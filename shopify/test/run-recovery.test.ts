import { hashShopEmail } from "../app/email-hash";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { saveConnection } from "../app/klaviyo/connection.server";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { recordPurchases } from "../app/orders/purchases";
import { confirmJobsPage } from "../app/runs/confirm";
import { closeStalledRun, createSuppressionRun, createUndoRun, executeRun, requestStopRun, type BatchRequest } from "../app/runs/engine";
import { SUPPRESSION_EVIDENCE_MARGIN_MS, createSuppressionGateway, undoEvidence, type GatewayEnv } from "../app/runs/gateway.server";
import { ABANDON_AFTER_MINUTES, QUEUED_STALL_MINUTES, RUNNING_STALL_MINUTES, instanceStateOf, recoverStalledRuns, type InstanceState } from "../app/runs/recovery";
import { loadRunDetail } from "../app/runs/view.server";
import { AUTO_GROWTH_FLOOR, AUTO_MAX_CANDIDATE_SHARE, AUTO_MAX_GROWTH_FACTOR, automaticReview, decideAutomatic } from "../app/schedule/automatic";
import { FakeGateway, FakeSteps, db, installCandidateSegment, profileStatuses, schema, seedSimulation, uniqueShop } from "./helpers";

/**
 * Regression tests for the 2026-11-26 review: C2 (stalled runs), A1 + S-07
 * (re-validation before each batch), M3 (lost answers), M6 (undo and foreign
 * suppressions), M8 (stop), A6 (automatic mode guardrails), S-08, B3.
 */

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256)));
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const emailOf = (id: string) => `${id.toLowerCase()}@buyers.test`;

