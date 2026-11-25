import { decryptToken, encryptToken, importTokenKey } from "@tiersaver/core";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { getAccount, getProfilesUsage } from "./api";
import { KlaviyoClient, type AccessTokenProvider } from "./client";
import { KLAVIYO_REQUIRED_SCOPES, KLAVIYO_REVISION } from "./config";
import { KlaviyoConnectionError, KlaviyoOAuthError } from "./errors";
import {
  exchangeCode,
  missingScopes,
  refreshTokens,
  revokeRefreshToken,
  type OAuthClientCredentials,
  type TokenSet,
} from "./oauth";

/**
 * The shop's Klaviyo connection: tokens at rest and access token refresh.
 *
 * Tokens are stored only as AES-256-GCM ciphertext (core `encryptToken`, key
 * in the TOKEN_ENCRYPTION_KEY secret). Plaintext tokens exist in memory for
 * the duration of a call and are never logged.
 *
 * Refresh and concurrency. Klaviyo's docs do not say whether a refresh
 * rotates the refresh token, so this code assumes the worst case: the response
 * carries a new refresh token and the old one stops working. In that world two
 * requests that refresh at the same time can destroy the connection (the
 * second one presents a token that is already dead, or the older response is
 * stored last). So a refresh is serialized per shop with a lease:
 *
 * 1. Claim: one conditional UPDATE sets `last_refreshed_at = now`, and only
 *    succeeds if the row still holds the token we read and nobody claimed it
 *    in the last 30 seconds. D1 runs it atomically, so exactly one caller wins.
 * 2. The winner calls Klaviyo and stores the new tokens with a second
 *    conditional UPDATE that requires its own claim to still be in place.
 * 3. Everyone else does not call Klaviyo. If the current access token is
 *    still good for 30 seconds they use it; otherwise they wait for the winner
 *    to finish and read the new token from the row.
 *
 * `last_refreshed_at` therefore means "when the most recent refresh started".
 * A winner that dies mid-flight leaves a lease that expires by itself. What no
 * client-side design can cover: the Worker dying after Klaviyo rotated the
 * token and before the row was written. With rotation that costs a reconnect.
 */

type Db = DrizzleD1Database<typeof schema>;

export interface KlaviyoSecrets {
  TOKEN_ENCRYPTION_KEY: string;
  KLAVIYO_CLIENT_ID: string;
  KLAVIYO_CLIENT_SECRET: string;
}

export interface ConnectionDeps {
  db: Db;
  env: KlaviyoSecrets;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type ConnectionStatus = (typeof schema.KLAVIYO_CONNECTION_STATUSES)[number];

/** Connection data that is safe to pass around: no tokens, not even encrypted. */
export interface ConnectionInfo {
  shop: string;
  klaviyoAccountId: string;
  status: ConnectionStatus;
  scopes: string;
  apiRevision: string;
  profilesUsageTypeId: string | null;
  accessTokenExpiresAt: Date;
  connectedAt: Date;
}

/** Refresh when the access token has less than this left. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** A token with at least this much life left can still be used while someone else refreshes. */
export const MIN_USABLE_MS = 30 * 1000;
/** How long a refresh claim excludes other refreshers. Must exceed the token request timeout (10 s). */
export const REFRESH_LEASE_MS = 30 * 1000;
const POLL_MS = 250;
const MAX_WAIT_MS = 8000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function credentials(env: KlaviyoSecrets): OAuthClientCredentials {
  return { clientId: env.KLAVIYO_CLIENT_ID, clientSecret: env.KLAVIYO_CLIENT_SECRET };
}

function toInfo(row: typeof schema.klaviyoConnections.$inferSelect): ConnectionInfo {
  return {
    shop: row.shop,
    klaviyoAccountId: row.klaviyoAccountId,
    status: row.status,
    scopes: row.scopes,
    apiRevision: row.apiRevision,
    profilesUsageTypeId: row.profilesUsageTypeId,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    connectedAt: row.connectedAt,
  };
}

/** The shop's connection without tokens, or null when there is none. */
export async function getConnection(db: Db, shop: string): Promise<ConnectionInfo | null> {
  const row = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop) });
  return row ? toInfo(row) : null;
}

/**
 * Stores (or replaces) the connection after a successful authorization.
 * The `shops` row must exist.
 */
