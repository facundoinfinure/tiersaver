import { describe, expect, it } from "vitest";
import {
  assertValidPriceTable,
  chargeIdempotencyKey,
  estimateSavings,
  formatUsd,
  KLAVIYO_EMAIL_2026_11_DRAFT,
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
  it("accepts the fixture and the draft table", () => {
    expect(() => assertValidPriceTable(TEST_TABLE)).not.toThrow();
    expect(() => assertValidPriceTable(KLAVIYO_EMAIL_2026_11_DRAFT)).not.toThrow();
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
  it("draft table is not marked verified", () => {
    expect(isTableFullyVerified(KLAVIYO_EMAIL_2026_11_DRAFT)).toBe(false);
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

describe("quoteCharge", () => {
  it("charges 20% of savings", () => {
    const q = quoteCharge({ monthlySavingsCents: 12_500 });
    expect(q.feeCents).toBe(2_500);
    expect(q.capApplied).toBe(false);
    expect(q.noChargeReason).toBeNull();
  });
  it("caps at $149 per window", () => {
    const q = quoteCharge({ monthlySavingsCents: 100_000 });
    expect(q.uncappedFeeCents).toBe(20_000);
    expect(q.feeCents).toBe(14_900);
    expect(q.capApplied).toBe(true);
  });
  it("respects what was already charged in the window", () => {
    const q = quoteCharge({ monthlySavingsCents: 50_000, chargedInWindowCents: 10_000 });
    expect(q.feeCents).toBe(4_900);
    const full = quoteCharge({ monthlySavingsCents: 50_000, chargedInWindowCents: 14_900 });
    expect(full.feeCents).toBe(0);
    expect(full.noChargeReason).toBe("cap_reached");
  });
  it("charges nothing without savings", () => {
    expect(quoteCharge({ monthlySavingsCents: 0 })).toMatchObject({ feeCents: 0, noChargeReason: "no_savings" });
    expect(quoteCharge({ monthlySavingsCents: -500 })).toMatchObject({ feeCents: 0, noChargeReason: "no_savings" });
  });
  it("charges at most once per cycle", () => {
    const q = quoteCharge({ monthlySavingsCents: 12_500, lastChargeAt: daysAgo(10), now: NOW });
    expect(q).toMatchObject({ feeCents: 0, noChargeReason: "already_charged_this_cycle" });
    const later = quoteCharge({ monthlySavingsCents: 12_500, lastChargeAt: daysAgo(29), now: NOW });
    expect(later.feeCents).toBe(2_500);
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
