import { describe, expect, it } from "vitest";
import { KLAVIYO_EMAIL_2026_11, hashEmail, normalizeEmail, verifiedSavings } from "../src/index.js";

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

describe("hashEmail", () => {
  it("normalizes before hashing", async () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(await hashEmail("  Jane.Doe@Example.COM ")).toBe(await hashEmail("jane.doe@example.com"));
    expect(await hashEmail("a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
});
