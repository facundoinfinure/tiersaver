import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import { advanceOrdersSync, ordersAccessFromScopes, type AdminGraphql, type OrdersAccess, type OrdersSyncResult } from "./sync";

/** Admin API access for a shop outside a request (Workflow, cron, scan), from the stored offline session, with what its scopes allow. */
export async function offlineOrdersAccess(shop: string): Promise<OrdersAccess> {
  // Imported lazily: the Shopify app object reads secrets when the module loads.
  const { unauthenticated } = await import("../shopify.server");
  // One session load per access object; callers build a new one per step, so an expiring token is refreshed there.
  const { session, admin } = await unauthenticated.admin(shop);
  const graphql: AdminGraphql = async <T>(query: string, variables: Record<string, unknown>) => {
    const response = await admin.graphql(query, { variables });
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (body.errors || !body.data) throw new Error("shopify_graphql_error");
    return body.data;
  };
  return ordersAccessFromScopes(graphql, session.scope);
}

/**
 * Brings the shop's purchase data up to date, at most `maxPages` Admin API
 * requests per call. Used by scans right before they evaluate profiles; the
 * hourly cron and the install use the orders Workflow, which calls the same code.
 */
export async function syncShopOrders(db: DrizzleD1Database<typeof schema>, shop: string, maxPages: number): Promise<OrdersSyncResult> {
  return advanceOrdersSync(db, await offlineOrdersAccess(shop), { shop, maxPages });
}
