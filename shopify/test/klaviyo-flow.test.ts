import { describe, expect, it } from "vitest";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { getConnection } from "../app/klaviyo/connection.server";
import {
  BINDING_COOKIE,
  embeddedAppUrl,
  finishKlaviyoAuthorization,
  handleKlaviyoCallback,
  klaviyoStartUrl,
  startKlaviyoAuthorization,
  type FlowEnv,
} from "../app/klaviyo/flow.server";
import { START_TICKET_TTL_MS, createStartTicket, verifyStartTicket } from "../app/klaviyo/oauth";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { db, schema, uniqueShop } from "./helpers";

const ENCRYPTION_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));
const APP_URL = "https://app.example.test";
const T0 = new Date("2026-11-25T12:00:00Z");

function setup() {
  const fake = new FakeKlaviyo();
  fake.now = () => T0.getTime();
  fake.billingUsage = [{ id: "active_profiles", usage_used: 10, usage_max: 250, unit: "profiles" }];
  const env: FlowEnv = {
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    KLAVIYO_CLIENT_ID: fake.clientId,
    KLAVIYO_CLIENT_SECRET: fake.clientSecret,
    SHOPIFY_API_KEY: "shopify-client-id",
    SHOPIFY_APP_URL: APP_URL,
  };
  return { fake, env };
}

async function newShop(): Promise<string> {
  const shop = uniqueShop();
  await db.insert(schema.shops).values({ shop });
  return shop;
}

function cookieFrom(res: Response): string {
  const header = res.headers.get("Set-Cookie") ?? "";
  return header.split(";")[0]!;
}

/** Start, then play Klaviyo's consent screen: returns what Klaviyo would send the browser back with. */
async function startAndConsent(fake: FakeKlaviyo, env: FlowEnv, shop: string) {
  const startUrl = await klaviyoStartUrl(env, shop, T0);
  const started = await startKlaviyoAuthorization(new Request(startUrl), env, T0);
  const authorize = new URL(started.headers.get("Location")!);
  const code = fake.authorize({
    codeChallenge: authorize.searchParams.get("code_challenge")!,
    redirectUri: authorize.searchParams.get("redirect_uri")!,
    scope: authorize.searchParams.get("scope")!,
  });
  return { started, authorize, code, state: authorize.searchParams.get("state")!, cookie: cookieFrom(started) };
}

describe("start ticket", () => {
  it("names the shop, expires, and cannot be forged or used as a state", async () => {
    const ticket = await createStartTicket({ shop: "demo.myshopify.com", stateSecret: ENCRYPTION_KEY, now: T0 });
    await expect(verifyStartTicket({ ticket, stateSecret: ENCRYPTION_KEY, now: T0 })).resolves.toEqual({ shop: "demo.myshopify.com" });

    const late = new Date(T0.getTime() + START_TICKET_TTL_MS);
    await expect(verifyStartTicket({ ticket, stateSecret: ENCRYPTION_KEY, now: late })).rejects.toMatchObject({ code: "klaviyo_oauth_ticket_expired" });

    const [v, payload, signature] = ticket.split(".");
    const other = btoa(JSON.stringify({ s: "other.myshopify.com", e: T0.getTime() + 60_000 })).replace(/=+$/, "");
    for (const bad of [`${v}.${other}.${signature}`, `${v}.${payload}.AAAA`, "", "v1.x", null]) {
      await expect(verifyStartTicket({ ticket: bad, stateSecret: ENCRYPTION_KEY, now: T0 })).rejects.toMatchObject({ code: "klaviyo_oauth_ticket_invalid" });
    }
    await expect(createStartTicket({ shop: "evil.example.com", stateSecret: ENCRYPTION_KEY })).rejects.toMatchObject({ code: "klaviyo_oauth_invalid_shop" });
  });
});