async function newRun(candidates: number, shop?: string) {
  const s = await seedSimulation({ candidates, shop });
  const created = await createSuppressionRun(db, { shop: s.shop, simulationId: s.simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  return { ...s, runId: created.runId };
}

/** A queued cleanup with a connected fake Klaviyo that looks like the scan left it: profiles, hashes, candidate segment. */
async function world(candidates: number, configure?: (fake: FakeKlaviyo) => void) {
  const fake = new FakeKlaviyo();
  configure?.(fake);
  const s = await seedSimulation({ candidates });
  for (const id of s.profileIds) {
    fake.profiles.set(id, { id, email: emailOf(id) });
    await db.update(schema.simulationCandidates).set({ emailHash: await hashShopEmail(s.shop, emailOf(id)) }).where(eq(schema.simulationCandidates.profileId, id));
  }
  const created = await createSuppressionRun(db, { shop: s.shop, simulationId: s.simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  const segment = await installCandidateSegment(fake, s.shop, s.profileIds);
  const genv: GatewayEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY, KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret, SUPPRESSION_ENABLED: "true" };
  const tokens = fake.issueTokens(KLAVIYO_SCOPES.join(" "));
  await saveConnection({ db, env: genv }, { shop: s.shop, klaviyoAccountId: fake.accountId, tokens: { ...tokens, expiresAt: new Date(Date.now() + HOUR), scope: KLAVIYO_SCOPES.join(" ") } });
  const gatewayWith = (fetchImpl: typeof fetch = fake.fetch) => createSuppressionGateway(genv, s.shop, { fetch: fetchImpl, sleep: async () => {} });
  const reasons = async (runId = created.runId) => {
    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    return Object.fromEntries(rows.map((r) => [r.profileId, `${r.status}${r.errorCode ? `:${r.errorCode}` : ""}`]));
  };
  const undo = async () => {
    const created2 = await createUndoRun(db, { shop: s.shop, runId: created.runId, createdBy: "user:2", confirmAfterRenewal: true });
    if (!created2.ok) throw new Error(created2.reason);
    const outcome = await executeRun({ db, gateway: gatewayWith(), step: new FakeSteps() }, created2.runId);
    return { runId: created2.runId, outcome };
  };
  return { ...s, fake, segment, runId: created.runId, gateway: gatewayWith(), gatewayWith, reasons, undo };
}

type World = Awaited<ReturnType<typeof world>>;

const recovery = (state: InstanceState | ((runId: string) => InstanceState), now: Date) => {
  const launched: string[] = [];
  const terminated: string[] = [];
  return {
    launched,
    terminated,
    run: (opts: { launchFails?: boolean } = {}) =>
      recoverStalledRuns({
        db,
        now,
        max: 200,
        instanceState: async (id) => (typeof state === "function" ? state(id) : state),
        launch: async (id) => (launched.push(id), !opts.launchFails),
        terminate: async (id) => void terminated.push(id),
      }),
  };
};

describe("C2: a run whose Workflow died is recovered", () => {
  it("is closed with what was really sent, and can then be undone", async () => {
    const { shop, runId } = await newRun(250);
    const steps = new FakeSteps();
    steps.crashBefore = "batch 1";
    expect(await steps.runUntilCrash(() => executeRun({ db, gateway: new FakeGateway(), step: steps }, runId))).toBe("crashed");
    expect((await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) }))?.status).toBe("running");
    expect(await createUndoRun(db, { shop, runId, createdBy: "user:1", confirmAfterRenewal: true })).toMatchObject({ ok: false, reason: "still_running" });

    // Too early: a healthy run can be silent for a few minutes.
    const early = recovery("dead", new Date(Date.now() + (RUNNING_STALL_MINUTES - 5) * MINUTE));
    expect((await early.run()).closed).not.toContain(runId);
    // An instance that is alive is left alone.
    const alive = recovery((id) => (id === runId ? "alive" : "unknown"), new Date(Date.now() + (RUNNING_STALL_MINUTES + 5) * MINUTE));
    expect((await alive.run()).closed).not.toContain(runId);
    // So is one that cannot be asked.
    const unknown = recovery("unknown", new Date(Date.now() + (RUNNING_STALL_MINUTES + 5) * MINUTE));
    expect((await unknown.run()).closed).not.toContain(runId);

    const dead = recovery((id) => (id === runId ? "dead" : "unknown"), new Date(Date.now() + (RUNNING_STALL_MINUTES + 5) * MINUTE));
    const report = await dead.run();
    expect(report.closed).toEqual([runId]);
    expect(dead.launched).toEqual([]); // nothing is sent again

    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    expect(run).toMatchObject({ status: "completed_with_errors", processedCount: 100, failedCount: 0, unknownCount: 0, lastError: "run_stalled" });
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(await profileStatuses(runId)).toEqual({ submitted: 100, pending: 150 });
    const log = await db.query.eventsLog.findFirst({ where: eq(schema.eventsLog.id, `run:${runId}:finished`) });
    expect(log).toMatchObject({ action: "run.completed_with_errors", detail: { submitted: 100, untouched: 150, error: "run_stalled" } });

    expect(await createUndoRun(db, { shop, runId, createdBy: "user:1", confirmAfterRenewal: true })).toMatchObject({ ok: true, totalCount: 100 });
    // A second pass has nothing left to do.
    expect((await dead.run()).closed).toEqual([]);
  });

  it("a batch that was in flight when the Workflow died counts as possibly sent, and undo includes it", async () => {
    const w = await world(130);
    // Batch 0 goes out; the Worker dies before the answer is recorded.
    let died = false;
    const dying = {
      async submitBatch(request: BatchRequest) {
        const result = await w.gateway.submitBatch(request);
        if (request.batchIndex === 0) {
          died = true;
          return new Promise<never>(() => {});
        }
        return result;
      },
    };
    void executeRun({ db, gateway: dying, step: new FakeSteps() }, w.runId);
    await expect.poll(() => died, { timeout: 5000 }).toBe(true);
    expect(await profileStatuses(w.runId)).toEqual({ submitting: 100, pending: 30 });
    expect(w.fake.suppressed.size).toBe(100);

    const outcome = await closeStalledRun(db, w.runId, { error: "run_stalled" });
    expect(outcome).toMatchObject({ status: "completed_with_errors", submitted: 0, unknown: 100, failed: 0, untouched: 30 });
    expect(await profileStatuses(w.runId)).toEqual({ failed: 100, pending: 30 });

    const detail = await loadRunDetail(w.shop, w.runId);
    expect(detail?.run.unknown).toBe(100);
    expect(detail?.undo?.restorable).toBe(100);
    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 100 });
    expect(w.fake.suppressed.size).toBe(0);
    expect((await loadRunDetail(w.shop, w.runId))?.undo).toMatchObject({ restorable: 0, restored: 100 });
  });

  it("a claimed batch that never left is untouched again after the run is closed", async () => {
    const { runId } = await newRun(120);
    await db.update(schema.runs).set({ status: "running", startedAt: new Date() }).where(eq(schema.runs.id, runId));
    await db.update(schema.runProfiles).set({ status: "submitting" }).where(eq(schema.runProfiles.runId, runId));
    const outcome = await closeStalledRun(db, runId, { error: "run_stalled" });
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, unknown: 0, untouched: 120, error: "run_stalled" });
    expect(await profileStatuses(runId)).toEqual({ pending: 120 });
  });

  it("a queued run without a Workflow is started again with the same id, or closed when that is no longer possible", async () => {
    const a = await newRun(5);
    const soon = recovery((id) => (id === a.runId ? "missing" : "unknown"), new Date(Date.now() + (QUEUED_STALL_MINUTES - 2) * MINUTE));
    expect((await soon.run()).relaunched).toEqual([]);

    const later = recovery((id) => (id === a.runId ? "missing" : "unknown"), new Date(Date.now() + (QUEUED_STALL_MINUTES + 1) * MINUTE));
    expect(await later.run()).toMatchObject({ relaunched: [a.runId], closed: [] });
    expect(later.launched).toEqual([a.runId]);
    expect((await db.query.runs.findFirst({ where: eq(schema.runs.id, a.runId) }))?.status).toBe("queued");
    expect(await db.query.eventsLog.findFirst({ where: eq(schema.eventsLog.id, `run:${a.runId}:relaunched`) })).toMatchObject({ action: "run.relaunched", actor: "system" });

    // The relaunched run decides for itself: by now the simulation is too old, so nobody is touched.
    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: new FakeSteps(), now: () => new Date(Date.now() + 25 * HOUR) }, a.runId);
    expect(outcome).toMatchObject({ status: "failed", error: "simulation_expired", submitted: 0 });
    expect(gateway.calls).toHaveLength(0);

    // The instance exists but ended without ever starting the run: closed, nothing sent, the shop is free again.
    const b = await newRun(5);
    const dead = recovery((id) => (id === b.runId ? "dead" : "unknown"), new Date(Date.now() + (QUEUED_STALL_MINUTES + 1) * MINUTE));
    expect((await dead.run()).closed).toEqual([b.runId]);
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.id, b.runId) })).toMatchObject({ status: "failed", lastError: "run_never_started", processedCount: 0 });

    // Workflows cannot create the instance: stays queued for the next tick; after a day it is closed instead.
    const c = await newRun(5);
    const failing = recovery((id) => (id === c.runId ? "missing" : "unknown"), new Date(Date.now() + HOUR));
    expect(await failing.run({ launchFails: true })).toMatchObject({ relaunched: [], closed: [] });
    const dayLater = recovery((id) => (id === c.runId ? "missing" : "unknown"), new Date(Date.now() + 25 * HOUR));
    // (Other runs left open by this file's tests are a day silent by then and are closed as abandoned too.)
    expect((await dayLater.run()).closed).toContain(c.runId);
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.id, c.runId) })).toMatchObject({ status: "failed", lastError: "run_never_started" });
    expect(dayLater.launched).toEqual([]);
  });

  it("a run that is alive on paper but silent for hours is terminated and closed", async () => {
    const { runId } = await newRun(150);
    const steps = new FakeSteps();
    steps.crashBefore = "batch 1";
    await steps.runUntilCrash(() => executeRun({ db, gateway: new FakeGateway(), step: steps }, runId));
    const stuck = recovery((id) => (id === runId ? "alive" : "unknown"), new Date(Date.now() + (ABANDON_AFTER_MINUTES + 5) * MINUTE));
    expect((await stuck.run()).closed).toEqual([runId]);
    expect(stuck.terminated).toEqual([runId]);
    // If that Workflow wakes up after all, it finds a closed run and sends nothing more.
    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: steps }, runId);
    expect(gateway.calls).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "completed_with_errors", submitted: 100, untouched: 50 });
  });

  it("maps Workflow instance states", () => {
    expect(["queued", "running", "waiting", "paused"].map(instanceStateOf)).toEqual(["alive", "alive", "alive", "alive"]);
    expect(["errored", "terminated", "complete"].map(instanceStateOf)).toEqual(["dead", "dead", "dead"]);
    expect(instanceStateOf("unknown")).toBe("unknown");
  });
});

