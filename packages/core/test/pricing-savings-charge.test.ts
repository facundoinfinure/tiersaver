import { describe, expect, it } from "vitest";
import {
  assertValidPriceTable,
  DEFAULT_FEE_POLICY,
  FLAT_PRICE_TIERS,
  flatTierFor,
  estimateSavings,
  formatUsd,
  KLAVIYO_EMAIL_2026_11,
  KLAVIYO_MARKETING_2026_11,
  isKnownTierBoundary,
  isTableFullyVerified,
  PriceTableError,
  profilesToDropOneTier,
  planCoverage,
  quotePlan,
  flatTierForPrice,
  tierFor,
  tierProximity,
  type PriceTable,
} from "../src/index.js";
import { NOW, TEST_TABLE, daysAgo } from "./fixtures.js";

describe("tierFor", () => {
  it("uses inclusive upper bounds", () => {
    expect(tierFor(10_000, TEST_TABLE)?.tier.monthlyCents).toBe(15_000);
    expect(tierFor(10_001, TEST_TABLE)?.tier.monthlyCents).toBe(27_500);
    expect(tierFor(0, TEST_TABLE)?.index).toBe(0);
  });
  it("returns null above the largest known tier", () => {
    expect(tierFor(50_001, TEST_TABLE)).toBeNull();
  });
  it("rejects negative counts", () => {
    expect(() => tierFor(-1, TEST_TABLE)).toThrow(RangeError);
  });
});

describe("assertValidPriceTable", () => {
  it("accepts the fixture and the official tables", () => {
    expect(() => assertValidPriceTable(TEST_TABLE)).not.toThrow();
    expect(() => assertValidPriceTable(KLAVIYO_EMAIL_2026_11)).not.toThrow();
    expect(() => assertValidPriceTable(KLAVIYO_MARKETING_2026_11)).not.toThrow();
  });
  it("rejects unsorted tiers and decreasing prices", () => {
    const bad: PriceTable = { ...TEST_TABLE, tiers: [TEST_TABLE.tiers[1]!, TEST_TABLE.tiers[0]!] };
    expect(() => assertValidPriceTable(bad)).toThrow(PriceTableError);
    const cheaper: PriceTable = {
      ...TEST_TABLE,
      tiers: [
        { maxProfiles: 10, monthlyCents: 500, verified: true },
        { maxProfiles: 20, monthlyCents: 400, verified: true },
      ],
    };
    expect(() => assertValidPriceTable(cheaper)).toThrow(PriceTableError);
  });
  it("official tables are fully verified and cover 500–150,000", () => {
    for (const t of [KLAVIYO_EMAIL_2026_11, KLAVIYO_MARKETING_2026_11]) {
      expect(isTableFullyVerified(t)).toBe(true);
      expect(t.tiers).toHaveLength(49);
      expect(t.tiers[0]!.maxProfiles).toBe(500);
      expect(t.tiers.at(-1)!.maxProfiles).toBe(150_000);
    }
  });
});

describe("tierProximity", () => {
  it("flags lists within 5% of the next tier", () => {
    const p = tierProximity(9_600, TEST_TABLE)!;
    expect(p.headroom).toBe(400);
    expect(p.nearNextTier).toBe(true);
    expect(p.nextTierDeltaCents).toBe(12_500);
    expect(tierProximity(9_400, TEST_TABLE)!.nearNextTier).toBe(false);
  });
  it("never flags the largest tier", () => {
    expect(tierProximity(49_999, TEST_TABLE)!.nearNextTier).toBe(false);
  });
});

describe("estimateSavings", () => {
  it("matches the handover example: 12,500 → 10,000 saves $125", () => {
    const s = estimateSavings({ profilesBefore: 12_500, profilesRemoved: 2_500, table: TEST_TABLE });
    expect(s.monthlySavingsCents).toBe(12_500);
    expect(s.tierBefore?.maxProfiles).toBe(12_500);
    expect(s.tierAfter?.maxProfiles).toBe(10_000);
    expect(s.isEstimate).toBe(true);
  });
  it("is zero when the tier does not change", () => {
    const s = estimateSavings({ profilesBefore: 12_000, profilesRemoved: 1_000, table: TEST_TABLE });
    expect(s.monthlySavingsCents).toBe(0);
    expect(s.unavailableReason).toBe("no_change");
  });
  it("is zero on the free plan", () => {
    const s = estimateSavings({ profilesBefore: 12_000, profilesRemoved: 5_000, table: TEST_TABLE, onFreePlan: true });
    expect(s.monthlySavingsCents).toBe(0);
    expect(s.unavailableReason).toBe("free_plan");
  });
  it("is zero when outside known tiers (conservative)", () => {
    const s = estimateSavings({ profilesBefore: 80_000, profilesRemoved: 60_000, table: TEST_TABLE });
    expect(s.monthlySavingsCents).toBe(0);
    expect(s.unavailableReason).toBe("above_known_tiers");
  });
  it("never goes below zero profiles", () => {
    const s = estimateSavings({ profilesBefore: 100, profilesRemoved: 1_000, table: TEST_TABLE });
    expect(s.profilesAfter).toBe(0);
  });
});

describe("profilesToDropOneTier", () => {
  it("counts profiles above the lower tier bound", () => {
    expect(profilesToDropOneTier(11_240, TEST_TABLE)).toBe(1_240);
    expect(profilesToDropOneTier(400, TEST_TABLE)).toBeNull();
  });
});

