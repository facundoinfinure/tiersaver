import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approveCleanup } from "../app/billing/approval";
import { requestPlanFor } from "../app/billing/billing";
import { hashShopEmail } from "../app/email-hash";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { getConnection, saveConnection } from "../app/klaviyo/connection.server";
import { finishKlaviyoAuthorization, klaviyoStartUrl, startKlaviyoAuthorization, type FlowEnv } from "../app/klaviyo/flow.server";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { decidingCountry, EXCLUDED_COUNTRY_CODES, isExcludedCountry, isShopExcluded, MARKET_EXCLUDED } from "../app/markets";
import { createSuppressionRun, createUndoRun, executeRun } from "../app/runs/engine";
import { createSuppressionGateway, type GatewayEnv } from "../app/runs/gateway.server";
import { createCleanupWithPlan } from "../app/runs/gated";
import { createScan } from "../app/scans/engine";
import { COUNTRY_RECHECK_MS, rememberShopProfile, shopTimeZone } from "../app/settings/timezone";
import { fakeShopifyBilling } from "./fake-shopify-billing";
import { FakeGateway, FakeSteps, db, installCandidateSegment, schema, seedSimulation, uniqueShop } from "./helpers";

/**
 * Owner's decision of 2026-11-27 (docs/16-LEGALES.md §2.4): TierSaver is not offered to stores in the EU/EEA,
 * the UK or Switzerland. Every path that reads Klaviyo, approves, charges or suppresses refuses for them;
 * restoring an earlier cleanup does not.
 */

const ENCRYPTION_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 13 + 1) % 256)));
const RETURN_URL = "https://admin.shopify.com/store/test/apps/tiersaver/app/simulation";
const T0 = new Date("2026-11-27T12:00:00Z");

const setCountry = (shop: string, code: string | null) => db.update(schema.shops).set({ countryCode: code, countryCheckedAt: new Date() }).where(eq(schema.shops.shop, shop));

/** A shop with an open simulation of `activeProfiles`, in `country`. */
async function shopIn(country: string | null, opts: { approved?: boolean; activeProfiles?: number } = {}) {
  const seeded = await seedSimulation({ candidates: 3, approved: opts.approved ?? false });
  await db.update(schema.simulations).set({ activeProfiles: opts.activeProfiles ?? 8_000 }).where(eq(schema.simulations.id, seeded.simulationId));
  await setCountry(seeded.shop, country);
  return seeded;
}

function flowEnv(fake: FakeKlaviyo): FlowEnv {
  return { TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret, SHOPIFY_API_KEY: "shopify-client-id", SHOPIFY_APP_URL: "https://app.example.test" };
}

afterEach(() => vi.restoreAllMocks());

describe("the list of excluded countries", () => {
  it("has the 27 EU member states, the rest of the EEA, the UK, Switzerland and the UK's dependencies", () => {
    const eu = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
    expect(eu).toHaveLength(27);
    for (const code of [...eu, "IS", "LI", "NO", "GB", "CH", "GI", "GG", "JE", "IM", "RE", "AX"]) expect(isExcludedCountry(code)).toBe(true);
    expect(new Set(EXCLUDED_COUNTRY_CODES).size).toBe(EXCLUDED_COUNTRY_CODES.length);
    for (const code of ["US", "CA", "AU", "NZ", "AR", "BR", "MX", "", null, undefined]) expect(isExcludedCountry(code)).toBe(false);
    expect(isExcludedCountry("de")).toBe(true);
  });

  it("decides from either address: an excluded one wins, else billing, else the shop address, else unknown", () => {
    expect(decidingCountry("US", "DE")).toBe("DE");
    expect(decidingCountry("GB", "US")).toBe("GB");
    expect(decidingCountry("US", "CA")).toBe("US");
    expect(decidingCountry(null, "au")).toBe("AU");
    expect(decidingCountry(null, null)).toBeNull();
  });
});

