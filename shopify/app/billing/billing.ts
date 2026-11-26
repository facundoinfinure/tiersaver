import { chargeIdempotencyKey, DEFAULT_FEE_POLICY, FLAT_PRICE_TIERS, formatUsd, quoteCharge } from "@tiersaver/core";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { CHARGE_HOLD_HOURS } from "../runs/labels";
import { chargedWithoutWindow, clearUnpaidCleanup } from "./unpaid";

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
/**
 * (Defined in runs/labels.ts, which the browser can load.) A confirmed charge waits this long after the cleanup finished before it is sent to Shopify, so a merchant
 * who undoes the whole cleanup inside the window is not charged (decided 2026-11-26).
 */
export { CHARGE_HOLD_HOURS };
const CHARGE_HOLD_MS = CHARGE_HOLD_HOURS * 60 * 60 * 1000;

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The price of one cleanup given what the shop was already CHARGED. Only charges that reached Shopify count:
 * a pending or failed one must not make the next cleanup free. The 28 days are counted in whole UTC days from
 * the day of the charged cleanup, so a monthly schedule is not skipped in a 28-day February by a few minutes.
 */
async function quoteForRun(db: Db, run: { id: string; shop: string; processedCount: number }, activeProfiles: number, now: Date) {
  const charged = await db.query.usageCharges.findMany({
    where: and(eq(schema.usageCharges.shop, run.shop), eq(schema.usageCharges.status, "charged"), ne(schema.usageCharges.runId, run.id)),
    orderBy: desc(schema.usageCharges.createdAt),
    limit: 10,
  });
  const billable = charged.filter((c) => c.feeCents > 0);
  const windowStart = now.getTime() - 30 * DAY_MS;
  const last = billable[0]?.createdAt ?? null;
  return quoteCharge({
    activeProfiles,
    profilesSuppressed: run.processedCount,
    lastChargeAt: last ? new Date(Math.floor(last.getTime() / DAY_MS) * DAY_MS) : null,
    chargedInWindowCents: billable.filter((c) => c.createdAt.getTime() >= windowStart).reduce((sum, c) => sum + c.feeCents, 0),
    now,
  });
}

export type SettleResult =
  | { status: "charged"; feeCents: number }
  /** Quoted from what the run sent; waiting for Klaviyo's jobs to confirm before anything is charged. */
  | { status: "estimated"; feeCents: number }
  /** Confirmed by Klaviyo, waiting out the undo window; `chargeAt` is when it goes to Shopify. */
  | { status: "held"; feeCents: number; chargeAt: string }
  | { status: "not_charged"; reason: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: "run_not_found" | "not_a_cleanup" | "not_finished" };

const FINISHED = ["completed", "completed_with_errors", "failed", "cancelled"] as const;

