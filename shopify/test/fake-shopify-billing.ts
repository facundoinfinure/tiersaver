import type { AdminGraphql } from "../app/billing/billing";

/**
 * A stand-in for the part of Shopify's Admin API that app/billing/billing.ts uses: the shop's subscriptions,
 * `appSubscriptionCreate` (pending until `approve()`, like Shopify's approval page) and `appSubscriptionCancel`.
 * Every operation is recorded, so a test can show what was never asked of Shopify.
 */
export interface FakeSubscription {
  id: string;
  name: string;
  status: "ACTIVE" | "FROZEN" | "PENDING" | "CANCELLED" | "DECLINED";
  test: boolean;
  /** Recurring monthly price in cents; null for the usage subscription of the old per-cleanup model. */
  monthlyCents: number | null;
  returnUrl?: string;
}

export function fakeShopifyBilling(opts: { developmentStore?: boolean; monthlyCents?: number; legacyUsageSubscription?: boolean } = {}) {
  let next = 1;
  const state = {
    developmentStore: opts.developmentStore ?? true,
    /** Throws on every call, like an outage or a revoked token. */
    down: false,
    subscriptions: [] as FakeSubscription[],
    /** Names of the GraphQL operations received, in order. */
    operations: [] as string[],
    created: [] as { name: string; returnUrl: string; test: boolean; lineItems: unknown }[],
    cancelled: [] as string[],
  };
  const add = (sub: Omit<FakeSubscription, "id">) => {
    const row = { id: `gid://shopify/AppSubscription/${next++}`, ...sub };
    state.subscriptions.push(row);
    return row;
  };
  if (opts.legacyUsageSubscription) add({ name: "TierSaver list hygiene", status: "ACTIVE", test: true, monthlyCents: null });
  if (opts.monthlyCents) add({ name: "plan", status: "ACTIVE", test: state.developmentStore, monthlyCents: opts.monthlyCents });

  const graphql: AdminGraphql = async <T>(query: string, variables: Record<string, unknown>) => {
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
    state.operations.push(operation);
    if (state.down) throw new Error("shopify_graphql_error");
    if (operation === "TierSaverBillingStatus") {
      return {
        shop: { plan: { partnerDevelopment: state.developmentStore } },
        currentAppInstallation: {
          activeSubscriptions: state.subscriptions
            .filter((s) => s.status === "ACTIVE" || s.status === "FROZEN")
            .map((s) => ({
              id: s.id,
              name: s.name,
              status: s.status,
              test: s.test,
              currentPeriodEnd: s.status === "ACTIVE" ? "2026-12-26T12:00:00Z" : null,
              lineItems: [
                {
                  id: `${s.id}/line`,
                  plan: {
                    pricingDetails:
                      s.monthlyCents === null
                        ? { __typename: "AppUsagePricing" }
                        : { __typename: "AppRecurringPricing", interval: "EVERY_30_DAYS", price: { amount: (s.monthlyCents / 100).toFixed(2), currencyCode: "USD" } },
                  },
                },
              ],
            })),
        },
      } as T;
    }
    if (operation === "TierSaverPlanCreate") {
      const v = variables as { name: string; returnUrl: string; test: boolean; lineItems: { plan: { appRecurringPricingDetails: { price: { amount: number } } } }[] };
      state.created.push({ name: v.name, returnUrl: v.returnUrl, test: v.test, lineItems: v.lineItems });
      const sub = add({ name: v.name, status: "PENDING", test: v.test, monthlyCents: Math.round(v.lineItems[0]!.plan.appRecurringPricingDetails.price.amount * 100), returnUrl: v.returnUrl });
      return { appSubscriptionCreate: { confirmationUrl: `https://admin.shopify.com/confirm/${sub.id.split("/").pop()}`, appSubscription: { id: sub.id }, userErrors: [] } } as T;
    }
    if (operation === "TierSaverPlanCancel") {
      if (!/prorate:\s*false/.test(query)) throw new Error("the plan must be cancelled without proration");
      const sub = state.subscriptions.find((s) => s.id === variables.id && s.status === "ACTIVE");
      if (!sub) return { appSubscriptionCancel: { appSubscription: null, userErrors: [{ message: "not found" }] } } as T;
      sub.status = "CANCELLED";
      state.cancelled.push(sub.id);
      return { appSubscriptionCancel: { appSubscription: { id: sub.id, status: "CANCELLED" }, userErrors: [] } } as T;
    }
    throw new Error(`unexpected operation ${operation}`);
  };

  return {
    graphql,
    state,
    /** The merchant approves the pending subscription on Shopify's page: it becomes the only active one. */
    approve() {
      const pending = [...state.subscriptions].reverse().find((s) => s.status === "PENDING");
      if (!pending) throw new Error("nothing to approve");
      for (const s of state.subscriptions) if (s.status === "ACTIVE") s.status = "CANCELLED";
      pending.status = "ACTIVE";
      return pending;
    },
    decline() {
      const pending = [...state.subscriptions].reverse().find((s) => s.status === "PENDING");
      if (pending) pending.status = "DECLINED";
    },
    /** What an uninstall, a cancellation in Shopify or a store billing problem does. */
    end(status: "CANCELLED" | "FROZEN") {
      for (const s of state.subscriptions) if (s.status === "ACTIVE" && s.monthlyCents !== null) s.status = status;
    },
  };
}
