import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { validateRuleSettings } from "@tiersaver/core";
import * as schema from "../app/db/schema";
import { buildCandidateSegmentDefinition } from "../app/klaviyo/api";
import { CANDIDATE_SEGMENT_NAME } from "../app/klaviyo/config";
import type { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { rulesOf } from "../app/settings/settings";
import type { BatchRequest, BatchResult, StepConfig, StepRunner, SuppressionGateway } from "../app/runs/engine";

export const db = drizzle(env.DB, { schema });
export { schema };

let counter = 0;
export function uniqueShop(): string {
  return `test-${Date.now()}-${counter++}.myshopify.com`;
}

/** Inserts a shop with default settings and a simulation with `candidates` profiles. */
export async function seedSimulation(opts: {
  shop?: string;
  candidates: number;
  createdAt?: Date;
  approved?: boolean;
  approvedAt?: Date;
  settingsVersion?: number;
}): Promise<{ shop: string; simulationId: string; profileIds: string[] }> {
  const shop = opts.shop ?? uniqueShop();
  const createdAt = opts.createdAt ?? new Date();
  const simulationId = crypto.randomUUID();
  await db.insert(schema.shops).values({ shop }).onConflictDoNothing();
  await db.insert(schema.settings).values({ shop }).onConflictDoNothing();
  const approved = opts.approved ?? true;
  await db.insert(schema.simulations).values({
    id: simulationId,
    shop,
    createdAt,
    settingsVersion: opts.settingsVersion ?? 1,
    ruleSettings: {},
    coverage: {},
    summary: {},
    evaluatedCount: opts.candidates * 3,
    candidateCount: opts.candidates,
    protectedCount: opts.candidates * 2,
    skippedCount: 0,
    activeProfiles: opts.candidates * 3,
    priceTableId: "test-table",
    approvedAt: approved ? (opts.approvedAt ?? new Date(createdAt.getTime() + 1000)) : null,
    approvedBy: approved ? "user:1" : null,
  });
  const profileIds = Array.from({ length: opts.candidates }, (_, i) => `P${String(i).padStart(6, "0")}`);
  for (let i = 0; i < profileIds.length; i += 20) {
    await db.insert(schema.simulationCandidates).values(
      profileIds.slice(i, i + 20).map((profileId) => ({
        simulationId,
        profileId,
        reason: "lapsed",
        emailHash: `hash-${profileId}`,
      })),
    );
  }
  return { shop, simulationId, profileIds };
}

/** Records every batch it receives; can be told to fail or to simulate a crash. */
export class FakeGateway implements SuppressionGateway {
  calls: BatchRequest[] = [];
  /** Return an error to throw for this call, or nothing to succeed. */
  failWhen: (request: BatchRequest, callNumber: number) => Error | void = () => {};
  skip: (request: BatchRequest) => string[] = () => [];

  async submitBatch(request: BatchRequest): Promise<BatchResult> {
    this.calls.push(request);
    const err = this.failWhen(request, this.calls.length);
    if (err) throw err;
    return { jobId: `job-${request.batchIndex}-${this.calls.length}`, skippedProfileIds: this.skip(request) };
  }

  /** How many times each profile was sent in a call that succeeded or failed. */
  sentCount(): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of this.calls) for (const id of c.profileIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }
}

/** Thrown by FakeSteps to simulate the Worker being killed in the middle of a run. */
export class Crash extends Error {
  constructor() {
    super("simulated crash");
    this.name = "Crash";
  }
}

/**
 * Minimal stand-in for Cloudflare's WorkflowStep: caches successful and
 * permanently failed steps by name, retries up to `retries.limit` times
 * (without sleeping) and does not retry NonRetryableError. The cache survives
 * across `executeRun` calls, like the engine's persisted state survives a restart.
 */
export class FakeSteps implements StepRunner {
  private results = new Map<string, { ok: true; value: unknown } | { ok: false; error: Error }>();
  executed: string[] = [];
  /** Kill the "Worker" right before this step runs (once). */
  crashBefore: string | null = null;
  private onCrash: (() => void) | null = null;

  /**
   * Runs `work` until it finishes or the simulated Worker dies. A real crash is
   * not an exception the engine could catch: execution simply stops. So a
   * crashed step never settles, and this resolves with "crashed" instead.
   */
  async runUntilCrash<T>(work: () => Promise<T>): Promise<T | "crashed"> {
    const crashed = new Promise<"crashed">((resolve) => {
      this.onCrash = () => resolve("crashed");
    });
    return Promise.race([work(), crashed]);
  }

  private crash(): Promise<never> {
    this.onCrash?.();
    return new Promise<never>(() => {});
  }

  async do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T> {
    const cached = this.results.get(name);
    if (cached) {
      if (cached.ok) return cached.value as T;
      throw cached.error;
    }
    if (this.crashBefore === name) {
      this.crashBefore = null;
      return this.crash();
    }
    const attempts = (config.retries?.limit ?? 0) + 1;
    let lastError: Error = new Error("no attempts");
    for (let i = 0; i < attempts; i++) {
      try {
        this.executed.push(name);
        const value = await callback();
        this.results.set(name, { ok: true, value: structuredClone(value) });
        return value;
      } catch (err) {
        if (err instanceof Crash) return this.crash();
        lastError = err as Error;
        if (lastError.name === "NonRetryableError") break;
      }
    }
    this.results.set(name, { ok: false, error: lastError });
    throw lastError;
  }
}

export async function profileStatuses(runId: string): Promise<Record<string, number>> {
  const rows = await db.query.runProfiles.findMany({ where: (p, { eq }) => eq(p.runId, runId) });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export const NATIVE_METRICS = [
  { id: "M_RECV", name: "Received Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_OPEN", name: "Opened Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_CLICK", name: "Clicked Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_ORDER", name: "Placed Order", integration: { name: "Shopify", category: "eCommerce" } },
];

/**
 * Puts TierSaver's managed candidate segment into the fake Klaviyo, as a finished scan leaves it: built-in
 * metrics, the definition the shop's current rules produce, computed, with `members`. Returns the segment
 * (mutable: tests remove members, flip `isProcessing`, edit the definition).
 */
export async function installCandidateSegment(fake: FakeKlaviyo, shop: string, members: string[]) {
  if (fake.metrics.length === 0) fake.metrics = NATIVE_METRICS;
  const settings = await db.query.settings.findFirst({ where: (s, { eq }) => eq(s.shop, shop) });
  if (!settings) throw new Error("no settings for shop");
  const built = buildCandidateSegmentDefinition(
    fake.metrics.map((m) => ({ id: m.id, name: m.name, integrationName: m.integration.name, integrationCategory: m.integration.category })),
    validateRuleSettings(rulesOf(settings)).settings,
  );
  if (!built.ok) throw new Error(built.reason);
  const segment: FakeKlaviyo["segments"][number] = { id: "SEGCAND", name: CANDIDATE_SEGMENT_NAME, members: [...members], definition: built.definition, isProcessing: false };
  fake.segments = fake.segments.filter((s) => s.name !== CANDIDATE_SEGMENT_NAME);
  fake.segments.push(segment);
  return segment;
}
