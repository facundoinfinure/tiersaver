import { DEFAULT_RULE_SETTINGS, DEFAULT_SCHEDULE, RULE_LIMITS } from "@tiersaver/core";
import { env } from "cloudflare:workers";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { eq, is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema, seedSimulation, uniqueShop } from "./helpers";

const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable));

describe("migrations match the Drizzle schema", () => {
  it("covers every table of the data model", () => {
    const names = tables.map((t) => getTableConfig(t).name).sort();
    expect(names).toEqual(
      [
        "audits",
        "events_log",
        "klaviyo_connections",
        "klaviyo_oauth_attempts",
        "orders_sync",
        "privacy_requests",
        "purchase_hashes",
        "run_profiles",
        "runs",
        "scan_profiles",
        "scans",
        "session",
        "settings",
        "shop_plans",
        "shops",
        "simulation_candidates",
        "simulations",
        "unpaid_cleanups",
        "usage_charges",
      ].sort(),
    );
  });

  for (const table of tables) {
    const config = getTableConfig(table);
    it(`${config.name}: same columns, nullability and primary key`, async () => {
      const { results } = await env.DB.prepare(`PRAGMA table_info(\`${config.name}\`)`).all<{
        name: string;
        notnull: number;
        pk: number;
      }>();
      const inDb = new Map(results.map((r) => [r.name, r]));
      expect([...inDb.keys()].sort()).toEqual(config.columns.map((c) => c.name).sort());

      const compositePk = new Set(config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
      for (const column of config.columns) {
        const row = inDb.get(column.name)!;
        const isPk = column.primary || compositePk.has(column.name);
        expect(row.pk > 0, `${column.name} primary key`).toBe(isPk);
        expect(row.notnull === 1, `${column.name} NOT NULL`).toBe(column.notNull);
      }
    });

    it(`${config.name}: same indexes`, async () => {
      const { results } = await env.DB.prepare(`PRAGMA index_list(\`${config.name}\`)`).all<{
        name: string;
        unique: number;
        origin: string;
      }>();
      const inDb = results.filter((r) => r.origin === "c").map((r) => `${r.name}:${r.unique}`);
      const declared = config.indexes.map((i) => `${i.config.name}:${i.config.unique ? 1 : 0}`);
      // The session table's index predates the Drizzle definitions and is not declared there.
      expect(inDb.filter((n) => !n.startsWith("session_")).sort()).toEqual(declared.sort());
    });
  }
});

describe("defaults and constraints", () => {
  it("settings defaults equal the defaults in core (Klaviyo's criteria)", async () => {
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    await db.insert(schema.settings).values({ shop });
    const row = (await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) }))!;
    expect({
      purchaseDays: row.purchaseDays,
      clickDays: row.clickDays,
      openDays: row.openDays,
      siteActivityDays: row.siteActivityDays,
      newProfileDays: row.newProfileDays,
      minEmailsReceived: row.minEmailsReceived,
      reactivationLockDays: row.reactivationLockDays,
      countMachineOpens: row.countMachineOpens,
    }).toEqual({ ...DEFAULT_RULE_SETTINGS });
    expect(row.leadDays).toBe(DEFAULT_SCHEDULE.leadDays);
    expect(row.mode).toBe("approval");
    expect(row.protectedGroupIds).toEqual([]);
    expect("reactivationEnabled" in row).toBe(false);
  });

  it("refuses rule thresholds below the floors in core", async () => {
    const columns = {
      purchaseDays: "purchase_days",
      clickDays: "click_days",
      openDays: "open_days",
      siteActivityDays: "site_activity_days",
      newProfileDays: "new_profile_days",
      minEmailsReceived: "min_emails_received",
      reactivationLockDays: "reactivation_lock_days",
    } as const;
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    await db.insert(schema.settings).values({ shop });
    for (const [key, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
      const min = RULE_LIMITS[key].min;
      await expect(
        env.DB.prepare(`UPDATE settings SET ${column} = ? WHERE shop = ?`).bind(min - 1, shop).run(),
      ).rejects.toThrow(/CHECK/i);
      await env.DB.prepare(`UPDATE settings SET ${column} = ? WHERE shop = ?`).bind(min, shop).run();
    }
  });

  it("a suppression run cannot exist without a simulation", async () => {
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    await expect(
      db.insert(schema.runs).values({ id: crypto.randomUUID(), shop, kind: "suppress", createdBy: "user:1" }),
    ).rejects.toThrow();
  });

  it("a simulation can back only one run", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 1 });
    await db.insert(schema.runs).values({ id: crypto.randomUUID(), shop, simulationId, createdBy: "user:1" });
    await expect(
      db.insert(schema.runs).values({ id: crypto.randomUUID(), shop, simulationId, createdBy: "user:1" }),
    ).rejects.toThrow();
  });

  it("an approval must name the approver", async () => {
    const { simulationId } = await seedSimulation({ candidates: 1, approved: false });
    await expect(
      db.update(schema.simulations).set({ approvedAt: new Date() }).where(eq(schema.simulations.id, simulationId)),
    ).rejects.toThrow();
  });

  it("no fee without a cleanup, and one charge per run", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 1 });
    const runId = crypto.randomUUID();
    await db.insert(schema.runs).values({ id: runId, shop, simulationId, createdBy: "user:1" });
    const charge = { shop, runId, activeProfiles: 12_400, priceTierMax: 25_000 };
    await expect(
      db.insert(schema.usageCharges).values({ ...charge, id: "c0", idempotencyKey: "k0", profilesSuppressed: 0, feeCents: 2900 }),
    ).rejects.toThrow();
    await db.insert(schema.usageCharges).values({ ...charge, id: `c1-${runId}`, idempotencyKey: `k1-${runId}`, profilesSuppressed: 300, feeCents: 2900 });
    await expect(
      db.insert(schema.usageCharges).values({ ...charge, id: `c2-${runId}`, idempotencyKey: `k2-${runId}`, profilesSuppressed: 300, feeCents: 2900 }),
    ).rejects.toThrow();
  });
});
