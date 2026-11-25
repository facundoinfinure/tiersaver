import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { deleteShopData, redactCustomer } from "../data/privacy";

/**
 * Mandatory privacy webhooks (customers/data_request, customers/redact,
 * shop/redact). authenticate.webhook rejects an invalid HMAC with 401.
 *
 * TierSaver stores no customer personal data in clear: purchase matching
 * uses SHA-256 email hashes. customers/redact removes that customer's hashes;
 * shop/redact removes everything stored for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "SHOP_REDACT":
      await deleteShopData(db, shop);
      break;
    case "CUSTOMERS_REDACT": {
      const customer = (payload as { customer?: { id?: number | string; email?: string } }).customer;
      await redactCustomer(db, shop, { id: customer?.id, email: customer?.email });
      break;
    }
    case "CUSTOMERS_DATA_REQUEST":
      // Nothing to export: the only customer-derived data is a one-way hash of
      // the email with the date of the last order. The help center explains this.
      break;
    default:
      return new Response("Unhandled topic", { status: 400 });
  }
  return new Response();
};
