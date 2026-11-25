/**
 * Minimal Klaviyo REST client: one place for base URL, revision and auth,
 * client-side pacing under the published limits, and retries.
 *
 * Every dependency with side effects (fetch, sleep, clock, randomness, log) is
 * injected so the whole client is testable offline.
 */
import { TokenBucket, retryDelayMs } from "@tiersaver/core";
import { ENDPOINTS, KLAVIYO_BASE_URL, KLAVIYO_MEDIA_TYPE, KLAVIYO_REVISION, type EndpointName } from "./klaviyo-config.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  random?: () => number;
  log?: (message: string) => void;
  /** Total tries per request, first one included. */
  maxAttempts?: number;
  baseUrl?: string;
  revision?: string;
  requestTimeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null when the response has none (202 Accepted). */
  json: unknown;
}

export class KlaviyoApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  constructor(status: number, endpoint: string, detail: string) {
    super(`Klaviyo responded ${status} on ${endpoint}${detail ? `: ${detail}` : ""}`);
    this.name = "KlaviyoApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

/** Replaces every occurrence of the secret. Used on anything that is logged or persisted. */
export function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pulls the human-readable parts out of a JSON:API error body. */
function describeErrors(json: unknown): string {
  const errors = (json as { errors?: { code?: unknown; title?: unknown; detail?: unknown }[] } | null)?.errors;
  if (!Array.isArray(errors)) return "";
  return errors
    .slice(0, 5)
    .map((e) => [e.code, e.title, e.detail].filter((x) => typeof x === "string" && x).join(" - "))
    .join("; ");
}

export class KlaviyoClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly log: (message: string) => void;
  private readonly maxAttempts: number;
  private readonly baseUrl: string;
  private readonly revision: string;
  private readonly requestTimeoutMs: number;
  private readonly buckets = new Map<EndpointName, { burst: TokenBucket; steady: TokenBucket }>();
  /** Number of HTTP requests actually sent, retries included. */
  requestCount = 0;

  constructor(options: ClientOptions) {
    if (!options.apiKey) throw new Error("KlaviyoClient needs an API key");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.clock = options.clock ?? Date.now;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? (() => {});
    this.maxAttempts = options.maxAttempts ?? 6;
    this.baseUrl = options.baseUrl ?? KLAVIYO_BASE_URL;
    this.revision = options.revision ?? KLAVIYO_REVISION;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  /**
   * Klaviyo uses fixed windows (1 s burst, 1 min steady). A token bucket that
   * starts full can emit capacity + refill inside one window, so each bucket
   * holds and refills half the published limit: worst case equals the limit.
   */
  private bucketsFor(endpoint: EndpointName): { burst: TokenBucket; steady: TokenBucket } {
    let pair = this.buckets.get(endpoint);
    if (!pair) {
      const { burstPerSecond, steadyPerMinute } = ENDPOINTS[endpoint].rate;
      const burstCapacity = Math.max(1, Math.floor(burstPerSecond / 2));
      const steadyCapacity = Math.max(1, Math.floor(steadyPerMinute / 2));
      pair = {
        burst: new TokenBucket(burstCapacity, burstPerSecond / 2, this.clock),
        steady: new TokenBucket(steadyCapacity, steadyPerMinute / 2 / 60, this.clock),
      };
      this.buckets.set(endpoint, pair);
    }
    return pair;
  }

  private async pace(endpoint: EndpointName): Promise<void> {
    const { burst, steady } = this.bucketsFor(endpoint);
    for (const bucket of [steady, burst]) {
      for (;;) {
        const waitMs = bucket.tryTake();
        if (waitMs === 0) break;
        await this.sleep(waitMs);
      }
    }
  }

  private safe(text: string): string {
    return redactSecret(text, this.apiKey);
  }

  /**
   * Sends one request, retrying on 429 (honouring Retry-After), on 5xx and on
   * network errors (exponential backoff with jitter). Any other 4xx throws at
   * once: retrying a rejected payload cannot help.
   *
   * Retrying writes is safe here because every write the seed makes is
   * idempotent (profile upsert by email, events with a unique_id, consent,
   * suppression).
   */
  async request(method: "GET" | "POST", endpoint: EndpointName, pathSuffix = "", options: RequestOptions = {}): Promise<ApiResponse> {
    const url = new URL(`${ENDPOINTS[endpoint].path}${pathSuffix}`, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const label = `${method} ${url.pathname}`;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    for (let attempt = 1; ; attempt += 1) {
      await this.pace(endpoint);
      this.requestCount += 1;

      let response: Response | null = null;
      let networkError = "";
      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Klaviyo-API-Key ${this.apiKey}`,
            revision: this.revision,
            Accept: KLAVIYO_MEDIA_TYPE,
            ...(body === undefined ? {} : { "Content-Type": KLAVIYO_MEDIA_TYPE }),
          },
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        networkError = this.safe(error instanceof Error ? `${error.name}: ${error.message}` : "unknown network error");
      }

      if (response && response.status < 400) {
        const text = await response.text();
        let json: unknown = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            throw new KlaviyoApiError(response.status, label, "response body is not valid JSON");
          }
        }
        return { status: response.status, headers: response.headers, json };
      }

      const status = response?.status ?? 0;
      const retryable = !response || status === 429 || status >= 500;
      let detail = networkError;
      if (response) {
        const text = await response.text().catch(() => "");
        try {
          detail = describeErrors(JSON.parse(text));
        } catch {
          detail = "";
        }
      }
      if (!retryable || attempt >= this.maxAttempts) {
        throw new KlaviyoApiError(status, label, this.safe(detail));
      }

      const retryAfterHeader = response?.headers.get("Retry-After");
      const retryAfterSeconds = status === 429 && retryAfterHeader ? Number(retryAfterHeader) : null;
      const delayMs = retryDelayMs(attempt, { retryAfterSeconds, random: this.random });
      this.log(
        `${label}: ${response ? `HTTP ${status}` : networkError}; retry ${attempt}/${this.maxAttempts - 1} in ${Math.ceil(delayMs / 1000)}s`,
      );
      await this.sleep(delayMs);
    }
  }
}
