import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import { KLAVIYO_OAUTH_CALLBACK_PATH } from "./config";
import { completeAuthorization, getConnection, type ConnectionInfo, type KlaviyoSecrets } from "./connection.server";
import { KlaviyoError } from "./errors";
import {
  OAUTH_STATE_TTL_MS,
  createAuthorizationRequest,
  createStartTicket,
  verifyAuthorizationState,
  verifyAuthorizationStateForShop,
  verifyStartTicket,
} from "./oauth";

/**
 * The three HTTP steps that connect a shop to Klaviyo.
 *
 * The app is embedded in the Shopify admin, a third-party iframe: it cannot
 * navigate to Klaviyo itself and our cookies are not sent inside it. So:
 *
 * 1. START (top-level, `/klaviyo/oauth/start?ticket=`). The embedded page,
 *    authenticated by Shopify, links here with a signed ticket naming its
 *    shop. We set the browser-binding cookie and redirect to Klaviyo.
 * 2. CALLBACK (top-level, `/klaviyo/oauth/callback`). Klaviyo sends the
 *    browser back with `code` and `state`. We check the state against the
 *    cookie and hand both over to the embedded app; nothing is exchanged or
 *    stored here, because this request is not authenticated by Shopify.
 * 3. FINISH (embedded, `/app/klaviyo/finish`). Authenticated as a shop by
 *    Shopify. The state must have been issued for that same shop; only then
 *    is the code exchanged and the connection stored.
 *
 * Why step 3 exists: a start link can be sent to anyone. Without it, a person
 * tricked into opening someone else's link and approving on Klaviyo would
 * connect their Klaviyo account to the other party's shop. With it, the
 * connection is only ever stored for a shop whose admin the person is logged
 * in to.
 */

export const KLAVIYO_OAUTH_START_PATH = "/klaviyo/oauth/start";
export const KLAVIYO_OAUTH_FINISH_PATH = "/app/klaviyo/finish";

/** `__Host-`: Secure, no Domain, Path=/, so only this exact origin can set or read it. */
export const BINDING_COOKIE = "__Host-ts_klaviyo_oauth";

export interface FlowEnv extends KlaviyoSecrets {
  SHOPIFY_API_KEY: string;
  SHOPIFY_APP_URL: string;
}

const SHOP_PATTERN = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/;

function redirectUri(env: FlowEnv): string {
  return new URL(KLAVIYO_OAUTH_CALLBACK_PATH, env.SHOPIFY_APP_URL).toString();
}

