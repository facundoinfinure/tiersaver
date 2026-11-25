import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { recordPurchases } from "../orders/purchases";

interface OrderPayload {
  email?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  test?: boolean | null;
  customer?: { id?: number | string | null } | null;
}

/** Keeps buyer protection current: every new order refreshes the buyer's hashed row. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

  await recordPurchases(db, shop, [
    {
      email: order.email,
      processedAt: order.processed_at ?? order.created_at,
      test: order.test,
      customerId: order.customer?.id,
    },
  ]);
  return new Response();
};
