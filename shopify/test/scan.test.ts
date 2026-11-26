import { hashEmail } from "@tiersaver/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { KLAVIYO_REQUIRED_SCOPES, KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { createKlaviyoClient, saveConnection, type ConnectionDeps } from "../app/klaviyo/connection.server";
import { FakeKlaviyo, type FakeProfile } from "../app/klaviyo/testing/fake-klaviyo";
import { createScan, executeScan, type ScanDeps, type ScanSteps, type ScanSummary } from "../app/scans/engine";
import { advanceOrdersSync, ordersAccessFromScopes } from "../app/orders/sync";
import { FakeShopifyOrders } from "./fake-shopify-orders";
import { Crash, FakeSteps, db, schema, uniqueShop } from "./helpers";

const ENCRYPTION_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));
const T0 = Date.parse("2026-11-25T12:00:00Z");
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(T0 - daysAgo * DAY).toISOString();

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** FakeSteps plus `sleep`, which is where a test lets "Klaviyo" finish computing the segment. */
class ScanFakeSteps extends FakeSteps implements ScanSteps {
  sleeps: string[] = [];
  onSleep: (name: string) => void = () => {};
  async sleep(name: string): Promise<void> {
    if (this.sleeps.includes(name)) return;
    this.sleeps.push(name);
    this.onSleep(name);
  }
}

const NATIVE_METRICS = [
  { id: "M_RECV", name: "Received Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_OPEN", name: "Opened Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_CLICK", name: "Clicked Email", integration: { name: "Klaviyo", category: "Internal" } },
  { id: "M_ORDER", name: "Placed Order", integration: { name: "Shopify", category: "eCommerce" } },
];

function fakeProfiles(count: number, overrides: Record<number, Partial<FakeProfile>> = {}): FakeProfile[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `P${String(i).padStart(5, "0")}`,
    email: `p${i}@shop.test`,
    created: iso(800),
    emailConsent: "SUBSCRIBED",
    emailConsentTimestamp: iso(790),
    ...overrides[i],
  }));
}

interface World {
  fake: FakeKlaviyo;
  shop: string;
  steps: ScanFakeSteps;
  deps: ScanDeps;
  /** Members Klaviyo will report once the segment is processed. */
  members: string[];
  scanId: string;
  run: () => ReturnType<typeof executeScan>;
}

