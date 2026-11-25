import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { db, schema } from "../db.server";
import { createSuppressionRun, createUndoRun, type CreateRunResult, type CreateUndoResult } from "./engine";

/**
 * Creates the run for an approved simulation and hands it to the Workflow.
 * The Workflow instance id is the run id, so calling this twice for the same
 * run cannot start a second execution.
 */
export async function startSuppressionRun(args: {
  shop: string;
  simulationId: string;
  createdBy: string;
  origin?: "manual" | "scheduled";
}): Promise<CreateRunResult> {
  const created = await createSuppressionRun(db, args);
  if (!created.ok) return created;

  const instance = await env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
  await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, created.runId));
  return created;
}

/** Creates the undo of a cleanup and hands it to the same Workflow. Not gated by SUPPRESSION_ENABLED. */
export async function startUndoRun(args: {
  shop: string;
  runId: string;
  createdBy: string;
  confirmAfterRenewal?: boolean;
}): Promise<CreateUndoResult> {
  const created = await createUndoRun(db, args);
  if (!created.ok) return created;

  const instance = await env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
  await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, created.runId));
  return created;
}