export async function saveConnection(
  deps: Pick<ConnectionDeps, "db" | "env" | "now">,
  args: {
    shop: string;
    klaviyoAccountId: string;
    tokens: TokenSet & { refreshToken: string };
    profilesUsageTypeId?: string | null;
  },
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const key = await importTokenKey(deps.env.TOKEN_ENCRYPTION_KEY);
  const values = {
    klaviyoAccountId: args.klaviyoAccountId,
    accessTokenEnc: await encryptToken(args.tokens.accessToken, key),
    refreshTokenEnc: await encryptToken(args.tokens.refreshToken, key),
    accessTokenExpiresAt: args.tokens.expiresAt,
    scopes: args.tokens.scope,
    apiRevision: KLAVIYO_REVISION,
    status: "connected" as const,
    profilesUsageTypeId: args.profilesUsageTypeId ?? null,
    connectedAt: now,
    lastRefreshedAt: null,
    updatedAt: now,
  };
  await deps.db
    .insert(schema.klaviyoConnections)
    .values({ shop: args.shop, ...values })
    .onConflictDoUpdate({ target: schema.klaviyoConnections.shop, set: values });
}

/**
 * Finishes the OAuth flow for a shop: exchanges the code, checks that every
 * scope the app needs was granted, reads the account id and the billing usage
 * type (optional), and stores the connection. Two or three Klaviyo requests.
 */
export async function completeAuthorization(
  deps: ConnectionDeps,
  args: { shop: string; code: string; codeVerifier: string; redirectUri: string },
): Promise<ConnectionInfo> {
  const now = deps.now ?? (() => new Date());
  const tokens = await exchangeCode({
    credentials: credentials(deps.env),
    code: args.code,
    codeVerifier: args.codeVerifier,
    redirectUri: args.redirectUri,
    fetch: deps.fetch,
    now: now(),
  });
  try {
    if (missingScopes(tokens.scope, KLAVIYO_REQUIRED_SCOPES).length > 0) {
      throw new KlaviyoOAuthError("klaviyo_oauth_missing_scopes");
    }
    const client = new KlaviyoClient({
      getAccessToken: async () => tokens.accessToken,
      fetch: deps.fetch,
      sleep: deps.sleep,
    });
    const account = await getAccount(client);
    // Billing usage is optional information for the audit and the report. A
    // missing `usage:read` scope, a free plan or a failing endpoint must not
    // stop the merchant from connecting.
    let usageTypeId: string | null = null;
    if (missingScopes(tokens.scope, ["usage:read"]).length === 0) {
      usageTypeId = await getProfilesUsage(client).then(
        (found) => found.usage?.usageTypeId ?? null,
        () => null,
      );
    }

    await saveConnection(deps, {
      shop: args.shop,
      klaviyoAccountId: account.id,
      tokens,
      profilesUsageTypeId: usageTypeId,
    });
  } catch (err) {
    // Do not leave an install at Klaviyo that we hold no record of.
    await revokeRefreshToken({
      credentials: credentials(deps.env),
      refreshToken: tokens.refreshToken,
      fetch: deps.fetch,
    }).catch(() => undefined);
    throw err;
  }
  const saved = await getConnection(deps.db, args.shop);
  if (!saved) throw new KlaviyoConnectionError("klaviyo_not_connected");
  return saved;
}

export async function setProfilesUsageTypeId(db: Db, shop: string, usageTypeId: string | null): Promise<void> {
  await db
    .update(schema.klaviyoConnections)
    .set({ profilesUsageTypeId: usageTypeId })
    .where(eq(schema.klaviyoConnections.shop, shop));
}

/**
 * Returns a valid access token for the shop, refreshing it when it is close
 * to expiry (or when `forceRefresh` is set after a 401).
 *
 * Throws KlaviyoConnectionError:
 * - `klaviyo_not_connected`: no connection row;
 * - `klaviyo_needs_reauth` / `klaviyo_disconnected`: the merchant must connect again;
 * - `klaviyo_token_refresh_in_progress` (retryable): another request is
 *   refreshing and did not finish in time.
 * Throws KlaviyoOAuthError (retryable) when Klaviyo's token endpoint is
 * unavailable or rate limited.
 */
