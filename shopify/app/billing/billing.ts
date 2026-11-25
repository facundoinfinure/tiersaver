import { chargeIdempotencyKey, DEFAULT_FEE_POLICY, FLAT_PRICE_TIERS, formatUsd, quoteCharge } from "@tiersaver/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * TierSaver's own charge, through Shopify's Billing API ("Manual Pricing"):
 * one usage-based subscription with a capped amount, and one usage record per
 * cleanup that suppressed profiles. Checked against shopify.dev on 2026-11-25
 * (API 2026-10): appSubscriptionCreate with `appUsagePricingDetails { terms,
 * cappedAmount }`, appUsageRecordCreate with `idempotencyKey`.
 *
 * Rules (docs/00-HANDOVER.md, docs/04-PRECIO-Y-COBRO.md):
 * - flat price by list size; the list size is the one shown in the approved simulation;
 * - a cleanup that suppressed nobody is not charged;
 * - at most one charge every 28 days and never above the cap;
 * - above the public tiers nothing is charged automatically;
 * - the amount never depends on the merchant's Klaviyo invoice.
 *
 * No Cloudflare or Shopify imports: the Admin API is a function passed in.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };
export type AdminGraphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

export const SUBSCRIPTION_NAME = "TierSaver list hygiene";
export const CAPPED_AMOUNT_CENTS = DEFAULT_FEE_POLICY.windowCapCents;

/** Shown by Shopify on the approval screen. Built from the price table, so it cannot drift from what is charged. */
export function subscriptionTerms(): string {
  const tiers = FLAT_PRICE_TIERS.map((t) => `${formatUsd(t.monthlyCents)} up to ${t.maxProfiles.toLocaleString("en-US")} active profiles`).join(", ");
  return `Flat monthly price by list size: ${tiers}. Charged only in a month when a cleanup suppresses profiles, at most once every ${DEFAULT_FEE_POLICY.minDaysBetweenCharges} days. The audit is free.`;
}

const STATUS_QUERY = `#graphql
  query TierSaverBillingStatus {
    shop { plan { partnerDevelopment } }
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        test
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppUsagePricing { cappedAmount { amount currencyCode } balanceUsed { amount } }
            }
          }
        }
      }
    }
  }`;

interface StatusData {
  shop?: { plan?: { partnerDevelopment?: boolean } };
  currentAppInstallation?: {
    activeSubscriptions?: {
      id: string;
      status: string;
      test: boolean;
      lineItems?: { id: string; plan?: { pricingDetails?: { __typename?: string; cappedAmount?: { amount: string; currencyCode: string }; balanceUsed?: { amount: string } } } }[];
    }[];
  };
}

export interface BillingStatus {
  /** Development stores can only take test charges. */
  developmentStore: boolean;
  /** The active subscription with a usage line item in USD, if the merchant accepted one. */
  subscription: { id: string; usageLineItemId: string; cappedCents: number; balanceUsedCents: number; test: boolean } | null;
}

const cents = (amount: string | undefined) => Math.round(Number(amount ?? 0) * 100);

export async function getBillingStatus(graphql: AdminGraphql): Promise<BillingStatus> {
  const data = await graphql<StatusData>(STATUS_QUERY, {});
  let subscription: BillingStatus["subscription"] = null;
  for (const sub of data.currentAppInstallation?.activeSubscriptions ?? []) {
    if (sub.status !== "ACTIVE") continue;
    const usage = (sub.lineItems ?? []).find(
      (li) => li.plan?.pricingDetails?.__typename === "AppUsagePricing" && li.plan.pricingDetails.cappedAmount?.currencyCode === "USD",
    );
    if (!usage) continue;
    subscription = {
      id: sub.id,
      usageLineItemId: usage.id,
      cappedCents: cents(usage.plan?.pricingDetails?.cappedAmount?.amount),
      balanceUsedCents: cents(usage.plan?.pricingDetails?.balanceUsed?.amount),
      test: sub.test === true,
    };
    break;
  }
  return { developmentStore: data.shop?.plan?.partnerDevelopment === true, subscription };
}

const CREATE_MUTATION = `#graphql
  mutation TierSaverSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl
      appSubscription { id }
      userErrors { field message }
    }
  }`;