describe("the store's country is read from Shopify with its time zone", () => {
  const answer = (billing: string | null, shopAddress: string | null) => async () =>
    Response.json({ data: { shop: { ianaTimezone: "Europe/Berlin", shopAddress: { countryCodeV2: shopAddress }, billingAddress: { countryCodeV2: billing } } } });

  it("in one query, stored once, and asked again only after a week", async () => {
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    let calls = 0;
    const graphql = async (query: string) => {
      calls++;
      expect(query).toContain("countryCodeV2");
      return answer("DE", "DE")();
    };
    await rememberShopProfile(db, shop, graphql, T0);
    await rememberShopProfile(db, shop, graphql, new Date(T0.getTime() + COUNTRY_RECHECK_MS - 1));
    expect(calls).toBe(1);
    expect(await shopTimeZone(db, shop)).toBe("Europe/Berlin");
    expect(await isShopExcluded(db, shop)).toBe(true);
    await rememberShopProfile(db, shop, answer("US", "US"), new Date(T0.getTime() + COUNTRY_RECHECK_MS));
    expect(await isShopExcluded(db, shop)).toBe(false);
  });

  it("no country from Shopify: unknown, allowed, logged; a country already known is not erased", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    await rememberShopProfile(db, shop, answer(null, null), T0);
    expect((await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) }))?.countryCode).toBeNull();
    expect(await isShopExcluded(db, shop)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("country not returned"));

    await setCountry(shop, "FR");
    await rememberShopProfile(db, shop, answer(null, null), new Date(Date.now() + COUNTRY_RECHECK_MS + 1));
    expect(await isShopExcluded(db, shop)).toBe(true);
  });

  it("a failing Shopify call changes nothing", async () => {
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });
    await rememberShopProfile(db, shop, async () => {
      throw new Error("shopify is down");
    });
    expect((await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop) }))?.countryCheckedAt).toBeNull();
  });
});

