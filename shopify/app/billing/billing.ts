import { FLAT_PRICE_TIERS, DEFAULT_FEE_POLICY, flatTierFor, flatTierForPrice, formatUsd, planCoverage, type FlatPriceTier, type PlanCoverage } from "@tiersaver/core";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { isShopExcluded, MARKET_EXCLUDED } from "../markets";

/**
 * TierSaver's plan: ONE flat monthly subscription by list size, through Shopify's Billing API.
 * This file is the only place that knows how the plan is sold; everything else asks it.
 *
 * Rules (owner's decision of 2026-11-26, docs/04-PRECIO-Y-COBRO.md):
 * - free until the first cleanup: connecting, the audit and the simulation need no plan;
 * - the plan starts when the merchant approves their first cleanup and Shopify then charges it every 30 days,
 *   whether or not a cleanup runs that month, until the merchant cancels (uninstalling cancels it);
 * - a cleanup, manual or automatic, starts only with an ACTIVE plan whose monthly price is at least the price
 *   of the tier of the list size in the simulation being approved (`planGate`);
 * - nothing is charged per cleanup; restoring a cleanup refunds nothing;
 * - development stores get test subscriptions (`test: true`), which Shopify never charges.
 *
 * What Shopify's documentation says (read on 2026-11-26, GraphQL Admin API 2026-10):
 * - `appSubscriptionCreate` with `appRecurringPricingDetails { price, interval }`; `interval` is
 *   `EVERY_30_DAYS` (the default) or `ANNUAL`. The merchant approves on Shopify's `confirmationUrl` and is sent
 *   back to `returnUrl`. A subscription not approved within two days becomes EXPIRED; a declined one DECLINED.
 *   https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing/create-time-based-subscriptions
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
 *   https://shopify.dev/docs/api/admin-graphql/latest/enums/AppSubscriptionStatus
 * - "An app can have only one active subscription for each merchant. The existing subscription is canceled and
 *   replaced by the new subscription after the merchant approves it." With the default replacement behaviour
 *   (STANDARD) a change between two 30-day plans applies at once and is prorated by Shopify: an upgrade charges
 *   the difference for the days left in the cycle, a downgrade gives the merchant a prorated credit.
 *   https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing
 *   https://shopify.dev/docs/api/admin-graphql/latest/enums/AppSubscriptionReplacementBehavior
 *   This is also why the usage subscription of the old model needs no cleanup: the first plan replaces it.
 * - `appSubscriptionCancel(id, prorate)`: "Cancels an active app subscription, stopping future billing cycles";
 *   `prorate` defaults to false (no credit for the days left). Uninstalling cancels the subscription.
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCancel
 * - `APP_SUBSCRIPTIONS_UPDATE` webhook: "Triggered when the status, or capped amount, of an AppSubscription
 *   object is changed" (app/routes/webhooks.app.subscriptions_update.tsx).
 *   https://shopify.dev/docs/apps/launch/billing/manual-pricing
 *
 * ALTERNATIVE PATH, not implemented: Shopify App Pricing (formerly "managed pricing").
 * Shopify's documentation calls it "the default option when you submit a new public app for approval" and the
 * Billing API ("Manual Pricing") the legacy method, "still supported for existing apps and outlier pricing
 * models Shopify App Pricing doesn't cover". App Store requirement 1.2.1 accepts either: "Your app must use
 * Shopify App Pricing or the Shopify Billing API for any app charges."
 * https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing (also served at /billing/managed-pricing)
 * https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
 * If the owner switches the app to Shopify App Pricing in the Partner Dashboard, only this file changes:
 * - the four plans are defined in the Partner Dashboard, with the prices of FLAT_PRICE_TIERS (the App Store
 *   listing shows them from there) and no trial;
 * - `requestPlan` stops calling `appSubscriptionCreate` (Shopify refuses it once the app has opted in) and
 *   returns Shopify's hosted plan page instead:
 *   https://admin.shopify.com/store/<store handle>/charges/<app handle>/pricing_plans
 *   That page cannot be opened on one given plan, so the merchant picks the plan and `planGate` checks the pick;
 * - `getBillingStatus` reads the Partner API's `activeSubscription(appId, shopId)` (the documented way; it needs
 *   a Partner API credential as a secret) instead of `currentAppInstallation.activeSubscriptions`;
 * - `cancelPlan` sends the merchant to the same hosted page, and the `APP_SUBSCRIPTIONS_UPDATE` webhook is
 *   replaced by the redirect parameters and Partner API queries (Shopify App Pricing sends no webhooks since
 *   2026-04-28);
 * - `planCoversList`, `planGate`, the copy in `shop_plans` and every caller stay as they are.
 *
 * No Cloudflare or Shopify imports: the Admin API is a function passed in.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };
export type AdminGraphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

/** Shopify's name for "charged every 30 days". The only interval TierSaver sells. */
export const PLAN_INTERVAL = "EVERY_30_DAYS";
export const PLAN_INTERVAL_DAYS = DEFAULT_FEE_POLICY.billingIntervalDays;