describe("connecting Klaviyo, end to end", () => {
  it("start sets the binding cookie and sends the browser to Klaviyo with PKCE and every scope", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { started, authorize } = await startAndConsent(fake, env, shop);

    expect(started.status).toBe(302);
    expect(authorize.origin + authorize.pathname).toBe("https://www.klaviyo.com/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe(fake.clientId);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${APP_URL}/klaviyo/oauth/callback`);
    expect(authorize.searchParams.get("scope")).toBe(KLAVIYO_SCOPES.join(" "));
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = started.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(new RegExp(`^${BINDING_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`));
    // Nothing reached Klaviyo's servers yet, and nothing is stored.
    expect(fake.requests).toHaveLength(0);
    expect(await getConnection(db, shop)).toBeNull();
  });

  it("callback forwards code and state into the embedded app without exchanging or storing anything", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { code, state, cookie } = await startAndConsent(fake, env, shop);

    const callback = await handleKlaviyoCallback(
      new Request(`${APP_URL}/klaviyo/oauth/callback?code=${code}&state=${encodeURIComponent(state)}`, { headers: { Cookie: `other=1; ${cookie}` } }),
      env,
      T0,
    );
    expect(callback.status).toBe(302);
    const target = new URL(callback.headers.get("Location")!);
    const handle = shop.replace(".myshopify.com", "");
    expect(target.origin + target.pathname).toBe(`https://admin.shopify.com/store/${handle}/apps/shopify-client-id/app/klaviyo/finish`);
    expect(target.searchParams.get("code")).toBe(code);
    expect(target.searchParams.get("state")).toBe(state);
    expect(callback.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(fake.requests).toHaveLength(0);
    expect(await getConnection(db, shop)).toBeNull();
  });

  it("finish, authenticated as the same shop, exchanges the code and stores the connection", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { code, state } = await startAndConsent(fake, env, shop);

    const result = await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop, code, state });
    expect(result).toMatchObject({ ok: true, connection: { shop, status: "connected", klaviyoAccountId: fake.accountId } });
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected" });

    // The code is single use at Klaviyo. A reload of the finish URL returns the recorded result without a second exchange.
    const exchanges = () => fake.requests.filter((r) => r.url.pathname === "/oauth/token" && r.body.includes("authorization_code")).length;
    expect(exchanges()).toBe(1);
    const again = await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop, code, state });
    expect(again).toMatchObject({ ok: true, connection: { shop, status: "connected" } });
    expect(exchanges()).toBe(1);
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected" });
  });

  it("finish loaded several times at once (Shopify cancels and reloads it) exchanges the code once and every load gets the result", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { code, state } = await startAndConsent(fake, env, shop);
    fake.tokenDelayMs = 50;
    const settled: boolean[] = [];
    const kept: Promise<unknown>[] = [];
    const load = () =>
      finishKlaviyoAuthorization(
        { db, env, fetch: fake.fetch, now: () => T0, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))), waitUntil: (w) => kept.push(w), onSettled: async (r) => void settled.push(r.ok) },
        { shop, code, state },
      );
    const results = await Promise.all([load(), load(), load()]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fake.requests.filter((r) => r.url.pathname === "/oauth/token" && r.body.includes("authorization_code"))).toHaveLength(1);
    expect(settled).toEqual([true]); // logged once
    expect(kept).toHaveLength(3); // each load keeps its work alive past a cancelled request
    // Nothing secret is kept about the attempt.
    const rows = JSON.stringify(await db.query.klaviyoOauthAttempts.findMany({ where: (a, { eq }) => eq(a.shop, shop) }));
    expect(rows).not.toContain(code);
    expect(rows).not.toContain(state);
  });

  it("a failed exchange is recorded, and reloads report the same failure without retrying the code", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { state } = await startAndConsent(fake, env, shop);
    const first = await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop, code: "not-the-code", state });
    expect(first).toEqual({ ok: false, code: "klaviyo_oauth_invalid_grant" });
    const before = fake.requests.length;
    expect(await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop, code: "not-the-code", state })).toEqual({ ok: false, code: "klaviyo_oauth_invalid_grant" });
    expect(fake.requests.length).toBe(before);
    expect(await getConnection(db, shop)).toBeNull();
  });

  it("a state issued for one shop cannot connect another shop (someone else's link)", async () => {
    const { fake, env } = setup();
    const attackerShop = await newShop();
    const victimShop = await newShop();
    // The victim opened the attacker's start link and approved on Klaviyo; the code is the victim's.
    const { code, state } = await startAndConsent(fake, env, attackerShop);

    // The finish step runs as whatever shop the browser is logged in to: the victim's, never the attacker's.
    const result = await finishKlaviyoAuthorization({ db, env, fetch: fake.fetch, now: () => T0 }, { shop: victimShop, code, state });
    expect(result).toEqual({ ok: false, code: "klaviyo_oauth_state_shop_mismatch" });
    expect(await getConnection(db, victimShop)).toBeNull();
    expect(await getConnection(db, attackerShop)).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });

  it("finish rejects a missing, tampered or expired state and a missing code", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { code, state } = await startAndConsent(fake, env, shop);
    const deps = { db, env, fetch: fake.fetch };

    expect(await finishKlaviyoAuthorization({ ...deps, now: () => T0 }, { shop, code, state: null })).toEqual({ ok: false, code: "klaviyo_oauth_state_invalid" });
    expect(await finishKlaviyoAuthorization({ ...deps, now: () => T0 }, { shop, code, state: `${state}x` })).toEqual({ ok: false, code: "klaviyo_oauth_state_invalid" });
    const late = new Date(T0.getTime() + 11 * 60_000);
    expect(await finishKlaviyoAuthorization({ ...deps, now: () => late }, { shop, code, state })).toEqual({ ok: false, code: "klaviyo_oauth_state_expired" });
    expect(await finishKlaviyoAuthorization({ ...deps, now: () => T0 }, { shop, code: null, state })).toEqual({ ok: false, code: "klaviyo_oauth_code_missing" });
    expect(await getConnection(db, shop)).toBeNull();
    expect(fake.requests).toHaveLength(0);
  });
});

