import { KLAVIYO_OAUTH, KLAVIYO_SCOPES } from "./config";
import { KlaviyoOAuthError, safeCode } from "./errors";

/**
 * Klaviyo OAuth: authorization-code flow with PKCE (S256).
 *
 * Verified in developers.klaviyo.com/en/docs/set_up_oauth and
 * /troubleshoot_oauth_errors (2026-11-25):
 * - authorize at www.klaviyo.com/oauth/authorize with response_type=code,
 *   client_id, redirect_uri, scope (space separated), state,
 *   code_challenge_method=S256, code_challenge;
 * - token and revoke at a.klaviyo.com, form-encoded body, client
 *   authentication by `Authorization: Basic base64(client_id:client_secret)`;
 * - PKCE is required even though the client has a secret;
 * - the authorization code lives 5 minutes; access tokens about 1 hour
 *   ("rely on expires_in"); a refresh token unused for 90 days is revoked;
 * - a refresh token can be used 10 times per minute (429 `rate_limit_exceeded`);
 * - 400 `invalid_grant` on refresh means the merchant must authorize again.
 *
 * Not stated by the docs: whether a refresh returns a NEW refresh token and
 * whether the old one stops working. The code handles both (see
 * connection.server.ts).
 *
 * State and verifier storage: nothing is stored. `state` is a signed,
 * 10-minute value carrying the shop, and the PKCE verifier is derived from
 * the state with a second key, so it never travels through the browser.
 * No table, no migration, nothing to clean up after an abandoned flow.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const STATE_VERSION = "v1";
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const encoder = new TextEncoder();

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  /** Absent when the token endpoint did not return one; the caller keeps the current token. */
  refreshToken: string | null;
  expiresAt: Date;
  /** Space-separated scopes granted, as returned by Klaviyo. */
  scope: string;
}

export interface AuthorizationRequest {
  /** Where to send the merchant's browser (top-level navigation, not the embedded iframe). */
  url: string;
  state: string;
  /**
   * Random value the caller must put in a cookie on the merchant's browser
   * (HttpOnly, Secure, SameSite=Lax, 10 minutes) and hand back to
   * `verifyAuthorizationState`. It ties the callback to the browser that
   * started the flow, so nobody can be tricked into connecting their Klaviyo
   * account to someone else's shop.
   */
  browserBinding: string;
  expiresAt: Date;
}

interface StatePayload {
  /** Shop domain. */
  s: string;
  /** Expiry, ms since the epoch. */
  e: number;
  /** Nonce. */
  n: string;
  /** SHA-256 of the browser binding, base64url. */
  b: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("not base64url");
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

/**
 * Derives an HMAC key for one purpose from the Worker secret (HKDF-SHA-256),
 * so the state signature, the PKCE verifier and token encryption never share
 * a key even though they start from the same secret.
 */
async function deriveKey(secret: string, purpose: "state" | "pkce" | "start"): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new KlaviyoOAuthError("klaviyo_oauth_state_secret_too_short");
  }
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: encoder.encode(`tiersaver/klaviyo-oauth/${purpose}/${STATE_VERSION}`),
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** PKCE verifier for a state: 43 base64url characters (256 bits), never sent to the browser. */
async function deriveVerifier(secret: string, signedPart: string): Promise<string> {
  const key = await deriveKey(secret, "pkce");
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPart))));
}

/** S256 code challenge for a verifier (RFC 7636). */
export function codeChallengeFor(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}

/**
 * Starts the flow: returns the authorize URL, the signed state and the value
 * for the browser-binding cookie. `stateSecret` is a Worker secret of at
 * least 32 characters (TOKEN_ENCRYPTION_KEY in production).
 */
export async function createAuthorizationRequest(args: {
  clientId: string;
  redirectUri: string;
  shop: string;
  stateSecret: string;
  scopes?: readonly string[];
  now?: Date;
}): Promise<AuthorizationRequest> {
  if (!SHOP_PATTERN.test(args.shop)) throw new KlaviyoOAuthError("klaviyo_oauth_invalid_shop");
  if (!args.clientId) throw new KlaviyoOAuthError("klaviyo_oauth_client_not_configured");

  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS);
  const browserBinding = randomToken();
  const payload: StatePayload = {
    s: args.shop,
    e: expiresAt.getTime(),
    n: randomToken(16),
    b: await sha256Base64Url(browserBinding),
  };
  const signedPart = `${STATE_VERSION}.${toBase64Url(encoder.encode(JSON.stringify(payload)))}`;
  const key = await deriveKey(args.stateSecret, "state");
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPart)));
  const state = `${signedPart}.${toBase64Url(signature)}`;

  const verifier = await deriveVerifier(args.stateSecret, signedPart);
  const url = new URL(KLAVIYO_OAUTH.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", (args.scopes ?? KLAVIYO_SCOPES).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", await codeChallengeFor(verifier));

  return { url: url.toString(), state, browserBinding, expiresAt };
}

interface VerifiedState {
  shop: string;
  /** SHA-256 of the browser binding the state was issued with, base64url. */
  bindingHash: string;
  signedPart: string;
}