describe("A1 + S-07: every batch is validated again right before it is sent", () => {
  it("skips, with a reason, whoever is no longer exactly what was approved", async () => {
    const w = await world(8);
    const [buyer, engaged, suppressed, unsubscribed, redacted, changed, noState, ok] = w.profileIds as [string, string, string, string, string, string, string, string];
    // An order arrives through the orders/create webhook after the simulation.
    await recordPurchases(db, w.shop, [{ email: emailOf(buyer), processedAt: new Date(), test: false }]);
    // Opened an email: Klaviyo dropped the profile from the candidate segment.
    w.segment.members = w.segment.members.filter((id) => id !== engaged);
    // Suppressed by the merchant, and unsubscribed, in the meantime (the segment has not caught up yet).
    w.fake.suppressed.add(emailOf(suppressed));
    w.fake.profiles.get(unsubscribed)!.suppression = ["UNSUBSCRIBE"];
    // customers/redact removed the stored hash.
    await db.update(schema.runProfiles).set({ emailHash: null }).where(eq(schema.runProfiles.profileId, redacted));
    w.fake.profiles.get(changed)!.email = "new-address@buyers.test";
    w.fake.profiles.get(noState)!.omitSubscriptions = true;

    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 1, skipped: 7, failed: 0, unknown: 0 });
    expect(await w.reasons()).toEqual({
      [buyer]: "skipped:purchased_since_simulation",
      [engaged]: "skipped:not_in_candidate_segment",
      [suppressed]: "skipped:already_suppressed",
      [unsubscribed]: "skipped:already_suppressed",
      [redacted]: "skipped:email_hash_missing",
      [changed]: "skipped:email_changed",
      [noState]: "skipped:state_unknown",
      [ok]: "submitted",
    });
    expect(w.fake.jobs).toHaveLength(1);
    expect(w.fake.jobs[0]!.emails).toEqual([emailOf(ok)]);
    expect(w.fake.suppressed.has(emailOf(buyer))).toBe(false);
    expect(w.fake.suppressed.has("new-address@buyers.test")).toBe(false);

    // The run page gets the reasons, most frequent first; nothing here is personal data.
    const detail = await loadRunDetail(w.shop, w.runId);
    expect(detail?.skipReasons[0]).toEqual({ reason: "already_suppressed", count: 2 });
    expect(detail?.skipReasons.map((r) => r.reason).sort()).toEqual(["already_suppressed", "email_changed", "email_hash_missing", "not_in_candidate_segment", "purchased_since_simulation", "state_unknown"]);
    // The buyer and the redacted customer were never looked up in Klaviyo.
    const filters = w.fake.requestsTo(/\/api\/segments\/[^/]+\/profiles$/).map((r) => r.url.searchParams.get("filter") ?? "");
    expect(filters.join()).not.toContain(buyer);
    expect(filters.join()).not.toContain(redacted);
  });

  it("an order that was recorded before the scan began does not block anybody (it was already evaluated)", async () => {
    const w = await world(2);
    await db.insert(schema.purchaseHashes).values({ shop: w.shop, emailHash: await hashShopEmail(w.shop, emailOf(w.profileIds[0]!)), lastOrderAt: new Date(Date.now() - 400 * 24 * HOUR), updatedAt: new Date(Date.now() - 2 * HOUR) });
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 2, skipped: 0 });
  });

  it.each([
    ["deleted", (w: World): void => void (w.fake.segments = []), "candidate_segment_missing"],
    ["edited", (w: World): void => void (w.segment.definition = { condition_groups: [{ conditions: [] }] }), "candidate_segment_changed"],
    ["deactivated", (w: World): void => void (w.segment.isActive = false), "candidate_segment_changed"],
    ["still being computed", (w: World): void => void (w.segment.isProcessing = true), "candidate_segment_processing"],
  ] as const)("stops without touching anybody when the candidate segment was %s", async (_name, change, error) => {
    const w = await world(130);
    change(w);
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, unknown: 0, error });
    expect(await profileStatuses(w.runId)).toEqual({ failed: 100, pending: 30 });
    expect(w.fake.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    expect(w.fake.suppressed.size).toBe(0);
  });

  it("refuses when the connected Klaviyo account is not the one the shop connected", async () => {
    const w = await world(3);
    w.fake.accountId = "OTHER9";
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, error: "klaviyo_account_changed" });
    expect(w.fake.suppressed.size).toBe(0);
  });

  it("checks the segment once for the batches of a run, not once per batch", async () => {
    const w = await world(250);
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250 });
    expect(w.fake.requestsTo(/^\/api\/segments$/)).toHaveLength(1);
    expect(w.fake.requestsTo(/^\/api\/accounts$/)).toHaveLength(1);
    // 3 batches (100 + 100 + 50) at 20 ids per member read: 5 + 5 + 3 reads, and 3 jobs.
    expect(w.fake.requestsTo(/\/api\/segments\/[^/]+\/profiles$/)).toHaveLength(13);
    expect(w.fake.jobs).toHaveLength(3);
  });
});

