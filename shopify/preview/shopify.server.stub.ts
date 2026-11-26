// Stands in for app/shopify.server.ts in the local preview (see README.md). Never part of a production build.
import { redirect as routerRedirect, redirectDocument } from "react-router";
import { billing, installPreviewWorld, PREVIEW_SHOP, PREVIEW_USER } from "./world";

installPreviewWorld();

async function graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> {
  const json = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
  if (query.includes("TierSaverBillingStatus")) {
    return json({
      shop: { plan: { partnerDevelopment: true } },
      currentAppInstallation: {
        activeSubscriptions: billing.subscribed
          ? [{ id: "gid://shopify/AppSubscription/1", status: "ACTIVE", test: true, lineItems: [{ id: "gid://shopify/AppSubscriptionLineItem/1", plan: { pricingDetails: { __typename: "AppUsagePricing", cappedAmount: { amount: "149.0", currencyCode: "USD" }, balanceUsed: { amount: "0.0" } } } }] }]
          : [],
      },
    });
  }
  // The shop's time zone, as Shop.ianaTimezone: dates in the app are shown in it (app/settings/timezone.ts).
  if (query.includes("TierSaverShopTimeZone")) return json({ shop: { ianaTimezone: "America/Los_Angeles" } });
  if (query.includes("appSubscriptionCreate")) {
    return json({ appSubscriptionCreate: { confirmationUrl: "http://localhost:3210/__preview/billing/confirm", appSubscription: { id: "gid://shopify/AppSubscription/1" }, userErrors: [] } });
  }
  if (query.includes("appUsageRecordCreate")) {
    const v = options?.variables as { price: { amount: number }; description: string };
    billing.usageRecords.push({ amount: v.price.amount, description: v.description });
    return json({ appUsageRecordCreate: { appUsageRecord: { id: `gid://shopify/AppUsageRecord/${billing.usageRecords.length}` }, userErrors: [] } });
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