/** Asks Shopify for the approval page of the usage subscription. Nothing is charged by accepting it. */
export async function requestSubscription(
  graphql: AdminGraphql,
  args: { returnUrl: string; test: boolean },
): Promise<{ ok: true; confirmationUrl: string } | { ok: false; error: string }> {
  const data = await graphql<{ appSubscriptionCreate?: { confirmationUrl?: string | null; userErrors?: { message: string }[] } }>(CREATE_MUTATION, {
    name: SUBSCRIPTION_NAME,
    returnUrl: args.returnUrl,
    test: args.test,
    lineItems: [
      {
        plan: {
          appUsagePricingDetails: {
            terms: subscriptionTerms(),
            cappedAmount: { amount: CAPPED_AMOUNT_CENTS / 100, currencyCode: "USD" },
          },
        },
      },
    ],
  });
  const result = data.appSubscriptionCreate;
  if (!result?.confirmationUrl || (result.userErrors?.length ?? 0) > 0) return { ok: false, error: "subscription_not_created" };
  return { ok: true, confirmationUrl: result.confirmationUrl };
}

const USAGE_MUTATION = `#graphql
  mutation TierSaverUsage($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!, $idempotencyKey: String) {
    appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, price: $price, description: $description, idempotencyKey: $idempotencyKey) {
      appUsageRecord { id }
      userErrors { field message }
    }
  }`;

export type SettleResult =
  | { status: "charged"; feeCents: number }
  /** Quoted from what the run sent; waiting for Klaviyo's jobs to confirm before anything is charged. */
  | { status: "estimated"; feeCents: number }
  | { status: "not_charged"; reason: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: "run_not_found" | "not_a_cleanup" | "not_finished" };

const FINISHED = ["completed", "completed_with_errors", "failed", "cancelled"] as const;

/**
 * Settles the charge of one cleanup. Safe to call any number of times: there
 * is one `usage_charges` row per run, and Shopify gets the same idempotency
 * key every time. A failed attempt stays "failed" and is tried again later.
 * Two stages: first an ESTIMATE from what the run sent, then, once Klaviyo's
 * jobs are complete, the real charge for what Klaviyo confirmed.
 */