describe("M3: a batch Klaviyo accepted but whose answer was lost", () => {
  it("is kept as 'outcome unknown', never as untouched, and undo restores it", async () => {
    const w = await world(5);
    // Klaviyo applies every suppression job; the answer never reaches us.
    const lossy: typeof fetch = async (input, init) => {
      const response = await w.fake.fetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.pathname.endsWith("bulk-create-jobs") ? new Response("upstream timeout", { status: 504 }) : response;
    };
    // From the first retry on, Klaviyo's state is hidden too, so the retries cannot learn that it was applied.
    let posts = 0;
    const blind: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (posts > 0 && /\/api\/(segments\/[^/]+\/profiles|profiles)$/.test(url.pathname)) return new Response("unavailable", { status: 503 });
      if (url.pathname.endsWith("bulk-create-jobs")) posts++;
      return lossy(input, init);
    };
    const outcome = await executeRun({ db, gateway: w.gatewayWith(blind), step: new FakeSteps() }, w.runId);
    expect(w.fake.suppressed.size).toBe(5); // suppressed in Klaviyo for real
    expect(outcome).toMatchObject({ status: "completed_with_errors", submitted: 0, failed: 0, unknown: 5 });
    expect(Object.values(await w.reasons())).toEqual(Array(5).fill("failed:outcome_unknown"));
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.id, w.runId) })).toMatchObject({ unknownCount: 5, failedCount: 0, processedCount: 0 });

    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 5 });
    expect(w.fake.suppressed.size).toBe(0);
  });

  it("a retry that finds the first attempt applied records the profiles as suppressed, without a second job", async () => {
    const w = await world(4);
    // The whole first attempt (with the client's own retries) loses its answers; Klaviyo applied the job.
    let phase: "before" | "losing" | "retrying" = "before";
    let jobsAfterFirstAttempt = 0;
    const lossyOnce: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (phase === "losing" && !url.pathname.endsWith("bulk-create-jobs")) {
        phase = "retrying";
        jobsAfterFirstAttempt = w.fake.jobs.length;
      }
      const response = await w.fake.fetch(input, init);
      if (phase !== "retrying" && url.pathname.endsWith("bulk-create-jobs")) {
        phase = "losing";
        // Klaviyo also drops a suppressed profile from the segment.
        w.segment.members = [];
        return new Response("upstream timeout", { status: 504 });
      }
      return response;
    };
    const outcome = await executeRun({ db, gateway: w.gatewayWith(lossyOnce), step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 4, skipped: 0, unknown: 0 });
    expect(phase).toBe("retrying");
    // The retry created no further job: it found the profiles suppressed since our own request.
    expect(w.fake.jobs).toHaveLength(jobsAfterFirstAttempt);
    expect(w.fake.requestsTo(/^\/api\/profiles$/)).toHaveLength(1);
    expect(Object.values(await w.reasons())).toEqual(Array(4).fill("submitted:confirmed_by_state"));
  });

  it("a batch Klaviyo rejected outright is not 'possibly sent'", async () => {
    const w = await world(3);
    w.fake.failNext(/bulk-create-jobs$/, () => FakeKlaviyo.clientError(400, "invalid"));
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, failed: 3, unknown: 0, error: "klaviyo_400_invalid" });
    expect(await createUndoRun(db, { shop: w.shop, runId: w.runId, createdBy: "user:1", confirmAfterRenewal: true })).toMatchObject({ ok: false, reason: "nothing_to_restore" });
  });
});

