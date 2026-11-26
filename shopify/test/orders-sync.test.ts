import { PURCHASE_DATA_MAX_AGE_HOURS, hashEmail, purchaseDataIsFresh } from "@tiersaver/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteShopData } from "../app/data/privacy";
import { ensureShop, FULL_ORDER_HISTORY_SINCE } from "../app/orders/purchases";
import {
  advanceOrdersSync,
  claimShopsForOrdersSync,
  ordersAccessFromScopes,
  ordersSyncInstanceId,
  planOrdersPass,
  purchaseCoverage,
  refreshShopTimeZone,
  SYNC_SETTLE_MS,
  type OrdersAccess,
} from "../app/orders/sync";
import { FakeShopifyOrders, type FakeOrder } from "./fake-shopify-orders";
import { db, schema, uniqueShop } from "./helpers";

const T0 = Date.parse("2026-12-01T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

interface World {
  shop: string;
  fake: FakeShopifyOrders;
  clock: { now: number };
  access: OrdersAccess;
  sync: (maxPages?: number) => ReturnType<typeof advanceOrdersSync>;
  shopRow: () => Promise<typeof schema.shops.$inferSelect>;
  pass: () => Promise<typeof schema.ordersSync.$inferSelect | undefined>;
  has: (email: string) => Promise<Date | null>;
}

async function world(opts: { orders?: FakeOrder[]; scope?: string; pageSize?: number } = {}): Promise<World> {
  const shop = uniqueShop();
  await ensureShop(db, shop);
  const clock = { now: T0 };
  const fake = new FakeShopifyOrders();
  fake.now = () => clock.now;
  fake.orders = opts.orders ?? [];
  fake.pageSize = opts.pageSize ?? 2;
  const access = ordersAccessFromScopes(fake.graphql, opts.scope ?? "read_orders");
  fake.readAllOrders = access.readAllOrders;
  return {
    shop,
    fake,
    clock,
    access,
    sync: (maxPages = 100) => advanceOrdersSync(db, access, { shop, maxPages, now: () => new Date(clock.now) }),
    shopRow: async () => (await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) }))!,
    pass: () => db.query.ordersSync.findFirst({ where: eq(schema.ordersSync.shop, shop) }),
    has: async (email) => {
      const hash = await hashEmail(email);
      const row = await db.query.purchaseHashes.findFirst({ where: (p, { and, eq }) => and(eq(p.shop, shop), eq(p.emailHash, hash)) });
      return row?.lastOrderAt ?? null;
    },
  };
}

/** `count` orders, one per day going back from `T0 - 1 day`, each from its own buyer. */
const dailyOrders = (count: number): FakeOrder[] =>
  Array.from({ length: count }, (_, i) => ({ email: `buyer${i}@example.com`, processedAt: iso(T0 - (i + 1) * DAY) }));

describe("orders sync: the first backfill", () => {
  it("reads what Shopify shows, proves coverage from 59 days back up to the start of the read, and leaves no pass behind", async () => {
    const w = await world({ orders: [...dailyOrders(5), { email: "old@example.com", processedAt: iso(T0 - 200 * DAY) }, { email: "t@example.com", processedAt: iso(T0 - DAY), test: true }] });
    expect(await purchaseCoverage(db, w.shop)).toEqual({ since: null, until: null });

    expect(await w.sync()).toEqual({ status: "fresh", pages: 3, orders: 6 });

    const row = await w.shopRow();
    // The 60 days are counted on the creation date; one day of margin on what is claimed.
    expect(row.purchasesCoveredSince?.toISOString()).toBe(iso(T0 - 59 * DAY));
    expect(row.purchasesCoveredUntil?.toISOString()).toBe(iso(T0 - SYNC_SETTLE_MS));
    expect(row.readAllOrdersGranted).toBe(false);
    expect(await w.pass()).toBeUndefined();
    expect(await w.has("buyer0@example.com")).toEqual(new Date(T0 - DAY));
    expect(await w.has("old@example.com")).toBeNull(); // not visible without read_all_orders
    expect(await w.has("t@example.com")).toBeNull(); // test orders are not purchases
    expect(w.fake.calls[0]!.variables).toEqual({ first: 250, after: null, query: `processed_at:>='${iso(T0 - 60 * DAY)}'` });
    expect(w.fake.calls[0]!.query).toContain("sortKey: PROCESSED_AT");
    // Without read_customers the customer is not requested: the field would be an access error.
    expect(w.fake.calls[0]!.query).not.toContain("customer");
  });

  it("with read_all_orders the whole history is read and coverage starts before any store existed", async () => {
    const w = await world({ scope: "read_orders,read_all_orders", orders: [{ email: "old@example.com", processedAt: "2015-03-01T00:00:00Z" }] });
    expect(await w.sync()).toMatchObject({ status: "fresh", orders: 1 });
    const row = await w.shopRow();
    expect(row.purchasesCoveredSince).toEqual(FULL_ORDER_HISTORY_SINCE);
    expect(row.readAllOrdersGranted).toBe(true);
    expect(await w.has("old@example.com")).toEqual(new Date("2015-03-01T00:00:00Z"));
  });

  it("asks for the customer only with read_customers, and then the customer's email protects too", async () => {
    const w = await world({
      scope: "read_orders,read_customers",
      orders: [{ email: null, processedAt: iso(T0 - DAY), customer: { id: "gid://shopify/Customer/9", email: "pos@example.com" } }],
    });
    await w.sync();
    expect(w.fake.calls[0]!.query).toContain("defaultEmailAddress");
    expect(await w.has("pos@example.com")).toEqual(new Date(T0 - DAY));
  });
});

