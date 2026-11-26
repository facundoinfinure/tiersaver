import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { db, schema } from "../db.server";
import type { AdminGraphql } from "../billing/billing";
import { createUndoRun, type CreateUndoResult } from "./engine";
import { createCleanupWithPlan, type GatedRunResult } from "./gated";

/**
 * Creates the run for an approved simulation and hands it to the Workflow.
 * The Workflow instance id is the run id, so calling this twice for the same
 * run cannot start a second execution.
 *
 * Refused, with nothing changed, unless Shopify confirms an active plan that covers the list (runs/gated.ts).
 */
export async function startSuppressionRun(args: {
  shop: string;
  simulationId: string;
  createdBy: string;
  origin?: "manual" | "scheduled";
  /** Admin API of the shop, to ask Shopify about the plan. */
  graphql: AdminGraphql;
}): Promise<GatedRunResult> {
  const { graphql, ...run } = args;
  const created = await createCleanupWithPlan({ db, graphql }, run);
  if (!created.ok) return created;
  await launchRun(created.runId);
  return created;
}

/**
 * Starts the Workflow of a run that already exists. If the Workflow cannot be created right now the run stays
 * `queued`, and the hourly recovery (runs/recovery.ts) starts it again with the same id or closes it: a run
 * row is never left behind without an owner.
 */
export async function launchRun(runId: string): Promise<boolean> {
  try {
    const instance = await env.SUPPRESSION_RUN.create({ id: runId, params: { runId } });
    await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, runId));
    return true;
  } catch (error) {
    console.error(`run launch failed: ${error instanceof Error ? error.name : "error"}`);
    return false;
  }
}

/** Creates the undo of a cleanup and hands it to the same Workflow. Not gated by SUPPRESSION_ENABLED nor by the plan: restoring always works. */
export async function startUndoRun(args: {
  shop: string;
  runId: string;
  createdBy: string;
  confirmAfterRenewal?: boolean;
}): Promise<CreateUndoResult> {
  const created = await createUndoRun(db, args);
  if (!created.ok) return created;
  await launchRun(created.runId);
  return created;
}
