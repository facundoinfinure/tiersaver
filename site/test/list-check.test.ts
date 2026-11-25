import { describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_TABLES,
  KLAVIYO_EMAIL_2026_11,
  KLAVIYO_MARKETING_2026_11,
  tierFor,
} from "@tiersaver/core";
import {
  check,
  criteriaCount,
  describe as describeResult,
  formatUsd,
  largestPublishedPlan,
  parseCount,
  parsePercent,
  tableForPlan,
  tierSaverPlanFor,
  type CheckInput,
} from "../src/check/check.js";
import { DEFAULT_EXAMPLE, siteData } from "../src/data.js";
import { TIERSAVER_PLANS } from "../src/site-config.js";

describe("Klaviyo plan sizes come from core's price table", () => {
  it("maps plans onto core's current price tables", () => {
    expect(tableForPlan("email")).toBe(KLAVIYO_EMAIL_2026_11);
    expect(tableForPlan("marketing")).toBe(KLAVIYO_MARKETING_2026_11);
    expect(largestPublishedPlan()).toBe(150_000);
    expect(check(DEFAULT_EXAMPLE).capturedOn).toBe(KLAVIYO_EMAIL_2026_11.capturedOn);
  });

  const actives = [0, 1, 250, 500, 501, 4_999, 10_000, 10_001, 12_500, 13_250, 27_400, 50_000, 99_999, 150_000, 150_001, 400_000];
  const criteria = [0, 1, 500, 2_500, 9_999, 30_000, 149_999, 300_000];
  for (const plan of ["email", "marketing"] as const) {
    for (const active of actives) {
      for (const meeting of criteria) {
        it(`${plan}: ${active} active, ${meeting} meet the criteria`, () => {
          const table = CURRENT_PRICE_TABLES[plan === "marketing" ? "email_sms" : "email"];
          const r = check({ activeProfiles: active, meetingCriteria: meeting, unit: "profiles", plan });
          const after = active - Math.min(meeting, active);
          expect(r.valid).toBe(true);
          expect(r.profilesAfter).toBe(after);
          expect(r.profilesSuppressed).toBe(active - after);
          // Same tier objects core returns: no re-implementation of the lookup.
          expect(r.klaviyoBefore).toBe(tierFor(active, table)?.tier ?? null);
          expect(r.klaviyoAfter).toBe(tierFor(after, table)?.tier ?? null);
          expect(r.beforeAbovePublished).toBe(tierFor(active, table) === null);
          expect(r.afterAbovePublished).toBe(tierFor(after, table) === null);
          expect(r.priceTableId).toBe(table.id);
        });
      }
    }
  }

  it("the two documented list sizes land on the plan sizes in core's table", () => {
    const a = check({ activeProfiles: 12_500, meetingCriteria: 2_500, unit: "profiles", plan: "email" });
    expect(a.klaviyoBefore).toEqual({ maxProfiles: 12_500, monthlyCents: 27_500, verified: true });
    expect(a.klaviyoAfter).toEqual({ maxProfiles: 10_000, monthlyCents: 15_000, verified: true });
    const b = check({ activeProfiles: 50_000, meetingCriteria: 30_000, unit: "profiles", plan: "email" });
    expect(b.klaviyoBefore).toEqual({ maxProfiles: 50_000, monthlyCents: 72_000, verified: true });
    expect(b.klaviyoAfter).toEqual({ maxProfiles: 20_000, monthlyCents: 37_500, verified: true });
  });
});

describe("TierSaver's flat price by list size (provisional plans in site-config)", () => {
  it("has the provisional plans", () => {
    expect(TIERSAVER_PLANS).toEqual([
      { maxProfiles: 25_000, monthlyCents: 2_900 },
      { maxProfiles: 75_000, monthlyCents: 7_900 },
      { maxProfiles: 150_000, monthlyCents: 14_900 },
    ]);
  });

  it("uses inclusive upper bounds and 'contact us' above the largest plan", () => {
    expect(tierSaverPlanFor(0)?.monthlyCents).toBe(2_900);
    expect(tierSaverPlanFor(25_000)?.monthlyCents).toBe(2_900);
    expect(tierSaverPlanFor(25_001)?.monthlyCents).toBe(7_900);
    expect(tierSaverPlanFor(75_000)?.monthlyCents).toBe(7_900);
    expect(tierSaverPlanFor(75_001)?.monthlyCents).toBe(14_900);
    expect(tierSaverPlanFor(150_000)?.monthlyCents).toBe(14_900);
    expect(tierSaverPlanFor(150_001)).toBeNull();
  });

  it("is set by the list's current size, not by how many profiles are suppressed", () => {
    const few = check({ activeProfiles: 30_000, meetingCriteria: 10, unit: "profiles", plan: "email" });
    const many = check({ activeProfiles: 30_000, meetingCriteria: 20_000, unit: "profiles", plan: "email" });
    expect(few.tierSaverPlan).toEqual(many.tierSaverPlan);
    expect(describeResult(many).tierSaverPrice).toBe("$79/month");
  });
});