describe("M6 + S-07: undo leaves alone what is provably not the cleanup's doing", () => {
  it("skips a redacted customer and suppressions dated well before the cleanup or well after it finished", async () => {
    const w = await world(6);
    const [normal, redacted, before, after, unsubscribed, gone] = w.profileIds as [string, string, string, string, string, string];
    const outcome = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 6 });
    const job = Date.now();

    await db.update(schema.runProfiles).set({ emailHash: null }).where(eq(schema.runProfiles.profileId, redacted));
    // Klaviyo says this one has been suppressed since long before our request: not ours.
    w.fake.suppressedAt.set(emailOf(before), new Date(job - 30 * 24 * HOUR).toISOString());
    // The merchant restored this one by hand and suppressed it again two days later: not ours any more.
    w.fake.suppressedAt.set(emailOf(after), new Date(job + 48 * HOUR).toISOString());
    // Unsubscribed since: Klaviyo's unsuppress only removes USER_SUPPRESSED, so sending it is harmless.
    w.fake.profiles.get(unsubscribed)!.suppression = ["UNSUBSCRIBE"];
    w.fake.profiles.delete(gone);

    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 2, skipped: 4 });
    expect(await w.reasons(undo.runId)).toEqual({
      [normal]: "submitted",
      [unsubscribed]: "submitted",
      [redacted]: "skipped:email_hash_missing",
      [before]: "skipped:suppressed_before_cleanup",
      [after]: "skipped:suppressed_after_cleanup",
      [gone]: "skipped:profile_gone",
    });
    expect(w.fake.jobs.at(-1)).toMatchObject({ kind: "unsuppress" });
    expect([...w.fake.jobs.at(-1)!.emails].sort()).toEqual([emailOf(normal), emailOf(unsubscribed)].sort());
    expect(w.fake.suppressed.has(emailOf(before))).toBe(true);
    expect(w.fake.suppressed.has(emailOf(after))).toBe(true);
    // Only what was sent is stamped as restored. What the restore left alone is not offered again as restorable.
    expect((await loadRunDetail(w.shop, w.runId))?.undo).toMatchObject({ restored: 2, restorable: 0, leftAlone: 4, fullyRestored: false });
  });

  it("restores as before when Klaviyo cannot tell (job unreadable, or no suppression state returned)", async () => {
    const w = await world(3);
    await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    // The job is gone from Klaviyo: there is no upper bound, so a later timestamp proves nothing.
    w.fake.jobs.length = 0;
    w.fake.suppressedAt.set(emailOf(w.profileIds[0]!), new Date(Date.now() + 48 * HOUR).toISOString());
    w.fake.profiles.get(w.profileIds[1]!)!.omitSubscriptions = true;
    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 3, skipped: 0 });
    expect(w.fake.suppressed.size).toBe(0);
  });
});

