import { hashShopEmail } from "../app/email-hash";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashCustomerId, redactCustomer } from "../app/data/privacy";
import { ensureShop, ORDERS_PAGE_SIZE, recordPurchases } from "../app/orders/purchases";
import { db, schema, uniqueShop } from "./helpers";

async function rows(shop: string) {
  return db.query.purchaseHashes.findMany({ where: eq(schema.purchaseHashes.shop, shop) });
}

describe("ensureShop", () => {
  it("creates the shop with conservative default settings and revives it on reinstall", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    await db.update(schema.settings).set({ openDays: 200, version: 4 }).where(eq(schema.settings.shop, shop));
    await db.update(schema.shops).set({ status: "uninstalled", uninstalledAt: new Date() }).where(eq(schema.shops.shop, shop));

    await ensureShop(db, shop);

    const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) });
    expect(row).toMatchObject({ status: "installed", uninstalledAt: null, purchasesCoveredSince: null });
    const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) });
    expect(settings).toMatchObject({ openDays: 200, version: 4, mode: "approval" });
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
    expect(ana?.emailHash).toBe(await hashShopEmail(shop, "ana@example.com"));
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

describe("recordPurchases: the customer's email", () => {
  it("an order without its own email still protects the customer it belongs to (point of sale)", async () => {
    const shop = uniqueShop();
    await ensureShop(db, shop);
    await recordPurchases(db, shop, [
      { email: null, customerEmail: "Pos@Example.com", customerId: "gid://shopify/Customer/5", processedAt: "2026-11-01T00:00:00Z" },
      { email: "gift@example.com", customerEmail: "buyer@example.com", customerId: 6, processedAt: "2026-11-02T00:00:00Z" },
      { email: null, customerEmail: null, processedAt: "2026-11-03T00:00:00Z" },
    ]);
    const stored = await rows(shop);
    expect(stored.map((r) => r.emailHash).sort()).toEqual(
      [await hashShopEmail(shop, "pos@example.com"), await hashShopEmail(shop, "gift@example.com"), await hashShopEmail(shop, "buyer@example.com")].sort(),
    );
    expect(stored.every((r) => r.customerIdHash !== null)).toBe(true);
  });
});
