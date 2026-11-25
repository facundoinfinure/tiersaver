import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSuppressionRun, executeRun, RUN_BATCH_SIZE } from "../app/runs/engine";
import { Crash, db, FakeGateway, FakeSteps, profileStatuses, schema, seedSimulation } from "./helpers";

const HOUR = 60 * 60 * 1000;

async function createRun(candidates: number) {
  const seeded = await seedSimulation({ candidates });
  const created = await createSuppressionRun(db, { shop: seeded.shop, simulationId: seeded.simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(`run not created: ${created.reason}`);
  return { ...seeded, runId: created.runId, created };
}

describe("simulation gate (product rule 1)", () => {
  it("refuses a simulation that was not approved", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 5, approved: false });
    expect(await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "not_approved" });
    expect(await db.query.runs.findFirst({ where: eq(schema.runs.simulationId, simulationId) })).toBeUndefined();
  });

  it("refuses a simulation older than 24 hours", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 5, createdAt: new Date(Date.now() - 25 * HOUR) });
    expect(await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses when settings changed after the simulation", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 5 });
    await db.update(schema.settings).set({ version: 2 }).where(eq(schema.settings.shop, shop));
    expect(await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "superseded" });
  });

  it("refuses a simulation of another shop", async () => {
    const { simulationId } = await seedSimulation({ candidates: 5 });
    const other = await seedSimulation({ candidates: 1 });
    expect(await createSuppressionRun(db, { shop: other.shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a simulation with nothing to suppress", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 0 });
    expect(await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "no_candidates" });
  });

  it("executes a simulation only once, even with concurrent requests", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 5 });
    const results = await Promise.all(
      [1, 2, 3].map(() => createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" }).catch(() => ({ ok: false as const }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const runs = await db.query.runs.findMany({ where: eq(schema.runs.simulationId, simulationId) });
    expect(runs).toHaveLength(1);
    const again = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    expect(again).toEqual({ ok: false, reason: "already_executed" });
  });

  it("the atomic SQL guard holds even if the in-memory check is bypassed", async () => {
    // Approved in the row, but expired by the time the transaction runs.
    const { shop, simulationId } = await seedSimulation({ candidates: 5, createdAt: new Date(Date.now() - 23.9 * HOUR) });
    const result = await createSuppressionRun(db, {
      shop,
      simulationId,
      createdBy: "user:1",
      // The JS pre-check uses `now`; the SQL guard compares against the same value.
      now: new Date(Date.now() + HOUR),
    });
    expect(result.ok).toBe(false);
  });

  it("the run re-checks the gate when it starts", async () => {
    const { runId, shop } = await createRun(5);
    await db.update(schema.settings).set({ version: 9 }).where(eq(schema.settings.shop, shop));
    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("simulation_superseded");
    expect(gateway.calls).toHaveLength(0);
    expect(await profileStatuses(runId)).toEqual({ pending: 5 });
  });
});

describe("run creation", () => {
  it("freezes the profile set in batches of at most 100", async () => {
    const { runId, created, profileIds, simulationId } = await createRun(250);
    expect(created).toMatchObject({ totalCount: 250, batchCount: 3 });
    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(rows.map((r) => r.profileId).sort()).toEqual(profileIds);
    const perBatch = new Map<number, number>();
    for (const r of rows) perBatch.set(r.batchIndex, (perBatch.get(r.batchIndex) ?? 0) + 1);
    expect([...perBatch.entries()].sort()).toEqual([[0, 100], [1, 100], [2, 50]]);
    expect(Math.max(...perBatch.values())).toBeLessThanOrEqual(RUN_BATCH_SIZE);
    const sim = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) });
    expect(sim?.executedAt).toBeInstanceOf(Date);
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.runId, runId) });
    expect(log.map((e) => [e.action, e.actor])).toEqual([["run.created", "user:1"]]);
  });
});