describe("Restore after a cleanup, through the real gateway and the fake Klaviyo", () => {
  const restoreAll = async (w: World, candidates: number) => {
    const cleanup = await executeRun({ db, gateway: w.gateway, step: new FakeSteps() }, w.runId);
    expect(cleanup).toMatchObject({ status: "completed", submitted: candidates });
    return cleanup;
  };

  it("restores every profile of a completed cleanup (the preview bug of 2026-11-26: 0 restored, all 'suppressed again')", async () => {
    const w = await world(230);
    await restoreAll(w, 230);
    expect(w.fake.suppressed.size).toBe(230);
    // Every time Klaviyo reports comes from one clock: a job's suppressions are never newer than its completion.
    for (const job of w.fake.jobs) {
      expect(Date.parse(job.completedAt!)).toBeGreaterThanOrEqual(Date.parse(job.createdAt));
      for (const email of job.emails) expect(Date.parse(w.fake.suppressedAt.get(email)!)).toBeLessThanOrEqual(Date.parse(job.completedAt!));
    }
    expect((await loadRunDetail(w.shop, w.runId))?.undo).toMatchObject({ restorable: 230, restored: 0, leftAlone: 0 });

    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 230, skipped: 0 });
    expect(w.fake.suppressed.size).toBe(0);
    expect(w.fake.jobs.filter((j) => j.kind === "unsuppress").flatMap((j) => j.emails)).toHaveLength(230);
    // No job had to be read to decide: nothing was dated after the cleanup.
    expect(w.fake.requestsTo(/^\/api\/profile-suppression-bulk-create-jobs\/[^/]+$/, "GET")).toHaveLength(0);
    expect((await loadRunDetail(w.shop, w.runId))?.undo).toMatchObject({ restorable: 0, restored: 230, leftAlone: 0, fullyRestored: true });
  });

  it("restores everything when Klaviyo applies its jobs later than it accepts them", async () => {
    let klaviyoNow = Date.now();
    const w = await world(120, (fake) => {
      fake.now = () => klaviyoNow;
      fake.jobProcessingMs = 25_000;
    });
    await restoreAll(w, 120);
    // Accepted, not applied yet.
    expect(w.fake.suppressed.size).toBe(0);
    klaviyoNow += 60_000;
    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 120, skipped: 0 });
    klaviyoNow += 60_000;
    await w.fake.fetch("https://a.klaviyo.com/api/accounts"); // any request lets the fake settle its jobs
    expect(w.fake.suppressed.size).toBe(0);
  });

  it.each([
    ["3 hours ahead of ours", 3 * HOUR],
    ["3 hours behind ours", -3 * HOUR],
    ["12 hours behind ours (a timestamp reported without its offset)", -12 * HOUR],
  ])("restores everything when Klaviyo's clock is %s", async (_name, shift) => {
    const w = await world(40, (fake) => {
      fake.now = () => Date.now() + shift;
    });
    await restoreAll(w, 40);
    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 40, skipped: 0 });
    expect(w.fake.suppressed.size).toBe(0);
  });

  it("restores when the job Klaviyo reports cannot be compared with our clock, or fails to be read", async () => {
    const w = await world(4);
    await restoreAll(w, 4);
    const [bogusJob, unreadable, ...rest] = w.profileIds as [string, string, ...string[]];
    // Dated two days after the cleanup, which alone proves nothing:
    for (const id of [bogusJob, unreadable]) w.fake.suppressedAt.set(emailOf(id), new Date(Date.now() + 48 * HOUR).toISOString());
    // - Klaviyo says the job completed a day BEFORE we requested it (what the old fake did): not comparable.
    w.fake.jobs[0]!.completedAt = new Date(Date.now() - 24 * HOUR).toISOString();
    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 4, skipped: 0 });
    expect(rest).toHaveLength(2);

    // - Klaviyo answers 503 to every job read: the restore is not held back by a read that is only evidence.
    const w2 = await world(3);
    await restoreAll(w2, 3);
    w2.fake.suppressedAt.set(emailOf(w2.profileIds[0]!), new Date(Date.now() + 48 * HOUR).toISOString());
    w2.fake.failNext(/^\/api\/profile-suppression-bulk-create-jobs\/[^/]+$/, () => FakeKlaviyo.serverError(), 50);
    const undo2 = await w2.undo();
    expect(undo2.outcome).toMatchObject({ status: "completed", submitted: 3, skipped: 0 });
    expect(w2.fake.suppressed.size).toBe(0);
  });

  it("leaves alone only what is provably not the cleanup's: suppressed long before, or suppressed again days later", async () => {
    const w = await world(6);
    await restoreAll(w, 6);
    const [before, after, nearBefore, nearAfter, ...normal] = w.profileIds as [string, string, string, string, ...string[]];
    const now = Date.now();
    // The merchant had suppressed this one a month earlier (it slipped in through a batch whose answer was lost).
    w.fake.suppressedAt.set(emailOf(before), new Date(now - 30 * 24 * HOUR).toISOString());
    // Restored by hand in Klaviyo and suppressed again three days later: a decision made after the cleanup.
    w.fake.suppressedAt.set(emailOf(after), new Date(now + 72 * HOUR).toISOString());
    // Inside the margin on either side: could be ours (clock differences, a job applied late), so they are restored.
    w.fake.suppressedAt.set(emailOf(nearBefore), new Date(now - 2 * HOUR).toISOString());
    w.fake.suppressedAt.set(emailOf(nearAfter), new Date(now + 2 * HOUR).toISOString());

    const undo = await w.undo();
    expect(undo.outcome).toMatchObject({ status: "completed", submitted: 4, skipped: 2 });
    expect(await w.reasons(undo.runId)).toMatchObject({
      [before]: "skipped:suppressed_before_cleanup",
      [after]: "skipped:suppressed_after_cleanup",
      [nearBefore]: "submitted",
      [nearAfter]: "submitted",
    });
    expect([...w.fake.suppressed].sort()).toEqual([emailOf(before), emailOf(after)].sort());
    expect(normal).toHaveLength(2);
    const detail = await loadRunDetail(w.shop, w.runId);
    expect(detail?.undo).toMatchObject({ restored: 4, restorable: 0, leftAlone: 2, fullyRestored: false });
    expect(detail?.undo?.leftAloneReasons.map((r) => r.reason).sort()).toEqual(["suppressed_after_cleanup", "suppressed_before_cleanup"]);
    // Nothing is offered again, so a second restore is refused rather than promising something.
    expect(detail?.undoRuns).toHaveLength(1);
  });

  it("undoEvidence: the rule on its own", () => {
    const t0 = Date.parse("2026-11-26T10:00:00Z");
    const D = SUPPRESSION_EVIDENCE_MARGIN_MS;
    const base = { requestedAt: t0, jobCompletedAt: t0 + 30_000, cleanupFinishedAt: t0 + 60_000 };
    expect(undoEvidence({ ...base, suppressedAt: t0 + 20_000 })).toBeNull();
    expect(undoEvidence({ ...base, suppressedAt: null })).toBeNull();
    expect(undoEvidence({ ...base, suppressedAt: t0 - D + 1 })).toBeNull();
    expect(undoEvidence({ ...base, suppressedAt: t0 - D - 1 })).toBe("suppressed_before_cleanup");
    expect(undoEvidence({ ...base, suppressedAt: t0 + 60_000 + D })).toBeNull();
    expect(undoEvidence({ ...base, suppressedAt: t0 + 60_000 + D + 1 })).toBe("suppressed_after_cleanup");
    // Without Klaviyo's completion, without our own end of the cleanup, or with a completion that precedes the request: no upper bound.
    expect(undoEvidence({ ...base, jobCompletedAt: undefined, suppressedAt: t0 + 10 * D })).toBeNull();
    expect(undoEvidence({ ...base, cleanupFinishedAt: null, suppressedAt: t0 + 10 * D })).toBeNull();
    expect(undoEvidence({ ...base, jobCompletedAt: t0 - D, suppressedAt: t0 + 10 * D })).toBeNull();
    // A job Klaviyo completed long after we closed the cleanup moves the bound with it.
    expect(undoEvidence({ ...base, jobCompletedAt: t0 + 5 * D, suppressedAt: t0 + 5 * D + 1000 })).toBeNull();
    // Without the time of our own request nothing can be said at all.
    expect(undoEvidence({ ...base, requestedAt: undefined, suppressedAt: t0 - 10 * D })).toBeNull();
  });
});

