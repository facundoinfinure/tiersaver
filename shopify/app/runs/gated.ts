import { planGate, type AdminGraphql, type PlanGateRefusal } from "../billing/billing";
import { createSuppressionRun, type CreateRunResult, type Db } from "./engine";

/**
 * The way a cleanup is created by the app, manual or automatic: first the plan gate (billing/billing.ts: an
 * active plan at Shopify that covers the list size of this simulation, asked at this moment), then the run.
 * `createSuppressionRun` itself only knows the database; nothing but this function and tests may call it.
 *
 * Workflows and the cron cannot act as the merchant: they pass `offlineAdminGraphql(shop)`.
 */
export type GatedRunResult = CreateRunResult | { ok: false; reason: PlanGateRefusal; requiredCents: number | null };

export async function createCleanupWithPlan(
  deps: { db: Db; graphql: AdminGraphql; now?: Date },
  args: { shop: string; simulationId: string; createdBy: string; origin?: "manual" | "scheduled"; runId?: string },
): Promise<GatedRunResult> {
  const gate = await planGate({ db: deps.db, graphql: deps.graphql, actor: args.createdBy, now: deps.now }, { shop: args.shop, simulationId: args.simulationId });
  if (!gate.ok) return gate;
  return createSuppressionRun(deps.db, { ...args, now: deps.now });
}
