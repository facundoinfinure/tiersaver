import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { DEFAULT_ORDER_HISTORY_DAYS, FULL_ORDER_HISTORY_SINCE, ORDERS_PAGE_SIZE, recordPurchases } from "./purchases";

/**
 * Keeps the hashed buyers (`purchase_hashes`) complete and current.
 *
 * Purchase data has a start and an end:
 *   shops.purchases_covered_since  from when the buyers are complete
 *   shops.purchases_covered_until  up to when (the last completed read)
 * The rules only trust "this profile never bought" while the end is recent
 * (PURCHASE_DATA_MAX_AGE_HOURS in packages/core); otherwise everyone is
 * protected. Nothing here ever makes a profile a candidate by itself.
 *
 * Orders are read through the Admin GraphQL API in "passes", one page at a time:
 *   backfill     orders processed since the start of what Shopify lets the app
 *                see (everything with read_all_orders, else the last 60 days).
 *                Proves the start of coverage.
 *   incremental  orders created or updated since the last completed read
 *                (minus an overlap). Moves the end of coverage forward.
 * The pass and its cursor live in `orders_sync`, written after every page, so
 * a read is resumed by whoever runs next (the Workflow, the hourly cron's next
 * Workflow instance, or a scan) and never restarted. Pages are idempotent
 * upserts; two runners on the same pass cannot corrupt it: the cursor only
 * moves by compare-and-set, and the loser stops.
 *
 * The orders/create webhook, when enabled, only makes a buyer visible sooner.
 * Coverage never depends on it.
 */

type Db = DrizzleD1Database<typeof schema>;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A completed read counts as "current up to" this long before it began: it
 * absorbs clock differences and the delay of Shopify's order search index.
 */
export const SYNC_SETTLE_MS = 5 * MINUTE_MS;
/** Every incremental read starts this long before the end of the previous one, so nothing indexed late is missed. */
export const SYNC_OVERLAP_MS = HOUR_MS;
/** Data read less than this ago is not read again (a scan right after the cron does no extra work). */
export const SYNC_MIN_INTERVAL_MS = 10 * MINUTE_MS;
/**
 * Without read_all_orders the 60 days are counted on the order's creation
 * date, and this app files a purchase under its processing date. One day of
 * margin keeps the claimed start of coverage inside what was really readable.
 */
export const ORDER_WINDOW_MARGIN_MS = DAY_MS;
/** A pass whose cursor keeps failing and has made no progress for a day starts over from its first page. */
const RESTART_AFTER_FAILURES = 10;
const RESTART_AFTER_STALL_MS = DAY_MS;

/** Runs one Admin GraphQL query and returns its `data`. Must throw on transport or GraphQL errors. */
export type AdminGraphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

/** Admin API access for one shop plus what its granted scopes allow. */
export interface OrdersAccess {
  graphql: AdminGraphql;
  /** read_all_orders granted: orders older than 60 days are readable. */
  readAllOrders: boolean;
  /** read_customers granted: the order's customer (id, email) may be queried. */
  readCustomers: boolean;
}

export function ordersAccessFromScopes(graphql: AdminGraphql, scope: string | null | undefined): OrdersAccess {
  const scopes = (scope ?? "").split(",").map((s) => s.trim());
  // write_customers implies read_customers.
  return { graphql, readAllOrders: scopes.includes("read_all_orders"), readCustomers: scopes.includes("read_customers") || scopes.includes("write_customers") };
}

type PassKind = (typeof schema.ORDERS_SYNC_KINDS)[number];
type Pass = typeof schema.ordersSync.$inferSelect;

/**
 * Orders page (Admin GraphQL 2026-10, `orders` query). The backfill filters and
 * sorts by processed_at; the incremental read by updated_at, which also catches
 * an order whose email was added or corrected after it was placed. The customer
 * is only requested when read_customers was granted: without that scope the
 * field is an access error and the whole page would fail.
 */