describe("orders sync: a large store's backfill is resumed, never restarted (M5)", () => {
  it("completes across several bounded invocations, one request per page in total", async () => {
    const w = await world({ orders: dailyOrders(20), pageSize: 3 }); // 7 pages
    // Each call stands for one Workflow instance that ran out of its page budget.
    expect(await w.sync(3)).toEqual({ status: "more", pages: 3, orders: 9 });
    expect(await w.pass()).toMatchObject({ kind: "backfill", pages: 3, failures: 0 });
    // Not complete yet: nothing is claimed, so the rules still protect everyone.
    expect(await purchaseCoverage(db, w.shop)).toEqual({ since: null, until: null });

    w.clock.now += HOUR;
    expect(await w.sync(3)).toEqual({ status: "more", pages: 3, orders: 9 });
    w.clock.now += HOUR;
    // The last page of the backfill, then the incremental read that covers the two hours it took.
    const last = await w.sync(3);
    expect(last.status).toBe("fresh");

    const backfillCalls = w.fake.calls.filter((c) => String(c.variables.query).startsWith("processed_at"));
    expect(backfillCalls).toHaveLength(7);
    // Every request continued from the previous one's cursor, with the query fixed when the backfill began.
    expect(new Set(backfillCalls.map((c) => c.variables.after)).size).toBe(7);
    expect(new Set(backfillCalls.map((c) => c.variables.query))).toEqual(new Set([`processed_at:>='${iso(T0 - 60 * DAY)}'`]));
    for (let i = 0; i < 20; i++) expect(await w.has(`buyer${i}@example.com`)).not.toBeNull();

    const row = await w.shopRow();
    // The start is the one the backfill could prove when it began, not when it ended.
    expect(row.purchasesCoveredSince?.toISOString()).toBe(iso(T0 - 59 * DAY));
    expect(purchaseDataIsFresh(row.purchasesCoveredUntil, new Date(w.clock.now))).toBe(true);
    expect(await w.pass()).toBeUndefined();
  });

  it("a failed page keeps the cursor: the next attempt continues from the last stored page", async () => {
    const w = await world({ orders: dailyOrders(8) }); // 4 pages
    w.fake.failWhen = (n) => (n === 3 ? new Error("shopify_graphql_error") : undefined);
    await expect(w.sync()).rejects.toThrow("shopify_graphql_error");
    const stalled = await w.pass();
    expect(stalled).toMatchObject({ pages: 2, failures: 1 });
    expect(await purchaseCoverage(db, w.shop)).toEqual({ since: null, until: null });

    expect(await w.sync()).toMatchObject({ status: "fresh", pages: 2 });
    expect(w.fake.calls[3]!.variables.after).toBe(stalled!.cursor);
    expect(w.fake.calls).toHaveLength(5);
    expect((await w.shopRow()).purchasesCoveredSince).not.toBeNull();
  });

  it("two runners on the same read: one moves the cursor, the other stops, and nothing is lost", async () => {
    const w = await world({ orders: dailyOrders(8) });
    let nested: Awaited<ReturnType<World["sync"]>> | null = null;
    // While the first runner holds page 1 in memory, a second runner reads the whole history.
    w.fake.afterFetch = async (n) => {
      if (n === 1) nested = await w.sync();
    };
    expect(await w.sync()).toMatchObject({ status: "busy", pages: 1 });
    expect(nested).toMatchObject({ status: "fresh" });
    for (let i = 0; i < 8; i++) expect(await w.has(`buyer${i}@example.com`)).not.toBeNull();
    expect(await w.pass()).toBeUndefined();
    expect((await w.shopRow()).purchasesCoveredUntil?.toISOString()).toBe(iso(T0 - SYNC_SETTLE_MS));
  });

  it("a cursor that keeps failing for a day restarts the same read instead of blocking the shop forever", async () => {
    const w = await world({ orders: dailyOrders(6) });
    await w.sync(1);
    await db.update(schema.ordersSync).set({ failures: 10 }).where(eq(schema.ordersSync.shop, w.shop));
    // Failing, but progress was made today: keep the cursor.
    w.clock.now += HOUR;
    await w.sync(1);
    expect(await w.pass()).toMatchObject({ pages: 2, failures: 0 });

    await db.update(schema.ordersSync).set({ failures: 10 }).where(eq(schema.ordersSync.shop, w.shop));
    w.clock.now += 25 * HOUR;
    await w.sync(1);
    expect(w.fake.calls[2]!.variables.after).toBeNull();
    expect(await w.pass()).toMatchObject({ pages: 1, failures: 0 });
  });
});

