/**
 * Typed errors for the Klaviyo layer.
 *
 * `message` is always the machine-readable `code` and nothing else. Access
 * tokens, refresh tokens, emails, request URLs (their filters can hold ids or
 * emails) and Klaviyo's free-text `detail` never go into an error, so an error
 * can be logged or stored in `runs.last_error` as is.
 */
export class KlaviyoError extends Error {
  readonly code: string;
  /** True when the same call may succeed later (rate limit, 5xx, network, contention). */
  readonly retryable: boolean;
  readonly status: number | null;
  /** How long Klaviyo asked us to wait, when it said so. */
  readonly retryAfterMs: number | null;

  constructor(code: string, opts: { retryable?: boolean; status?: number | null; retryAfterMs?: number | null } = {}) {
    super(code);
    this.name = "KlaviyoError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** A non-2xx answer from /api/*, or a transport failure reaching it. */
export class KlaviyoApiError extends KlaviyoError {
  constructor(code: string, opts: { retryable?: boolean; status?: number | null; retryAfterMs?: number | null } = {}) {
    super(code, opts);
    this.name = "KlaviyoApiError";
  }
}

/** A failure of the OAuth flow: state validation, token endpoint, revoke. */
export class KlaviyoOAuthError extends KlaviyoError {
  /** RFC 6749 `error` value from the token endpoint, when there was one. */
  readonly oauthError: string | null;

  constructor(
    code: string,
    opts: { retryable?: boolean; status?: number | null; retryAfterMs?: number | null; oauthError?: string | null } = {},
  ) {
    super(code, opts);
    this.name = "KlaviyoOAuthError";
    this.oauthError = opts.oauthError ?? null;
  }
}

/** The shop has no usable Klaviyo connection. */
export class KlaviyoConnectionError extends KlaviyoError {
  constructor(code: string, opts: { retryable?: boolean } = {}) {
    super(code, opts);
    this.name = "KlaviyoConnectionError";
  }
}

/**
 * Accepts a provider error code only if it already is a short lowercase
 * identifier (`not_found`, `throttled`, `invalid_grant`...). Anything else,
 * including free text that could carry personal data, becomes `fallback`.
 */
export function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : fallback;
}
