import { hashShopEmail } from "../app/email-hash";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { purgeStaleData, UNINSTALLED_SHOP_RETENTION_DAYS } from "../app/data/housekeeping";
import { exportCustomerData, handleUninstall, installedAfter, listDataRequests, markInstalled, recordDataRequest, redactCustomer } from "../app/data/privacy";
import { createSuppressionRun } from "../app/runs/engine";
import { verifyShopifyWebhook } from "../app/shopify-webhook.server";
import { db, schema, seedSimulation } from "./helpers";

const SECRET = "test-secret";

async function signed(body: string, headers: Record<string, string> = {}, secret = SECRET): Promise<Request> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return new Request("https://app.test/webhooks/compliance", {
    method: "POST",
    body,
    headers: {
      "x-shopify-hmac-sha256": btoa(String.fromCharCode(...mac)),
      "x-shopify-topic": "shop/redact",
      "x-shopify-shop-domain": "one.myshopify.com",
      "x-shopify-triggered-at": "2026-11-26T10:00:00.000Z",
      ...headers,
    },
  });
}

const status = async (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e instanceof Response ? e.status : -1));

describe("webhook verification without a session", () => {
  it("accepts a correctly signed webhook and reads shop, topic and time from the headers", async () => {
    const hook = await verifyShopifyWebhook(await signed('{"shop_id":1}'), SECRET);
    expect(hook).toMatchObject({ topic: "shop/redact", shop: "one.myshopify.com", payload: { shop_id: 1 } });
    expect(hook.triggeredAt?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
  });

  it("rejects a wrong secret, a tampered body, a missing signature and a strange shop", async () => {
    expect(await status(verifyShopifyWebhook(await signed("{}", {}, "other"), SECRET))).toBe(401);
    const good = await signed('{"a":1}');
    const tampered = new Request(good.url, { method: "POST", body: '{"a":2}', headers: good.headers });
    expect(await status(verifyShopifyWebhook(tampered, SECRET))).toBe(401);
    expect(await status(verifyShopifyWebhook(await signed("{}", { "x-shopify-hmac-sha256": "" }), SECRET))).toBe(401);
    expect(await status(verifyShopifyWebhook(await signed("{}", { "x-shopify-shop-domain": "evil.example.com" }), SECRET))).toBe(400);
    expect(await status(verifyShopifyWebhook(await signed("{}"), ""))).toBe(401);
  });
});

describe("late webhooks of an earlier installation", () => {
  it("are told apart by the time of the current installation", async () => {
    const { shop } = await seedSimulation({ candidates: 1 });
    const t0 = new Date("2026-11-20T00:00:00Z");
    await markInstalled(db, shop, t0);
    expect(await installedAfter(db, shop, new Date(t0.getTime() - 1000))).toBe(true); // sent before this installation
    expect(await installedAfter(db, shop, new Date(t0.getTime() + 1000))).toBe(false); // sent after: it is about this one
    expect(await installedAfter(db, shop, null)).toBe(false);
    await handleUninstall(db, shop);
    expect(await installedAfter(db, shop, new Date(t0.getTime() - 1000))).toBe(false); // not installed now
  });
});

describe("customer data requests", () => {
  it("records the request once and exports what is held about that customer, for that shop only", async () => {
    const { shop, simulationId, profileIds } = await seedSimulation({ candidates: 2 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    const emailHash = await hashShopEmail(shop, "ana@example.com");
    await db.update(schema.runProfiles).set({ emailHash }).where(and(eq(schema.runProfiles.runId, created.runId), eq(schema.runProfiles.profileId, profileIds[0]!)));
    await db.insert(schema.purchaseHashes).values({ shop, emailHash, lastOrderAt: new Date("2026-01-02T00:00:00Z") });

    await recordDataRequest(db, shop, { id: 7, email: " Ana@Example.com", requestId: 99 });
    await recordDataRequest(db, shop, { id: 7, email: "ana@example.com", requestId: 99 });
    const list = await listDataRequests(db, shop);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ shopifyCustomerId: "7", downloadedAt: null });

    const data = await exportCustomerData(db, shop, list[0]!.id);
    expect(data).toMatchObject({ shopifyCustomerId: "7", lastOrderOnRecord: "2026-01-02T00:00:00.000Z" });
    expect(data!.cleanups).toHaveLength(1);
    expect(data!.cleanups[0]).toMatchObject({ cleanupId: created.runId, klaviyoProfileId: profileIds[0] });
    expect(JSON.stringify(data)).not.toContain("ana@");
    expect((await listDataRequests(db, shop))[0]!.downloadedAt).not.toBeNull();

    const other = await seedSimulation({ candidates: 1 });
    expect(await exportCustomerData(db, other.shop, list[0]!.id)).toBeNull();
    await recordDataRequest(db, "unknown-shop.myshopify.com", { id: 1, email: "x@example.com", requestId: 1 });
  });

  it("customers/redact cuts the link between a past cleanup and the customer's Klaviyo profile", async () => {
    const { shop, simulationId, profileIds } = await seedSimulation({ candidates: 2 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    const emailHash = await hashShopEmail(shop, "ana@example.com");
    await db.update(schema.runProfiles).set({ emailHash }).where(and(eq(schema.runProfiles.runId, created.runId), eq(schema.runProfiles.profileId, profileIds[0]!)));
    await recordDataRequest(db, shop, { id: 7, email: "ana@example.com", requestId: 5 });

    await redactCustomer(db, shop, { email: "ana@example.com" });

    const rows = await db.select().from(schema.runProfiles).where(eq(schema.runProfiles.runId, created.runId));
    expect(rows).toHaveLength(2); // the cleanup keeps its counts
    expect(rows.some((r) => r.profileId === profileIds[0])).toBe(false);
    expect(rows.filter((r) => r.profileId.startsWith("redacted:"))).toHaveLength(1);
    expect(await listDataRequests(db, shop)).toHaveLength(0);
  });
});

describe("housekeeping of uninstalled shops", () => {
  it("deletes a shop's data some days after the uninstall when shop/redact never came, and never an installed shop", async () => {
    const gone = await seedSimulation({ candidates: 2 });
    const kept = await seedSimulation({ candidates: 2 });
    const recent = await seedSimulation({ candidates: 2 });
    const now = new Date("2027-01-20T00:00:00Z");
    await handleUninstall(db, gone.shop, new Date(now.getTime() - (UNINSTALLED_SHOP_RETENTION_DAYS + 1) * 86_400_000));
    await handleUninstall(db, recent.shop, new Date(now.getTime() - 86_400_000));

    // A few shops per tick: run until this one is gone.
    for (let i = 0; i < 50; i++) {
      await purgeStaleData(db, now);
      if (!(await db.query.shops.findFirst({ where: eq(schema.shops.shop, gone.shop) }))) break;
    }
    const count = async (shop: string) => (await env.DB.prepare("SELECT (SELECT COUNT(*) FROM shops WHERE shop = ?1) + (SELECT COUNT(*) FROM simulations WHERE shop = ?1) AS n").bind(shop).first<{ n: number }>())!.n;
    expect(await count(gone.shop)).toBe(0);
    expect(await count(kept.shop)).toBe(2);
    expect(await count(recent.shop)).toBe(1); // data deleted at uninstall; only the marker row waits for housekeeping
  });
});
