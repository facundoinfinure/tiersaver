import { hashShopEmail } from "../app/email-hash";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteShopData, handleUninstall, hashCustomerId, redactCustomer } from "../app/data/privacy";
import { createSuppressionRun } from "../app/runs/engine";
import { db, schema, seedSimulation } from "./helpers";

async function seedEverything() {
  const seeded = await seedSimulation({ candidates: 3 });
  const { shop, simulationId } = seeded;
  const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(schema.sessionTable).values({ id: `offline_${shop}`, shop, state: "s", accessToken: "enc" });
  await db.insert(schema.klaviyoConnections).values({
    shop,
    klaviyoAccountId: "ACC",
    accessTokenEnc: "enc",
    refreshTokenEnc: "enc",
    accessTokenExpiresAt: new Date(),
    scopes: "accounts:read",
    apiRevision: "2026-10-15",
  });
  await db.insert(schema.audits).values({
    id: crypto.randomUUID(),
    shop,
    activeProfiles: 10,
    inactiveProfiles: 3,
    priceTableId: "t",
    ruleSettings: {},
  });
  await db.insert(schema.purchaseHashes).values({
    shop,
    emailHash: await hashShopEmail(shop, "buyer@example.com"),
    customerIdHash: await hashCustomerId(shop, 42),
    lastOrderAt: new Date(),
  });
  await db.insert(schema.usageCharges).values({
    id: crypto.randomUUID(),
    shop,
    runId: created.runId,
    activeProfiles: 12_400,
    priceTierMax: 25_000,
    profilesSuppressed: 3,
    feeCents: 2900,
    idempotencyKey: `k-${created.runId}`,
  });
  await db.insert(schema.shopPlans).values({ shop, status: "active", subscriptionId: "gid://shopify/AppSubscription/1", monthlyCents: 1900, tierMaxProfiles: 25_000 });
  return { ...seeded, runId: created.runId };
}

async function rowCounts(shop: string, simulationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byShop = ["session", "shops", "klaviyo_connections", "settings", "audits", "simulations", "runs", "run_profiles", "purchase_hashes", "usage_charges", "shop_plans", "events_log"];
  for (const table of byShop) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE shop = ?`).bind(shop).first<{ n: number }>();
    out[table] = row!.n;
  }
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM simulation_candidates WHERE simulation_id = ?").bind(simulationId).first<{ n: number }>();
  out.simulation_candidates = c!.n;
  return out;
}

describe("privacy", () => {
  it("shop/redact deletes every row of the shop and nothing of other shops", async () => {
    const a = await seedEverything();
    const b = await seedEverything();
    const before = await rowCounts(a.shop, a.simulationId);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    const otherBefore = await rowCounts(b.shop, b.simulationId);

    await deleteShopData(db, a.shop);

    const after = await rowCounts(a.shop, a.simulationId);
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true);
    expect(await rowCounts(b.shop, b.simulationId)).toEqual(otherBefore);
    // Safe to receive twice.
    await deleteShopData(db, a.shop);
  });

  it("uninstall deletes everything of the shop at once, leaving only a marker row", async () => {
    const a = await seedEverything();
    const b = await seedEverything();
    const otherBefore = await rowCounts(b.shop, b.simulationId);
    await handleUninstall(db, a.shop);
    const after = await rowCounts(a.shop, a.simulationId);
    expect(after.shops).toBe(1);
    expect(Object.entries(after).filter(([table, n]) => table !== "shops" && n !== 0), JSON.stringify(after)).toEqual([]);
    expect(await rowCounts(b.shop, b.simulationId)).toEqual(otherBefore);
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.shop, a.shop) });
    expect(shop?.status).toBe("uninstalled");
    await handleUninstall(db, a.shop);
  });

  it("customers/redact removes the customer's hashes by email or by customer id", async () => {
    const a = await seedEverything();
    const emailHash = await hashShopEmail(a.shop, "buyer@example.com");
    await db.update(schema.runProfiles).set({ emailHash }).where(eq(schema.runProfiles.profileId, a.profileIds[0]!));
    await db.update(schema.simulationCandidates).set({ emailHash }).where(eq(schema.simulationCandidates.profileId, a.profileIds[0]!));

    await redactCustomer(db, a.shop, { id: 42 });

    expect((await rowCounts(a.shop, a.simulationId)).purchase_hashes).toBe(0);
    const left = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM run_profiles WHERE shop = ?1 AND email_hash = ?2) + (SELECT COUNT(*) FROM simulation_candidates WHERE simulation_id = ?3 AND email_hash = ?2) AS n",
    ).bind(a.shop, emailHash, a.simulationId).first<{ n: number }>();
    expect(left!.n).toBe(0);
    // The run history itself stays (needed to undo).
    expect((await rowCounts(a.shop, a.simulationId)).run_profiles).toBe(3);

    const b = await seedEverything();
    await redactCustomer(db, b.shop, { email: " Buyer@Example.com " });
    expect((await rowCounts(b.shop, b.simulationId)).purchase_hashes).toBe(0);
    await redactCustomer(db, b.shop, {});
  });

  it("housekeeping: abandoned audit rows, unused simulation lists and old OAuth markers do not linger", async () => {
    const { purgeStaleData } = await import("../app/data/housekeeping");
    const now = new Date("2026-12-01T00:00:00Z");
    const old = new Date(now.getTime() - 2 * 86_400_000);
    const { shop, simulationId } = await seedSimulation({ candidates: 3, approved: false, createdAt: new Date(now.getTime() - 9 * 86_400_000) });
    const fresh = await seedSimulation({ shop, candidates: 2, approved: false, createdAt: new Date(now.getTime() - 3600_000) });
    const executed = await seedSimulation({ shop, candidates: 2, createdAt: new Date(now.getTime() - 30 * 86_400_000) });
    await db.update(schema.simulations).set({ executedAt: old }).where(eq(schema.simulations.id, executed.simulationId));

    await db.insert(schema.scans).values([
      { id: `dead-${shop}`, shop, createdBy: "user:1", status: "running", createdAt: old },
      { id: `live-${shop}`, shop, createdBy: "user:1", status: "running", createdAt: new Date(now.getTime() - 60_000) },
    ]);
    await db.insert(schema.scanProfiles).values([
      { scanId: `dead-${shop}`, profileId: "P1", shop, page: 0, facts: {} },
      { scanId: `live-${shop}`, profileId: "P2", shop, page: 0, facts: {} },
    ]);
    await db.insert(schema.klaviyoOauthAttempts).values([
      { stateHash: `old-${shop}`, shop, createdAt: old },
      { stateHash: `new-${shop}`, shop, createdAt: now },
    ]);

    await purgeStaleData(db, now);

    const count = async (table: string, where: string, value: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} = ?`).bind(value).first<{ n: number }>())!.n;
    expect(await count("scan_profiles", "scan_id", `dead-${shop}`)).toBe(0);
    expect(await count("scan_profiles", "scan_id", `live-${shop}`)).toBe(1);
    expect((await db.query.scans.findFirst({ where: eq(schema.scans.id, `dead-${shop}`) }))?.status).toBe("failed");
    expect(await count("simulation_candidates", "simulation_id", simulationId)).toBe(0);
    expect(await count("simulation_candidates", "simulation_id", fresh.simulationId)).toBe(2);
    expect(await count("simulation_candidates", "simulation_id", executed.simulationId)).toBe(2);
    expect(await count("klaviyo_oauth_attempts", "state_hash", `old-${shop}`)).toBe(0);
    expect(await count("klaviyo_oauth_attempts", "state_hash", `new-${shop}`)).toBe(1);
  });
});