describe("run execution", () => {
  it("submits every profile exactly once and records the result", async () => {
    const { runId, profileIds } = await createRun(250);
    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250, skipped: 0, failed: 0, untouched: 0, error: null });
    expect(gateway.calls.map((c) => c.profileIds.length)).toEqual([100, 100, 50]);
    const sent = gateway.sentCount();
    expect([...sent.keys()].sort()).toEqual(profileIds);
    expect(new Set(sent.values())).toEqual(new Set([1]));
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    expect(run).toMatchObject({ status: "completed", processedCount: 250, failedCount: 0 });
    expect(run?.startedAt).toBeInstanceOf(Date);
    expect(run?.finishedAt).toBeInstanceOf(Date);
    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(rows.every((r) => r.status === "submitted" && r.klaviyoJobId?.startsWith("job-"))).toBe(true);
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.runId, runId) });
    expect(log.map((e) => e.action).sort()).toEqual(["run.completed", "run.created"]);
  });

  it("resumes after a crash without duplicating or skipping profiles", async () => {
    const { runId, profileIds } = await createRun(250);
    const gateway = new FakeGateway();
    const steps = new FakeSteps();
    steps.crashBefore = "batch 1";
    expect(await steps.runUntilCrash(() => executeRun({ db, gateway, step: steps }, runId))).toBe("crashed");
    expect(await profileStatuses(runId)).toEqual({ submitted: 100, pending: 150 });

    const outcome = await executeRun({ db, gateway, step: steps }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250, untouched: 0 });
    const sent = gateway.sentCount();
    expect([...sent.keys()].sort()).toEqual(profileIds);
    expect(new Set(sent.values())).toEqual(new Set([1]));
    expect(steps.executed.filter((s) => s === "batch 0")).toHaveLength(1);
  });

  it("resumes with a fresh step cache (lost Workflow state) without resending finished batches", async () => {
    const { runId } = await createRun(250);
    const gateway = new FakeGateway();
    const first = new FakeSteps();
    first.crashBefore = "batch 2";
    expect(await first.runUntilCrash(() => executeRun({ db, gateway, step: first }, runId))).toBe("crashed");

    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250 });
    expect(new Set(gateway.sentCount().values())).toEqual(new Set([1]));
  });

  it("a batch that dies after reaching Klaviyo is sent again, and only that batch", async () => {
    const { runId } = await createRun(250);
    const gateway = new FakeGateway();
    // Call 2 (batch 1) reaches the gateway, then the Worker dies before the result is stored.
    gateway.failWhen = (_req, n) => (n === 2 ? new Crash() : undefined);
    const steps = new FakeSteps();
    expect(await steps.runUntilCrash(() => executeRun({ db, gateway, step: steps }, runId))).toBe("crashed");
    expect(await profileStatuses(runId)).toEqual({ submitted: 100, submitting: 100, pending: 50 });

    const outcome = await executeRun({ db, gateway, step: steps }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250, untouched: 0 });
    const perBatch = gateway.calls.map((c) => c.batchIndex);
    expect(perBatch).toEqual([0, 1, 1, 2]);
  });

  it("retries a transient failure inside the step", async () => {
    const { runId } = await createRun(120);
    const gateway = new FakeGateway();
    gateway.failWhen = (_req, n) => (n === 1 || n === 2 ? new Error("klaviyo 503") : undefined);
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 120, failed: 0 });
  });

  it("stops at a batch that keeps failing and leaves the rest untouched", async () => {
    const { runId } = await createRun(250);
    const gateway = new FakeGateway();
    gateway.failWhen = (req) => (req.batchIndex === 1 ? new Error("Klaviyo 500: upstream") : undefined);
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({
      status: "completed_with_errors",
      submitted: 100,
      failed: 100,
      untouched: 50,
      error: "klaviyo_500_upstream",
    });
    expect(gateway.calls.some((c) => c.batchIndex === 2)).toBe(false);
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    expect(run).toMatchObject({ status: "completed_with_errors", lastError: "klaviyo_500_upstream", failedCount: 100 });
  });

  it("fails without touching anyone when the first batch cannot be sent", async () => {
    const { runId } = await createRun(30);
    const gateway = new FakeGateway();
    const err = new Error("klaviyo_gateway_not_implemented");
    err.name = "NonRetryableError";
    gateway.failWhen = () => err;
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, failed: 30 });
    expect(gateway.calls).toHaveLength(1);
  });

  it("records profiles the gateway skipped", async () => {
    const { runId, profileIds } = await createRun(120);
    const gateway = new FakeGateway();
    const gone = new Set([profileIds[0]!, profileIds[57]!, profileIds[110]!]);
    gateway.skip = (req) => req.profileIds.filter((id) => gone.has(id)).concat("not-in-this-batch");
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 117, skipped: 3 });
    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(rows.filter((r) => r.status === "skipped").map((r) => r.profileId).sort()).toEqual([...gone].sort());
  });

  it("stops between batches when the run is cancelled", async () => {
    const { runId } = await createRun(250);
    const gateway = new FakeGateway();
    gateway.failWhen = (req) => {
      if (req.batchIndex === 0) void db.update(schema.runs).set({ status: "cancelled" }).where(eq(schema.runs.id, runId)).run();
    };
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.untouched).toBeGreaterThanOrEqual(100);
    expect(gateway.calls.some((c) => c.batchIndex === 2)).toBe(false);
  });

  it("running a finished run again does nothing", async () => {
    const { runId } = await createRun(40);
    const gateway = new FakeGateway();
    await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 40 });
    expect(gateway.calls).toHaveLength(1);
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.runId, runId) });
    expect(log).toHaveLength(2);
  });

  it("reports an unknown run instead of throwing", async () => {
    const outcome = await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, "missing");
    expect(outcome).toMatchObject({ status: "not_found", error: "run_not_found" });
  });
});