/** "US$9": the way a price is written to the merchant. */
export const usd = (cents: number) => `US${formatUsd(cents)}`;
const count = (n: number) => n.toLocaleString("en-US");

export interface Plan {
  monthlyCents: number;
  /** Largest list (active profiles) the plan covers. */
  maxProfiles: number;
  /** The subscription's name, as Shopify shows it on its approval page and in the merchant's bills. */
  name: string;
  /** "US$9/month". */
  price: string;
  /** One sentence with everything the merchant agrees to. Built here so no page writes a price by hand. */
  terms: string;
}

function planOf(tier: FlatPriceTier): Plan {
  const price = `${usd(tier.monthlyCents)}/month`;
  return {
    monthlyCents: tier.monthlyCents,
    maxProfiles: tier.maxProfiles,
    name: `TierSaver list hygiene: up to ${count(tier.maxProfiles)} active profiles`,
    price,
    terms: `${price} for lists up to ${count(tier.maxProfiles)} active profiles, charged by Shopify every ${PLAN_INTERVAL_DAYS} days until you cancel.`,
  };
}

/** Every plan on sale, smallest first. */
export const PLANS: readonly Plan[] = FLAT_PRICE_TIERS.map(planOf);
/** Above this many active profiles TierSaver is not sold automatically. */
export const LARGEST_PLAN_PROFILES = FLAT_PRICE_TIERS[FLAT_PRICE_TIERS.length - 1]!.maxProfiles;

/** The plan for a list of this size, or null above the largest plan (not sold automatically). */
export function planForListSize(activeProfiles: number): Plan | null {
  const tier = flatTierFor(activeProfiles);
  return tier ? planOf(tier) : null;
}

export interface ActivePlan {
  /** Shopify's AppSubscription id. */
  id: string;
  name: string;
  monthlyCents: number;
  /** Largest list the plan covers; null when its price is not one of the plans on sale. */
  maxProfiles: number | null;
  /** Test subscription (development stores): Shopify never charges it. */
  test: boolean;
  /** ISO date and time the current 30-day period ends, when Shopify reports it. */
  currentPeriodEnd: string | null;
}

export interface BillingStatus {
  /** Development stores can only take test charges. */
  developmentStore: boolean;
  /** The ACTIVE 30-day subscription in USD, if the merchant approved one. Nothing else counts as a plan. */
  plan: ActivePlan | null;
  /** A plan exists but Shopify put it on hold for non-payment; it comes back when payments resume. */
  frozen: boolean;
}