describe("orders sync: purchase data stays current after the install (C1)", () => {
  it("an order placed after the backfill is found by the next sync, without the orders/create webhook", async () => {
    const w = await world({ orders: dailyOrders(2) });
    await w.sync();
    expect(await w.has("late@example.com")).toBeNull();

    // 45 days later someone buys. Nothing but the sync tells the app.
    w.clock.now = T0 + 45 * DAY;
    w.fake.orders.push({ email: "Late@Example.com", processedAt: iso(T0 + 44 * DAY) });
    const before = await w.shopRow();
    expect(purchaseDataIsFresh(before.purchasesCoveredUntil, new Date(w.clock.now))).toBe(false);

    const calls = w.fake.calls.length;
    expect(await w.sync()).toEqual({ status: "fresh", pages: 1, orders: 1 });
    const request = w.fake.calls[calls]!;
    // From the end of the last completed read, minus the overlap, by update date.
    expect(request.variables.query).toBe(`updated_at:>='${iso(T0 - SYNC_SETTLE_MS - HOUR)}'`);
    expect(request.query).toContain("sortKey: UPDATED_AT");
    expect(await w.has("late@example.com")).toEqual(new Date(T0 + 44 * DAY));

    const after = await w.shopRow();
    // Fresh data moves the end forward; the start does not move at all.
    expect(after.purchasesCoveredSince).toEqual(before.purchasesCoveredSince);
    expect(after.purchasesCoveredUntil?.toISOString()).toBe(iso(w.clock.now - SYNC_SETTLE_MS));
  });

  it("an email added to an order after it was placed is picked up (the read follows updates, not creations)", async () => {
    const order: FakeOrder = { email: null, processedAt: iso(T0 - 3 * DAY) };
    const w = await world({ orders: [order] });
    await w.sync();
    w.clock.now += 2 * HOUR;
    order.email = "added@example.com";
    order.updatedAt = iso(w.clock.now - HOUR);
    await w.sync();
    expect(await w.has("added@example.com")).toEqual(new Date(T0 - 3 * DAY));
  });

  it("is idempotent: data read minutes ago is not read again, and a repeated read changes nothing", async () => {
    const w = await world({ orders: dailyOrders(3) });
    await w.sync();
    const calls = w.fake.calls.length;
    w.clock.now += 5 * MIN;
    expect(await w.sync()).toEqual({ status: "fresh", pages: 0, orders: 0 });
    expect(w.fake.calls).toHaveLength(calls);

    w.clock.now += HOUR;
    const hashes = await db.query.purchaseHashes.findMany({ where: eq(schema.purchaseHashes.shop, w.shop) });
    await w.sync();
    await w.sync();
    const again = await db.query.purchaseHashes.findMany({ where: eq(schema.purchaseHashes.shop, w.shop) });
    expect(again.map((r) => [r.emailHash, r.lastOrderAt])).toEqual(hashes.map((r) => [r.emailHash, r.lastOrderAt]));
  });

  it("an incremental read bigger than one invocation is resumed too, and only counts once it is complete", async () => {
    const w = await world({ orders: dailyOrders(1) });
    await w.sync();
    const until = (await w.shopRow()).purchasesCoveredUntil;
    w.clock.now += 3 * HOUR;
    for (let i = 0; i < 6; i++) w.fake.orders.push({ email: `new${i}@example.com`, processedAt: iso(T0 + HOUR + i * MIN) });

    expect(await w.sync(2)).toMatchObject({ status: "more", pages: 2 });
    expect((await w.shopRow()).purchasesCoveredUntil).toEqual(until);
    expect(await w.pass()).toMatchObject({ kind: "incremental", pages: 2 });
    expect(await w.sync(2)).toMatchObject({ status: "fresh" });
    expect((await w.shopRow()).purchasesCoveredUntil?.toISOString()).toBe(iso(w.clock.now - SYNC_SETTLE_MS));
    expect(await w.has("new5@example.com")).not.toBeNull();
  });

  it("when Shopify cannot be read the end of coverage does not move, so it goes stale", async () => {
    const w = await world({ orders: dailyOrders(1) });
    await w.sync();
    const until = (await w.shopRow()).purchasesCoveredUntil!;
    w.clock.now += (PURCHASE_DATA_MAX_AGE_HOURS + 1) * HOUR;
    w.fake.failWhen = () => new Error("shopify_graphql_error");
    await expect(w.sync()).rejects.toThrow();
    expect((await w.shopRow()).purchasesCoveredUntil).toEqual(until);
    expect(purchaseDataIsFresh(until, new Date(w.clock.now))).toBe(false);
  });
});