async function world(opts: {
  profiles?: FakeProfile[];
  members?: (profiles: FakeProfile[]) => string[];
  scopes?: string;
  usage?: { used: number; max: number } | null;
  protectedGroupIds?: string[];
  purchasesCoveredSince?: Date | null;
  /** When the shop's orders were last read completely. Default: just now (current data). */
  purchasesCoveredUntil?: Date | null;
  syncPurchases?: (shop: string) => ReturnType<NonNullable<ScanDeps["syncPurchases"]>>;
  seededAccountId?: string | null;
  metrics?: typeof NATIVE_METRICS;
  limits?: ScanDeps["limits"];
} = {}): Promise<World> {
  const fake = new FakeKlaviyo();
  fake.now = () => T0;
  fake.metrics = opts.metrics ?? NATIVE_METRICS;
  const profiles = opts.profiles ?? fakeProfiles(250);
  for (const p of profiles) fake.profiles.set(p.id, p);
  if (opts.usage !== null) {
    const usage = opts.usage ?? { used: 5000, max: 5500 };
    fake.billingUsage = [{ id: "active_profiles", usage_used: usage.used, usage_max: usage.max, unit: "profiles" }];
  }
  const members = opts.members ? opts.members(profiles) : profiles.map((p) => p.id);

  const shop = uniqueShop();
  await db.insert(schema.shops).values({
    shop,
    purchasesCoveredSince: opts.purchasesCoveredSince === undefined ? new Date("2000-01-01T00:00:00Z") : opts.purchasesCoveredSince,
    purchasesCoveredUntil: opts.purchasesCoveredUntil === undefined ? new Date(T0) : opts.purchasesCoveredUntil,
  });
  await db.insert(schema.settings).values({ shop, protectedGroupIds: opts.protectedGroupIds ?? [] });

  const scopes = opts.scopes ?? KLAVIYO_SCOPES.join(" ");
  // Time only moves when the Klaviyo client waits (rate limiter, retries).
  const clock = { now: T0 };
  fake.now = () => clock.now;
  const connectionDeps: ConnectionDeps = {
    db,
    env: { TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret },
    fetch: fake.fetch,
    now: () => new Date(clock.now),
    sleep: async (ms) => {
      clock.now += ms;
    },
  };
  await saveConnection(connectionDeps, {
    shop,
    klaviyoAccountId: fake.accountId,
    tokens: { ...fake.issueTokens(scopes), expiresAt: new Date(T0 + 3600_000), scope: scopes },
    profilesUsageTypeId: opts.usage === null ? null : "active_profiles",
  });

  const steps = new ScanFakeSteps();
  // The segment is "processing" after every write; the first wait is when Klaviyo finishes it.
  steps.onSleep = () => {
    for (const segment of fake.segments) {
      if (segment.isProcessing) {
        segment.isProcessing = false;
        segment.members = members;
      }
    }
  };
  const deps: ScanDeps = {
    db: db as ScanDeps["db"],
    step: steps,
    klaviyo: (s) => createKlaviyoClient(connectionDeps, s),
    nonRetryable: (code) => new NonRetryableError(code),
    now: () => new Date(T0),
    seededAccountId: opts.seededAccountId ?? null,
    syncPurchases: opts.syncPurchases,
    limits: opts.limits,
  };
  const created = await createScan(deps.db, { shop, createdBy: "user:7", now: new Date(T0) });
  if (!created.ok) throw new Error("scan not created");
  return { fake, shop, steps, deps, members, scanId: created.scanId, run: () => executeScan(deps, created.scanId) };
}

async function results(w: World) {
  const scan = await db.query.scans.findFirst({ where: eq(schema.scans.id, w.scanId) });
  const simulation = scan?.simulationId ? await db.query.simulations.findFirst({ where: eq(schema.simulations.id, scan.simulationId) }) : undefined;
  const audit = scan?.auditId ? await db.query.audits.findFirst({ where: eq(schema.audits.id, scan.auditId) }) : undefined;
  const candidates = simulation ? await db.query.simulationCandidates.findMany({ where: eq(schema.simulationCandidates.simulationId, simulation.id) }) : [];
  const working = await db.query.scanProfiles.findMany({ where: eq(schema.scanProfiles.scanId, w.scanId) });
  return { scan, simulation, audit, candidates, working, summary: simulation?.summary as ScanSummary | undefined };
}