export function ordersPageQuery(kind: PassKind, withCustomer: boolean): string {
  return `#graphql
  query TierSaverOrdersPage($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: ${kind === "backfill" ? "PROCESSED_AT" : "UPDATED_AT"}) {
      nodes {
        email
        processedAt
        createdAt
        test${
          withCustomer
            ? `
        customer {
          id
          defaultEmailAddress {
            emailAddress
          }
        }`
            : ""
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
}

interface OrdersPageData {
  orders: {
    nodes: {
      email: string | null;
      processedAt: string | null;
      createdAt: string | null;
      test: boolean | null;
      customer?: { id: string; defaultEmailAddress?: { emailAddress: string | null } | null } | null;
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface PassPlan {
  kind: PassKind;
  queryFrom: Date;
  /** Backfill: the start of coverage it proves. */
  coversSince: Date | null;
  /**
   * True when what is stored cannot be extended (never read, or the last read
   * is older than what Shopify still shows): the start of coverage is forgotten
   * now and set again when this backfill completes.
   */
  restart: boolean;
}

/** What to read next for a shop, or null when its purchase data is current. Pure. */
export function planOrdersPass(
  shop: { purchasesCoveredSince: Date | null; purchasesCoveredUntil: Date | null },
  readAllOrders: boolean,
  now: Date,
): PassPlan | null {
  const visibleFrom = readAllOrders ? FULL_ORDER_HISTORY_SINCE : new Date(now.getTime() - DEFAULT_ORDER_HISTORY_DAYS * DAY_MS);
  const provable = readAllOrders ? FULL_ORDER_HISTORY_SINCE : new Date(visibleFrom.getTime() + ORDER_WINDOW_MARGIN_MS);
  const { purchasesCoveredSince: since, purchasesCoveredUntil: until } = shop;

  // Never read, or read so long ago that orders in between are no longer visible: a gap cannot be
  // papered over. Coverage starts again at what can be read today (it does not reach further back
  // than that), and data from then on is complete.
  if (!since || !until || (!readAllOrders && until.getTime() < provable.getTime())) {
    return { kind: "backfill", queryFrom: visibleFrom, coversSince: provable, restart: true };
  }
  // Freshness first: the end of coverage is what protects recent buyers.
  if (now.getTime() - until.getTime() >= SYNC_MIN_INTERVAL_MS + SYNC_SETTLE_MS) {
    return { kind: "incremental", queryFrom: new Date(until.getTime() - SYNC_OVERLAP_MS), coversSince: null, restart: false };
  }
  // read_all_orders was granted after the first backfill: extend coverage to the whole history.
  if (readAllOrders && since.getTime() > FULL_ORDER_HISTORY_SINCE.getTime()) {
    return { kind: "backfill", queryFrom: FULL_ORDER_HISTORY_SINCE, coversSince: FULL_ORDER_HISTORY_SINCE, restart: false };
  }
  return null;
}

export interface OrdersSyncResult {
  /**
   * fresh  purchase data is current; nothing left to read.
   * more   the page budget of this call ran out; call again to continue.
   * busy   another runner moved the same read forward; this one stopped.
   */
  status: "fresh" | "more" | "busy";
  pages: number;
  orders: number;
}

/**
 * Moves the shop's orders read forward by at most `maxPages` pages (one Admin
 * API request each), starting or resuming a pass as needed. Safe to call from
 * anywhere, any number of times, concurrently. Throws when Shopify cannot be
 * read; the caller's stale data then protects everyone.
 */
export async function advanceOrdersSync(
  db: Db,
  access: OrdersAccess,
  args: { shop: string; maxPages: number; now?: () => Date },
): Promise<OrdersSyncResult> {
  const { shop } = args;
  const clock = args.now ?? (() => new Date());
  let pages = 0;
  let orders = 0;

  for (;;) {
    const now = clock();
    let pass = (await db.query.ordersSync.findFirst({ where: eq(schema.ordersSync.shop, shop) })) ?? null;

    // A history backfill planned with read_all_orders proves nothing once that scope is gone.
    if (pass && pass.kind === "backfill" && pass.readAllOrders && !access.readAllOrders) {
      await db.delete(schema.ordersSync).where(and(eq(schema.ordersSync.shop, shop), eq(schema.ordersSync.passId, pass.passId)));
      pass = null;
    }
    // A cursor Shopify keeps rejecting must not leave the shop protected forever: start the same pass over.
    if (pass && pass.cursor !== null && pass.failures >= RESTART_AFTER_FAILURES && now.getTime() - pass.updatedAt.getTime() >= RESTART_AFTER_STALL_MS) {
      await db
        .update(schema.ordersSync)
        .set({ cursor: null, pages: 0, failures: 0, updatedAt: now })
        .where(and(eq(schema.ordersSync.shop, shop), eq(schema.ordersSync.passId, pass.passId), eq(schema.ordersSync.cursor, pass.cursor)));
      continue;
    }

    if (!pass) {
      const row = await db.query.shops.findFirst({
        where: eq(schema.shops.shop, shop),
        columns: { status: true, purchasesCoveredSince: true, purchasesCoveredUntil: true },
      });
      if (!row || row.status !== "installed") throw new Error("shop_not_installed");
      const plan = planOrdersPass(row, access.readAllOrders, now);
      if (!plan) return { status: "fresh", pages, orders };
      if (pages >= args.maxPages) return { status: "more", pages, orders };
      await startPass(db, shop, plan, access.readAllOrders, now);
      continue; // load whichever pass won, ours or a concurrent runner's
    }
    if (pages >= args.maxPages) return { status: "more", pages, orders };

    let data: OrdersPageData;
    try {
      data = await access.graphql<OrdersPageData>(ordersPageQuery(pass.kind, access.readCustomers), {
        first: ORDERS_PAGE_SIZE,
        after: pass.cursor,
        query: `${pass.kind === "backfill" ? "processed_at" : "updated_at"}:>='${pass.queryFrom.toISOString()}'`,
      });
    } catch (error) {
      await db
        .update(schema.ordersSync)
        .set({ failures: sql`${schema.ordersSync.failures} + 1` })
        .where(and(eq(schema.ordersSync.shop, shop), eq(schema.ordersSync.passId, pass.passId)))
        .catch(() => undefined);
      throw error;
    }
    const { nodes, pageInfo } = data.orders;
    await recordPurchases(
      db,
      shop,
      nodes.map((n) => ({
        email: n.email,
        customerEmail: n.customer?.defaultEmailAddress?.emailAddress,
        customerId: n.customer?.id,
        processedAt: n.processedAt ?? n.createdAt,
        test: n.test,
      })),
      now,
    );
    pages++;
    orders += nodes.length;

    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      const moved = await db
        .update(schema.ordersSync)
        .set({ cursor: pageInfo.endCursor, pages: sql`${schema.ordersSync.pages} + 1`, failures: 0, updatedAt: now })
        .where(
          and(
            eq(schema.ordersSync.shop, shop),
            eq(schema.ordersSync.passId, pass.passId),
            pass.cursor === null ? isNull(schema.ordersSync.cursor) : eq(schema.ordersSync.cursor, pass.cursor),
          ),
        )
        .returning({ shop: schema.ordersSync.shop });
      if (moved.length === 0) return { status: "busy", pages, orders };
    } else {
      await completePass(db, pass, now);
    }
  }
}

async function startPass(db: Db, shop: string, plan: PassPlan, readAllOrders: boolean, now: Date): Promise<void> {
  const passId = crypto.randomUUID();
  const insert = db
    .insert(schema.ordersSync)
    .values({ shop, passId, kind: plan.kind, queryFrom: plan.queryFrom, coversSince: plan.coversSince, readAllOrders, startedAt: now, updatedAt: now })
    .onConflictDoNothing();
  if (!plan.restart) {
    await insert;
    return;
  }
  // One transaction: the old start of coverage is forgotten only if this pass is the one that was created.
  await db.batch([
    insert,
    db
      .update(schema.shops)
      .set({ purchasesCoveredSince: null, updatedAt: now })
      .where(and(eq(schema.shops.shop, shop), passIsLive(shop, passId))),
  ]);
}

/**
 * The pass read its last page: record what it proves and remove it, in one
 * transaction and only if it is still the shop's pass (a second runner
 * finishing the same pass changes nothing). Coverage only ever widens here:
 * the start moves earlier, the end moves later.
 */
async function completePass(db: Db, pass: Pass, now: Date): Promise<void> {
  const until = pass.startedAt.getTime() - SYNC_SETTLE_MS;
  const shops = schema.shops;
  const set =
    pass.kind === "backfill" && pass.coversSince
      ? {
          purchasesCoveredSince: sql`MIN(COALESCE(${shops.purchasesCoveredSince}, ${pass.coversSince.getTime()}), ${pass.coversSince.getTime()})`,
          purchasesCoveredUntil: sql`MAX(COALESCE(${shops.purchasesCoveredUntil}, 0), ${until})`,
          readAllOrdersGranted: pass.readAllOrders,
          updatedAt: now,
        }
      : { purchasesCoveredUntil: sql`MAX(COALESCE(${shops.purchasesCoveredUntil}, 0), ${until})`, updatedAt: now };
  await db.batch([
    db.update(shops).set(set).where(and(eq(shops.shop, pass.shop), passIsLive(pass.shop, pass.passId))),
    db.delete(schema.ordersSync).where(and(eq(schema.ordersSync.shop, pass.shop), eq(schema.ordersSync.passId, pass.passId))),
  ]);
}

function passIsLive(shop: string, passId: string) {
  return sql`EXISTS (SELECT 1 FROM orders_sync WHERE orders_sync.shop = ${shop} AND orders_sync.pass_id = ${passId})`;
}

/** How far the shop's purchase data reaches, for the rules (`DataCoverage.purchasesSince` / `purchasesUntil`). */
export async function purchaseCoverage(db: Db, shop: string): Promise<{ since: Date | null; until: Date | null }> {
  const row = await db.query.shops.findFirst({
    where: eq(schema.shops.shop, shop),
    columns: { purchasesCoveredSince: true, purchasesCoveredUntil: true },
  });
  // Without a proven start there is no coverage at all, whatever the end says.
  if (!row?.purchasesCoveredSince) return { since: null, until: null };
  return { since: row.purchasesCoveredSince, until: row.purchasesCoveredUntil };
}

/** The cron hands a shop to the sync at most this often. */
export const CRON_SYNC_INTERVAL_MS = 50 * MINUTE_MS;

/**
 * Hourly cron: picks the installed shops whose orders were not read in the
 * last hour, least recently attempted first, and stamps the attempt so a shop
 * that keeps failing goes to the back of the line. The caller starts one
 * orders Workflow per returned shop.
 */
export async function claimShopsForOrdersSync(db: Db, args: { now: Date; limit: number }): Promise<string[]> {
  const cutoff = args.now.getTime() - CRON_SYNC_INTERVAL_MS;
  const due = await db
    .select({ shop: schema.shops.shop })
    .from(schema.shops)
    .where(
      and(
        eq(schema.shops.status, "installed"),
        sql`(${schema.shops.purchasesCoveredSince} IS NULL OR ${schema.shops.purchasesCoveredUntil} IS NULL OR ${schema.shops.purchasesCoveredUntil} < ${cutoff})`,
        sql`(${schema.shops.purchasesSyncAttemptedAt} IS NULL OR ${schema.shops.purchasesSyncAttemptedAt} < ${cutoff})`,
      ),
    )
    .orderBy(sql`${schema.shops.purchasesSyncAttemptedAt} IS NOT NULL`, schema.shops.purchasesSyncAttemptedAt)
    .limit(args.limit);
  const shops = due.map((r) => r.shop);
  for (let i = 0; i < shops.length; i += 50) {
    const slice = shops.slice(i, i + 50);
    await db
      .update(schema.shops)
      .set({ purchasesSyncAttemptedAt: args.now })
      .where(sql`${schema.shops.shop} IN (${sql.join(slice.map((s) => sql`${s}`), sql`, `)})`);
  }
  return shops;
}

/** Workflow instance id for a shop's orders sync: one per shop per hour (ids allow letters, digits, "-" and "_"). */
export function ordersSyncInstanceId(shop: string, now: Date): string {
  const hour = now.toISOString().slice(0, 13).replace(/[^0-9]/g, "");
  return `${`orders-${shop.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 88)}-${hour}`;
}

const SHOP_TIME_ZONE_QUERY = `#graphql
  query TierSaverShopTimeZone {
    shop {
      ianaTimezone
    }
  }
`;

/** Stores the shop's IANA time zone (the monthly schedule counts days on the shop's calendar). Returns the stored zone, or null when Shopify's answer is unusable. */
export async function refreshShopTimeZone(db: Db, graphql: AdminGraphql, shop: string): Promise<string | null> {
  const data = await graphql<{ shop: { ianaTimezone: string | null } | null }>(SHOP_TIME_ZONE_QUERY, {});
  const zone = data.shop?.ianaTimezone;
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    return null;
  }
  await db
    .update(schema.shops)
    .set({ ianaTimezone: zone })
    .where(and(eq(schema.shops.shop, shop), sql`${schema.shops.ianaTimezone} IS NOT ${zone}`));
  return zone;
}
