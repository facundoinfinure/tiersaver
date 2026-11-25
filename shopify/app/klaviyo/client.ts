import { TokenBucket, retryDelayMs } from "@tiersaver/core";
import { ENDPOINTS, KLAVIYO_API_BASE_URL, KLAVIYO_MEDIA_TYPE, KLAVIYO_REVISION, type EndpointName } from "./config";
import { KlaviyoApiError, safeCode } from "./errors";

/**
 * JSON:API client for Klaviyo's /api/* endpoints.
 *
 * - Sends `Authorization: Bearer <token>` and the pinned `revision` header.
 * - Paces each endpoint class with a token bucket at half the published limit
 *   (Klaviyo uses fixed windows, so a full bucket plus its refill could
 *   otherwise double the limit).
 * - Retries 429 after `Retry-After` and 5xx / network errors with jittered
 *   exponential backoff, a few times and for a bounded total wait. Beyond that
 *   it throws a retryable error so the Workflow step retries later.
 * - On a 401 it asks for a refreshed token once and retries.
 * - Never loops over pages: every call is one request, and paginated readers
 *   return the cursor of the next page. A Worker invocation has a subrequest
 *   limit (50 on Workers Free, 1,000 on Paid), so long reads have to be
 *   resumed across invocations by the caller. `subrequestBudget` makes the
 *   client stop before it hits that limit.
 * - Errors carry a code only: no token, URL, email or Klaviyo free text.
 */

export type AccessTokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export interface KlaviyoClientOptions {
  getAccessToken: AccessTokenProvider;
  fetch?: typeof fetch;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Attempts per request, including the first. Default 4. */
  maxAttempts?: number;
  /** Upper bound for the time one request may spend waiting (pacing + retries). Default 20 s. */
  maxWaitMs?: number;
  /** Maximum number of HTTP requests this client may send. Default: unlimited. */
  subrequestBudget?: number;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
}

export type QueryValue = string | number | readonly string[] | null | undefined;

export interface KlaviyoRequest {
  endpoint: EndpointName;
  method?: "GET" | "POST";
  /** Path starting with /api/. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface JsonApiLinks {
  self?: string | null;
  next?: string | null;
  prev?: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class KlaviyoClient {
  private readonly getAccessToken: AccessTokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly timeoutMs: number;
  private readonly budget: number;
  private readonly buckets = new Map<EndpointName, TokenBucket>();
  private sent = 0;

  constructor(options: KlaviyoClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.maxWaitMs = options.maxWaitMs ?? 20_000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.budget = options.subrequestBudget ?? Number.POSITIVE_INFINITY;
  }

  /** HTTP requests sent so far, retries included (token refreshes are not counted). */
  get requestCount(): number {
    return this.sent;
  }

  private bucket(endpoint: EndpointName): TokenBucket {
    let bucket = this.buckets.get(endpoint);
    if (!bucket) {
      const limit = ENDPOINTS[endpoint];
      bucket = new TokenBucket(
        Math.max(1, Math.floor(limit.burstPerSecond / 2)),
        limit.steadyPerMinute / 60 / 2,
        this.now,
      );
      this.buckets.set(endpoint, bucket);
    }
    return bucket;
  }

  /** Sends one request (plus bounded retries) and returns the parsed JSON body, or null when there is none. */
  async request<T = unknown>(req: KlaviyoRequest): Promise<T | null> {
    const method = req.method ?? "GET";
    const url = buildUrl(req.path, req.query);
    const payload = req.body === undefined ? undefined : JSON.stringify(req.body);
    const bucket = this.bucket(req.endpoint);
    let waited = 0;
    let refreshed = false;
    let forceRefresh = false;

    const wait = async (ms: number, onTooLong: () => KlaviyoApiError) => {
      if (waited + ms > this.maxWaitMs) throw onTooLong();
      waited += ms;
      await this.sleep(ms);
    };

    for (let attempt = 1; ; attempt++) {
      for (let pause = bucket.tryTake(); pause > 0; pause = bucket.tryTake()) {
        await wait(pause, () => new KlaviyoApiError("klaviyo_rate_limited_locally", { retryable: true, retryAfterMs: pause }));
      }
      if (this.sent >= this.budget) {
        throw new KlaviyoApiError("klaviyo_subrequest_budget_exhausted", { retryable: true });
      }

      const token = await this.getAccessToken(forceRefresh ? { forceRefresh: true } : undefined);
      forceRefresh = false;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: KLAVIYO_MEDIA_TYPE,
        revision: KLAVIYO_REVISION,
      };
      if (payload !== undefined) headers["Content-Type"] = KLAVIYO_MEDIA_TYPE;

      const last = attempt >= this.maxAttempts;
      let res: Response;
      this.sent++;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        // Transport errors can quote the URL (which may hold ids); only a code survives.
        const error = new KlaviyoApiError("klaviyo_network_error", { retryable: true });
        if (last) throw error;
        await wait(retryDelayMs(attempt, { baseMs: 500, maxMs: 8000, random: this.random }), () => error);
        continue;
      }

      if (res.ok) return readJson<T>(res);

      const error = await apiError(res);
      if (res.status === 401 && !refreshed && !last) {
        // The stored token may have just expired or been replaced: get a fresh one, once.
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if (!error.retryable || last) throw error;
      const delay =
        error.retryAfterMs ?? retryDelayMs(attempt, { baseMs: 500, maxMs: 8000, random: this.random });
      await wait(delay, () => error);
    }
  }
}

function buildUrl(path: string, query: KlaviyoRequest["query"]): string {
  if (!path.startsWith("/api/")) throw new KlaviyoApiError("klaviyo_invalid_request_path");
  const url = new URL(path, KLAVIYO_API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : value.join(",");
    if (text !== "") url.searchParams.set(key, text);
  }
  return url.toString();
}

async function readJson<T>(res: Response): Promise<T | null> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new KlaviyoApiError("klaviyo_invalid_response", { status: res.status, retryable: true });
  }
}

async function apiError(res: Response): Promise<KlaviyoApiError> {
  let code = "error";
  try {
    const body = (await res.json()) as { errors?: { code?: unknown }[] };
    // Only the short `code` is kept. `title` and `detail` are free text and can quote emails.
    code = safeCode(body?.errors?.[0]?.code, "error");
  } catch {
    code = "error";
  }
  const retryAfterSeconds = Number(res.headers.get("Retry-After"));
  const hasRetryAfter = res.headers.has("Retry-After") && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0;
  return new KlaviyoApiError(`klaviyo_${res.status}_${code}`, {
    status: res.status,
    retryable: res.status === 429 || res.status === 408 || res.status >= 500,
    retryAfterMs: res.status === 429 && hasRetryAfter ? Math.ceil(retryAfterSeconds * 1000) : null,
  });
}

/** Cursor of the next page from a JSON:API `links.next` URL, or null on the last page. */
export function nextCursor(links: JsonApiLinks | null | undefined): string | null {
  const next = links?.next;
  if (typeof next !== "string" || !next) return null;
  try {
    return new URL(next, KLAVIYO_API_BASE_URL).searchParams.get("page[cursor]") || null;
  } catch {
    return null;
  }
}

/** A string literal for Klaviyo's filter syntax: double-quoted, with `\` and `"` escaped. */
export function filterString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** An unquoted RFC 3339 datetime for Klaviyo's filter syntax. */
export function filterDate(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
