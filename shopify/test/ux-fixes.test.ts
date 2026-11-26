import { DEFAULT_SCHEDULE, RULE_LIMITS } from "@tiersaver/core";
import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { legalUrls, SUPPORT_EMAIL, TERMS_VERSION } from "../app/legal";
import { saveSettings, type SettingsInput } from "../app/settings/settings";
import { dayStamp, formatCalendarDay, formatDateTime, rememberShopTimeZone, safeTimeZone, shopTimeZone, stamp } from "../app/settings/timezone";
import { db, schema, seedSimulation } from "./helpers";

const baseInput = (over: Partial<SettingsInput> = {}): SettingsInput => ({
  ruleMode: "recommended",
  protectedGroupIds: [],
  billingDay: null,
  leadDays: 5,
  scheduleEnabled: false,
  mode: "approval",
  ...over,
});

describe("dates shown to the merchant", () => {
  const at = new Date("2026-11-26T01:36:00Z");

  it("are formatted in the shop's time zone and always name the zone", () => {
    expect(formatDateTime(at, "America/Los_Angeles")).toBe("Nov 25, 2026, 5:36 PM PST");
    expect(formatDateTime(at, null)).toBe("Nov 26, 2026, 1:36 AM UTC");
    expect(formatDateTime(at.toISOString(), "Not/AZone")).toBe("Nov 26, 2026, 1:36 AM UTC");
    expect(stamp(at, "America/Los_Angeles")).toEqual({ iso: "2026-11-26T01:36:00.000Z", text: "Nov 25, 2026, 5:36 PM PST" });
    expect(dayStamp(at, "America/Los_Angeles").text).toBe("Nov 25, 2026");
    expect(safeTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(safeTimeZone("")).toBe("UTC");
  });

  it("keep a calendar day as it is, whatever the zone", () => {
    expect(formatCalendarDay("2026-12-05")).toBe("Dec 5, 2026");
  });

  it("use UTC until Shopify has told the shop's zone, which is then stored once", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    expect(await shopTimeZone(db, shop)).toBe("UTC");

    let calls = 0;
    const graphql = async () => {
      calls++;
      return Response.json({ data: { shop: { ianaTimezone: "America/Bogota" } } });
    };
    await rememberShopTimeZone(db, shop, graphql);
    await rememberShopTimeZone(db, shop, graphql);
    expect(calls).toBe(1);
    expect(await shopTimeZone(db, shop)).toBe("America/Bogota");
  });

  it("ignore a zone that is not one, and a failing Shopify call", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    await rememberShopTimeZone(db, shop, async () => Response.json({ data: { shop: { ianaTimezone: "Nowhere/Nothing" } } }));
    await rememberShopTimeZone(db, shop, async () => {
      throw new Error("shopify is down");
    });
    expect(await shopTimeZone(db, shop)).toBe("UTC");
  });
});

describe("help and support links", () => {
  it("live under the site, with support as a mailto", () => {
    const urls = legalUrls({ SITE_URL: "https://example.test/" });
    expect(urls.terms).toBe("https://example.test/terms");
    expect(urls.help).toBe("https://example.test/help/");
    expect(urls.articles.undo).toBe("https://example.test/help/undo");
    expect(urls.articles.whatSuppressMeans).toBe("https://example.test/help/what-suppress-means");
    expect(urls.support).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(urls.sales).toBe("mailto:hello@tiersaver.com");
    expect(legalUrls({}).privacy).toBe("https://tiersaver.com/privacy");
  });
});

describe("settings: errors by field", () => {
  it("says next to each field how to fix it", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    const result = await saveSettings(db, {
      shop,
      actor: "user:1",
      input: baseInput({ ruleMode: "wider", clickDays: RULE_LIMITS.clickDays.min - 1, billingDay: 40, leadDays: DEFAULT_SCHEDULE.minLeadDays - 1, mode: "automatic" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["automatic", "billingDay", "clickDays", "leadDays"]);
    expect(result.fieldErrors.clickDays).toBe(`Enter a whole number between ${RULE_LIMITS.clickDays.min} and ${RULE_LIMITS.clickDays.max}, or leave it empty for "ever".`);
    expect(result.fieldErrors.billingDay).toContain("between 1 and 31");
    expect(result.fieldErrors.automatic).toContain("Run the audit every month");
    // Every field error has its line in the summary.
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("explains that automatic cleanups are not available with wider windows", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    const result = await saveSettings(db, { shop, actor: "user:1", input: baseInput({ ruleMode: "wider", clickDays: 200, mode: "automatic", scheduleEnabled: true }) });
    expect(result).toMatchObject({ ok: false, fieldErrors: { automatic: expect.stringContaining("wider windows") } });
  });
});

describe("settings: turning automatic cleanups on", () => {
  const events = (shop: string) => db.query.eventsLog.findMany({ where: and(eq(schema.eventsLog.shop, shop), like(schema.eventsLog.action, "automatic_mode.%")), orderBy: (e, { asc }) => asc(e.at) });

  it("records who accepted which terms and which price, once, and when it was turned off", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    const on = baseInput({ mode: "automatic", scheduleEnabled: true, billingDay: 3 });

    const first = await saveSettings(db, { shop, actor: "user:42", input: on, termsVersion: TERMS_VERSION, priceShown: "$29 for your list today", now: new Date("2026-11-26T10:00:00Z") });
    expect(first).toMatchObject({ ok: true, automaticTurnedOn: true });
    // Saving again with it already on is not a new authorisation.
    expect(await saveSettings(db, { shop, actor: "user:42", input: on, termsVersion: TERMS_VERSION, now: new Date("2026-11-26T10:05:00Z") })).toMatchObject({ ok: true, automaticTurnedOn: false });

    let log = await events(shop);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "automatic_mode.enabled", actor: "user:42", detail: { termsVersion: TERMS_VERSION, priceShown: "$29 for your list today" } });
    expect(log[0]!.at.toISOString()).toBe("2026-11-26T10:00:00.000Z");

    expect(await saveSettings(db, { shop, actor: "user:43", input: baseInput({ scheduleEnabled: true, billingDay: 3 }), now: new Date("2026-11-27T10:00:00Z") })).toMatchObject({ ok: true, automaticTurnedOn: false });
    log = await events(shop);
    expect(log.map((l) => [l.action, l.actor])).toEqual([
      ["automatic_mode.enabled", "user:42"],
      ["automatic_mode.disabled", "user:43"],
    ]);
  });

  it("records nothing when the save is refused", async () => {
    const { shop } = await seedSimulation({ candidates: 1, approved: false });
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ mode: "automatic", scheduleEnabled: false }), termsVersion: TERMS_VERSION })).ok).toBe(false);
    expect(await events(shop)).toHaveLength(0);
  });
});
