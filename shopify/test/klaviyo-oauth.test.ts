import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { KlaviyoOAuthError } from "../app/klaviyo/errors";
import {
  OAUTH_STATE_TTL_MS,
  codeChallengeFor,
  createAuthorizationRequest,
  exchangeCode,
  missingScopes,
  refreshTokens,
  revokeRefreshToken,
  verifyAuthorizationState,
} from "../app/klaviyo/oauth";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";

const SECRET = "state-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const REDIRECT = "https://app.example.test/klaviyo/oauth/callback";
const SHOP = "demo-shop.myshopify.com";
const T0 = new Date("2026-11-25T12:00:00Z");

async function start(shop = SHOP, clientId = "fake-client-id") {
  return createAuthorizationRequest({ clientId, redirectUri: REDIRECT, shop, stateSecret: SECRET, now: T0 });
}

async function codeOf(err: Promise<unknown>): Promise<string> {
  const e = await err.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(KlaviyoOAuthError);
  return (e as KlaviyoOAuthError).code;
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
afterEach(() => vi.restoreAllMocks());

describe("authorization request (PKCE + signed state)", () => {
  it("builds the authorize URL the docs describe", async () => {
    const req = await start();
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe("https://www.klaviyo.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("fake-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("scope")).toBe(KLAVIYO_SCOPES.join(" "));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(req.state);
    expect(req.expiresAt.getTime() - T0.getTime()).toBe(OAUTH_STATE_TTL_MS);
  });

  it("asks for accounts:read and for nothing the MVP does not use", () => {
    expect(KLAVIYO_SCOPES).toContain("accounts:read");
    expect([...KLAVIYO_SCOPES].sort()).toEqual(
      [
        "accounts:read",
        "events:read",
        "lists:read",
        "metrics:read",
        "profiles:read",
        "profiles:write",
        "segments:read",
        "subscriptions:read",
        "subscriptions:write",
        "usage:read",
      ].sort(),
    );
  });

  it("derives a valid verifier whose S256 challenge is the one in the URL, and keeps it out of the URL", async () => {
    const req = await start();
    const { shop, codeVerifier } = await verifyAuthorizationState({
      state: req.state,
      browserBinding: req.browserBinding,
      stateSecret: SECRET,
      now: new Date(T0.getTime() + 60_000),
    });
    expect(shop).toBe(SHOP);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await codeChallengeFor(codeVerifier)).toBe(new URL(req.url).searchParams.get("code_challenge"));
    expect(req.url).not.toContain(codeVerifier);
    expect(req.state).not.toContain(codeVerifier);
    expect(req.state).not.toContain(req.browserBinding);
  });

  it("uses a new state, verifier and challenge for every request", async () => {
    const a = await start();
    const b = await start();
    expect(a.state).not.toBe(b.state);
    expect(a.browserBinding).not.toBe(b.browserBinding);
    expect(new URL(a.url).searchParams.get("code_challenge")).not.toBe(new URL(b.url).searchParams.get("code_challenge"));
  });

  it("rejects an expired state, exactly at 10 minutes", async () => {
    const req = await start();
    const at = (ms: number) =>
      verifyAuthorizationState({
        state: req.state,
        browserBinding: req.browserBinding,
        stateSecret: SECRET,
        now: new Date(T0.getTime() + ms),
      });
    await expect(at(OAUTH_STATE_TTL_MS - 1)).resolves.toMatchObject({ shop: SHOP });
    expect(await codeOf(at(OAUTH_STATE_TTL_MS))).toBe("klaviyo_oauth_state_expired");
    expect(await codeOf(at(OAUTH_STATE_TTL_MS + 86_400_000))).toBe("klaviyo_oauth_state_expired");
  });

  it("rejects any tampering with the state", async () => {
    const req = await start();
    const [version, payload, signature] = req.state.split(".") as [string, string, string];
    const check = (state: string | null | undefined) =>
      codeOf(verifyAuthorizationState({ state, browserBinding: req.browserBinding, stateSecret: SECRET, now: T0 }));

    // Point the state at another shop, keeping the signature.
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    const forge = (change: Record<string, unknown>) =>
      btoa(JSON.stringify({ ...decoded, ...change }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    expect(await check(`${version}.${forge({ s: "attacker.myshopify.com" })}.${signature}`)).toBe("klaviyo_oauth_state_invalid");
    // Extend the expiry.
    expect(await check(`${version}.${forge({ e: (decoded.e as number) + 3_600_000 })}.${signature}`)).toBe("klaviyo_oauth_state_invalid");
    // Flip one character of the signature.
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(await check(`${version}.${payload}.${flipped}`)).toBe("klaviyo_oauth_state_invalid");
    // Structural garbage.
    for (const bad of ["", "abc", "v1..", `v2.${payload}.${signature}`, `${version}.${payload}`, `${version}.${payload}.!!!`, null, undefined]) {
      expect(await check(bad)).toBe("klaviyo_oauth_state_invalid");
    }
  });

  it("rejects a state signed with another secret", async () => {
    const req = await start();
    const other = "another-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
    expect(
      await codeOf(verifyAuthorizationState({ state: req.state, browserBinding: req.browserBinding, stateSecret: other, now: T0 })),
    ).toBe("klaviyo_oauth_state_invalid");
  });

  it("rejects a callback that reaches a browser which did not start the flow", async () => {
    const mine = await start();
    const theirs = await start("attacker.myshopify.com");
    const check = (browserBinding: string | null | undefined) =>
      codeOf(verifyAuthorizationState({ state: theirs.state, browserBinding, stateSecret: SECRET, now: T0 }));
    expect(await check(mine.browserBinding)).toBe("klaviyo_oauth_state_binding_mismatch");
    expect(await check(null)).toBe("klaviyo_oauth_state_binding_mismatch");
    expect(await check("")).toBe("klaviyo_oauth_state_binding_mismatch");
  });

  it("refuses invalid shops, a missing client id and a weak secret", async () => {
    expect(await codeOf(start("evil.example.com"))).toBe("klaviyo_oauth_invalid_shop");
    expect(await codeOf(start("a.myshopify.com/x"))).toBe("klaviyo_oauth_invalid_shop");
    expect(await codeOf(start(SHOP, ""))).toBe("klaviyo_oauth_client_not_configured");
    expect(
      await codeOf(createAuthorizationRequest({ clientId: "c", redirectUri: REDIRECT, shop: SHOP, stateSecret: "short" })),
    ).toBe("klaviyo_oauth_state_secret_too_short");
  });
});

describe("token endpoint", () => {
  async function authorized(fake: FakeKlaviyo) {
    const req = await start(SHOP, fake.clientId);
    const url = new URL(req.url);
    const code = fake.authorize({
      codeChallenge: url.searchParams.get("code_challenge")!,
      redirectUri: url.searchParams.get("redirect_uri")!,
      scope: url.searchParams.get("scope")!,
    });
    const { codeVerifier } = await verifyAuthorizationState({
      state: req.state,
      browserBinding: req.browserBinding,
      stateSecret: SECRET,
      now: T0,
    });
    return { code, codeVerifier };
  }
  const creds = (fake: FakeKlaviyo) => ({ clientId: fake.clientId, clientSecret: fake.clientSecret });

  it("exchanges the code with Basic auth, a form body and the PKCE verifier", async () => {
    const fake = new FakeKlaviyo();
    const { code, codeVerifier } = await authorized(fake);
    const tokens = await exchangeCode({
      credentials: creds(fake),
      code,
      codeVerifier,
      redirectUri: REDIRECT,
      fetch: fake.fetch,
      now: T0,
    });
    expect(tokens.accessToken).toMatch(/^access-/);
    expect(tokens.refreshToken).toMatch(/^refresh-/);
    expect(tokens.expiresAt.getTime()).toBe(T0.getTime() + 3600_000);
    expect(missingScopes(tokens.scope)).toEqual([]);

    const sent = fake.requests[0]!;
    expect(sent.url.toString()).toBe("https://a.klaviyo.com/oauth/token");
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(sent.headers.get("Authorization")).toBe(`Basic ${btoa(`${fake.clientId}:${fake.clientSecret}`)}`);
    const form = new URLSearchParams(sent.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT,
    });
  });

  it("fails with invalid_grant when the verifier does not match the challenge", async () => {
    const fake = new FakeKlaviyo();
    const { code } = await authorized(fake);
    const err = await exchangeCode({
      credentials: creds(fake),
      code,
      codeVerifier: "x".repeat(43),
      redirectUri: REDIRECT,
      fetch: fake.fetch,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KlaviyoOAuthError);
    expect(err).toMatchObject({ code: "klaviyo_oauth_invalid_grant", oauthError: "invalid_grant", status: 400, retryable: false });
  });

  it("a code works once", async () => {
    const fake = new FakeKlaviyo();
    const { code, codeVerifier } = await authorized(fake);
    const args = { credentials: creds(fake), code, codeVerifier, redirectUri: REDIRECT, fetch: fake.fetch };
    await exchangeCode(args);
    expect(await codeOf(exchangeCode(args))).toBe("klaviyo_oauth_invalid_grant");
  });

  it("refreshes, with and without a rotated refresh token", async () => {
    const fake = new FakeKlaviyo();
    const first = fake.issueTokens("accounts:read");
    const rotated = await refreshTokens({ credentials: creds(fake), refreshToken: first.refreshToken, fetch: fake.fetch, now: T0 });
    expect(rotated.refreshToken).not.toBeNull();
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(Object.fromEntries(new URLSearchParams(fake.requests[0]!.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: first.refreshToken,
    });
    // The old token is dead in rotate mode.
    expect(await codeOf(refreshTokens({ credentials: creds(fake), refreshToken: first.refreshToken, fetch: fake.fetch }))).toBe(
      "klaviyo_oauth_invalid_grant",
    );

    fake.refreshMode = "static";
    const again = await refreshTokens({ credentials: creds(fake), refreshToken: rotated.refreshToken!, fetch: fake.fetch });
    expect(again.refreshToken).toBeNull();
    expect(again.accessToken).not.toBe(rotated.accessToken);
  });

  it("reports wrong client credentials, rate limits and outages with the right retryability", async () => {
    const fake = new FakeKlaviyo();
    const { refreshToken } = fake.issueTokens("accounts:read");
    const wrong = await refreshTokens({
      credentials: { clientId: fake.clientId, clientSecret: "nope" },
      refreshToken,
      fetch: fake.fetch,
    }).catch((e: unknown) => e);
    expect(wrong).toMatchObject({ code: "klaviyo_oauth_invalid_client", status: 401, retryable: false });

    fake.failNext(/^\/oauth\/token$/, () =>
      new Response(JSON.stringify({ error: "rate_limit_exceeded", error_description: "Rate limit exceeded for refresh token." }), {
        status: 429,
      }),
    );
    const limited = await refreshTokens({ credentials: creds(fake), refreshToken, fetch: fake.fetch }).catch((e: unknown) => e);
    expect(limited).toMatchObject({ code: "klaviyo_oauth_rate_limit_exceeded", retryable: true, retryAfterMs: 60_000 });

    fake.failNext(/^\/oauth\/token$/, () => new Response("<html>bad gateway</html>", { status: 502 }));
    const down = await refreshTokens({ credentials: creds(fake), refreshToken, fetch: fake.fetch }).catch((e: unknown) => e);
    expect(down).toMatchObject({ code: "klaviyo_oauth_http_502", retryable: true });

    const offline = await refreshTokens({
      credentials: creds(fake),
      refreshToken,
      fetch: async () => {
        throw new TypeError(`fetch failed for refresh_token=${refreshToken}`);
      },
    }).catch((e: unknown) => e);
    expect(offline).toMatchObject({ code: "klaviyo_oauth_network_error", retryable: true });
  });

  it("revokes with the refresh token and the documented form fields", async () => {
    const fake = new FakeKlaviyo();
    const { refreshToken } = fake.issueTokens("accounts:read");
    await revokeRefreshToken({ credentials: creds(fake), refreshToken, fetch: fake.fetch });
    const sent = fake.requests[0]!;
    expect(sent.url.toString()).toBe("https://a.klaviyo.com/oauth/revoke");
    expect(Object.fromEntries(new URLSearchParams(sent.body))).toEqual({ token_type_hint: "refresh_token", token: refreshToken });
    expect(fake.liveRefreshTokens()).toEqual([]);
  });

  it("never puts a secret, a token or Klaviyo's free text in an error or in the console", async () => {
    const fake = new FakeKlaviyo();
    const { refreshToken } = fake.issueTokens("accounts:read");
    const secretText = `leak ${refreshToken} ${fake.clientSecret}`;
    const errors: unknown[] = [];
    fake.failNext(/^\/oauth\/token$/, () => new Response(JSON.stringify({ error: secretText, error_description: secretText }), { status: 400 }));
    errors.push(await refreshTokens({ credentials: creds(fake), refreshToken, fetch: fake.fetch }).catch((e: unknown) => e));
    fake.revokeEverything();
    errors.push(await refreshTokens({ credentials: creds(fake), refreshToken, fetch: fake.fetch }).catch((e: unknown) => e));
    errors.push(
      await refreshTokens({
        credentials: creds(fake),
        refreshToken,
        fetch: async () => {
          throw new Error(secretText);
        },
      }).catch((e: unknown) => e),
    );
    for (const e of errors) {
      expect(e).toBeInstanceOf(KlaviyoOAuthError);
      const text = `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack ?? ""}`;
      expect(text).not.toContain(refreshToken);
      expect(text).not.toContain(fake.clientSecret);
      expect(text).not.toContain("leak");
    }
    expect(logged.join("\n")).toBe("");
  });
});