describe("scan: audit and simulation in one resumable pass", () => {
  it("evaluates the segment members with our own rules and stores an unapproved simulation", async () => {
    const profiles = fakeProfiles(250, {
      3: { smsConsent: "SUBSCRIBED", canReceiveSms: true },
      4: { created: iso(100) },
      5: { emailConsentTimestamp: iso(30) },
    });
    const w = await world({ profiles, members: (all) => all.slice(0, 230).map((p) => p.id), protectedGroupIds: ["list:VIP"] });
    w.fake.lists = [{ id: "VIP", name: "VIP", members: ["P00006", "P00240", "NOT_IN_SEGMENT"] }];
    // P7 bought in the Shopify store; P8 was restored by an earlier undo.
    await db.insert(schema.purchaseHashes).values({ shop: w.shop, emailHash: await hashEmail("p7@shop.test"), lastOrderAt: new Date(T0 - 900 * DAY) });
    await db.insert(schema.runs).values({ id: `undo-${w.scanId}`, shop: w.shop, kind: "undo", undoOfRunId: "earlier", createdBy: "user:7" });
    await db.insert(schema.runProfiles).values({
      runId: `undo-${w.scanId}`,
      profileId: "P00008",
      shop: w.shop,
      batchIndex: 0,
      reason: "never_engaged",
      emailHash: await hashEmail("p8@shop.test"),
      status: "submitted",
      reactivatedAt: new Date(T0 - 40 * DAY),
    });
    // An older open simulation exists; the new one replaces it.
    await db.insert(schema.simulations).values({
      id: `old-${w.scanId}`, shop: w.shop, settingsVersion: 1, ruleSettings: {}, coverage: {}, summary: {},
      evaluatedCount: 1, candidateCount: 1, protectedCount: 0, skippedCount: 0, activeProfiles: 1, priceTableId: "t",
    });

    const outcome = await w.run();
    expect(outcome).toMatchObject({ status: "completed", candidates: 224 });

    const r = await results(w);
    expect(r.scan).toMatchObject({ status: "completed", memberCount: 230, lastError: null });
    expect(r.working).toEqual([]);
    expect(r.simulation).toMatchObject({
      shop: w.shop,
      evaluatedCount: 230,
      candidateCount: 224,
      protectedCount: 6,
      skippedCount: 0,
      activeProfiles: 5000,
      activeProfilesSource: "klaviyo_usage",
      estimatedFeeCents: 1500,
      approvedAt: null,
      approvedBy: null,
      supersededAt: null,
      settingsVersion: 1,
    });
    expect(r.summary).toMatchObject({
      candidatesByReason: { never_engaged: 224, lapsed: 0 },
      protectedByReason: { sms_consent: 1, new_profile: 2, protected_group: 1, recent_purchase: 1, recently_reactivated: 1 },
    });
    expect(r.candidates).toHaveLength(224);
    const ids = new Set(r.candidates.map((c) => c.profileId));
    for (const safe of ["P00003", "P00004", "P00005", "P00006", "P00007", "P00008", "P00240"]) expect(ids.has(safe)).toBe(false);
    expect(r.candidates.find((c) => c.profileId === "P00000")).toMatchObject({ reason: "never_engaged", emailHash: await hashEmail("p0@shop.test") });
    expect(r.audit).toMatchObject({ activeProfiles: 5000, inactiveProfiles: 224, usageUsed: 5000, usageMax: 5500, activeProfilesSource: "klaviyo_usage" });

    const old = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, `old-${w.scanId}`) });
    expect(old?.supersededAt).not.toBeNull();

    // Read-only apart from the one managed segment; nothing was suppressed.
    const writes = w.fake.requests.filter((q) => q.method !== "GET" && q.url.pathname.startsWith("/api/"));
    expect(writes.map((q) => `${q.method} ${q.url.pathname}`)).toEqual(["POST /api/segments"]);
    expect(w.fake.jobs).toEqual([]);
    // No email address is stored anywhere by a scan.
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.shop, w.shop) });
    expect(JSON.stringify([r.simulation, r.audit, r.candidates, log])).not.toContain("@shop.test");
  });

  it("a second scan reuses the segment without writing it again", async () => {
    const w = await world({ profiles: fakeProfiles(30) });
    await w.run();
    const again = await createScan(w.deps.db, { shop: w.shop, createdBy: "user:7", now: new Date(T0 + 1000) });
    if (!again.ok) throw new Error("expected a new scan");
    const steps = new ScanFakeSteps();
    const outcome = await executeScan({ ...w.deps, step: steps }, again.scanId);
    expect(outcome).toMatchObject({ status: "completed", candidates: 30 });
    expect(w.fake.requestsTo(/^\/api\/segments/, "POST")).toHaveLength(1);
    expect(w.fake.requestsTo(/^\/api\/segments/, "PATCH")).toHaveLength(0);
    expect(steps.sleeps).toEqual([]);
  });

  it("only one scan per shop at a time", async () => {
    const w = await world({ profiles: fakeProfiles(5) });
    expect(await createScan(w.deps.db, { shop: w.shop, createdBy: "user:7", now: new Date(T0) })).toEqual({ ok: false, reason: "scan_in_progress", scanId: w.scanId });
    await w.run();
    expect((await createScan(w.deps.db, { shop: w.shop, createdBy: "user:7", now: new Date(T0) })).ok).toBe(true);
  });

  it("resumes after a crash without reading a page twice or duplicating a member", async () => {
    const w = await world({ profiles: fakeProfiles(250) });
    w.steps.crashBefore = "members 1";
    expect(await w.steps.runUntilCrash(w.run)).toBe("crashed");
    expect((await results(w)).working).toHaveLength(100);

    const outcome = await w.run();
    expect(outcome).toMatchObject({ status: "completed", candidates: 250 });
    const pages = w.fake.requestsTo(/^\/api\/segments\/[^/]+\/profiles$/);
    expect(pages).toHaveLength(3);
    expect((await results(w)).candidates).toHaveLength(250);
  });

  it("a step that dies after storing its page is repeated safely", async () => {
    const w = await world({ profiles: fakeProfiles(120) });
    let failed = false;
    const original = w.steps.do.bind(w.steps);
    w.steps.do = (name, config, callback) =>
      original(name, config, async () => {
        const value = await callback();
        if (name === "members 0" && !failed) {
          failed = true;
          throw new Error("lost after the write");
        }
        return value;
      });
    const outcome = await w.run();
    expect(outcome).toMatchObject({ status: "completed", candidates: 120 });
    expect((await results(w)).simulation).toMatchObject({ evaluatedCount: 120, candidateCount: 120 });
  });
});