export async function getAccessToken(
  deps: ConnectionDeps,
  shop: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const key = await importTokenKey(deps.env.TOKEN_ENCRYPTION_KEY);
  const table = schema.klaviyoConnections;
  let waited = 0;

  for (;;) {
    const row = await deps.db.query.klaviyoConnections.findFirst({ where: eq(table.shop, shop) });
    if (!row) throw new KlaviyoConnectionError("klaviyo_not_connected");
    if (row.status !== "connected") throw new KlaviyoConnectionError(`klaviyo_${row.status}`);

    const at = now();
    const msLeft = row.accessTokenExpiresAt.getTime() - at.getTime();
    // A token refreshed moments ago is not refreshed again, even when asked: a 401
    // right after a refresh means the install is gone, and hammering the token
    // endpoint (10 calls per minute per refresh token) would not bring it back.
    const justRefreshed =
      row.lastRefreshedAt !== null && at.getTime() - row.lastRefreshedAt.getTime() < REFRESH_LEASE_MS;
    const wantsRefresh = msLeft <= REFRESH_SKEW_MS || (opts.forceRefresh === true && !justRefreshed);
    if (!wantsRefresh) return decryptToken(row.accessTokenEnc, key);

    // Step 1: claim the refresh. Only one caller per token generation gets through.
    const claimed = await deps.db
      .update(table)
      .set({ lastRefreshedAt: at })
      .where(
        and(
          eq(table.shop, shop),
          eq(table.status, "connected"),
          eq(table.accessTokenEnc, row.accessTokenEnc),
          or(isNull(table.lastRefreshedAt), lte(table.lastRefreshedAt, new Date(at.getTime() - REFRESH_LEASE_MS))),
        ),
      )
      .returning({ shop: table.shop });

    if (claimed.length === 0) {
      // Someone else is refreshing (or just did, or the connection changed).
      if (msLeft > MIN_USABLE_MS) return decryptToken(row.accessTokenEnc, key);
      if (waited >= MAX_WAIT_MS) throw new KlaviyoConnectionError("klaviyo_token_refresh_in_progress", { retryable: true });
      await sleep(POLL_MS);
      waited += POLL_MS;
      continue;
    }

    // Step 2: we hold the lease. Our claim is the row version every write below checks.
    const ours = and(eq(table.shop, shop), eq(table.accessTokenEnc, row.accessTokenEnc), eq(table.lastRefreshedAt, at));
    let tokens: TokenSet;
    try {
      tokens = await refreshTokens({
        credentials: credentials(deps.env),
        refreshToken: await decryptToken(row.refreshTokenEnc, key),
        fetch: deps.fetch,
        now: now(),
      });
    } catch (err) {
      if (err instanceof KlaviyoOAuthError && err.oauthError === "invalid_grant") {
        // Uninstalled in Klaviyo, revoked, suspended, or unused for 90 days.
        await deps.db.update(table).set({ status: "needs_reauth", updatedAt: now() }).where(ours);
        throw new KlaviyoConnectionError("klaviyo_needs_reauth");
      }
      // Give the lease back so the next caller can try right away.
      await deps.db.update(table).set({ lastRefreshedAt: row.lastRefreshedAt }).where(ours);
      throw err;
    }

    // Step 3: store both tokens in one statement. If Klaviyo sent no new refresh token, the current one stays.
    await deps.db
      .update(table)
      .set({
        accessTokenEnc: await encryptToken(tokens.accessToken, key),
        refreshTokenEnc: tokens.refreshToken ? await encryptToken(tokens.refreshToken, key) : row.refreshTokenEnc,
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scope || row.scopes,
        updatedAt: now(),
      })
      .where(ours);
    // If that UPDATE matched nothing, the connection was replaced or removed
    // while we were refreshing; the token we got is still valid for this call.
    return tokens.accessToken;
  }
}

/** An access token provider bound to a shop, for KlaviyoClient. */
export function accessTokenProvider(deps: ConnectionDeps, shop: string): AccessTokenProvider {
  return (opts) => getAccessToken(deps, shop, opts);
}

/** A client that acts for the shop. `subrequestBudget` keeps a caller under the Worker's subrequest limit. */
export function createKlaviyoClient(
  deps: ConnectionDeps,
  shop: string,
  options: { subrequestBudget?: number } = {},
): KlaviyoClient {
  return new KlaviyoClient({
    getAccessToken: accessTokenProvider(deps, shop),
    fetch: deps.fetch,
    sleep: deps.sleep,
    // Pacing uses the same clock as the caller, so a test that controls time controls the rate limiter too.
    now: deps.now ? () => deps.now!().getTime() : undefined,
    subrequestBudget: options.subrequestBudget,
  });
}

/**
 * Disconnect (merchant action, or the Shopify uninstall webhook): revoke the
 * install at Klaviyo's /oauth/revoke, then delete the stored tokens.
 *
 * Safe to call at any time and more than once: with no connection it does
 * nothing, and when the revoke call fails (Klaviyo down, token already
 * revoked or the app already removed there) the row is deleted anyway, so we
 * never keep credentials we were asked to drop. `revoked` says whether Klaviyo
 * confirmed. Profiles stay suppressed: disconnecting never unsuppresses.
 */
export async function disconnect(deps: ConnectionDeps, shop: string): Promise<{ existed: boolean; revoked: boolean }> {
  const table = schema.klaviyoConnections;
  const row = await deps.db.query.klaviyoConnections.findFirst({ where: eq(table.shop, shop) });
  if (!row) return { existed: false, revoked: false };

  let revoked = false;
  try {
    const key = await importTokenKey(deps.env.TOKEN_ENCRYPTION_KEY);
    await revokeRefreshToken({
      credentials: credentials(deps.env),
      refreshToken: await decryptToken(row.refreshTokenEnc, key),
      fetch: deps.fetch,
    });
    revoked = true;
  } catch {
    revoked = false;
  }
  await deps.db.delete(table).where(eq(table.shop, shop));
  return { existed: true, revoked };
}