describe("links that do not belong to this browser or are stale", () => {
  it("start answers a bad or expired ticket with a dead-end page, not a redirect", async () => {
    const { env } = setup();
    for (const url of [`${APP_URL}/klaviyo/oauth/start`, `${APP_URL}/klaviyo/oauth/start?ticket=v1.e30.AAAA`]) {
      const res = await startKlaviyoAuthorization(new Request(url), env, T0);
      expect(res.status).toBe(400);
      expect(res.headers.get("Location")).toBeNull();
    }
    const stale = await klaviyoStartUrl(env, "demo.myshopify.com", new Date(T0.getTime() - START_TICKET_TTL_MS));
    expect((await startKlaviyoAuthorization(new Request(stale), env, T0)).status).toBe(400);
  });

  it("callback refuses a state without the cookie of the browser that started the flow", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { code, state } = await startAndConsent(fake, env, shop);
    const url = `${APP_URL}/klaviyo/oauth/callback?code=${code}&state=${encodeURIComponent(state)}`;

    const noCookie = await handleKlaviyoCallback(new Request(url), env, T0);
    expect(noCookie.status).toBe(400);
    const wrongCookie = await handleKlaviyoCallback(new Request(url, { headers: { Cookie: `${BINDING_COOKIE}=${"A".repeat(43)}` } }), env, T0);
    expect(wrongCookie.status).toBe(400);
    expect(wrongCookie.headers.get("Location")).toBeNull();
    expect(await wrongCookie.text()).not.toContain(shop);
  });

  it("callback sends a declined consent back to the app with a reason and no code", async () => {
    const { fake, env } = setup();
    const shop = await newShop();
    const { state, cookie } = await startAndConsent(fake, env, shop);
    const res = await handleKlaviyoCallback(
      new Request(`${APP_URL}/klaviyo/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie } }),
      env,
      T0,
    );
    const target = new URL(res.headers.get("Location")!);
    expect(target.pathname.endsWith("/app")).toBe(true);
    expect(target.searchParams.get("klaviyo")).toBe("declined");
    expect(target.searchParams.has("code")).toBe(false);
  });
});

describe("embeddedAppUrl", () => {
  it("only builds admin URLs for myshopify.com shops", () => {
    expect(embeddedAppUrl({ SHOPIFY_API_KEY: "key" }, "demo-shop.myshopify.com", "/app", { a: "b c" })).toBe(
      "https://admin.shopify.com/store/demo-shop/apps/key/app?a=b+c",
    );
    expect(() => embeddedAppUrl({ SHOPIFY_API_KEY: "key" }, "evil.example.com/x", "/app")).toThrow();
  });
});