describe("scan: active profile count", () => {
  it("counts emailable, unsuppressed profiles itself when the connection has no usage scope", async () => {
    const profiles = fakeProfiles(250, { 1: { suppression: ["USER_SUPPRESSED"] }, 2: { email: null } });
    const w = await world({ profiles, usage: null, scopes: KLAVIYO_REQUIRED_SCOPES.join(" "), members: (all) => all.slice(10, 60).map((p) => p.id) });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 50 });
    const r = await results(w);
    expect(r.simulation).toMatchObject({ activeProfiles: 248, activeProfilesSource: "counted" });
    expect(r.audit).toMatchObject({ activeProfiles: 248, suppressedProfiles: 1, usageUsed: null, usageMax: null });
    expect(w.fake.requestsTo(/^\/api\/billing-usage/)).toHaveLength(0);
  });

  it("does not trust a usage figure lower than what it just read (Klaviyo refreshes it twice a day)", async () => {
    const w = await world({ profiles: fakeProfiles(150), usage: { used: 0, max: 250 } });
    await w.run();
    const r = await results(w);
    expect(r.simulation).toMatchObject({ activeProfiles: 150, activeProfilesSource: "counted" });
    // Free plan: no Klaviyo plan estimate.
    expect(r.audit).toMatchObject({ savingsUnavailableReason: "free_plan", estimatedMonthlySavingsCents: 0 });
  });
});

