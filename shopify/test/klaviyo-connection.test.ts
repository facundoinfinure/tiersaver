import { decryptToken, importTokenKey } from "@tiersaver/core";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import {
  REFRESH_LEASE_MS,
  completeAuthorization,
  disconnect,
  getAccessToken,
  getConnection,
  saveConnection,
  type ConnectionDeps,
} from "../app/klaviyo/connection.server";
import { KlaviyoConnectionError, KlaviyoOAuthError } from "../app/klaviyo/errors";
import { createAuthorizationRequest, verifyAuthorizationState } from "../app/klaviyo/oauth";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { db, schema, uniqueShop } from "./helpers";

const ENCRYPTION_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));
const SCOPES = KLAVIYO_SCOPES.join(" ");
const T0 = Date.parse("2026-11-25T12:00:00Z");

/** A shop connected to a fake Klaviyo, on a clock the test controls. */
async function setup(opts: { expiresInMs?: number; refreshMode?: "rotate" | "static" } = {}) {
  const fake = new FakeKlaviyo();
  fake.refreshMode = opts.refreshMode ?? "rotate";
  const clock = { now: T0 };
  fake.now = () => clock.now;
  const secrets = {
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    KLAVIYO_CLIENT_ID: fake.clientId,
    KLAVIYO_CLIENT_SECRET: fake.clientSecret,
  };
  const deps: ConnectionDeps = {
    db,
    env: secrets,
    fetch: fake.fetch,
    now: () => new Date(clock.now),
    sleep: async (ms) => {
      clock.now += ms;
    },
  };
  const shop = uniqueShop();
  await db.insert(schema.shops).values({ shop });
  const tokens = fake.issueTokens(SCOPES);
  await saveConnection(deps, {
    shop,
    klaviyoAccountId: fake.accountId,
    tokens: { ...tokens, expiresAt: new Date(clock.now + (opts.expiresInMs ?? 3600_000)), scope: SCOPES },
  });
  const row = () => db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop) });
  const storedTokens = async () => {
    const r = await row();
    const key = await importTokenKey(ENCRYPTION_KEY);
    return { access: await decryptToken(r!.accessTokenEnc, key), refresh: await decryptToken(r!.refreshTokenEnc, key) };
  };
  const tokenCalls = () => fake.requestsTo(/^\/oauth\/token$/).length;
  return { fake, clock, deps, shop, tokens, row, storedTokens, tokenCalls };
}

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  // Nothing in this layer writes to the console, so no token can end up in a log.
  expect(logged.join("\n")).toBe("");
  vi.restoreAllMocks();
});

describe("storing the connection", () => {
  it("keeps tokens encrypted at rest: no plaintext token anywhere in the database", async () => {
    const { shop, tokens, storedTokens } = await setup();
    const raw = await env.DB.prepare("SELECT * FROM klaviyo_connections WHERE shop = ?").bind(shop).first<Record<string, unknown>>();
    expect(raw).not.toBeNull();
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain(tokens.accessToken);
    expect(dump).not.toContain(tokens.refreshToken);
    expect(String(raw!.access_token_enc)).toMatch(/^v1:/);
    expect(String(raw!.refresh_token_enc)).toMatch(/^v1:/);
    expect(raw).toMatchObject({ status: "connected", api_revision: "2026-10-15", klaviyo_account_id: "ACC001", scopes: SCOPES });
    expect(await storedTokens()).toEqual({ access: tokens.accessToken, refresh: tokens.refreshToken });

    // A different key cannot read them.
    const otherKey = await importTokenKey(btoa("x".repeat(32)));
    await expect(decryptToken(String(raw!.access_token_enc), otherKey)).rejects.toThrow();
  });

  it("exposes connection details without any token", async () => {
    const { shop, tokens } = await setup();
    const info = await getConnection(db, shop);
    expect(info).toMatchObject({ shop, status: "connected", klaviyoAccountId: "ACC001", profilesUsageTypeId: null });
    expect(JSON.stringify(info)).not.toContain(tokens.accessToken);
    expect(Object.keys(info!)).not.toContain("accessTokenEnc");
    expect(await getConnection(db, "nobody.myshopify.com")).toBeNull();
  });

  it("reconnecting replaces the tokens and clears needs_reauth", async () => {
    const { fake, deps, shop, storedTokens } = await setup();
    await db.update(schema.klaviyoConnections).set({ status: "needs_reauth" }).where(eq(schema.klaviyoConnections.shop, shop));
    const fresh = fake.issueTokens(SCOPES);
    await saveConnection(deps, {
      shop,
      klaviyoAccountId: "ACC002",
      tokens: { ...fresh, expiresAt: new Date(T0 + 3600_000), scope: SCOPES },
      profilesUsageTypeId: "active_profiles",
    });
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected", klaviyoAccountId: "ACC002", profilesUsageTypeId: "active_profiles" });
    expect(await storedTokens()).toEqual({ access: fresh.accessToken, refresh: fresh.refreshToken });
  });
});