const STATUS_QUERY = `#graphql
  query TierSaverBillingStatus {
    shop { plan { partnerDevelopment } }
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing { interval price { amount currencyCode } }
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
      name?: string;
      status: string;
      test: boolean;
      currentPeriodEnd?: string | null;
      lineItems?: { id: string; plan?: { pricingDetails?: { __typename?: string; interval?: string; price?: { amount: string; currencyCode: string } } } }[];
    }[];
  };
}

const cents = (amount: string | undefined) => Math.round(Number(amount ?? 0) * 100);

/**
 * The shop's plan as Shopify reports it right now. Only a subscription with a recurring 30-day price in USD is
 * a plan: the usage subscription of the per-cleanup model (it may still exist on the development store) has no
 * such line item and does not count.
 */
export async function getBillingStatus(graphql: AdminGraphql): Promise<BillingStatus> {
  const data = await graphql<StatusData>(STATUS_QUERY, {});
  let plan: ActivePlan | null = null;
  let frozen = false;
  for (const sub of data.currentAppInstallation?.activeSubscriptions ?? []) {
    const recurring = (sub.lineItems ?? []).find((li) => {
      const details = li.plan?.pricingDetails;
      return details?.__typename === "AppRecurringPricing" && details.interval === PLAN_INTERVAL && details.price?.currencyCode === "USD";
    });
    if (!recurring) continue;
    if (sub.status === "FROZEN") frozen = true;
    if (sub.status !== "ACTIVE" || plan) continue;
    const monthlyCents = cents(recurring.plan?.pricingDetails?.price?.amount);
    if (!(monthlyCents > 0)) continue;
    plan = {
      id: sub.id,
      name: sub.name ?? "",
      monthlyCents,
      maxProfiles: flatTierForPrice(monthlyCents)?.maxProfiles ?? null,
      test: sub.test === true,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
    };
  }
  return { developmentStore: data.shop?.plan?.partnerDevelopment === true, plan, frozen: frozen && !plan };
}

/**
 * Whether `plan` allows a cleanup of a list of `activeProfiles`: its monthly price must be at least the price
 * of the list's tier. `overpaying` marks a plan that costs more than the list needs (the list moved to a lower
 * tier): the merchant is told and offered the lower plan.
 */
export function planCoversList(plan: Pick<ActivePlan, "monthlyCents"> | null, activeProfiles: number): PlanCoverage {
  return planCoverage(plan?.monthlyCents ?? null, activeProfiles);
}

const CREATE_MUTATION = `#graphql
  mutation TierSaverPlanCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
      confirmationUrl
      appSubscription { id }
      userErrors { field message }
    }
  }`;

export type RequestPlanResult = { ok: true; confirmationUrl: string; plan: Plan } | { ok: false; error: "above_price_tiers" | "plan_not_created" };

/**
 * Asks Shopify for the approval page of the plan for a list of `activeProfiles`. Nothing is charged until the
 * merchant approves there; Shopify then sends them to `returnUrl`. Approving replaces any subscription the shop
 * already has (a smaller or larger plan, or the old usage subscription), with Shopify's own proration.
 */
export async function requestPlan(graphql: AdminGraphql, args: { activeProfiles: number; returnUrl: string; test: boolean }): Promise<RequestPlanResult> {
  const plan = planForListSize(args.activeProfiles);
  if (!plan) return { ok: false, error: "above_price_tiers" };
  const data = await graphql<{ appSubscriptionCreate?: { confirmationUrl?: string | null; userErrors?: { message: string }[] } }>(CREATE_MUTATION, {
    name: plan.name,
    returnUrl: args.returnUrl,
    // Development stores cannot be charged: Shopify only accepts test subscriptions there.
    test: args.test,
    lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: plan.monthlyCents / 100, currencyCode: "USD" }, interval: PLAN_INTERVAL } } }],
  });
  const result = data.appSubscriptionCreate;
  if (!result?.confirmationUrl || (result.userErrors?.length ?? 0) > 0) return { ok: false, error: "plan_not_created" };
  return { ok: true, confirmationUrl: result.confirmationUrl, plan };
}

const CANCEL_MUTATION = `#graphql
  mutation TierSaverPlanCancel($id: ID!) {
    appSubscriptionCancel(id: $id, prorate: false) {
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

export type CancelPlanResult = { ok: true; cancelled: ActivePlan | null } | { ok: false; error: "plan_not_cancelled" };

/**
 * Cancels the shop's plan at Shopify: no further 30-day charge is made. The days left of the current period are
 * not credited (`prorate: false`), as the terms say. `cancelled: null` means there was no plan to cancel.
 */
export async function cancelPlan(graphql: AdminGraphql): Promise<CancelPlanResult> {
  const { plan } = await getBillingStatus(graphql);
  if (!plan) return { ok: true, cancelled: null };
  const data = await graphql<{ appSubscriptionCancel?: { appSubscription?: { id: string; status: string } | null; userErrors?: { message: string }[] } }>(CANCEL_MUTATION, { id: plan.id });
  const result = data.appSubscriptionCancel;
  if (!result?.appSubscription?.id || (result.userErrors?.length ?? 0) > 0) return { ok: false, error: "plan_not_cancelled" };
  return { ok: true, cancelled: plan };
}

// ---- The app's copy of the plan (`shop_plans`) ---------------------------------------------------------------

export type PlanEnd = "cancelled" | "declined" | "frozen";

/**
 * Brings `shop_plans` in line with what Shopify just reported, and writes the audit trail (product rule 3):
 * `plan.started` when a plan becomes active (first plan, or a change of plan) and `plan.ended` when it stops.
 * `endedAs` says why a plan that is no longer there ended (default: cancelled; "frozen" when Shopify reported a
 * hold that its list of subscriptions no longer shows); `declined` is also recorded for a shop that never had a
 * plan (the merchant said no on Shopify's approval page).
 */
export async function syncPlanState(db: Db, shop: string, status: BillingStatus, opts: { actor?: string; endedAs?: PlanEnd; now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const previous = await db.query.shopPlans.findFirst({ where: eq(schema.shopPlans.shop, shop) });

  if (status.plan) {
    const plan = status.plan;
    const fresh = previous?.status !== "active" || previous.subscriptionId !== plan.id;
    const values = {
      status: "active" as const,
      subscriptionId: plan.id,
      monthlyCents: plan.monthlyCents,
      tierMaxProfiles: plan.maxProfiles,
      test: plan.test,
      currentPeriodEnd: plan.currentPeriodEnd ? new Date(plan.currentPeriodEnd) : null,
      startedAt: fresh ? now : (previous?.startedAt ?? now),
      endedAt: null,
      updatedAt: now,
    };
    await db.insert(schema.shopPlans).values({ shop, ...values }).onConflictDoUpdate({ target: schema.shopPlans.shop, set: values });
    if (fresh) {
      await db
        .insert(schema.eventsLog)
        .values({
          id: `plan:${shop}:${plan.id}:started`,
          shop,
          at: now,
          actor,
          action: "plan.started",
          detail: { subscriptionId: plan.id, monthlyCents: plan.monthlyCents, tierMaxProfiles: plan.maxProfiles, test: plan.test, previousMonthlyCents: previous?.status === "active" ? previous.monthlyCents : null },
        })
        .onConflictDoNothing();
    }
    return;
  }

  if (status.frozen) {
    if (previous && previous.status !== "frozen") {
      await db.update(schema.shopPlans).set({ status: "frozen", updatedAt: now }).where(eq(schema.shopPlans.shop, shop));
      await db.insert(schema.eventsLog).values({ id: crypto.randomUUID(), shop, at: now, actor, action: "plan.frozen", detail: { subscriptionId: previous.subscriptionId } });
    } else if (!previous) {
      await db.insert(schema.shopPlans).values({ shop, status: "frozen", updatedAt: now }).onConflictDoNothing();
    }
    return;
  }

  // No plan at Shopify.
  const endedAs = opts.endedAs ?? "cancelled";
  if (previous && (previous.status === "active" || (previous.status === "frozen" && endedAs !== "frozen"))) {
    await db.batch([
      db.update(schema.shopPlans).set({ status: endedAs, endedAt: endedAs === "frozen" ? null : now, currentPeriodEnd: null, updatedAt: now }).where(eq(schema.shopPlans.shop, shop)),
      db.insert(schema.eventsLog).values({ id: crypto.randomUUID(), shop, at: now, actor, action: endedAs === "frozen" ? "plan.frozen" : "plan.ended", detail: { subscriptionId: previous.subscriptionId, monthlyCents: previous.monthlyCents, endedAs } }),
    ]);
    return;
  }
  if (!previous && opts.endedAs === "declined") {
    await db.insert(schema.shopPlans).values({ shop, status: "declined", endedAt: now, updatedAt: now }).onConflictDoNothing();
  }
}

/** The app's copy of the plan: for pages that must not ask Shopify on every load. Null: the shop never had a plan. */
export async function storedPlanState(db: Db, shop: string): Promise<{ status: (typeof schema.PLAN_STATUSES)[number]; monthlyCents: number; tierMaxProfiles: number | null } | null> {
  const row = await db.query.shopPlans.findFirst({ where: eq(schema.shopPlans.shop, shop), columns: { status: true, monthlyCents: true, tierMaxProfiles: true } });
  return row ?? null;
}

// ---- The gate ------------------------------------------------------------------------------------------------

export type PlanGateRefusal =
  /** No active plan: the merchant has to approve one in Shopify. */
  | "plan_required"
  /** The plan is on hold at Shopify for non-payment. */
  | "plan_frozen"
  /** The list moved to a higher tier: the merchant has to approve the new price in Shopify. */
  | "plan_price_too_low"
  /** List above the largest plan: not sold automatically. */
  | "above_price_tiers"
  /** Shopify could not be asked. Nothing is started on a guess. */
  | "billing_unavailable"
  | "not_found";

export type PlanGateResult = { ok: true; plan: ActivePlan; overpaying: boolean; requiredCents: number } | { ok: false; reason: PlanGateRefusal; requiredCents: number | null };

/**
 * THE gate of every cleanup, manual or automatic (runs/start.server.ts, schedule/automatic.ts): asks Shopify
 * itself, at that moment, whether the shop has an active plan that covers the list size of the simulation.
 * Never answered from the stored copy, and a failed question is a refusal.
 */
export async function planGate(deps: { db: Db; graphql: AdminGraphql; actor?: string; now?: Date }, args: { shop: string; simulationId: string }): Promise<PlanGateResult> {
  const simulation = await deps.db.query.simulations.findFirst({
    where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)),
    columns: { activeProfiles: true },
  });
  if (!simulation) return { ok: false, reason: "not_found", requiredCents: null };
  let status: BillingStatus;
  try {
    status = await getBillingStatus(deps.graphql);
  } catch {
    return { ok: false, reason: "billing_unavailable", requiredCents: null };
  }
  // Keeping the copy current must never decide a cleanup.
  await syncPlanState(deps.db, args.shop, status, { actor: deps.actor, now: deps.now }).catch(() => {});
  const coverage = planCoversList(status.plan, simulation.activeProfiles);
  if (coverage.covered && status.plan) return { ok: true, plan: status.plan, overpaying: coverage.overpaying, requiredCents: coverage.requiredCents };
  if (coverage.covered) return { ok: false, reason: "plan_required", requiredCents: coverage.requiredCents };
  if (coverage.reason === "no_plan") return { ok: false, reason: status.frozen ? "plan_frozen" : "plan_required", requiredCents: coverage.requiredCents };
  return { ok: false, reason: coverage.reason, requiredCents: coverage.requiredCents };
}

// ---- Actions a merchant takes ----------------------------------------------------------------------------------

/** Asks Shopify for the plan and brings the stored copy in line. For pages that show the plan. Throws when Shopify cannot be asked. */
export async function refreshPlan(deps: { db: Db; graphql: AdminGraphql; actor?: string; endedAs?: PlanEnd; now?: Date }, shop: string): Promise<BillingStatus> {
  const status = await getBillingStatus(deps.graphql);
  await syncPlanState(deps.db, shop, status, { actor: deps.actor, endedAs: deps.endedAs, now: deps.now }).catch(() => {});
  return status;
}

export type PlanRequest =
  /** The shop already has exactly the plan this list size needs. */
  | { ok: true; next: "ready" }
  /** Send the merchant to Shopify's approval page. */
  | { ok: true; next: "approve_in_shopify"; confirmationUrl: string; plan: Plan }
  | { ok: false; reason: "above_price_tiers" | "billing_unavailable" | typeof MARKET_EXCLUDED };

/**
 * Starts, or changes to, the plan for a list of `activeProfiles`. With `keepLargerPlan` a plan that already
 * covers the list is left alone even if it costs more (approving a cleanup never changes a plan that is
 * enough); without it the request is for exactly the list's plan (the merchant asked to switch to the lower one).
 * The request and the terms version shown are written to the audit trail; the plan itself only exists once the
 * merchant approves it at Shopify.
 */
export async function requestPlanFor(
  deps: { db: Db; graphql: AdminGraphql; now?: Date },
  args: { shop: string; activeProfiles: number; returnUrl: string; actor: string; termsVersion?: string; simulationId?: string | null; keepLargerPlan?: boolean },
): Promise<PlanRequest> {
  // No plan is ever started for a store in a market TierSaver is not offered in (app/markets.ts).
  if (await isShopExcluded(deps.db, args.shop)) return { ok: false, reason: MARKET_EXCLUDED };
  const wanted = planForListSize(args.activeProfiles);
  if (!wanted) return { ok: false, reason: "above_price_tiers" };
  try {
    const status = await refreshPlan({ db: deps.db, graphql: deps.graphql, actor: args.actor, now: deps.now }, args.shop);
    const current = status.plan?.monthlyCents ?? null;
    if (current !== null && (current === wanted.monthlyCents || (args.keepLargerPlan && current > wanted.monthlyCents))) return { ok: true, next: "ready" };
    const requested = await requestPlan(deps.graphql, { activeProfiles: args.activeProfiles, returnUrl: args.returnUrl, test: status.developmentStore });
    if (!requested.ok) return { ok: false, reason: requested.error === "above_price_tiers" ? "above_price_tiers" : "billing_unavailable" };
    await deps.db
      .insert(schema.eventsLog)
      .values({
        id: crypto.randomUUID(),
        shop: args.shop,
        at: deps.now ?? new Date(),
        actor: args.actor,
        action: "plan.requested",
        simulationId: args.simulationId ?? null,
        detail: { monthlyCents: wanted.monthlyCents, tierMaxProfiles: wanted.maxProfiles, activeProfiles: Math.ceil(args.activeProfiles), previousMonthlyCents: current, test: status.developmentStore, termsVersion: args.termsVersion ?? null },
      })
      .catch(() => {});
    return { ok: true, next: "approve_in_shopify", confirmationUrl: requested.confirmationUrl, plan: requested.plan };
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }
}

/**
 * "Cancel plan" in Settings. Cancels the subscription at Shopify and, as its consequences: cleanups can no longer
 * start (`planGate`), and automatic cleanups are turned off, so that starting a plan again later does not bring
 * them back without the merchant asking. Recorded with who did it. Nothing is restored and nothing is refunded.
 */
export async function cancelPlanForShop(deps: { db: Db; graphql: AdminGraphql; now?: Date }, args: { shop: string; actor: string }): Promise<{ ok: true; hadPlan: boolean; automaticTurnedOff: boolean } | { ok: false; reason: "billing_unavailable" | "plan_not_cancelled" }> {
  const now = deps.now ?? new Date();
  let cancelled: ActivePlan | null;
  try {
    const result = await cancelPlan(deps.graphql);
    if (!result.ok) return { ok: false, reason: "plan_not_cancelled" };
    cancelled = result.cancelled;
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }
  await syncPlanState(deps.db, args.shop, { developmentStore: false, plan: null, frozen: false }, { actor: args.actor, endedAs: "cancelled", now });
  const settings = await deps.db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop), columns: { mode: true, version: true } });
  const automaticTurnedOff = settings?.mode === "automatic";
  if (automaticTurnedOff) {
    await deps.db.batch([
      deps.db.update(schema.settings).set({ mode: "approval", updatedAt: now }).where(eq(schema.settings.shop, args.shop)),
      deps.db.insert(schema.eventsLog).values({ id: crypto.randomUUID(), shop: args.shop, at: now, actor: args.actor, action: "automatic_mode.disabled", detail: { reason: "plan_cancelled", settingsVersion: settings?.version ?? null } }),
    ]);
  }
  return { ok: true, hadPlan: Boolean(cancelled), automaticTurnedOff };
}

