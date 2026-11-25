import { describe, expect, it } from "vitest";
import {
  TokenBucket,
  chunk,
  formatCalendarDate as f,
  nextBillingDate,
  parseCalendarDate as d,
  planNextCleanup,
  retryDelayMs,
  todayInTimeZone,
} from "../src/index.js";

describe("nextBillingDate", () => {
  it("returns this month's date when still ahead", () => {
    expect(f(nextBillingDate(d("2026-11-10"), 15))).toBe("2026-11-15");
  });
  it("rolls to next month on or after the billing day", () => {
    expect(f(nextBillingDate(d("2026-11-15"), 15))).toBe("2026-12-15");
    expect(f(nextBillingDate(d("2026-12-20"), 15))).toBe("2027-01-15");
  });
  it("clamps day 31 to the end of short months", () => {
    expect(f(nextBillingDate(d("2027-02-01"), 31))).toBe("2027-02-28");
    expect(f(nextBillingDate(d("2028-02-01"), 30))).toBe("2028-02-29");
  });
  it("rejects invalid days", () => {
    expect(() => nextBillingDate(d("2026-11-01"), 0)).toThrow(RangeError);
    expect(() => nextBillingDate(d("2026-11-01"), 32)).toThrow(RangeError);
  });
});

describe("planNextCleanup", () => {
  const s = { billingDay: 20, leadDays: 5, minLeadDays: 4 };
  it("plans 5 days before billing", () => {
    expect(planNextCleanup(d("2026-11-01"), s)).toMatchObject({ runToday: false });
    expect(f(planNextCleanup(d("2026-11-01"), s).runOn)).toBe("2026-11-15");
  });
  it("runs today on the preferred date", () => {
    const p = planNextCleanup(d("2026-11-15"), s);
    expect(p.runToday).toBe(true);
    expect(f(p.billingDate)).toBe("2026-11-20");
  });
  it("runs today if inside the window but past the preferred date", () => {
    const p = planNextCleanup(d("2026-11-16"), s);
    expect(p.runToday).toBe(true);
    expect(f(p.runOn)).toBe("2026-11-16");
  });
  it("targets next cycle when too close to billing", () => {
    const p = planNextCleanup(d("2026-11-18"), s);
    expect(f(p.billingDate)).toBe("2026-12-20");
    expect(f(p.runOn)).toBe("2026-12-15");
  });
});

describe("todayInTimeZone", () => {
  it("uses the shop's calendar date", () => {
    const now = new Date("2026-11-25T02:00:00Z");
    expect(f(todayInTimeZone(now, "America/Los_Angeles"))).toBe("2026-11-24");
    expect(f(todayInTimeZone(now, "Asia/Tokyo"))).toBe("2026-11-25");
  });
});

describe("chunk", () => {
  it("splits into batches of 100", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i);
    expect(chunk(ids, 100).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunk([], 100)).toEqual([]);
    expect(() => chunk(ids, 0)).toThrow(RangeError);
  });
});

describe("retryDelayMs", () => {
  it("honors Retry-After", () => {
    expect(retryDelayMs(1, { retryAfterSeconds: 3 })).toBe(3000);
    expect(retryDelayMs(1, { retryAfterSeconds: 600 })).toBe(60_000);
  });
  it("backs off exponentially with jitter", () => {
    expect(retryDelayMs(1, { random: () => 0.999 })).toBe(999);
    expect(retryDelayMs(4, { random: () => 0.5 })).toBe(4000);
    expect(retryDelayMs(20, { random: () => 0.999 })).toBeLessThanOrEqual(60_000);
  });
});

describe("TokenBucket", () => {
  it("allows a burst then throttles to the steady rate", () => {
    let t = 0;
    const bucket = new TokenBucket(3, 12.5, () => t);
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([0, 0, 0]);
    const wait = bucket.tryTake();
    expect(wait).toBe(80);
    t += wait;
    expect(bucket.tryTake()).toBe(0);
  });
});