describe("orders sync: the 60-day window is handled honestly", () => {
  it("a gap longer than what Shopify still shows cannot be filled: coverage is dropped at once and starts again", async () => {
    const w = await world({ orders: dailyOrders(2) });
    await w.sync();
    const first = (await w.shopRow()).purchasesCoveredSince!;

    // The app could not read orders for 70 days (uninstalled and reinstalled, token revoked...).
    w.clock.now = T0 + 70 * DAY;
    w.fake.orders.push({ email: "missed@example.com", processedAt: iso(T0 + 5 * DAY) }, { email: "seen@example.com", processedAt: iso(T0 + 60 * DAY) }, { email: "seen2@example.com", processedAt: iso(T0 + 61 * DAY) });
    w.fake.pageSize = 1;
    expect(await w.sync(0)).toMatchObject({ status: "more" });
    expect(await w.sync(1)).toMatchObject({ status: "more" });
    // In progress: the old start is already forgotten, so nothing is claimed.
    expect(await w.pass()).toMatchObject({ kind: "backfill" });
    expect(await purchaseCoverage(db, w.shop)).toEqual({ since: null, until: null });

    await w.sync();
    const row = await w.shopRow();
    // The start moved forward to what was readable; it does not pretend to reach back to the first install.
    expect(row.purchasesCoveredSince?.toISOString()).toBe(iso(w.clock.now - 59 * DAY));
    expect(row.purchasesCoveredSince!.getTime()).toBeGreaterThan(first.getTime());
    expect(await w.has("missed@example.com")).toBeNull();
    expect(await w.has("seen@example.com")).not.toBeNull();
  });

  it("a shop backfilled before freshness was tracked (start known, end unknown) is read again from scratch", () => {
    const now = new Date(T0);
    expect(planOrdersPass({ purchasesCoveredSince: new Date(T0 - 300 * DAY), purchasesCoveredUntil: null }, false, now)).toMatchObject({
      kind: "backfill",
      restart: true,
      coversSince: new Date(T0 - 59 * DAY),
    });
    expect(planOrdersPass({ purchasesCoveredSince: new Date(T0 - 300 * DAY), purchasesCoveredUntil: new Date(T0 - 30 * DAY) }, false, now)).toMatchObject({
      kind: "incremental",
      restart: false,
      queryFrom: new Date(T0 - 30 * DAY - HOUR),
    });
    expect(planOrdersPass({ purchasesCoveredSince: new Date(T0 - 300 * DAY), purchasesCoveredUntil: new Date(T0 - MIN) }, false, now)).toBeNull();
  });

  it("read_all_orders granted later extends coverage to the whole history; revoked mid-backfill, that backfill proves nothing", async () => {
    const w = await world({ orders: [...dailyOrders(2), { email: "old@example.com", processedAt: "2019-01-01T00:00:00Z" }], pageSize: 1 });
    await w.sync();
    expect(await w.has("old@example.com")).toBeNull();

    const full = ordersAccessFromScopes(w.fake.graphql, "read_orders,read_all_orders");
    w.fake.readAllOrders = true;
    w.clock.now += 2 * MIN; // still current: the next thing to do is the extension
    const run = (access: OrdersAccess, maxPages: number) => advanceOrdersSync(db, access, { shop: w.shop, maxPages, now: () => new Date(w.clock.now) });
    expect(await run(full, 1)).toMatchObject({ status: "more" });
    expect(await w.pass()).toMatchObject({ kind: "backfill", readAllOrders: true });
    // Coverage keeps its proven start while the extension is in progress.
    expect((await w.shopRow()).purchasesCoveredSince?.toISOString()).toBe(iso(T0 - 59 * DAY));

    // Scope revoked: the pass is dropped; the 60-day coverage that was proven stays.
    w.fake.readAllOrders = false;
    expect(await run(w.access, 10)).toMatchObject({ status: "fresh", pages: 0 });
    expect(await w.pass()).toBeUndefined();
    expect((await w.shopRow()).purchasesCoveredSince?.toISOString()).toBe(iso(T0 - 59 * DAY));

    // Granted again and left to finish.
    w.fake.readAllOrders = true;
    expect(await run(full, 10)).toMatchObject({ status: "fresh" });
    const row = await w.shopRow();
    expect(row.purchasesCoveredSince).toEqual(FULL_ORDER_HISTORY_SINCE);
    expect(row.readAllOrdersGranted).toBe(true);
    expect(await w.has("old@example.com")).not.toBeNull();
  });
});

