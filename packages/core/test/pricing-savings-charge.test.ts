import { describe, expect, it } from "vitest";
import {
  assertValidPriceTable,
  chargeIdempotencyKey,
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
  quoteCharge,
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

describe("quoteCharge (flat price by list size)", () => {
  it("prices by list size at the tier boundaries", () => {
    expect(flatTierFor(1)?.monthlyCents).toBe(1_500);
    expect(flatTierFor(10_000)?.monthlyCents).toBe(1_500);
    expect(flatTierFor(10_001)?.monthlyCents).toBe(2_900);
    expect(flatTierFor(25_000)?.monthlyCents).toBe(2_900);
    expect(flatTierFor(25_001)?.monthlyCents).toBe(7_900);
    expect(flatTierFor(75_000)?.monthlyCents).toBe(7_900);
    expect(flatTierFor(75_001)?.monthlyCents).toBe(14_900);
    expect(flatTierFor(150_000)?.monthlyCents).toBe(14_900);
    expect(flatTierFor(150_001)).toBeNull();
    expect(FLAT_PRICE_TIERS.map((t) => t.monthlyCents)).toEqual([1_500, 2_900, 7_900, 14_900]);
  });
  it("charges the tier price when a cleanup suppressed profiles", () => {
    expect(quoteCharge({ activeProfiles: 8_000, profilesSuppressed: 200 }).feeCents).toBe(1_500);
    const q = quoteCharge({ activeProfiles: 12_400, profilesSuppressed: 3_500 });
    expect(q).toMatchObject({ feeCents: 2_900, listFeeCents: 2_900, capApplied: false, noChargeReason: null });
  });
  it("the fee does not depend on how many profiles were suppressed", () => {
    const few = quoteCharge({ activeProfiles: 60_000, profilesSuppressed: 1 });
    const many = quoteCharge({ activeProfiles: 60_000, profilesSuppressed: 40_000 });
    expect(few.feeCents).toBe(7_900);
    expect(many.feeCents).toBe(7_900);
  });
  it("charges nothing for a cycle without a cleanup", () => {
    expect(quoteCharge({ activeProfiles: 12_400, profilesSuppressed: 0 })).toMatchObject({ feeCents: 0, noChargeReason: "no_cleanup" });
    expect(quoteCharge({ activeProfiles: 12_400, profilesSuppressed: -3 })).toMatchObject({ feeCents: 0, noChargeReason: "no_cleanup" });
    expect(quoteCharge({ activeProfiles: 12_400, profilesSuppressed: Number.NaN })).toMatchObject({ feeCents: 0, noChargeReason: "no_cleanup" });
  });
  it("never charges automatically above the public tiers", () => {
    expect(quoteCharge({ activeProfiles: 150_001, profilesSuppressed: 10 })).toMatchObject({
      feeCents: 0,
      tier: null,
      noChargeReason: "above_price_tiers",
    });
  });
  it("respects what was already charged in the window", () => {
    const q = quoteCharge({ activeProfiles: 100_000, profilesSuppressed: 10, chargedInWindowCents: 10_000 });
    expect(q).toMatchObject({ feeCents: 4_900, capApplied: true });
    const full = quoteCharge({ activeProfiles: 100_000, profilesSuppressed: 10, chargedInWindowCents: 14_900 });
    expect(full).toMatchObject({ feeCents: 0, noChargeReason: "cap_reached" });
  });
  it("charges at most once per cycle", () => {
    const q = quoteCharge({ activeProfiles: 12_400, profilesSuppressed: 10, lastChargeAt: daysAgo(10), now: NOW });
    expect(q).toMatchObject({ feeCents: 0, noChargeReason: "already_charged_this_cycle" });
    const later = quoteCharge({ activeProfiles: 12_400, profilesSuppressed: 10, lastChargeAt: daysAgo(29), now: NOW });
    expect(later.feeCents).toBe(2_900);
  });
});

describe("formatting and keys", () => {
  it("formats cents", () => {
    expect(formatUsd(2_500)).toBe("$25");
    expect(formatUsd(123_450)).toBe("$1,234.50");
    expect(formatUsd(-5)).toBe("-$0.05");
  });
  it("builds deterministic idempotency keys under 255 chars", () => {
    const k = chargeIdempotencyKey("shop.myshopify.com", "run_123");
    expect(k).toBe(chargeIdempotencyKey("shop.myshopify.com", "run_123"));
    expect(k.length).toBeLessThanOrEqual(255);
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