/** URL of a path of the embedded app inside the Shopify admin of `shop`. */
export function embeddedAppUrl(env: Pick<FlowEnv, "SHOPIFY_API_KEY">, shop: string, path: string, query: Record<string, string> = {}): string {
  const handle = SHOP_PATTERN.exec(shop)?.[1];
  if (!handle) throw new KlaviyoError("klaviyo_oauth_invalid_shop");
  const url = new URL(`https://admin.shopify.com/store/${handle}/apps/${encodeURIComponent(env.SHOPIFY_API_KEY)}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

/** Link for the embedded page's "Connect Klaviyo" button (open with target="_top"). */
export async function klaviyoStartUrl(env: FlowEnv, shop: string, now = new Date()): Promise<string> {
  const url = new URL(KLAVIYO_OAUTH_START_PATH, env.SHOPIFY_APP_URL);
  url.searchParams.set("ticket", await createStartTicket({ shop, stateSecret: env.TOKEN_ENCRYPTION_KEY, now }));
  return url.toString();
}

function bindingCookie(value: string, maxAgeSeconds: number): string {
  return `${BINDING_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}

/** A dead end the merchant can recover from by going back to the app. Says nothing about why. */
function linkNoLongerValid(): Response {
  const body =
    "<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>TierSaver</title>" +
    "<p>This connection link is no longer valid. Open TierSaver in your Shopify admin and choose Connect Klaviyo again.</p>";
  return new Response(body, {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": bindingCookie("", 0),
    },
  });
}

/** Step 1. Never throws for a bad ticket: the answer is a page telling the merchant to start again. */
export async function startKlaviyoAuthorization(request: Request, env: FlowEnv, now = new Date()): Promise<Response> {
  let shop: string;
  try {
    ({ shop } = await verifyStartTicket({
      ticket: new URL(request.url).searchParams.get("ticket"),
      stateSecret: env.TOKEN_ENCRYPTION_KEY,
      now,
    }));
  } catch {
    return linkNoLongerValid();
  }
  const authorization = await createAuthorizationRequest({
    clientId: env.KLAVIYO_CLIENT_ID,
    redirectUri: redirectUri(env),
    shop,
    stateSecret: env.TOKEN_ENCRYPTION_KEY,
    now,
  });
  return redirect(authorization.url, {
    "Set-Cookie": bindingCookie(authorization.browserBinding, Math.floor(OAUTH_STATE_TTL_MS / 1000)),
    "Referrer-Policy": "no-referrer",
  });
}

/** Step 2. Forwards a verified `code` + `state` into the embedded app; the cookie has done its job and is cleared. */
export async function handleKlaviyoCallback(request: Request, env: FlowEnv, now = new Date()): Promise<Response> {
  const params = new URL(request.url).searchParams;
  let shop: string;
  try {
    ({ shop } = await verifyAuthorizationState({
      state: params.get("state"),
      browserBinding: readCookie(request, BINDING_COOKIE),
      stateSecret: env.TOKEN_ENCRYPTION_KEY,
      now,
    }));
  } catch {
    return linkNoLongerValid();
  }
  const clear = { "Set-Cookie": bindingCookie("", 0), "Referrer-Policy": "no-referrer" };

  const code = params.get("code");
  if (!code) {
    // The merchant declined on Klaviyo's consent screen, or Klaviyo reported an error.
    const reason = params.get("error") === "access_denied" ? "declined" : "failed";
    return redirect(embeddedAppUrl(env, shop, "/app", { klaviyo: reason }), clear);
  }
  return redirect(embeddedAppUrl(env, shop, KLAVIYO_OAUTH_FINISH_PATH, { code, state: params.get("state") ?? "" }), clear);
}

export type FinishResult = { ok: true; connection: ConnectionInfo } | { ok: false; code: string };

/** How long a later load of the finish step waits for the load that is doing the exchange. */
const FINISH_WAIT_MS = 12_000;
const FINISH_POLL_MS = 300;

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 3. `shop` MUST come from the Shopify session of the request
 * (`authenticate.admin`), never from the URL. The `shops` row must exist.
 * Errors come back as a code (no tokens, no free text) for the page to explain.
 *
 * Shopify's admin loads this step more than once and cancels the first load
 * (seen on 2026-11-25: cancelled 300 ms in, then loaded twice more), while
 * Klaviyo accepts an authorization code exactly once. So:
 * - the first request to claim the state does the exchange, inside
 *   `waitUntil`, so it finishes and is recorded even if its request is cancelled;
 * - every other request with the same state waits for that result and returns
 *   it. The code is never sent to Klaviyo twice, and a state is single-use.
 *
 * `onSettled` runs once, with the claiming request, when the exchange ends
 * (for the audit trail).
 */
export async function finishKlaviyoAuthorization(
  deps: {
    db: DrizzleD1Database<typeof schema>;
    env: FlowEnv;
    fetch?: typeof fetch;
    now?: () => Date;
    waitUntil?: (work: Promise<unknown>) => void;
    sleep?: (ms: number) => Promise<void>;
    onSettled?: (result: FinishResult) => Promise<void>;
  },
  args: { shop: string; code: string | null; state: string | null },
): Promise<FinishResult> {
  let codeVerifier: string;
  try {
    ({ codeVerifier } = await verifyAuthorizationStateForShop({
      state: args.state,
      shop: args.shop,
      stateSecret: deps.env.TOKEN_ENCRYPTION_KEY,
      now: deps.now?.(),
    }));
  } catch (error) {
    return { ok: false, code: error instanceof KlaviyoError ? error.code : "klaviyo_oauth_failed" };
  }
  if (!args.code) return { ok: false, code: "klaviyo_oauth_code_missing" };
  const code = args.code;

  const d1 = (deps.db as DrizzleD1Database<typeof schema> & { $client: D1Database }).$client;
  const stateHash = await sha256Hex(args.state ?? "");
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const work = (async (): Promise<FinishResult> => {
    const [, claim] = await d1.batch([
      d1.prepare("DELETE FROM klaviyo_oauth_attempts WHERE created_at < ?1").bind(nowMs - 24 * 60 * 60 * 1000),
      d1.prepare("INSERT INTO klaviyo_oauth_attempts (state_hash, shop, status, created_at) VALUES (?1, ?2, 'pending', ?3) ON CONFLICT (state_hash) DO NOTHING").bind(stateHash, args.shop, nowMs),
    ]);

    if (claim?.meta.changes === 1) {
      let result: FinishResult;
      try {
        const connection = await completeAuthorization(deps, { shop: args.shop, code, codeVerifier, redirectUri: redirectUri(deps.env) });
        result = { ok: true, connection };
      } catch (error) {
        result = { ok: false, code: error instanceof KlaviyoError ? error.code : "klaviyo_oauth_failed" };
      }
      await d1
        .prepare("UPDATE klaviyo_oauth_attempts SET status = ?1, error_code = ?2 WHERE state_hash = ?3")
        .bind(result.ok ? "connected" : "failed", result.ok ? null : result.code, stateHash)
        .run();
      await deps.onSettled?.(result).catch(() => undefined);
      return result;
    }

    // Another load of this step holds the claim: wait for what it decides.
    for (let waited = 0; ; waited += FINISH_POLL_MS) {
      const row = await d1.prepare("SELECT shop, status, error_code FROM klaviyo_oauth_attempts WHERE state_hash = ?1").bind(stateHash).first<{ shop: string; status: string; error_code: string | null }>();
      if (!row || row.shop !== args.shop) return { ok: false, code: "klaviyo_oauth_failed" };
      if (row.status === "failed") return { ok: false, code: row.error_code ?? "klaviyo_oauth_failed" };
      if (row.status === "connected") {
        const connection = await getConnection(deps.db, args.shop);
        return connection ? { ok: true, connection } : { ok: false, code: "klaviyo_oauth_failed" };
      }
      if (waited >= FINISH_WAIT_MS) return { ok: false, code: "klaviyo_oauth_in_progress" };
      await sleep(FINISH_POLL_MS);
    }
  })();
  // Keeps the exchange alive when the browser drops this request.
  deps.waitUntil?.(work.catch(() => undefined));
  return work;
}
