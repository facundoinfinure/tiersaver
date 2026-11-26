import type { ActionFunctionArgs } from "react-router";
import { handleSubscriptionUpdate } from "../billing/billing";
import { offlineAdminGraphql } from "../billing/billing.server";
import { db } from "../db.server";
import { verifyShopifyWebhook } from "../shopify-webhook.server";

/**
 * app_subscriptions/update: the shop's TierSaver plan changed at Shopify (approved, declined, cancelled, frozen
 * for non-payment, reactivated). Keeps the app's copy of the plan current, so the home page can say that
 * cleanups are off. It never decides a cleanup: every cleanup asks Shopify itself (billing/billing.ts, `planGate`).
 *
 * Verified by signature alone, like the uninstall webhook: the subscription is cancelled by Shopify when the app
 * is uninstalled, and that delivery must not fail because the shop's token is gone.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await verifyShopifyWebhook(request);
  console.log(`Received ${topic} webhook`);
  const subscription = (payload.app_subscription ?? {}) as { admin_graphql_api_id?: unknown; status?: unknown };
  try {
    const outcome = await handleSubscriptionUpdate(
      { db, graphql: offlineAdminGraphql(shop) },
      {
        shop,
        subscriptionId: typeof subscription.admin_graphql_api_id === "string" ? subscription.admin_graphql_api_id : null,
        status: typeof subscription.status === "string" ? subscription.status : null,
      },
    );
    console.log(`plan webhook: ${outcome}`);
  } catch (error) {
    // Acknowledged all the same: the copy is refreshed again by the next page that shows the plan and by every cleanup.
    console.error(`plan webhook failed: ${error instanceof Error ? error.name : "error"}`);
  }
  return new Response();
};