/**
 * Settles the charge of one cleanup. Safe to call any number of times: there
 * is one `usage_charges` row per run, and Shopify gets the same idempotency
 * key every time. A failed attempt stays "failed" and is tried again later.
 * Three stages: first an ESTIMATE from what the run sent; once Klaviyo's jobs
 * are complete the amount is confirmed but HELD for the undo window; after the
 * window, the real charge for what Klaviyo confirmed.
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
    const quote = await quoteForRun(db, run, simulation.activeProfiles, now);
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

  // The amount is an estimate until Klaviyo confirms how many profiles its jobs processed. Once confirmed, the
  // count is kept on the charge, so a later call (the cron, after the undo window) needs no read of Klaviyo.
  if (!confirmation?.done && !charge.confirmedAt) return { status: "estimated", feeCents: charge.feeCents };
  const confirmed = confirmation?.done ? Math.max(0, Math.min(Math.trunc(confirmation.suppressed), run.processedCount)) : charge.profilesSuppressed;
  if (confirmed === 0) {
    await db
      .update(schema.usageCharges)
      .set({ status: "not_charged", feeCents: 0, profilesSuppressed: 0, noChargeReason: "no_cleanup" })
      .where(and(eq(schema.usageCharges.id, charge.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
    return { status: "not_charged", reason: "no_cleanup" };
  }
  // "No cleanup, no charge" also covers a cleanup that was undone in full before its charge went out
  // (decided 2026-11-25). An undo after the charge does not refund it. The hold below is what gives the
  // merchant time to do that.
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
  if (confirmed !== charge.profilesSuppressed || !charge.confirmedAt) {
    const confirmedAt = charge.confirmedAt ?? now;
    await db.update(schema.usageCharges).set({ profilesSuppressed: confirmed, confirmedAt }).where(eq(schema.usageCharges.id, charge.id));
    charge = { ...charge, profilesSuppressed: confirmed, confirmedAt };
  }

  // An account that left a cleanup unpaid by uninstalling inside the window gets no window (billing/unpaid.ts).
  const noWindow = await chargedWithoutWindow(db, run.shop);
  const chargeAt = (run.finishedAt ?? charge.createdAt).getTime() + (noWindow ? 0 : CHARGE_HOLD_MS);
  if (now.getTime() < chargeAt) return { status: "held", feeCents: charge.feeCents, chargeAt: new Date(chargeAt).toISOString() };
  // A restore that is still running when the window ends decides the charge: wait for it (an hour at a time).
  const undoing = await db.query.runs.findFirst({
    where: and(eq(schema.runs.undoOfRunId, runId), inArray(schema.runs.status, ["queued", "running"])),
    columns: { id: true },
  });
  if (undoing) return { status: "held", feeCents: charge.feeCents, chargeAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() };

  // Priced again at the moment of charging, against what was really charged by now: of two cleanups inside
  // 28 days the first to be charged is the one that pays, and one that was undone does not block the other.
  const simulation = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, run.simulationId), columns: { activeProfiles: true } });
  const finalQuote = await quoteForRun(db, run, simulation?.activeProfiles ?? charge.activeProfiles, now);
  if (finalQuote.feeCents <= 0) {
    await db
      .update(schema.usageCharges)
      .set({ status: "not_charged", feeCents: 0, noChargeReason: finalQuote.noChargeReason ?? "no_cleanup" })
      .where(and(eq(schema.usageCharges.id, charge.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
    return { status: "not_charged", reason: finalQuote.noChargeReason ?? "no_cleanup" };
  }
  if (finalQuote.feeCents !== charge.feeCents) {
    await db.update(schema.usageCharges).set({ feeCents: finalQuote.feeCents, capApplied: finalQuote.capApplied }).where(eq(schema.usageCharges.id, charge.id));
    charge = { ...charge, feeCents: finalQuote.feeCents };
  }

  const fail = async (error: string): Promise<SettleResult> => {
    await db.update(schema.usageCharges).set({ status: "failed", attempts: sql`${schema.usageCharges.attempts} + 1`, lastAttemptAt: now }).where(and(eq(schema.usageCharges.id, charge!.id), inArray(schema.usageCharges.status, ["pending", "failed"])));
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
    await clearUnpaidCleanup(db, run.shop).catch(() => {});
    return { status: "charged", feeCents: charge.feeCents };
  } catch {
    return fail("shopify_request_failed");
  }
}

/** After this many failed tries a charge is still retried, but each try is logged as needing a person. */
export const CHARGE_ATTEMPTS_BEFORE_ALERT = 24;

/**
 * Runs whose charge still has to be created or retried (cron). A charge that is waiting out the undo window is
 * left alone until the window ends. The least recently tried come first, so a charge that keeps failing cannot
 * hold back the others. Thirty days back: an older failure needs a person.
 */
export async function runsWithOpenCharges(db: Db, now = new Date(), limit = 20): Promise<{ runId: string; shop: string; confirmed: boolean; attempts: number }[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const holdEnded = now.getTime() - CHARGE_HOLD_MS;
  const rows = await db.$client
    .prepare(
      `SELECT r.id AS runId, r.shop AS shop, c.confirmed_at IS NOT NULL AS confirmed, COALESCE(c.attempts, 0) AS attempts FROM runs r
       JOIN shops s ON s.shop = r.shop AND s.status = 'installed'
       LEFT JOIN usage_charges c ON c.run_id = r.id
       WHERE r.kind = 'suppress' AND r.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')
         AND r.processed_count > 0 AND r.finished_at >= ?1
         AND (c.id IS NULL OR c.status = 'failed' OR (c.status = 'pending' AND (r.finished_at <= ?3 OR c.confirmed_at IS NULL)))
       ORDER BY COALESCE(c.last_attempt_at, 0), r.finished_at LIMIT ?2`,
    )
    .bind(since.getTime(), limit, holdEnded)
    .all<{ runId: string; shop: string; confirmed: number; attempts: number }>();
  return rows.results.map((r) => ({ runId: r.runId, shop: r.shop, confirmed: Boolean(r.confirmed), attempts: r.attempts }));
}