describe("what the check never does", () => {
  it("computes no saving, price difference or fee derived from Klaviyo prices", () => {
    const r = check(DEFAULT_EXAMPLE);
    for (const key of Object.keys(r)) expect(key).not.toMatch(/saving|fee|keep|diff|delta/i);
    const view = describeResult(r);
    // $275 and $150 are shown as list prices; their difference must not appear anywhere.
    const text = Object.values(view).join(" ");
    expect(text).toContain("$275/mo list price");
    expect(text).toContain("$150/mo list price");
    expect(text).not.toContain("$125");
    expect(text).not.toMatch(/sav(e|ing)|you keep|cheaper|less/i);
  });
});

describe("honest cases", () => {
  it("above 150,000 profiles: contact us, and no Klaviyo plan size is published", () => {
    const view = describeResult(check({ activeProfiles: 180_000, meetingCriteria: 10_000, unit: "profiles", plan: "email" }));
    expect(view.figure).toBe("170,000");
    expect(view.tierSaverPrice).toBe("Contact us");
    expect(view.klaviyoBefore).toMatch(/custom pricing/);
    expect(view.klaviyoAfter).toMatch(/custom pricing/);
  });

  it("free Klaviyo plan: no plan size is shown", () => {
    const view = describeResult(check({ activeProfiles: 240, meetingCriteria: 40, unit: "profiles", plan: "free" }));
    expect(view.figure).toBe("200");
    expect(view.klaviyoBefore).toBe("Free plan");
    expect(view.klaviyoAfter).toBe("Free plan");
  });

  it("nobody meets the criteria: nothing to suppress, month not charged", () => {
    const view = describeResult(check({ activeProfiles: 9_000, meetingCriteria: 0, unit: "profiles", plan: "email" }));
    expect(view.figure).toBe("9,000");
    expect(view.message).toMatch(/nothing to suppress/);
    expect(view.message).toMatch(/not charged/);
  });

  it("unusable input is reported, never computed", () => {
    for (const input of [
      { activeProfiles: Number.NaN, meetingCriteria: 10, unit: "profiles", plan: "email" },
      { activeProfiles: 1_000, meetingCriteria: -1, unit: "profiles", plan: "email" },
      { activeProfiles: 1_000, meetingCriteria: 101, unit: "percent", plan: "email" },
    ] satisfies CheckInput[]) {
      const r = check(input);
      expect(r.valid).toBe(false);
      expect(describeResult(r).figure).toBe("Check the numbers");
    }
  });
});

describe("percentage input and parsing", () => {
  it("converts a percentage to whole profiles, rounding down", () => {
    expect(criteriaCount(12_500, 20, "percent")).toBe(2_500);
    expect(criteriaCount(999, 33.3, "percent")).toBe(332);
    expect(criteriaCount(1_000, 5_000, "profiles")).toBe(1_000);
  });
  it("20% of 12,500 gives the same result as 2,500 profiles", () => {
    expect(check({ activeProfiles: 12_500, meetingCriteria: 20, unit: "percent", plan: "email" })).toEqual(
      check(DEFAULT_EXAMPLE),
    );
  });
  it("parses counts and percentages", () => {
    expect(parseCount("12,500")).toBe(12_500);
    expect(parseCount(" 12 500 ")).toBe(12_500);
    expect(parseCount("12.5")).toBeNaN();
    expect(parseCount("")).toBeNaN();
    expect(parsePercent("20%")).toBe(20);
    expect(parsePercent("12.5")).toBe(12.5);
    expect(parsePercent("-3")).toBeNaN();
  });
  it("formats money", () => {
    expect(formatUsd(2_900)).toBe("$29");
    expect(formatUsd(123_450)).toBe("$1,234.50");
  });
});

describe("default example rendered into the pages", () => {
  it("matches the live calculation", () => {
    const data = siteData();
    const view = describeResult(check(DEFAULT_EXAMPLE));
    expect(data["check.figure"]).toBe("10,000");
    expect(data["check.figure"]).toBe(view.figure);
    expect(data["check.tierSaverPrice"]).toBe("$29/month");
    expect(data["check.klaviyoBefore"]).toBe("Up to 12,500 profiles ($275/mo list price)");
    expect(data["check.klaviyoAfter"]).toBe("Up to 10,000 profiles ($150/mo list price)");
    expect(data["check.keptPercent"]).toBe("80");
  });
});
