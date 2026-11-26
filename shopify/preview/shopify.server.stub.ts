// Stands in for app/shopify.server.ts in the local preview (see README.md). Never part of a production build.
import { redirect as routerRedirect, redirectDocument } from "react-router";
import { billing, installPreviewWorld, PREVIEW_SHOP, PREVIEW_USER } from "./world";

installPreviewWorld();

async function graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> {
  const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  if (query.includes("TierSaverBillingStatus")) {
    const recurring = (plan: { id: string; name: string; monthlyCents: number; test: boolean }, status: string) => ({
      id: plan.id,
      name: plan.name,
      status,
      test: plan.test,
      currentPeriodEnd: status === "ACTIVE" ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null,
      lineItems: [{ id: `${plan.id}/line`, plan: { pricingDetails: { __typename: "AppRecurringPricing", interval: "EVERY_30_DAYS", price: { amount: (plan.monthlyCents / 100).toFixed(2), currencyCode: "USD" } } } }],
    });
    return json({
      shop: { plan: { partnerDevelopment: true } },
      currentAppInstallation: {
        activeSubscriptions: [
          ...(billing.plan ? [recurring(billing.plan, billing.frozen ? "FROZEN" : "ACTIVE")] : []),
          ...(billing.legacyUsage
            ? [{ id: "gid://shopify/AppSubscription/legacy", name: "TierSaver list hygiene", status: "ACTIVE", test: true, lineItems: [{ id: "legacy/line", plan: { pricingDetails: { __typename: "AppUsagePricing" } } }] }]
            : []),
        ],
      },
    });
  }
  // The shop's time zone, as Shop.ianaTimezone: dates in the app are shown in it (app/settings/timezone.ts).
  if (query.includes("TierSaverShopTimeZone")) return json({ shop: { ianaTimezone: "America/Los_Angeles" } });
  // The plan waits on "Shopify's approval page" (/__preview/billing/confirm, see worker.ts) until it is approved there.
  if (query.includes("appSubscriptionCreate")) {
    const v = options?.variables as { name: string; returnUrl: string; test: boolean; lineItems: { plan: { appRecurringPricingDetails: { price: { amount: number } } } }[] };
    const monthlyCents = Math.round(v.lineItems[0]!.plan.appRecurringPricingDetails.price.amount * 100);
    billing.pending = { id: `gid://shopify/AppSubscription/${billing.next++}`, name: v.name, monthlyCents, test: v.test, returnUrl: v.returnUrl };
    billing.requested.push({ name: v.name, monthlyCents, test: v.test });
    return json({ appSubscriptionCreate: { confirmationUrl: "http://localhost:3210/__preview/billing/confirm", appSubscription: { id: billing.pending.id }, userErrors: [] } });
  }
  if (query.includes("appSubscriptionCancel")) {
    const id = (options?.variables as { id: string }).id;
    if (billing.plan?.id !== id) return json({ appSubscriptionCancel: { appSubscription: null, userErrors: [{ message: "not found" }] } });
    billing.plan = null;
    billing.cancelled++;
    return json({ appSubscriptionCancel: { appSubscription: { id, status: "CANCELLED" }, userErrors: [] } });
  }
  // Orders backfill and anything else: an empty, finished page.
  return json({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
}

const session = { shop: PREVIEW_SHOP, scope: "read_orders" };
const context = async () => ({
  session,
  sessionToken: { sub: PREVIEW_USER },
  admin: { graphql },
  // Preview helpers are not app routes: they need a full page load, like Shopify's own pages would.
  redirect: (url: string, _init?: unknown) => (url.includes("/__preview/") ? redirectDocument(url) : routerRedirect(url)),
});

export const authenticate = {
  admin: async (_request: Request) => context(),
  webhook: async (_request: Request): Promise<never> => {
    throw new Response("webhooks are not part of the preview", { status: 404 });
  },
};
export const unauthenticated = { admin: async (_shop: string) => ({ session, admin: { graphql } }) };
export const login = async (_request: Request) => ({});
export const addDocumentResponseHeaders = (_request: Request, _headers: Headers) => {};
export const registerWebhooks = async () => {};
export const apiVersion = "2026-10";
export const sessionStorage = null;
export default {};
