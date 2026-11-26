import type { ActionFunctionArgs } from "react-router";
import { db } from "../db.server";
import { deleteShopData, installedAfter, recordDataRequest, redactCustomer } from "../data/privacy";
import { verifyShopifyWebhook } from "../shopify-webhook.server";

/**
 * Mandatory privacy webhooks (customers/data_request, customers/redact,
 * shop/redact). Verified by signature alone (401 on a bad one), so they work
 * when the shop's token can no longer be renewed.
 *
 * TierSaver stores no customer email in clear: matching uses keyed hashes.
 * customers/redact removes that customer's hashes and cuts the link to their
 * Klaviyo profile; shop/redact removes everything stored for the shop;
 * customers/data_request is recorded so the merchant can download what the
 * app holds about that customer (Settings).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, triggeredAt } = await verifyShopifyWebhook(request);

  switch (topic) {
    case "shop/redact":
      // Sent 48 hours after an uninstall. If the shop installed again in the meantime, its data is in use.
      if (await installedAfter(db, shop, triggeredAt ? new Date(triggeredAt.getTime() - 49 * 60 * 60 * 1000) : null)) {
        console.log("shop/redact ignored: the shop installed again");
        break;
      }
      await deleteShopData(db, shop);
      break;
    case "customers/redact": {
      const customer = (payload as { customer?: { id?: number | string; email?: string } }).customer;
      await redactCustomer(db, shop, { id: customer?.id, email: customer?.email });
      break;
    }
    case "customers/data_request": {
      const body = payload as { customer?: { id?: number | string; email?: string }; data_request?: { id?: number | string } };
      await recordDataRequest(db, shop, { id: body.customer?.id, email: body.customer?.email, requestId: body.data_request?.id });
      break;
    }
    default:
      return new Response("Unhandled topic", { status: 400 });
  }
  return new Response();
};