describe("M8: stop a cleanup", () => {
  it("a queued cleanup is closed at once and never sends anything", async () => {
    const { shop, runId } = await newRun(120);
    expect((await loadRunDetail(shop, runId))?.stop).toEqual({ canStop: true, requestedAt: null, requestedBy: null });
    expect(await requestStopRun(db, { shop: uniqueShop(), runId, requestedBy: "user:9" })).toEqual({ ok: false, reason: "not_found" });
    expect(await requestStopRun(db, { shop, runId, requestedBy: "user:9" })).toEqual({ ok: true, state: "stopped" });
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) })).toMatchObject({ status: "cancelled", stopRequestedBy: "user:9", processedCount: 0 });
    expect((await loadRunDetail(shop, runId))?.stop).toMatchObject({ canStop: false });

    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "cancelled", submitted: 0, untouched: 120 });
    expect(gateway.calls).toHaveLength(0);
    expect(await requestStopRun(db, { shop, runId, requestedBy: "user:9" })).toEqual({ ok: false, reason: "already_finished" });
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.runId, runId) });
    expect(log.map((l) => `${l.action}:${l.actor}`).sort()).toEqual(["run.cancelled:system", "run.created:user:1", "run.stop_requested:user:9"]);
    // The shop is free for a new cleanup.
    expect((await newRun(1, shop)).runId).toBeTruthy();
  });

  it("a running cleanup finishes the batch in flight, stops before the next one, and can then be undone", async () => {
    const { shop, runId } = await newRun(250);
    const gateway = new FakeGateway();
    const steps = new FakeSteps();
    const original = gateway.submitBatch.bind(gateway);
    gateway.submitBatch = async (request) => {
      // The merchant presses "Stop cleanup" while batch 0 is being sent.
      if (request.batchIndex === 0) expect(await requestStopRun(db, { shop, runId, requestedBy: "user:9" })).toEqual({ ok: true, state: "stopping" });
      return original(request);
    };
    const running = executeRun({ db, gateway, step: steps }, runId);
    const outcome = await running;
    expect(gateway.calls.map((c) => c.batchIndex)).toEqual([0]);
    expect(outcome).toMatchObject({ status: "cancelled", submitted: 100, untouched: 150, error: null });
    expect(await profileStatuses(runId)).toEqual({ submitted: 100, pending: 150 });
    const detail = await loadRunDetail(shop, runId);
    expect(detail?.run).toMatchObject({ status: "cancelled", stopping: false, submitted: 100 });
    expect(detail?.stop).toMatchObject({ canStop: false, requestedBy: "user:9" });
    expect(await createUndoRun(db, { shop, runId, createdBy: "user:9", confirmAfterRenewal: true })).toMatchObject({ ok: true, totalCount: 100 });
  });

  it("a stopped cleanup whose Workflow is gone is closed as cancelled by the recovery", async () => {
    const { shop, runId } = await newRun(150);
    const steps = new FakeSteps();
    steps.crashBefore = "batch 1";
    await steps.runUntilCrash(() => executeRun({ db, gateway: new FakeGateway(), step: steps }, runId));
    expect(await requestStopRun(db, { shop, runId, requestedBy: "user:9" })).toEqual({ ok: true, state: "stopping" });
    expect((await loadRunDetail(shop, runId))?.run.stopping).toBe(true);
    const r = recovery((id) => (id === runId ? "dead" : "unknown"), new Date(Date.now() + 15 * MINUTE));
    expect((await r.run()).closed).toEqual([runId]);
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) })).toMatchObject({ status: "cancelled", processedCount: 100, lastError: null });
  });

  it("only a cleanup can be stopped", async () => {
    const { shop, runId } = await newRun(2);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, runId);
    const undo = await createUndoRun(db, { shop, runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    expect(await requestStopRun(db, { shop, runId: undo.runId, requestedBy: "user:1" })).toEqual({ ok: false, reason: "not_a_cleanup" });
  });
});