describe("a store in an excluded country", () => {
  it("cannot start an audit", async () => {
    const { shop } = await shopIn("DE");
    expect(await createScan(db, { shop, createdBy: "user:1" })).toEqual({ ok: false, reason: MARKET_EXCLUDED, scanId: null });
    expect(await db.query.scans.findMany({ where: eq(schema.scans.shop, shop) })).toHaveLength(0);
  });

  it("cannot connect Klaviyo: the start link stops before Klaviyo and the finish step never exchanges the code", async () => {
    const fake = new FakeKlaviyo();
    fake.now = () => T0.getTime();
    const env = flowEnv(fake);
    const shop = uniqueShop();
    await db.insert(schema.shops).values({ shop });

    // Consent obtained before the country was known (the worst case): the code is still not used.
    const started = await startKlaviyoAuthorization(new Request(await klaviyoStartUrl(env, shop, T0)), env, T0);
    const authorize = new URL(started.headers.get("Location")!);
    const code = fake.authorize({ codeChallenge: authorize.searchParams.get("code_challenge")!, redirectUri: authorize.searchParams.get("redirect_uri")!, scope: authorize.searchParams.get("scope")! });
    await setCountry(shop, "GB");

    const blocked = await startKlaviyoAuthorization(new Request(await klaviyoStartUrl(env, shop, T0)), env, T0, (s) => isShopExcluded(db, s));
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("Location")).toBeNull();
    expect(await blocked.text()).toContain("not available for stores in the European Union, the United Kingdom or Switzerland");

    const requestsBefore = fake.requests.length;
    expect(await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop, code, state: authorize.searchParams.get("state") })).toEqual({ ok: false, code: MARKET_EXCLUDED });
    expect(fake.requests.length).toBe(requestsBefore);
    expect(await getConnection(db, shop)).toBeNull();
  });

  it("cannot approve a simulation, and Shopify is asked for nothing", async () => {
    const shopify = fakeShopifyBilling();
    const { shop, simulationId } = await shopIn("CH");
    expect(await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, returnUrl: RETURN_URL })).toEqual({ ok: false, reason: MARKET_EXCLUDED });
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.approvedAt).toBeNull();
    expect(shopify.state.operations).toEqual([]);
  });

  it("cannot request a plan: nothing is charged", async () => {
    const shopify = fakeShopifyBilling();
    const { shop } = await shopIn("NO");
    expect(await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 8_000, returnUrl: RETURN_URL, actor: "user:7" })).toEqual({ ok: false, reason: MARKET_EXCLUDED });
    expect(shopify.state.operations).toEqual([]);
    expect(shopify.state.created).toEqual([]);
  });

  it("cannot start a cleanup, even with an approved simulation and an active plan", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await shopIn("IE", { approved: true });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: MARKET_EXCLUDED, requiredCents: null });
    expect(await db.query.runs.findMany({ where: eq(schema.runs.shop, shop) })).toHaveLength(0);
  });

  it("an existing connection (not expected in production): the gateway refuses to suppress but restores", async () => {
    const fake = new FakeKlaviyo();
    const { shop, simulationId, profileIds } = await seedSimulation({ candidates: 5 });
    fake.accountId = `ACC-${shop}`;
    const emailOf = (id: string) => `${id.toLowerCase()}@customers-of-merchant.test`;
    for (const id of profileIds) {
      fake.profiles.set(id, { id, email: emailOf(id) });
      await db.update(schema.simulationCandidates).set({ emailHash: await hashShopEmail(shop, emailOf(id)) }).where(eq(schema.simulationCandidates.profileId, id));
    }
    // The cleanup was created while the store was still allowed.
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    await installCandidateSegment(fake, shop, profileIds);
    const gatewayEnv: GatewayEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret, SUPPRESSION_ENABLED: "true" };
    const tokens = fake.issueTokens(KLAVIYO_SCOPES.join(" "));
    await saveConnection({ db, env: gatewayEnv }, { shop, klaviyoAccountId: fake.accountId, tokens: { ...tokens, expiresAt: new Date(Date.now() + 3600_000), scope: KLAVIYO_SCOPES.join(" ") } });
    const gateway = createSuppressionGateway(gatewayEnv, shop, { fetch: fake.fetch, sleep: async () => {} });
    const batch = (kind: "suppress" | "undo") => ({ shop, runId: created.runId, kind, batchIndex: 0, profileIds });

    // Allowed: it suppresses. Then the store turns out to be in the UK.
    expect((await gateway.submitBatch(batch("suppress"))).jobId).toBeTruthy();
    await setCountry(shop, "GB");
    const jobs = fake.jobs.length;
    const refused = await gateway.submitBatch(batch("suppress")).then(
      () => null,
      (e: Error) => e,
    );
    expect(refused?.message).toBe(MARKET_EXCLUDED);
    expect(fake.jobs.length).toBe(jobs);
    expect((await gateway.submitBatch(batch("undo"))).jobId).toBeTruthy();
  });

  it("can still create the restore of an earlier cleanup", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 3 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, created.runId);
    await setCountry(shop, "ES");
    expect(await createUndoRun(db, { shop, runId: created.runId, createdBy: "user:1", confirmAfterRenewal: true })).toMatchObject({ ok: true, totalCount: 3 });
  });
});

describe("stores elsewhere, or whose country is unknown, are not affected", () => {
  it.each([["US"], ["CA"], ["AU"], [null]])("%s: audit, connect, approve, plan and cleanup all go ahead", async (country) => {
    const { shop, simulationId } = await shopIn(country);
    expect((await createScan(db, { shop, createdBy: "user:1" })).ok).toBe(true);

    const fake = new FakeKlaviyo();
    const env = flowEnv(fake);
    const started = await startKlaviyoAuthorization(new Request(await klaviyoStartUrl(env, shop, T0)), env, T0, (s) => isShopExcluded(db, s));
    expect(started.status).toBe(302);

    const shopify = fakeShopifyBilling();
    const approved = await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, returnUrl: RETURN_URL });
    expect(approved).toMatchObject({ ok: true, next: "approve_in_shopify" });
    expect(shopify.state.created).toHaveLength(1);

    const withPlan = fakeShopifyBilling({ monthlyCents: 900 });
    expect(await createCleanupWithPlan({ db, graphql: withPlan.graphql }, { shop, simulationId, createdBy: "user:7" })).toMatchObject({ ok: true });
  });
});
