import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { approveSimulation, type ApproveResult } from "../simulations/review";
import { planForListSize, requestPlanFor, type AdminGraphql, type Db, type Plan } from "./billing";

/**
 * Approving a cleanup, with the plan it needs (owner's decision of 2026-11-26: the plan starts when the
 * merchant approves their first cleanup).
 *
 * 1. The simulation is approved exactly as before (simulations/review.ts): acknowledgement, identified user,
 *    terms version, one atomic write.
 * 2. If the shop already has a plan that covers this list size, that is all: `next: "ready"`.
 * 3. Otherwise the merchant goes to Shopify's approval page for the plan of this list size (first plan, or a
 *    larger one because the list grew) and comes back to the review screen, where the cleanup can be started.
 *    If they decline there, the simulation stays approved and nothing can start: `planGate` refuses.
 *
 * Approving never suppresses anything; starting the cleanup is the next step, and it asks Shopify again.
 */
export type ApproveCleanupResult =
  | { ok: true; next: "ready" }
  | { ok: true; next: "approve_in_shopify"; confirmationUrl: string; plan: Plan }
  /** Approved, but Shopify could not be asked about the plan right now: the review screen offers it again. */
  | { ok: true; next: "plan_pending" }
  | { ok: false; reason: Extract<ApproveResult, { ok: false }>["reason"] | "above_price_tiers" };

export async function approveCleanup(
  deps: { db: Db; graphql: AdminGraphql; now?: Date },
  args: { shop: string; simulationId: string; approvedBy: string; acknowledged: boolean; termsVersion?: string; returnUrl: string },
): Promise<ApproveCleanupResult> {
  const simulation = await deps.db.query.simulations.findFirst({
    where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)),
    columns: { activeProfiles: true },
  });
  if (!simulation) return { ok: false, reason: "not_found" };
  // Above the largest plan nothing is sold automatically, so there is nothing to approve.
  if (!planForListSize(simulation.activeProfiles)) return { ok: false, reason: "above_price_tiers" };

  const approved = await approveSimulation(deps.db, { shop: args.shop, simulationId: args.simulationId, approvedBy: args.approvedBy, acknowledged: args.acknowledged, termsVersion: args.termsVersion, now: deps.now });
  if (!approved.ok) return approved;

  const plan = await requestPlanFor(deps, {
    shop: args.shop,
    activeProfiles: simulation.activeProfiles,
    returnUrl: args.returnUrl,
    actor: args.approvedBy,
    termsVersion: args.termsVersion,
    simulationId: args.simulationId,
    keepLargerPlan: true,
  });
  if (!plan.ok) return { ok: true, next: "plan_pending" };
  return plan.next === "ready" ? { ok: true, next: "ready" } : { ok: true, next: "approve_in_shopify", confirmationUrl: plan.confirmationUrl, plan: plan.plan };
}