describe("scan: every unknown protects, every failure leaves nothing behind", () => {
  it("a protected group that cannot be read protects everyone", async () => {
    const w = await world({ profiles: fakeProfiles(40), protectedGroupIds: ["GONE"] });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    const r = await results(w);
    expect(r.simulation).toMatchObject({ candidateCount: 0, protectedCount: 40 });
    expect(r.summary).toMatchObject({ protectedGroupsUnknown: true, protectedByReason: { protected_group: 40 } });
  });

  it("an id stored without its kind is found as a segment when it is not a list", async () => {
    const w = await world({ profiles: fakeProfiles(40), protectedGroupIds: ["SEGVIP"] });
    w.fake.segments.push({ id: "SEGVIP", name: "VIP segment", members: ["P00001", "P00002"] });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 38 });
  });

  it("without complete Shopify order history nobody is a candidate under the default rules", async () => {
    const w = await world({ profiles: fakeProfiles(40), purchasesCoveredSince: null });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect((await results(w)).summary).toMatchObject({ protectedByReason: { insufficient_purchase_history: 40 } });
  });

  it("an account without the built-in metrics gets a finished scan with nobody evaluated and no segment", async () => {
    const w = await world({ profiles: fakeProfiles(40), metrics: NATIVE_METRICS.filter((m) => m.name !== "Received Email") });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    const r = await results(w);
    expect(r.simulation).toMatchObject({ evaluatedCount: 0, candidateCount: 0, estimatedFeeCents: 0 });
    expect(r.summary).toMatchObject({ note: "received_metric_unresolved" });
    expect(w.fake.segments).toEqual([]);
  });

  it("fails, with no simulation, when the segment is edited while it is being read", async () => {
    const w = await world({ profiles: fakeProfiles(40) });
    const original = w.steps.do.bind(w.steps);
    w.steps.do = (name, config, callback) => {
      if (name === "segment verify") w.fake.segments[0]!.definition = { condition_groups: [{ conditions: [] }] };
      return original(name, config, callback);
    };
    expect(await w.run()).toEqual({ status: "failed", scanId: w.scanId, error: "candidate_segment_changed" });
    const r = await results(w);
    expect(r.scan).toMatchObject({ status: "failed", lastError: "candidate_segment_changed", simulationId: null, auditId: null });
    expect(r.working).toEqual([]);
    expect(await db.query.simulations.findMany({ where: eq(schema.simulations.shop, w.shop) })).toEqual([]);
  });

  it("fails when Klaviyo never finishes computing the segment", async () => {
    const w = await world({ profiles: fakeProfiles(5), limits: { maxSegmentPolls: 3 } });
    w.steps.onSleep = () => {};
    expect(await w.run()).toMatchObject({ status: "failed", error: "candidate_segment_still_processing" });
    expect(w.fake.requestsTo(/^\/api\/segments\/[^/]+\/profiles$/)).toHaveLength(0);
  });

  it("stops, without retrying, when Klaviyo access was revoked", async () => {
    const w = await world({ profiles: fakeProfiles(5) });
    w.fake.revokeEverything();
    expect(await w.run()).toMatchObject({ status: "failed", error: "klaviyo_needs_reauth" });
    const connection = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, w.shop) });
    expect(connection?.status).toBe("needs_reauth");
    expect(w.steps.executed.filter((s) => s === "account")).toHaveLength(1);

    // And a later scan does not even reach Klaviyo.
    const before = w.fake.requests.length;
    const next = await createScan(w.deps.db, { shop: w.shop, createdBy: "schedule", now: new Date(T0 + 1000) });
    if (!next.ok) throw new Error("expected a new scan");
    expect(await executeScan({ ...w.deps, step: new ScanFakeSteps() }, next.scanId)).toMatchObject({ status: "failed", error: "klaviyo_needs_reauth" });
    expect(w.fake.requests.length).toBe(before);
  });

  it("fails when the token belongs to a different Klaviyo account than the one connected", async () => {
    const w = await world({ profiles: fakeProfiles(5) });
    w.fake.accountId = "OTHER1";
    expect(await w.run()).toMatchObject({ status: "failed", error: "klaviyo_account_changed" });
  });

  it("a simulation computed with rules that changed meanwhile is born superseded", async () => {
    const w = await world({ profiles: fakeProfiles(20) });
    const original = w.steps.do.bind(w.steps);
    w.steps.do = async (name, config, callback) => {
      if (name === "finalize") await db.update(schema.settings).set({ version: 2 }).where(eq(schema.settings.shop, w.shop));
      return original(name, config, callback);
    };
    await w.run();
    expect((await results(w)).simulation?.supersededAt).not.toBeNull();
  });

  it("refuses more segment members than the plan's step budget allows", async () => {
    const w = await world({ profiles: fakeProfiles(250), limits: { maxMemberPages: 2 } });
    expect(await w.run()).toMatchObject({ status: "failed", error: "too_many_segment_members" });
    expect((await results(w)).working).toEqual([]);
  });
});

