import { hashEmail } from "@tiersaver/core";
import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { hashCustomerId } from "../data/privacy";
import * as schema from "../db/schema";

/**
 * Buyer protection data from Shopify orders.
 *
 * Only two things are kept per buyer: the SHA-256 of the normalized order
 * email and the date of their most recent order. No email, name, address or
 * order contents are stored or logged.
 */

type Db = DrizzleD1Database<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Without the read_all_orders scope Shopify only returns the last 60 days of orders. */
export const DEFAULT_ORDER_HISTORY_DAYS = 60;
/**
 * With read_all_orders: the shop's whole order history (decided 2026-11-25).
 * The default rule is "never purchased", which needs purchase data from before
 * each profile was created; a fixed window would leave the oldest profiles,
 * the most inactive ones, protected forever. Earlier than any Shopify store.
 */
export const FULL_ORDER_HISTORY_SINCE = new Date("2004-01-01T00:00:00Z");

/** Orders per page. Shopify's maximum page size is 250. */
export const ORDERS_PAGE_SIZE = 250;

export interface OrderRef {
  email: string | null | undefined;
  customerId?: string | number | null;
  processedAt: string | Date | null | undefined;
  /** Test orders are not purchases. */
  test?: boolean | null;
}

/** Creates the shop and its default (conservative) settings on install; revives the row on reinstall. */
export async function ensureShop(db: Db, shop: string, now = new Date()): Promise<void> {
  await db.batch([
    db
      .insert(schema.shops)
      .values({ shop, status: "installed", installedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.shops.shop,
        set: { status: "installed", uninstalledAt: null, updatedAt: now },
      }),
    db.insert(schema.settings).values({ shop, updatedAt: now }).onConflictDoNothing(),
  ]);
}

/**
 * Upserts hashed buyers. For each buyer the most recent order date wins, so
 * replays and out-of-order deliveries are harmless. Returns how many orders counted.
 */
export async function recordPurchases(db: Db, shop: string, orders: readonly OrderRef[], now = new Date()): Promise<number> {
  const latest = new Map<string, { at: Date; customerIdHash: string | null }>();
  for (const order of orders) {
    if (order.test || !order.email || !order.email.includes("@") || !order.processedAt) continue;
    const at = new Date(order.processedAt);
    if (Number.isNaN(at.getTime())) continue;
    const emailHash = await hashEmail(order.email);
    const customerIdHash = order.customerId != null ? await hashCustomerId(shop, customerNumericId(order.customerId)) : null;
    const seen = latest.get(emailHash);
    if (!seen || at > seen.at) latest.set(emailHash, { at, customerIdHash: customerIdHash ?? seen?.customerIdHash ?? null });
  }
  if (latest.size === 0) return 0;

  const statements = [...latest].map(([emailHash, v]) =>
    db
      .insert(schema.purchaseHashes)
      .values({ shop, emailHash, lastOrderAt: v.at, customerIdHash: v.customerIdHash, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.purchaseHashes.shop, schema.purchaseHashes.emailHash],
        set: {
          lastOrderAt: sql`MAX(${schema.purchaseHashes.lastOrderAt}, excluded.last_order_at)`,
          customerIdHash: sql`COALESCE(excluded.customer_id_hash, ${schema.purchaseHashes.customerIdHash})`,
          updatedAt: now,
        },
      }),
  );
  // D1 runs a batch as one transaction; keep each batch well under its limits.
  for (let i = 0; i < statements.length; i += 50) {
    const slice = statements.slice(i, i + 50);
    await db.batch(slice as [(typeof slice)[number], ...typeof slice]);
  }
  return latest.size;
}

/** "gid://shopify/Customer/123" and 123 identify the same customer. */
function customerNumericId(id: string | number): string {
  const s = String(id);
  return s.slice(s.lastIndexOf("/") + 1);
}

export const ORDERS_PAGE_QUERY = `#graphql
  query TierSaverOrdersPage($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
      nodes {
        email
        processedAt
        test
        customer {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface OrdersPageData {
  orders: {
    nodes: { email: string | null; processedAt: string; test: boolean; customer: { id: string } | null }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** Runs one Admin GraphQL query and returns its `data`. Must throw on transport or GraphQL errors. */
export type AdminGraphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

/** How far back the backfill reads, given what Shopify lets the app see. */
export function backfillSince(readAllOrders: boolean, now = new Date()): Date {
  if (readAllOrders) return FULL_ORDER_HISTORY_SINCE;
  return new Date(now.getTime() - DEFAULT_ORDER_HISTORY_DAYS * DAY_MS);
}

/** Reads one page of orders processed since `since` and stores the hashed buyers. */
export async function backfillOrdersPage(
  db: Db,
  graphql: AdminGraphql,
  args: { shop: string; since: Date; cursor: string | null },
): Promise<{ cursor: string | null; done: boolean; orders: number; buyers: number }> {
  const data = await graphql<OrdersPageData>(ORDERS_PAGE_QUERY, {
    first: ORDERS_PAGE_SIZE,
    after: args.cursor,
    query: `processed_at:>='${args.since.toISOString()}'`,
  });
  const { nodes, pageInfo } = data.orders;
  const buyers = await recordPurchases(
    db,
    args.shop,
    nodes.map((n) => ({ email: n.email, processedAt: n.processedAt, test: n.test, customerId: n.customer?.id })),
  );
  const done = !pageInfo.hasNextPage || !pageInfo.endCursor;
  return { cursor: done ? null : pageInfo.endCursor, done, orders: nodes.length, buyers };
}

/**
 * Marks purchase data as complete from `since` on. Until this is set, the
 * purchase rule protects everyone (insufficient_purchase_history). The date
 * only moves earlier, never later.
 */
export async function markPurchasesCovered(db: Db, shop: string, since: Date, readAllOrders: boolean): Promise<void> {
  await db
    .update(schema.shops)
    .set({
      purchasesCoveredSince: sql`MIN(COALESCE(${schema.shops.purchasesCoveredSince}, ${since.getTime()}), ${since.getTime()})`,
      readAllOrdersGranted: readAllOrders,
      updatedAt: new Date(),
    })
    .where(eq(schema.shops.shop, shop));
}
