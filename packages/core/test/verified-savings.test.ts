import { describe, expect, it } from "vitest";
import { KLAVIYO_EMAIL_2026_11, hashEmail, importHashKey, normalizeEmail, verifiedSavings } from "../src/index.js";

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
    const key = await importHashKey("a-test-key-of-enough-length");
    expect(await hashEmail("  Jane.Doe@Example.COM ", key)).toBe(await hashEmail("jane.doe@example.com", key));
    expect(await hashEmail("a@b.co", key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("depends on the key, and refuses a missing or short one", async () => {
    const a = await importHashKey("a-test-key-of-enough-length");
    const b = await importHashKey("another-key-of-enough-length");
    expect(await hashEmail("a@b.co", a)).not.toBe(await hashEmail("a@b.co", b));
    await expect(importHashKey("")).rejects.toThrow();
    await expect(importHashKey("short")).rejects.toThrow();
  });
});