describe("monthly plan by list size (owner's decision of 2026-11-26)", () => {
  it("prices by list size at the tier boundaries: $9 / $19 / $39 / $79 per month", () => {
    expect(flatTierFor(0)?.monthlyCents).toBe(900);
    expect(flatTierFor(1)?.monthlyCents).toBe(900);
    expect(flatTierFor(10_000)?.monthlyCents).toBe(900);
    expect(flatTierFor(10_001)?.monthlyCents).toBe(1_900);
    expect(flatTierFor(25_000)?.monthlyCents).toBe(1_900);
    expect(flatTierFor(25_001)?.monthlyCents).toBe(3_900);
    expect(flatTierFor(75_000)?.monthlyCents).toBe(3_900);
    expect(flatTierFor(75_001)?.monthlyCents).toBe(7_900);
    expect(flatTierFor(150_000)?.monthlyCents).toBe(7_900);
    expect(flatTierFor(150_001)).toBeNull();
    expect(FLAT_PRICE_TIERS).toEqual([
      { maxProfiles: 10_000, monthlyCents: 900 },
      { maxProfiles: 25_000, monthlyCents: 1_900 },
      { maxProfiles: 75_000, monthlyCents: 3_900 },
      { maxProfiles: 150_000, monthlyCents: 7_900 },
    ]);
  });
  it("the plan is charged every 30 days and has no per-cleanup concepts left", () => {
    expect(DEFAULT_FEE_POLICY).toEqual({ tiers: FLAT_PRICE_TIERS, billingIntervalDays: 30 });
    expect(Object.keys(DEFAULT_FEE_POLICY)).not.toContain("minDaysBetweenCharges");
    expect(Object.keys(DEFAULT_FEE_POLICY)).not.toContain("windowCapCents");
  });
  it("quotes the plan a list needs, and nothing above the public tiers", () => {
    expect(quotePlan(8_000)).toEqual({ activeProfiles: 8_000, tier: FLAT_PRICE_TIERS[0], monthlyCents: 900 });
    expect(quotePlan(60_000.2)).toMatchObject({ activeProfiles: 60_001, monthlyCents: 3_900 });
    expect(quotePlan(150_001)).toEqual({ activeProfiles: 150_001, tier: null, monthlyCents: 0 });
  });
  it("finds the tier of a plan by its price", () => {
    expect(flatTierForPrice(1_900)?.maxProfiles).toBe(25_000);
    expect(flatTierForPrice(1_500)).toBeNull();
  });
  it("no plan: no cleanup", () => {
    expect(planCoverage(null, 8_000)).toEqual({ covered: false, reason: "no_plan", requiredCents: 900 });
    expect(planCoverage(Number.NaN, 8_000)).toMatchObject({ covered: false, reason: "no_plan" });
  });
  it("a plan covers a list when its price is at least the price of the list's tier", () => {
    expect(planCoverage(900, 10_000)).toEqual({ covered: true, overpaying: false, requiredCents: 900 });
    expect(planCoverage(1_900, 12_400)).toEqual({ covered: true, overpaying: false, requiredCents: 1_900 });
  });
  it("the list moved to a higher tier: the plan no longer covers it", () => {
    expect(planCoverage(900, 10_001)).toEqual({ covered: false, reason: "plan_price_too_low", requiredCents: 1_900 });
    expect(planCoverage(3_900, 75_001)).toEqual({ covered: false, reason: "plan_price_too_low", requiredCents: 7_900 });
  });
  it("the list moved to a lower tier: covered, and flagged so the merchant is told", () => {
    expect(planCoverage(1_900, 9_000)).toEqual({ covered: true, overpaying: true, requiredCents: 900 });
  });
  it("above the public tiers nothing covers the list, whatever the plan", () => {
    expect(planCoverage(7_900, 150_001)).toEqual({ covered: false, reason: "above_price_tiers", requiredCents: null });
    expect(planCoverage(null, 150_001)).toEqual({ covered: false, reason: "above_price_tiers", requiredCents: null });
  });
});

describe("formatting", () => {
  it("formats cents", () => {
    expect(formatUsd(900)).toBe("$9");
    expect(formatUsd(2_500)).toBe("$25");
    expect(formatUsd(123_450)).toBe("$1,234.50");
    expect(formatUsd(-5)).toBe("-$0.05");
  });
});

describe("official Klaviyo Email table (2026-11-25)", () => {
  const t = KLAVIYO_EMAIL_2026_11;
  it("reproduces the handover examples", () => {
    expect(estimateSavings({ profilesBefore: 12_500, profilesRemoved: 2_500, table: t }).monthlySavingsCents).toBe(12_500);
    expect(estimateSavings({ profilesBefore: 50_000, profilesRemoved: 30_000, table: t }).monthlySavingsCents).toBe(34_500);
  });
  it("prices known points", () => {
    expect(tierFor(150_000, t)?.tier.monthlyCents).toBe(195_500);
    expect(tierFor(10_000, t)?.tier.monthlyCents).toBe(15_000);
    expect(tierFor(10_001, t)?.tier.monthlyCents).toBe(17_500);
    expect(tierFor(150_001, t)).toBeNull();
  });
  it("recognizes real tier boundaries only", () => {
    expect(isKnownTierBoundary(12_500, t)).toBe(true);
    expect(isKnownTierBoundary(12_000, t)).toBe(true);
    expect(isKnownTierBoundary(8_000, t)).toBe(false);
  });
});
