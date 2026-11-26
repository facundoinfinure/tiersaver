import { hashShopEmail } from "../email-hash";
import { sql } from "drizzle-orm";
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

/** Without the read_all_orders scope Shopify only returns orders created in the last 60 days. */
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
  /**
   * Email of the order's customer, when it is known and differs from the order's
   * (point-of-sale orders often carry no order email). Both protect.
   */
  customerEmail?: string | null;
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
 * replays and out-of-order deliveries are harmless. Returns how many buyers were stored.
 */
export async function recordPurchases(db: Db, shop: string, orders: readonly OrderRef[], now = new Date()): Promise<number> {
  const latest = new Map<string, { at: Date; customerIdHash: string | null }>();
  for (const order of orders) {
    if (order.test || !order.processedAt) continue;
    const emails = [order.email, order.customerEmail].filter((e): e is string => typeof e === "string" && e.includes("@"));
    if (emails.length === 0) continue;
    const at = new Date(order.processedAt);
    if (Number.isNaN(at.getTime())) continue;
    const customerIdHash = order.customerId != null ? await hashCustomerId(shop, customerNumericId(order.customerId)) : null;
    for (const email of emails) {
      // The one place order emails are hashed: every lookup must use the same helper.
      const emailHash = await hashShopEmail(shop, email);
      const seen = latest.get(emailHash);
      if (!seen || at > seen.at) latest.set(emailHash, { at, customerIdHash: customerIdHash ?? seen?.customerIdHash ?? null });
      else if (!seen.customerIdHash && customerIdHash) seen.customerIdHash = customerIdHash;
    }
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