describe("orders sync: cron dispatch", () => {
  it("claims the installed shops that are due, least recently attempted first, and not twice in the same hour", async () => {
    const now = new Date(T0);
    const mk = async (values: Partial<typeof schema.shops.$inferInsert>) => {
      const shop = uniqueShop();
      await db.insert(schema.shops).values({ shop, ...values });
      return shop;
    };
    const covered = { purchasesCoveredSince: new Date(T0 - 59 * DAY) };
    const never = await mk({});
    const stale = await mk({ ...covered, purchasesCoveredUntil: new Date(T0 - 2 * HOUR), purchasesSyncAttemptedAt: new Date(T0 - 3 * HOUR) });
    const failing = await mk({ ...covered, purchasesCoveredUntil: new Date(T0 - 9 * DAY), purchasesSyncAttemptedAt: new Date(T0 - 2 * HOUR) });
    const current = await mk({ ...covered, purchasesCoveredUntil: new Date(T0 - 10 * MIN) });
    const justTried = await mk({ purchasesSyncAttemptedAt: new Date(T0 - 10 * MIN) });
    const gone = await mk({ status: "uninstalled" });
    const mine = new Set([never, stale, failing, current, justTried, gone]);

    const claimed = (await claimShopsForOrdersSync(db, { now, limit: 1000 })).filter((s) => mine.has(s));
    expect(claimed).toEqual([never, stale, failing]);
    expect((await claimShopsForOrdersSync(db, { now, limit: 1000 })).filter((s) => mine.has(s))).toEqual([]);
    const later = new Date(T0 + HOUR);
    expect((await claimShopsForOrdersSync(db, { now: later, limit: 1000 })).filter((s) => mine.has(s)).sort()).toEqual([current, failing, justTried, never, stale].sort());
  });

  it("instance ids are valid Workflow ids, one per shop per hour", () => {
    const id = ordersSyncInstanceId("some-shop.myshopify.com", new Date("2026-12-01T12:34:00Z"));
    expect(id).toBe("orders-some-shop-myshopify-com-2026120112");
    expect(ordersSyncInstanceId("some-shop.myshopify.com", new Date("2026-12-01T13:00:00Z"))).not.toBe(id);
    expect(ordersSyncInstanceId(`${"x".repeat(200)}.myshopify.com`, new Date(T0))).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
  });
});

describe("orders sync: housekeeping around it", () => {
  it("stores the shop's time zone, and ignores an answer that is not a time zone", async () => {
    const w = await world();
    expect(await refreshShopTimeZone(db, w.fake.graphql, w.shop)).toBe("America/Argentina/Buenos_Aires");
    expect((await w.shopRow()).ianaTimezone).toBe("America/Argentina/Buenos_Aires");
    w.fake.ianaTimezone = "Not/AZone";
    expect(await refreshShopTimeZone(db, w.fake.graphql, w.shop)).toBeNull();
    expect((await w.shopRow()).ianaTimezone).toBe("America/Argentina/Buenos_Aires");
  });

  it("shop/redact removes a read in progress with everything else", async () => {
    const w = await world({ orders: dailyOrders(6) });
    await w.sync(1);
    expect(await w.pass()).toBeDefined();
    await deleteShopData(db, w.shop);
    expect(await w.pass()).toBeUndefined();
    await expect(w.sync()).rejects.toThrow("shop_not_installed");
  });
});
