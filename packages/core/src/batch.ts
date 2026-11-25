/** Batching and retry helpers for rate-limited bulk work. */

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Delay before retry `attempt` (1-based). Honors a Retry-After value in seconds
 * when present; otherwise exponential backoff with full jitter, capped.
 */
export function retryDelayMs(
  attempt: number,
  opts: { retryAfterSeconds?: number | null; baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const maxMs = opts.maxMs ?? 60_000;
  if (opts.retryAfterSeconds != null && Number.isFinite(opts.retryAfterSeconds) && opts.retryAfterSeconds >= 0) {
    return Math.min(maxMs, Math.ceil(opts.retryAfterSeconds * 1000));
  }
  const base = opts.baseMs ?? 1000;
  const random = opts.random ?? Math.random;
  const ceiling = Math.min(maxMs, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * Simple token bucket so a worker stays under a provider's steady rate limit.
 * Time is injected to keep it testable.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = clock();
  }

  private refill(): void {
    const now = this.clock();
    const elapsed = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.last = now;
  }

  /** Returns 0 if a token was taken, otherwise ms to wait before trying again. */
  tryTake(): number {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
  }
}