/** Signature, shape and expiry of a state. Says nothing yet about who is presenting it. */
async function readState(state: string | null | undefined, stateSecret: string, now: Date): Promise<VerifiedState> {
  const invalid = () => new KlaviyoOAuthError("klaviyo_oauth_state_invalid");
  const parts = typeof state === "string" ? state.split(".") : [];
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) throw invalid();
  const signedPart = `${parts[0]}.${parts[1]}`;

  let signature: Uint8Array<ArrayBuffer>;
  let payloadBytes: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64Url(parts[2]!);
    payloadBytes = fromBase64Url(parts[1]!);
  } catch {
    throw invalid();
  }
  const key = await deriveKey(stateSecret, "state");
  // `verify` compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(signedPart));
  if (!ok) throw invalid();

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as StatePayload;
  } catch {
    throw invalid();
  }
  if (
    typeof payload?.s !== "string" ||
    !SHOP_PATTERN.test(payload.s) ||
    typeof payload.e !== "number" ||
    typeof payload.b !== "string"
  ) {
    throw invalid();
  }
  if (now.getTime() >= payload.e) throw new KlaviyoOAuthError("klaviyo_oauth_state_expired");
  return { shop: payload.s, bindingHash: payload.b, signedPart };
}

/**
 * Validates the `state` Klaviyo sent back and returns the shop it was issued
 * for plus the PKCE verifier to use in the code exchange.
 *
 * Throws KlaviyoOAuthError: `klaviyo_oauth_state_invalid` (malformed, wrong
 * signature, tampered), `klaviyo_oauth_state_expired`, or
 * `klaviyo_oauth_state_binding_mismatch` (callback reached a browser that did
 * not start this flow).
 */
export async function verifyAuthorizationState(args: {
  state: string | null | undefined;
  /** Value of the browser-binding cookie on the callback request. */
  browserBinding: string | null | undefined;
  stateSecret: string;
  now?: Date;
}): Promise<{ shop: string; codeVerifier: string }> {
  const verified = await readState(args.state, args.stateSecret, args.now ?? new Date());

  const binding = typeof args.browserBinding === "string" ? args.browserBinding : "";
  // Both sides are SHA-256 digests of high-entropy values, so comparing them directly leaks nothing useful.
  if (!binding || (await sha256Base64Url(binding)) !== verified.bindingHash) {
    throw new KlaviyoOAuthError("klaviyo_oauth_state_binding_mismatch");
  }

  return { shop: verified.shop, codeVerifier: await deriveVerifier(args.stateSecret, verified.signedPart) };
}

/**
 * Validates a `state` for a request that is already authenticated as `shop`
 * by Shopify (the embedded "finish" step, where our cookie is not available
 * because the app runs in a third-party iframe). The Shopify session takes the
 * place of the browser binding: the state must have been issued for exactly
 * the shop whose admin is presenting it, otherwise
 * `klaviyo_oauth_state_shop_mismatch`.
 */
export async function verifyAuthorizationStateForShop(args: {
  state: string | null | undefined;
  /** Shop of the authenticated Shopify session. */
  shop: string;
  stateSecret: string;
  now?: Date;
}): Promise<{ shop: string; codeVerifier: string }> {
  const verified = await readState(args.state, args.stateSecret, args.now ?? new Date());
  if (verified.shop !== args.shop) throw new KlaviyoOAuthError("klaviyo_oauth_state_shop_mismatch");
  return { shop: verified.shop, codeVerifier: await deriveVerifier(args.stateSecret, verified.signedPart) };
}

/** How long a start ticket is valid: long enough to read the page and click, no longer. */
export const START_TICKET_TTL_MS = 10 * 60 * 1000;

/**
 * A signed, short-lived permission to start the Klaviyo flow for one shop.
 *
 * The app is embedded in the Shopify admin (a third-party iframe), so the
 * request that starts the flow has to be a top-level navigation, which carries
 * no Shopify session token. The embedded page, which IS authenticated, puts
 * this ticket in the link instead. It grants nothing by itself: the connection
 * is only stored by the embedded finish step, authenticated as the same shop.
 */
export async function createStartTicket(args: { shop: string; stateSecret: string; now?: Date }): Promise<string> {
  if (!SHOP_PATTERN.test(args.shop)) throw new KlaviyoOAuthError("klaviyo_oauth_invalid_shop");
  const expires = (args.now ?? new Date()).getTime() + START_TICKET_TTL_MS;
  const signedPart = `${STATE_VERSION}.${toBase64Url(encoder.encode(JSON.stringify({ s: args.shop, e: expires })))}`;
  const key = await deriveKey(args.stateSecret, "start");
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPart)));
  return `${signedPart}.${toBase64Url(signature)}`;
}