// ---- Shopify's webhook -----------------------------------------------------------------------------------------

const PAYLOAD_END: Record<string, PlanEnd> = { CANCELLED: "cancelled", EXPIRED: "cancelled", DECLINED: "declined", FROZEN: "frozen" };

/**
 * APP_SUBSCRIPTIONS_UPDATE: a subscription of this shop changed status at Shopify (approved, declined, cancelled
 * there or by an uninstall, frozen for non-payment, reactivated). The payload only says what happened to ONE
 * subscription, and a replaced or declined one says nothing about the plan that is still active, so Shopify is
 * asked for the current state with the shop's offline token; the payload's status only explains why a plan is
 * gone. If Shopify cannot be asked, the payload is believed only about the subscription the app has on record.
 * Safe to receive more than once and out of order.
 */
export async function handleSubscriptionUpdate(
  deps: { db: Db; graphql: AdminGraphql; now?: Date },
  args: { shop: string; subscriptionId: string | null; status: string | null },
): Promise<"ignored" | "synced" | "from_payload"> {
  const shop = await deps.db.query.shops.findFirst({ where: eq(schema.shops.shop, args.shop), columns: { status: true } });
  // Unknown or uninstalled shop: Shopify cancels the subscription on uninstall, and the stored plan went with it.
  if (!shop || shop.status !== "installed") return "ignored";
  const endedAs = PAYLOAD_END[(args.status ?? "").toUpperCase()];
  try {
    const status = await getBillingStatus(deps.graphql);
    await syncPlanState(deps.db, args.shop, status, { actor: "webhook", endedAs, now: deps.now });
    return "synced";
  } catch {
    const stored = await deps.db.query.shopPlans.findFirst({ where: eq(schema.shopPlans.shop, args.shop), columns: { subscriptionId: true } });
    if (!endedAs || !args.subscriptionId || (stored ? stored.subscriptionId !== args.subscriptionId : endedAs !== "declined")) return "ignored";
    await syncPlanState(deps.db, args.shop, { developmentStore: false, plan: null, frozen: false }, { actor: "webhook", endedAs, now: deps.now });
    return "from_payload";
  }
}
