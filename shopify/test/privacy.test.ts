import { hashEmail } from "@tiersaver/core";
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
    emailHash: await hashEmail("buyer@example.com"),
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
  return { ...seeded, runId: created.runId };
}

async function rowCounts(shop: string, simulationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const byShop = ["session", "shops", "klaviyo_connections", "settings", "audits", "simulations", "runs", "run_profiles", "purchase_hashes", "usage_charges", "events_log"];
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

  it("uninstall removes tokens right away and keeps the run history until shop/redact", async () => {
    const a = await seedEverything();
    await handleUninstall(db, a.shop);
    const after = await rowCounts(a.shop, a.simulationId);
    expect(after.session).toBe(0);
    expect(after.klaviyo_connections).toBe(0);
    expect(after.runs).toBe(1);
    const shop = await db.query.shops.findFirst({ where: eq(schema.shops.shop, a.shop) });
    expect(shop?.status).toBe("uninstalled");
    await handleUninstall(db, a.shop);
  });

  it("customers/redact removes the customer's hashes by email or by customer id", async () => {
    const a = await seedEverything();
    const emailHash = await hashEmail("buyer@example.com");
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
});
