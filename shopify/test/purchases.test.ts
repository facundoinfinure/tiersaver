import { hashEmail } from "@tiersaver/core";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashCustomerId, redactCustomer } from "../app/data/privacy";
import {
  backfillOrdersPage,
  backfillSince,
  ensureShop,
  markPurchasesCovered,
  ORDERS_PAGE_SIZE,
  recordPurchases,
  type AdminGraphql,
} from "../app/orders/purchases";
import { db, schema, uniqueShop } from "./helpers";

async function rows(shop: string) {
  return db.query.purchaseHashes.findMany({ where: eq(schema.purchaseHashes.shop, shop) });
}

describe("ensureShop", () => {
  it("creates the shop with conservative default settings and revives it on reinstall", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    await db.update(schema.settings).set({ openDays: 120, version: 4 }).where(eq(schema.settings.shop, shop));
    await db.update(schema.shops).set({ status: "uninstalled", uninstalledAt: new Date() }).where(eq(schema.shops.shop, shop));

    await ensureShop(db, shop);

    const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) });
    expect(row).toMatchObject({ status: "installed", uninstalledAt: null, purchasesCoveredSince: null });
    const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) });
    expect(settings).toMatchObject({ openDays: 120, version: 4, mode: "approval", reactivationEnabled: false });
  });
});

describe("recordPurchases", () => {
  it("stores only hashes and keeps the most recent order per buyer", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    const counted = await recordPurchases(db, shop, [
      { email: "Ana@Example.com ", processedAt: "2026-10-01T10:00:00Z", customerId: "gid://shopify/Customer/7" },
      { email: "ana@example.com", processedAt: "2026-11-01T10:00:00Z", customerId: 7 },
      { email: "bob@example.com", processedAt: "2026-09-15T00:00:00Z" },
    ]);
    expect(counted).toBe(2);
    // An older order arriving later must not move the date back.
    await recordPurchases(db, shop, [{ email: "ana@example.com", processedAt: "2026-01-01T00:00:00Z" }]);

    const stored = await rows(shop);
    expect(stored).toHaveLength(2);
    const ana = stored.find((r) => r.lastOrderAt.toISOString() === "2026-11-01T10:00:00.000Z");
    expect(ana?.emailHash).toBe(await hashEmail("ana@example.com"));
    expect(ana?.customerIdHash).toBe(await hashCustomerId(shop, 7));

    const dump = JSON.stringify(
      (await env.DB.prepare("SELECT * FROM purchase_hashes WHERE shop = ?").bind(shop).all()).results,
    );
    expect(dump).not.toMatch(/example\.com|ana|bob/i);
  });

  it("ignores test orders, orders without email and invalid dates", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    const counted = await recordPurchases(db, shop, [
      { email: "t@example.com", processedAt: "2026-11-01T00:00:00Z", test: true },
      { email: null, processedAt: "2026-11-01T00:00:00Z" },
      { email: "not-an-email", processedAt: "2026-11-01T00:00:00Z" },
      { email: "x@example.com", processedAt: "nope" },
      { email: "y@example.com", processedAt: null },
    ]);
    expect(counted).toBe(0);
    expect(await rows(shop)).toHaveLength(0);
  });

  it("handles a full page of distinct buyers", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    const orders = Array.from({ length: ORDERS_PAGE_SIZE }, (_, i) => ({
      email: `buyer${i}@example.com`,
      processedAt: "2026-11-01T00:00:00Z",
    }));
    expect(await recordPurchases(db, shop, orders)).toBe(ORDERS_PAGE_SIZE);
    expect(await rows(shop)).toHaveLength(ORDERS_PAGE_SIZE);
  });

  it("customers/redact removes a buyer recorded from an order", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    await recordPurchases(db, shop, [{ email: "ana@example.com", processedAt: "2026-11-01T00:00:00Z", customerId: 7 }]);
    await redactCustomer(db, shop, { id: 7 });
    expect(await rows(shop)).toHaveLength(0);
  });
});

describe("orders backfill", () => {
  it("pages through orders since the cutoff and reports completion", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    const since = new Date("2026-09-26T00:00:00Z");
    const calls: Record<string, unknown>[] = [];
    const pages = [
      { nodes: [{ email: "a@example.com", processedAt: "2026-10-01T00:00:00Z", test: false, customer: { id: "gid://shopify/Customer/1" } }], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      { nodes: [{ email: "b@example.com", processedAt: "2026-10-02T00:00:00Z", test: false, customer: null }, { email: null, processedAt: "2026-10-03T00:00:00Z", test: false, customer: null }], pageInfo: { hasNextPage: false, endCursor: "c2" } },
    ];
    const graphql: AdminGraphql = async <T>(_q: string, variables: Record<string, unknown>) => {
      calls.push(variables);
      return { orders: pages[calls.length - 1] } as T;
    };

    const first = await backfillOrdersPage(db, graphql, { shop, since, cursor: null });
    expect(first).toEqual({ cursor: "c1", done: false, orders: 1, buyers: 1 });
    const second = await backfillOrdersPage(db, graphql, { shop, since, cursor: first.cursor });
    expect(second).toEqual({ cursor: null, done: true, orders: 2, buyers: 1 });

    expect(calls[0]).toEqual({ first: 250, after: null, query: "processed_at:>='2026-09-26T00:00:00.000Z'" });
    expect(calls[1]).toMatchObject({ after: "c1" });
    expect(await rows(shop)).toHaveLength(2);
  });

  it("coverage reaches 60 days without read_all_orders, and only moves earlier", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    const now = new Date("2026-11-25T00:00:00Z");
    const short = backfillSince(false, now);
    expect(short.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    await markPurchasesCovered(db, shop, short, false);
    const full = backfillSince(true, now);
    await markPurchasesCovered(db, shop, full, true);
    await markPurchasesCovered(db, shop, short, true);
    const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) });
    expect(row?.purchasesCoveredSince?.toISOString()).toBe(full.toISOString());
    expect(row?.readAllOrdersGranted).toBe(true);
  });
});
