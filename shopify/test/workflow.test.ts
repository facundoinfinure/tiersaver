import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSuppressionRun } from "../app/runs/engine";
import { db, profileStatuses, schema, seedSimulation } from "./helpers";

describe("SuppressionRunWorkflow (real Workflows engine)", () => {
  it("until the Klaviyo gateway exists, a started run fails and touches nobody", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 130 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);

    await using instance = await introspectWorkflowInstance(env.SUPPRESSION_RUN, created.runId);
    await env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
    await instance.waitForStatus("complete");

    expect(await instance.getOutput()).toMatchObject({
      status: "failed",
      submitted: 0,
      error: "klaviyo_gateway_not_implemented",
    });
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, created.runId) });
    expect(run).toMatchObject({ status: "failed", processedCount: 0, lastError: "klaviyo_gateway_not_implemented" });
    // Batch 0 is marked failed; the other batch was never reached.
    expect(await profileStatuses(created.runId)).toEqual({ failed: 100, pending: 30 });
  });

  it("runs all batches as durable steps when the gateway step succeeds", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 130 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);

    await using instance = await introspectWorkflowInstance(env.SUPPRESSION_RUN, created.runId);
    await instance.modify(async (m) => {
      await m.mockStepResult({ name: "batch 0" }, { state: "done", submitted: 100, skipped: 0 });
      await m.mockStepResult({ name: "batch 1" }, { state: "done", submitted: 30, skipped: 0 });
    });
    await env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
    await instance.waitForStatus("complete");

    // The batch steps were mocked, so no row was submitted: the run must not claim success.
    expect(await instance.getOutput()).toMatchObject({ status: "completed_with_errors", submitted: 0, untouched: 130 });
  });

  it("a second instance for the same run id cannot be created", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 10 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    await using instance = await introspectWorkflowInstance(env.SUPPRESSION_RUN, created.runId);
    await env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
    await expect(env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } })).rejects.toThrow();
    await instance.waitForStatus("complete");
  });
});