describe("scan: seeded test account", () => {
  const API_METRICS = ["Received Email", "Opened Email", "Clicked Email", "Placed Order"].map((name, i) => ({
    id: `API${i}`,
    name,
    integration: { name: "API", category: "API" },
  }));
  // Imported today, like every seeded profile; the intended age is in a profile property.
  const seeded = () =>
    fakeProfiles(20, { 0: { properties: { ts_seed_created_at: iso(200) } } }).map((p) => ({
      ...p,
      created: iso(0),
      emailConsent: "NEVER_SUBSCRIBED",
      emailConsentTimestamp: null,
      properties: p.properties ?? { ts_seed_created_at: iso(500) },
    }));

  it("reads API-owned metrics and the intended age only for the configured test account", async () => {
    const w = await world({ profiles: seeded(), metrics: API_METRICS, seededAccountId: "ACC001", purchasesCoveredSince: null });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 19 });
    const r = await results(w);
    expect(r.summary).toMatchObject({ seededTestAccount: true, protectedByReason: { new_profile: 1 } });
  });

  it("the same account id without Klaviyo's test flag is treated like any merchant", async () => {
    const w = await world({ profiles: seeded(), metrics: API_METRICS, seededAccountId: "ACC001" });
    w.fake.testAccount = false;
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect((await results(w)).summary).toMatchObject({ note: "received_metric_unresolved" });
  });

  it("another account is never read in seeded mode", async () => {
    const w = await world({ profiles: seeded(), metrics: [...NATIVE_METRICS, ...API_METRICS], seededAccountId: "SGKvLG" });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    const r = await results(w);
    expect(r.summary?.seededTestAccount).toBeUndefined();
    expect(r.summary).toMatchObject({ protectedByReason: { new_profile: 20 } });
  });
});

describe("scan: cycle detector (guardrail 6)", () => {
  /** A finished cleanup of this shop that suppressed the given profiles `daysAgo` days ago. */
  async function earlierCleanup(w: World, profileNumbers: number[], daysAgo: number) {
    const simulationId = crypto.randomUUID();
    const at = new Date(T0 - daysAgo * DAY);
    await db.insert(schema.simulations).values({ id: simulationId, shop: w.shop, createdAt: at, settingsVersion: 1, ruleSettings: {}, coverage: {}, summary: {}, evaluatedCount: 1, candidateCount: 1, protectedCount: 0, skippedCount: 0, activeProfiles: 1, priceTableId: "t", approvedAt: at, approvedBy: "user:7", executedAt: at });
    const runId = crypto.randomUUID();
    await db.insert(schema.runs).values({ id: runId, shop: w.shop, kind: "suppress", simulationId, status: "completed", createdBy: "user:7", createdAt: at, finishedAt: at });
    for (const n of profileNumbers) {
      await db.insert(schema.runProfiles).values({ runId, profileId: `P${String(n).padStart(5, "0")}`, shop: w.shop, batchIndex: 0, reason: "never_engaged", emailHash: await hashEmail(`p${n}@shop.test`), status: "submitted", updatedAt: at });
    }
    return runId;
  }

  it("keeps active, locks and reports profiles a cleanup suppressed that are active again, and pauses the schedule", async () => {
    const w = await world({ profiles: fakeProfiles(20) });
    await db.update(schema.settings).set({ scheduleEnabled: true, mode: "automatic" }).where(eq(schema.settings.shop, w.shop));
    // P1 and P2 were suppressed 10 days ago and are members of the segment again: someone unsuppressed them.
    const runId = await earlierCleanup(w, [1, 2], 10);

    expect((await w.run()).status).toBe("completed");
    const r = await results(w);
    expect(r.summary?.resurfaced).toBe(2);
    expect(r.simulation?.candidateCount).toBe(18);
    expect(r.candidates.map((c) => c.profileId)).not.toContain("P00001");
    expect(r.summary?.protectedByReason.recently_reactivated).toBe(2);

    const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, w.shop) });
    expect(settings).toMatchObject({ scheduleEnabled: false, mode: "approval", version: 1 });
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.shop, w.shop) });
    expect(log.some((l) => l.action === "schedule.paused_cycle_detected")).toBe(true);

    // The lock is permanent history, not a one-off: the rows now carry a restore stamp.
    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(rows.every((p) => p.reactivatedAt?.getTime() === T0)).toBe(true);
  });

  it("does not mistake a cleanup Klaviyo is still applying for a cycle", async () => {
    const w = await world({ profiles: fakeProfiles(20) });
    await db.update(schema.settings).set({ scheduleEnabled: true }).where(eq(schema.settings.shop, w.shop));
    await earlierCleanup(w, [1, 2], 1); // yesterday: inside the 72 h grace period
    await w.run();
    const r = await results(w);
    expect(r.summary?.resurfaced).toBeUndefined();
    expect((await db.query.settings.findFirst({ where: eq(schema.settings.shop, w.shop) }))?.scheduleEnabled).toBe(true);
  });

  it("another shop's cleanup history never affects this shop", async () => {
    const other = await world({ profiles: fakeProfiles(5) });
    await earlierCleanup(other, [1, 2], 10);
    const w = await world({ profiles: fakeProfiles(20) });
    await w.run();
    expect((await results(w)).simulation?.candidateCount).toBe(20);
  });
});