describe("getAccessToken", () => {
  it("returns the stored token without calling Klaviyo while it is fresh", async () => {
    const { deps, shop, tokens, tokenCalls } = await setup();
    expect(await getAccessToken(deps, shop)).toBe(tokens.accessToken);
    expect(tokenCalls()).toBe(0);
  });

  it("refreshes when close to expiry and stores the rotated refresh token, encrypted", async () => {
    const { fake, clock, deps, shop, tokens, row, storedTokens, tokenCalls } = await setup({ expiresInMs: 4 * 60_000 });
    const access = await getAccessToken(deps, shop);
    expect(access).not.toBe(tokens.accessToken);
    expect(tokenCalls()).toBe(1);

    const stored = await storedTokens();
    expect(stored.access).toBe(access);
    expect(stored.refresh).not.toBe(tokens.refreshToken);
    expect(fake.liveRefreshTokens()).toEqual([stored.refresh]);
    const r = await row();
    expect(r).toMatchObject({ status: "connected" });
    expect(r!.accessTokenExpiresAt.getTime()).toBe(clock.now + 3600_000);
    expect(r!.lastRefreshedAt!.getTime()).toBe(clock.now);
    expect(JSON.stringify(r)).not.toContain(access);
    expect(JSON.stringify(r)).not.toContain(stored.refresh);

    // The new token is used until it is close to expiry again.
    expect(await getAccessToken(deps, shop)).toBe(access);
    expect(tokenCalls()).toBe(1);
    clock.now += 56 * 60_000;
    expect(await getAccessToken(deps, shop)).not.toBe(access);
    expect(tokenCalls()).toBe(2);
  });

  it("keeps the current refresh token when Klaviyo does not send a new one", async () => {
    const { deps, shop, tokens, storedTokens } = await setup({ expiresInMs: 1000, refreshMode: "static" });
    const access = await getAccessToken(deps, shop);
    expect(await storedTokens()).toEqual({ access, refresh: tokens.refreshToken });
  });

  it("concurrent callers trigger exactly one refresh and never lose the rotated refresh token", async () => {
    // Expired token, so nobody can fall back on it; rotate mode, so a second refresh
    // with the old token would be answered with invalid_grant.
    const { fake, deps, shop, storedTokens, tokenCalls } = await setup({ expiresInMs: -1000 });
    fake.tokenDelayMs = 20;
    const realDeps: ConnectionDeps = { ...deps, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) };

    const results = await Promise.all(Array.from({ length: 8 }, () => getAccessToken(realDeps, shop)));

    expect(tokenCalls()).toBe(1);
    expect(new Set(results).size).toBe(1);
    const stored = await storedTokens();
    expect(stored.access).toBe(results[0]);
    expect(fake.liveRefreshTokens()).toEqual([stored.refresh]);
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected" });

    // And the stored refresh token really works for the next refresh.
    await db
      .update(schema.klaviyoConnections)
      .set({ accessTokenExpiresAt: new Date(T0 - 1), lastRefreshedAt: new Date(T0 - REFRESH_LEASE_MS - 1) })
      .where(eq(schema.klaviyoConnections.shop, shop));
    await expect(getAccessToken(realDeps, shop)).resolves.toMatch(/^access-/);
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected" });
  });

  it("while another request refreshes, a still-valid token is used instead of a second refresh", async () => {
    const { fake, deps, shop, tokens, tokenCalls } = await setup({ expiresInMs: 4 * 60_000 });
    fake.tokenDelayMs = 20;
    const [a, b, c] = await Promise.all([getAccessToken(deps, shop), getAccessToken(deps, shop), getAccessToken(deps, shop)]);
    expect(tokenCalls()).toBe(1);
    // One caller got the new token; the others used the old one, which Klaviyo still accepts.
    const fresh = [a, b, c].filter((t) => t !== tokens.accessToken);
    expect(fresh).toHaveLength(1);
    expect([a, b, c].filter((t) => t === tokens.accessToken)).toHaveLength(2);
  });

  it("a refresh that died mid-flight blocks others briefly, then the lease expires", async () => {
    const { clock, deps, shop, tokenCalls } = await setup({ expiresInMs: -1000 });
    // Another Worker claimed the refresh just now and was killed before finishing.
    await db
      .update(schema.klaviyoConnections)
      .set({ lastRefreshedAt: new Date(clock.now) })
      .where(eq(schema.klaviyoConnections.shop, shop));

    const err = await getAccessToken(deps, shop).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KlaviyoConnectionError);
    expect(err).toMatchObject({ code: "klaviyo_token_refresh_in_progress", retryable: true });
    expect(tokenCalls()).toBe(0);

    clock.now = T0 + REFRESH_LEASE_MS + 1;
    await expect(getAccessToken(deps, shop)).resolves.toMatch(/^access-/);
    expect(tokenCalls()).toBe(1);
  });

  it("marks the connection needs_reauth on invalid_grant and stops calling Klaviyo", async () => {
    const { fake, deps, shop, tokenCalls } = await setup({ expiresInMs: 1000 });
    fake.revokeEverything();
    const err = await getAccessToken(deps, shop).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KlaviyoConnectionError);
    expect(err).toMatchObject({ code: "klaviyo_needs_reauth", retryable: false });
    expect(await getConnection(db, shop)).toMatchObject({ status: "needs_reauth" });

    await expect(getAccessToken(deps, shop)).rejects.toMatchObject({ code: "klaviyo_needs_reauth" });
    await expect(getAccessToken(deps, shop, { forceRefresh: true })).rejects.toMatchObject({ code: "klaviyo_needs_reauth" });
    expect(tokenCalls()).toBe(1);
  });

  it("keeps the connection and releases the lease when the token endpoint is down", async () => {
    const { fake, deps, shop, tokens, storedTokens, tokenCalls } = await setup({ expiresInMs: 1000 });
    fake.failNext(/^\/oauth\/token$/, () => new Response("oops", { status: 503 }));
    const err = await getAccessToken(deps, shop).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KlaviyoOAuthError);
    expect(err).toMatchObject({ code: "klaviyo_oauth_http_503", retryable: true });
    expect(await getConnection(db, shop)).toMatchObject({ status: "connected" });
    expect((await storedTokens()).refresh).toBe(tokens.refreshToken);

    // No waiting for a lease: the very next call refreshes.
    await expect(getAccessToken(deps, shop)).resolves.toMatch(/^access-/);
    expect(tokenCalls()).toBe(2);
  });

  it("forceRefresh refreshes a token that looks valid, but not one refreshed seconds ago", async () => {
    const { clock, deps, shop, tokens, tokenCalls } = await setup();
    const forced = await getAccessToken(deps, shop, { forceRefresh: true });
    expect(forced).not.toBe(tokens.accessToken);
    expect(tokenCalls()).toBe(1);
    // A 401 right after a refresh must not hammer the token endpoint (10 calls per minute).
    expect(await getAccessToken(deps, shop, { forceRefresh: true })).toBe(forced);
    expect(tokenCalls()).toBe(1);
    clock.now += REFRESH_LEASE_MS + 1;
    expect(await getAccessToken(deps, shop, { forceRefresh: true })).not.toBe(forced);
    expect(tokenCalls()).toBe(2);
  });

  it("fails clearly when there is no connection", async () => {
    const { deps } = await setup();
    await expect(getAccessToken(deps, "missing.myshopify.com")).rejects.toMatchObject({ code: "klaviyo_not_connected", retryable: false });
  });

  it("never puts a token in a thrown error", async () => {
    const { fake, deps, shop, tokens } = await setup({ expiresInMs: 1000 });
    const errors: unknown[] = [];
    fake.failNext(/^\/oauth\/token$/, () => new Response(JSON.stringify({ error: "server_error", error_description: tokens.refreshToken }), { status: 500 }));
    errors.push(await getAccessToken(deps, shop).catch((e: unknown) => e));
    fake.revokeEverything();
    errors.push(await getAccessToken(deps, shop).catch((e: unknown) => e));
    expect(errors).toHaveLength(2);
    for (const e of errors) {
      expect(e).toBeInstanceOf(Error);
      const text = `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack}`;
      expect(text).not.toContain(tokens.refreshToken);
      expect(text).not.toContain(tokens.accessToken);
      expect(text).not.toContain(fake.clientSecret);
    }
  });
});