export async function settleRunCharge(
  deps: { db: Db; graphql: AdminGraphql | null; now?: () => Date },
  runId: string,
  /**
   * What Klaviyo's jobs report for the run (app/runs/confirm.ts). Until it is
   * `done` the charge is only an estimate and nothing is sent to Shopify.
   */
  confirmation: { done: boolean; suppressed: number } | null = null,
): Promise<SettleResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) return { status: "skipped", reason: "run_not_found" };
  if (run.kind !== "suppress" || !run.simulationId) return { status: "skipped", reason: "not_a_cleanup" };
  if (!(FINISHED as readonly string[]).includes(run.status)) return { status: "skipped", reason: "not_finished" };

  let charge = await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) });
  if (charge?.status === "charged") return { status: "charged", feeCents: charge.feeCents };
  if (charge?.status === "not_charged") return { status: "not_charged", reason: charge.noChargeReason ?? "no_cleanup" };

  if (!charge) {
    const simulation = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, run.simulationId) });
    if (!simulation) return { status: "skipped", reason: "not_a_cleanup" };
    const earlier = await db.query.usageCharges.findMany({
      where: and(eq(schema.usageCharges.shop, run.shop), inArray(schema.usageCharges.status, ["charged", "pending", "failed"])),
      orderBy: desc(schema.usageCharges.createdAt),
      limit: 10,
    });
    const billable = earlier.filter((c) => c.feeCents > 0);
    const windowStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const quote = quoteCharge({
      activeProfiles: simulation.activeProfiles,
      profilesSuppressed: run.processedCount,
      lastChargeAt: billable[0]?.createdAt ?? null,
      chargedInWindowCents: billable.filter((c) => c.createdAt.getTime() >= windowStart).reduce((sum, c) => sum + c.feeCents, 0),
      now,
    });
    await db
      .insert(schema.usageCharges)
      .values({
        id: crypto.randomUUID(),
        shop: run.shop,
        runId,
        activeProfiles: quote.activeProfiles,
        priceTierMax: quote.tier?.maxProfiles ?? null,
        profilesSuppressed: run.processedCount,
        feeCents: quote.feeCents,
        capApplied: quote.capApplied,
        noChargeReason: quote.noChargeReason,
        status: quote.feeCents > 0 ? "pending" : "not_charged",
        idempotencyKey: chargeIdempotencyKey(run.shop, runId),
        createdAt: now,
      })
      .onConflictDoNothing();
    charge = await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) });
    if (!charge) return { status: "failed", error: "charge_not_recorded" };
    await db
      .insert(schema.eventsLog)
      .values({
        id: `run:${runId}:charge-quoted`,
        shop: run.shop,
        at: now,
        actor: "system",
        action: charge.feeCents > 0 ? "charge.quoted" : "charge.not_charged",
        runId,
        detail: { feeCents: charge.feeCents, activeProfiles: charge.activeProfiles, profilesSuppressed: charge.profilesSuppressed, reason: charge.noChargeReason },
      })
      .onConflictDoNothing();
    if (charge.status === "not_charged") return { status: "not_charged", reason: charge.noChargeReason ?? "no_cleanup" };
  }

  // The amount is an estimate until Klaviyo confirms how many profiles its jobs processed.
  if (!confirmation?.done) return { status: "estimated", feeCents: charge.feeCents };
  const confirmed = Math.max(0, Math.min(Math.trunc(confirmation.suppressed), run.processedCount));
  if (confirmed === 0) {
    await db
      .update(schema.usageCharges)
      .set({ status: "not_charged", feeCents: 0, profilesSuppressed: 0, noChargeReason: "no_cleanup" })
      .where(and(eq(schema.usageCharges.id, charge.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
    return { status: "not_charged", reason: "no_cleanup" };
  }
  // "No cleanup, no charge" also covers a cleanup that was undone in full before its charge went out
  // (decided 2026-11-25). An undo after the charge does not refund it.
  const [remaining] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.status, "submitted"), sql`${schema.runProfiles.reactivatedAt} IS NULL`));
  if ((remaining?.n ?? 0) === 0) {
    await db
      .update(schema.usageCharges)
      .set({ status: "not_charged", feeCents: 0, noChargeReason: "cleanup_undone" })
      .where(and(eq(schema.usageCharges.id, charge.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
    return { status: "not_charged", reason: "cleanup_undone" };
  }
  if (confirmed !== charge.profilesSuppressed) {
    await db.update(schema.usageCharges).set({ profilesSuppressed: confirmed }).where(eq(schema.usageCharges.id, charge.id));
    charge = { ...charge, profilesSuppressed: confirmed };
  }

  const fail = async (error: string): Promise<SettleResult> => {
    await db.update(schema.usageCharges).set({ status: "failed" }).where(and(eq(schema.usageCharges.id, charge!.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
    return { status: "failed", error };
  };
  if (!deps.graphql) return fail("shopify_unavailable");

  try {
    const billing = await getBillingStatus(deps.graphql);
    if (!billing.subscription) return fail("no_active_subscription");
    const data = await deps.graphql<{ appUsageRecordCreate?: { appUsageRecord?: { id: string } | null; userErrors?: { message: string }[] } }>(USAGE_MUTATION, {
      subscriptionLineItemId: billing.subscription.usageLineItemId,
      price: { amount: charge.feeCents / 100, currencyCode: "USD" },
      description: `List cleanup: ${charge.profilesSuppressed.toLocaleString("en-US")} profiles suppressed${charge.priceTierMax ? ` (list of up to ${charge.priceTierMax.toLocaleString("en-US")} active profiles)` : ""}`,
      idempotencyKey: charge.idempotencyKey,
    });
    const record = data.appUsageRecordCreate?.appUsageRecord;
    if (!record?.id || (data.appUsageRecordCreate?.userErrors?.length ?? 0) > 0) return fail("usage_record_rejected");
    await db.batch([
      db.update(schema.usageCharges).set({ status: "charged", chargedAt: now, shopifyUsageRecordId: record.id }).where(eq(schema.usageCharges.id, charge.id)),
      db
        .insert(schema.eventsLog)
        .values({ id: `run:${runId}:charged`, shop: run.shop, at: now, actor: "system", action: "charge.created", runId, detail: { feeCents: charge.feeCents, test: billing.subscription.test } })
        .onConflictDoNothing(),
    ]);
    return { status: "charged", feeCents: charge.feeCents };
  } catch {
    return fail("shopify_request_failed");
  }
}

/** Runs whose charge still has to be created or retried (cron). Only the last week: an older failure needs a person. */
export async function runsWithOpenCharges(db: Db, now = new Date(), limit = 20): Promise<{ runId: string; shop: string }[]> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.$client
    .prepare(
      `SELECT r.id AS runId, r.shop AS shop FROM runs r
       LEFT JOIN usage_charges c ON c.run_id = r.id
       WHERE r.kind = 'suppress' AND r.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')
         AND r.processed_count > 0 AND r.finished_at >= ?1
         AND (c.id IS NULL OR c.status IN ('pending', 'failed'))
       ORDER BY r.finished_at LIMIT ?2`,
    )
    .bind(since.getTime(), limit)
    .all<{ runId: string; shop: string }>();
  return rows.results;
}