describe("scan: Shopify purchase data must be current (C1)", () => {
  const HOUR = 3_600_000;
  const reasonsOf = async (w: World) => (await results(w)).summary?.protectedByReason;

  /** A scan wired to the real orders sync, reading a fake Shopify. */
  function shopify(orders: FakeShopifyOrders["orders"]) {
    const fake = new FakeShopifyOrders();
    fake.now = () => T0;
    fake.readAllOrders = true;
    fake.orders = orders;
    const access = ordersAccessFromScopes(fake.graphql, "read_orders,read_all_orders");
    return { fake, sync: (shop: string) => advanceOrdersSync(db, access, { shop, maxPages: 4, now: () => new Date(T0) }) };
  }

  it("a buyer who ordered after the install-time backfill is not a candidate: the scan reads the new orders first", async () => {
    // Installed 300 days ago; the backfill ran then and nothing has read orders since (no orders/create webhook).
    const { fake, sync } = shopify([
      { email: "P3@shop.test", processedAt: iso(120) },
      { email: "p9@shop.test", processedAt: iso(2) },
      { email: "someone-else@shop.test", processedAt: iso(50) },
    ]);
    const w = await world({ profiles: fakeProfiles(40), purchasesCoveredUntil: new Date(T0 - 300 * DAY), syncPurchases: sync });

    expect(await w.run()).toMatchObject({ status: "completed", candidates: 38 });
    const r = await results(w);
    expect(r.summary).toMatchObject({ protectedByReason: { recent_purchase: 2 } });
    expect(r.summary?.purchaseDataStale).toBeUndefined();
    const ids = new Set(r.candidates.map((c) => c.profileId));
    expect(ids.has("P00003")).toBe(false);
    expect(ids.has("P00009")).toBe(false);
    // Read by update date from the end of the old coverage, and the simulation records how current the data was.
    expect(fake.calls[0]!.variables.query).toMatch(/^updated_at:>=/);
    expect(w.steps.executed).toContain("purchases sync 0");
    expect(w.steps.executed.indexOf("purchases coverage")).toBeLessThan(w.steps.executed.indexOf("evaluate 0"));
    expect(r.simulation?.coverage).toMatchObject({ purchasesSince: "2000-01-01T00:00:00.000Z", purchasesUntil: new Date(T0 - 5 * 60_000).toISOString() });
  });

  it("order data that was not refreshed protects everyone, however far back it reaches", async () => {
    for (const purchasesCoveredUntil of [null, new Date(T0 - 300 * DAY), new Date(T0 - 7 * HOUR)]) {
      const w = await world({ profiles: fakeProfiles(40), purchasesCoveredUntil });
      // The one buyer the stale data does know about keeps the more specific reason.
      await db.insert(schema.purchaseHashes).values({ shop: w.shop, emailHash: await hashEmail("p7@shop.test"), lastOrderAt: new Date(T0 - 900 * DAY) });
      expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
      expect(await reasonsOf(w)).toEqual({ insufficient_purchase_history: 39, recent_purchase: 1 });
      expect((await results(w)).summary).toMatchObject({ purchaseDataStale: true });
    }
  });

  it("stale data protects in the wider mode as well (a purchase window is not proof without current data)", async () => {
    const w = await world({ profiles: fakeProfiles(40), purchasesCoveredUntil: new Date(T0 - 305 * DAY) });
    await db.update(schema.settings).set({ purchaseDays: 365, clickDays: 365, openDays: 365, siteActivityDays: 365 }).where(eq(schema.settings.shop, w.shop));
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect(await reasonsOf(w)).toEqual({ insufficient_purchase_history: 40 });
  });

  it("when Shopify cannot be read during the scan: data read within the last hours still counts, older data protects everyone", async () => {
    const failing = async () => {
      throw new Error("shopify_graphql_error");
    };
    const recent = await world({ profiles: fakeProfiles(40), purchasesCoveredUntil: new Date(T0 - 2 * HOUR), syncPurchases: failing });
    expect(await recent.run()).toMatchObject({ status: "completed", candidates: 40 });

    const old = await world({ profiles: fakeProfiles(40), purchasesCoveredUntil: new Date(T0 - 2 * DAY), syncPurchases: failing });
    expect(await old.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect(await reasonsOf(old)).toEqual({ insufficient_purchase_history: 40 });
  });

  it("a backlog too large to read inside the scan protects everyone; the scan does not wait forever", async () => {
    let calls = 0;
    const w = await world({
      profiles: fakeProfiles(40),
      purchasesCoveredUntil: new Date(T0 - 30 * DAY),
      limits: { maxPurchaseSyncSteps: 3 },
      syncPurchases: async () => {
        calls++;
        return { status: "more" as const };
      },
    });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect(calls).toBe(3);
    expect(await reasonsOf(w)).toEqual({ insufficient_purchase_history: 40 });
  });

  it("a first backfill that has not finished leaves no coverage, so nobody is a candidate", async () => {
    const { fake, sync } = shopify(Array.from({ length: 30 }, (_, i) => ({ email: `b${i}@shop.test`, processedAt: iso(i + 1) })));
    fake.pageSize = 1;
    const w = await world({ profiles: fakeProfiles(40), purchasesCoveredSince: null, purchasesCoveredUntil: null, limits: { maxPurchaseSyncSteps: 2 }, syncPurchases: sync });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 0 });
    expect(fake.calls).toHaveLength(8);
    expect(await reasonsOf(w)).toEqual({ insufficient_purchase_history: 40 });
  });

  it("the seeded test account has no Shopify orders behind it and is not read", async () => {
    let calls = 0;
    const seeded = fakeProfiles(20).map((p) => ({ ...p, created: iso(0), emailConsent: "NEVER_SUBSCRIBED", emailConsentTimestamp: null, properties: { ts_seed_created_at: iso(500) } }));
    const w = await world({
      profiles: seeded,
      metrics: [
        { id: "A_RECV", name: "Received Email", integration: { name: "API", category: "API" } },
        { id: "A_OPEN", name: "Opened Email", integration: { name: "API", category: "API" } },
        { id: "A_CLICK", name: "Clicked Email", integration: { name: "API", category: "API" } },
      ],
      seededAccountId: "ACC001",
      purchasesCoveredSince: null,
      purchasesCoveredUntil: null,
      syncPurchases: async () => {
        calls++;
        return { status: "fresh" as const };
      },
    });
    expect(await w.run()).toMatchObject({ status: "completed", candidates: 20 });
    expect(calls).toBe(0);
  });
});