describe("connecting and disconnecting", () => {
  const REDIRECT = "https://app.example.test/klaviyo/oauth/callback";

  async function consent(fake: FakeKlaviyo, shop: string) {
    const request = await createAuthorizationRequest({
      clientId: fake.clientId,
      redirectUri: REDIRECT,
      shop,
      stateSecret: ENCRYPTION_KEY,
    });
    const url = new URL(request.url);
    const code = fake.authorize({
      codeChallenge: url.searchParams.get("code_challenge")!,
      redirectUri: REDIRECT,
      scope: url.searchParams.get("scope")!,
    });
    const verified = await verifyAuthorizationState({
      state: request.state,
      browserBinding: request.browserBinding,
      stateSecret: ENCRYPTION_KEY,
    });
    return { code, ...verified };
  }

  function fresh() {
    const fake = new FakeKlaviyo();
    const deps: ConnectionDeps = {
      db,
      env: { TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY, KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret },
      fetch: fake.fetch,
    };
    return { fake, deps };
  }

  it("completes the whole authorization: code, account, usage type, encrypted storage", async () => {
    const { fake, deps } = fresh();
    fake.billingUsage = [
      { id: "email_sends", usage_used: 10, usage_max: 100, unit: "messages" },
      { id: "active_profiles", usage_used: 12450, usage_max: 15000, unit: "profiles" },
    ];
    const shop = `connect-${crypto.randomUUID().slice(0, 8)}.myshopify.com`;
    await db.insert(schema.shops).values({ shop });
    const { code, codeVerifier, shop: stateShop } = await consent(fake, shop);
    expect(stateShop).toBe(shop);

    const info = await completeAuthorization(deps, { shop, code, codeVerifier, redirectUri: REDIRECT });
    expect(info).toMatchObject({ shop, status: "connected", klaviyoAccountId: "ACC001", profilesUsageTypeId: "active_profiles", scopes: SCOPES });
    expect(fake.requests.map((r) => r.url.pathname)).toEqual(["/oauth/token", "/api/accounts", "/api/billing-usage"]);
    await expect(getAccessToken(deps, shop)).resolves.toMatch(/^access-/);
  });

  it("refuses a grant that lacks a required scope, stores nothing and revokes the install", async () => {
    const { fake, deps } = fresh();
    fake.grantedScopes = KLAVIYO_SCOPES.filter((s) => s !== "subscriptions:write").join(" ");
    const shop = `connect-${crypto.randomUUID().slice(0, 8)}.myshopify.com`;
    await db.insert(schema.shops).values({ shop });
    const { code, codeVerifier } = await consent(fake, shop);
    await expect(completeAuthorization(deps, { shop, code, codeVerifier, redirectUri: REDIRECT })).rejects.toMatchObject({
      code: "klaviyo_oauth_missing_scopes",
    });
    expect(await getConnection(db, shop)).toBeNull();
    expect(fake.requestsTo(/^\/oauth\/revoke$/)).toHaveLength(1);
    expect(fake.liveRefreshTokens()).toEqual([]);
  });

  it("disconnect revokes at Klaviyo and deletes the tokens; a failed revoke still deletes them", async () => {
    const first = await setup();
    expect(await disconnect(first.deps, first.shop)).toEqual({ existed: true, revoked: true });
    const revoke = first.fake.requestsTo(/^\/oauth\/revoke$/)[0]!;
    expect(new URLSearchParams(revoke.body).get("token")).toBe(first.tokens.refreshToken);
    expect(await getConnection(db, first.shop)).toBeNull();
    expect(first.fake.liveRefreshTokens()).toEqual([]);
    expect(await disconnect(first.deps, first.shop)).toEqual({ existed: false, revoked: false });

    const second = await setup();
    second.fake.failNext(/^\/oauth\/revoke$/, () => new Response("down", { status: 503 }));
    expect(await disconnect(second.deps, second.shop)).toEqual({ existed: true, revoked: false });
    expect(await getConnection(db, second.shop)).toBeNull();
  });
});