/** Returns the shop a start ticket was issued for. Throws `klaviyo_oauth_ticket_invalid` or `klaviyo_oauth_ticket_expired`. */
export async function verifyStartTicket(args: {
  ticket: string | null | undefined;
  stateSecret: string;
  now?: Date;
}): Promise<{ shop: string }> {
  const invalid = () => new KlaviyoOAuthError("klaviyo_oauth_ticket_invalid");
  const parts = typeof args.ticket === "string" ? args.ticket.split(".") : [];
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) throw invalid();
  const signedPart = `${parts[0]}.${parts[1]}`;
  let payload: { s?: unknown; e?: unknown };
  try {
    const key = await deriveKey(args.stateSecret, "start");
    const ok = await crypto.subtle.verify("HMAC", key, fromBase64Url(parts[2]!), encoder.encode(signedPart));
    if (!ok) throw invalid();
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!))) as { s?: unknown; e?: unknown };
  } catch (err) {
    if (err instanceof KlaviyoOAuthError && err.code !== "klaviyo_oauth_ticket_invalid") throw err;
    throw invalid();
  }
  if (typeof payload.s !== "string" || !SHOP_PATTERN.test(payload.s) || typeof payload.e !== "number") throw invalid();
  if ((args.now ?? new Date()).getTime() >= payload.e) throw new KlaviyoOAuthError("klaviyo_oauth_ticket_expired");
  return { shop: payload.s };
}

function basicAuth(credentials: OAuthClientCredentials): string {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new KlaviyoOAuthError("klaviyo_oauth_client_not_configured");
  }
  const bytes = encoder.encode(`${credentials.clientId}:${credentials.clientSecret}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

async function postForm(
  url: string,
  credentials: OAuthClientCredentials,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const authorization = basicAuth(credentials);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The original error can quote the request; it is dropped on purpose.
    throw new KlaviyoOAuthError("klaviyo_oauth_network_error", { retryable: true });
  }
}

/** Turns a token endpoint error into a typed error without copying any free text. */
async function tokenEndpointError(res: Response): Promise<KlaviyoOAuthError> {
  let oauthError: string | null = null;
  try {
    const body = (await res.json()) as { error?: unknown };
    oauthError = safeCode(body?.error, "") || null;
  } catch {
    oauthError = null;
  }
  const retryAfter = Number(res.headers.get("Retry-After"));
  const retryable = res.status === 429 || res.status >= 500;
  return new KlaviyoOAuthError(`klaviyo_oauth_${oauthError ?? `http_${res.status}`}`, {
    status: res.status,
    oauthError,
    retryable,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : res.status === 429 ? 60_000 : null,
  });
}

async function parseTokenResponse(res: Response, now: Date): Promise<TokenSet> {
  if (!res.ok) throw await tokenEndpointError(res);
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new KlaviyoOAuthError("klaviyo_oauth_invalid_token_response", { status: res.status });
  }
  const accessToken = body.access_token;
  const expiresIn = Number(body.expires_in);
  if (typeof accessToken !== "string" || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new KlaviyoOAuthError("klaviyo_oauth_invalid_token_response", { status: res.status });
  }
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

/** Exchanges the authorization code for tokens. `invalid_grant` here means the code or verifier was rejected. */
export async function exchangeCode(args: {
  credentials: OAuthClientCredentials;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: Date;
}): Promise<TokenSet & { refreshToken: string }> {
  const res = await postForm(
    KLAVIYO_OAUTH.tokenUrl,
    args.credentials,
    {
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
    },
    args.fetch ?? fetch,
  );
  const tokens = await parseTokenResponse(res, args.now ?? new Date());
  if (!tokens.refreshToken) throw new KlaviyoOAuthError("klaviyo_oauth_invalid_token_response", { status: res.status });
  return { ...tokens, refreshToken: tokens.refreshToken };
}

/**
 * Gets a new access token. Throws KlaviyoOAuthError with
 * `oauthError === "invalid_grant"` when the merchant has to connect again
 * (uninstalled in Klaviyo, revoked, or unused for 90 days).
 */
export async function refreshTokens(args: {
  credentials: OAuthClientCredentials;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: Date;
}): Promise<TokenSet> {
  const res = await postForm(
    KLAVIYO_OAUTH.tokenUrl,
    args.credentials,
    { grant_type: "refresh_token", refresh_token: args.refreshToken },
    args.fetch ?? fetch,
  );
  return parseTokenResponse(res, args.now ?? new Date());
}

/**
 * Revokes the install. The endpoint only takes refresh tokens; access tokens
 * issued from it stop working within a few minutes.
 */
export async function revokeRefreshToken(args: {
  credentials: OAuthClientCredentials;
  refreshToken: string;
  fetch?: typeof fetch;
}): Promise<void> {
  const res = await postForm(
    KLAVIYO_OAUTH.revokeUrl,
    args.credentials,
    { token_type_hint: "refresh_token", token: args.refreshToken },
    args.fetch ?? fetch,
  );
  if (!res.ok) throw await tokenEndpointError(res);
}

/** Scopes from `required` that are missing in a space-separated granted list. */
export function missingScopes(granted: string, required: readonly string[] = KLAVIYO_SCOPES): string[] {
  const have = new Set(granted.split(/\s+/).filter(Boolean));
  return required.filter((scope) => !have.has(scope));
}
