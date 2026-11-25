import { describe, expect, it } from "vitest";
import { KLAVIYO_EMAIL_2026_11, billableSavingsCents, hashEmail, normalizeEmail, verifiedSavings } from "../src/index.js";

const t = KLAVIYO_EMAIL_2026_11;

describe("verifiedSavings", () => {
  it("prices a confirmed tier drop", () => {
    expect(verifiedSavings({ tierMaxBefore: 12_500, tierMaxAfter: 10_000, table: t })).toMatchObject({
      monthlySavingsCents: 12_500,
      unavailableReason: null,
    });
  });
  it("reports no savings without a drop", () => {
    expect(verifiedSavings({ tierMaxBefore: 10_000, tierMaxAfter: 10_000, table: t }).unavailableReason).toBe("no_tier_drop");
    expect(verifiedSavings({ tierMaxBefore: 10_000, tierMaxAfter: 12_500, table: t }).monthlySavingsCents).toBe(0);
  });
  it("refuses tiers not in the table", () => {
    expect(verifiedSavings({ tierMaxBefore: 8_000, tierMaxAfter: 5_000, table: t }).unavailableReason).toBe("unknown_tier");
  });
});

describe("billableSavingsCents", () => {
  it("takes the lower of estimate and verification", () => {
    expect(billableSavingsCents({ approvedEstimateCents: 12_500, verifiedCents: 34_500 })).toBe(12_500);
    expect(billableSavingsCents({ approvedEstimateCents: 34_500, verifiedCents: 12_500 })).toBe(12_500);
    expect(billableSavingsCents({ approvedEstimateCents: 12_500, verifiedCents: 0 })).toBe(0);
  });
  it("caps by the merchant's real price when reported", () => {
    // Legacy discount: pays $200 instead of $275 list; new tier lists at $150.
    expect(
      billableSavingsCents({ approvedEstimateCents: 12_500, verifiedCents: 12_500, reportedCurrentPriceCents: 20_000, listPriceAfterCents: 15_000 }),
    ).toBe(5_000);
    expect(
      billableSavingsCents({ approvedEstimateCents: 12_500, verifiedCents: 12_500, reportedCurrentPriceCents: 14_000, listPriceAfterCents: 15_000 }),
    ).toBe(0);
  });
});

describe("hashEmail", () => {
  it("normalizes before hashing", async () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(await hashEmail("  Jane.Doe@Example.COM ")).toBe(await hashEmail("jane.doe@example.com"));
    expect(await hashEmail("a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
});
