import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { authenticate } from "../shopify.server";
import { db, schema } from "../db.server";

/**
 * Mandatory privacy webhooks (customers/data_request, customers/redact,
 * shop/redact). authenticate.webhook rejects an invalid HMAC with 401.
 *
 * TierSaver stores no customer personal data in clear: purchase matching
 * uses SHA-256 email hashes. customers/redact removes that customer's hash
 * (tables arrive in Phase 3); shop/redact removes everything for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  switch (topic) {
    case "SHOP_REDACT":
      await db.delete(schema.sessionTable).where(eq(schema.sessionTable.shop, shop));
      break;
    case "CUSTOMERS_REDACT":
    case "CUSTOMERS_DATA_REQUEST":
      // No customer records yet. Phase 3 deletes / reports the hashed purchase rows.
      break;
    default:
      return new Response("Unhandled topic", { status: 400 });
  }
  return new Response();
};