describe("B3: one cleanup at a time", () => {
  it("a second cleanup cannot be created while another is queued or running", async () => {
    const first = await newRun(3);
    const second = await seedSimulation({ candidates: 3, shop: first.shop });
    expect(await createSuppressionRun(db, { shop: first.shop, simulationId: second.simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "cleanup_in_progress" });
    // The refused simulation was not consumed.
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, second.simulationId) }))?.executedAt).toBeNull();
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, first.runId);
    expect(await createSuppressionRun(db, { shop: first.shop, simulationId: second.simulationId, createdBy: "user:1" })).toMatchObject({ ok: true });
  });
});

describe("S-08: job confirmation is scoped to the shop", () => {
  it("reads no job of a run that belongs to another shop", async () => {
    const { shop, runId } = await newRun(3);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, runId);
    let calls = 0;
    const client = { request: async () => (calls++, { data: { id: "j", attributes: { status: "complete", total_count: 3, completed_count: 3, skipped_count: 0 } } }) } as never;
    expect(await confirmJobsPage(db, client, { runId, offset: 0, limit: 10, shop: uniqueShop() })).toMatchObject({ jobs: 0, checked: 0 });
    expect(calls).toBe(0);
    expect(await confirmJobsPage(db, client, { runId, offset: 0, limit: 10, shop })).toMatchObject({ jobs: 1, checked: 1, suppressed: 3 });
  });
});

describe("A6: automatic mode guardrails", () => {
  async function shopWithManualCleanup(candidates: number) {
    const cleanup = await newRun(candidates);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, cleanup.runId);
    await db.update(schema.settings).set({ mode: "automatic", scheduleEnabled: true }).where(eq(schema.settings.shop, cleanup.shop));
    const scheduled = async (candidateCount: number, activeProfiles: number, settingsVersion = 1) => {
      const id = crypto.randomUUID();
      await db.insert(schema.simulations).values({ id, shop: cleanup.shop, origin: "scheduled", settingsVersion, ruleSettings: {}, coverage: {}, summary: {}, evaluatedCount: candidateCount, candidateCount, protectedCount: 0, skippedCount: 0, activeProfiles, priceTableId: "t" });
      return id;
    };
    return { ...cleanup, scheduled };
  }

  it("runs when the scheduled cleanup looks like what a person approved", async () => {
    const s = await shopWithManualCleanup(300);
    const simulationId = await s.scheduled(400, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId })).toEqual({ run: true, simulationId });
    expect(await automaticReview(db, { shop: s.shop, simulationId })).toBeNull();
  });

  it("waits for the merchant when the last cleanup they approved was undone in full", async () => {
    const s = await shopWithManualCleanup(2);
    const undo = await createUndoRun(db, { shop: s.shop, runId: s.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undo.runId);
    const simulationId = await s.scheduled(2, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId })).toEqual({ run: false, reason: "last_manual_cleanup_undone" });
    // The reason is stored where the app can read it, with text ready for the merchant.
    expect(await automaticReview(db, { shop: s.shop, simulationId })).toMatchObject({ reason: "last_manual_cleanup_undone", label: expect.stringContaining("restored") });
    expect(await automaticReview(db, { shop: uniqueShop(), simulationId })).toBeNull();
  });

  it("waits when rules or protected groups changed since the last approval by a person", async () => {
    const s = await shopWithManualCleanup(300);
    await db.update(schema.settings).set({ version: 2 }).where(eq(schema.settings.shop, s.shop));
    const simulationId = await s.scheduled(10, 100_000, 2);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId })).toEqual({ run: false, reason: "rules_changed_since_manual_approval" });
    expect((await automaticReview(db, { shop: s.shop, simulationId }))?.reason).toBe("rules_changed_since_manual_approval");
  });

  it("waits when the candidates are an abnormal share of the list, or far above the last approved cleanup", async () => {
    const s = await shopWithManualCleanup(300);
    // The reviewer's case: 90,000 of 100,000.
    const huge = await s.scheduled(90_000, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: huge })).toEqual({ run: false, reason: "candidate_share_too_high" });
    const event = await db.query.eventsLog.findFirst({ where: eq(schema.eventsLog.id, `simulation:${huge}:automatic_review`) });
    expect(event).toMatchObject({ action: "automatic.needs_review", actor: "schedule", detail: { reason: "candidate_share_too_high", candidates: 90_000, activeProfiles: 100_000, lastApprovedCandidates: 300 } });

    const share = await s.scheduled(100_000 * AUTO_MAX_CANDIDATE_SHARE + 1, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: share })).toMatchObject({ run: false, reason: "candidate_share_too_high" });
    const unknownList = await s.scheduled(5, 0);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: unknownList })).toMatchObject({ run: false, reason: "candidate_share_too_high" });

    const jump = await s.scheduled(300 * AUTO_MAX_GROWTH_FACTOR + 1, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: jump })).toEqual({ run: false, reason: "candidate_jump" });
    const atLimit = await s.scheduled(300 * AUTO_MAX_GROWTH_FACTOR, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: atLimit })).toMatchObject({ run: true });
  });

  it("small cleanups are not held back by the growth check", async () => {
    const s = await shopWithManualCleanup(2);
    const simulationId = await s.scheduled(AUTO_GROWTH_FLOOR, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId })).toMatchObject({ run: true });
    const above = await s.scheduled(AUTO_GROWTH_FLOOR + 1, 100_000);
    expect(await decideAutomatic(db, { shop: s.shop, simulationId: above })).toMatchObject({ run: false, reason: "candidate_jump" });
  });
});
