import { describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_TABLES,
  DEFAULT_FEE_POLICY,
  FLAT_PRICE_TIERS,
  KLAVIYO_EMAIL_2026_11,
  KLAVIYO_MARKETING_2026_11,
  flatTierFor,
  formatUsd as coreFormatUsd,
  tierFor,
} from "@tiersaver/core";
import {
  check,
  criteriaCount,
  describe as describeResult,
  FIELD_MESSAGES,
  fieldErrors,
  formatUsd,
  largestPublishedPlan,
  largestTierSaverPlan,
  parseCount,
  parsePercent,
  planRange,
  tableForPlan,
  type CheckInput,
} from "../src/check/check.js";
import { DEFAULT_EXAMPLE, SMALL_LIST_EXAMPLE, siteData } from "../src/data.js";

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
          if (meeting > active) {
            // More profiles than the list holds is reported as a mistake, never clamped in silence.
            expect(r.valid).toBe(false);
            return;
          }
          const after = active - meeting;
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

describe("TierSaver's flat price by list size comes from core's FLAT_PRICE_TIERS", () => {
  it("core has the four confirmed tiers", () => {
    expect(FLAT_PRICE_TIERS).toEqual([
      { maxProfiles: 10_000, monthlyCents: 900 },
      { maxProfiles: 25_000, monthlyCents: 1_900 },
      { maxProfiles: 75_000, monthlyCents: 3_900 },
      { maxProfiles: 150_000, monthlyCents: 7_900 },
    ]);
    expect(largestTierSaverPlan()).toBe(150_000);
  });

  it("the check returns core's own tier objects: no copy of the table, no second lookup", () => {
    for (const active of [0, 1, 8_000, 10_000, 10_001, 12_500, 25_000, 25_001, 75_000, 75_001, 150_000, 150_001, 400_000]) {
      const r = check({ activeProfiles: active, meetingCriteria: 0, unit: "profiles", plan: "email" });
      expect(r.tierSaverPlan).toBe(flatTierFor(active));
      if (r.tierSaverPlan) expect(FLAT_PRICE_TIERS).toContain(r.tierSaverPlan);
    }
  });

  it("uses inclusive upper bounds and 'contact us' above the largest plan", () => {
    const price = (active: number) =>
      describeResult(check({ activeProfiles: active, meetingCriteria: 1, unit: "profiles", plan: "email" })).tierSaverPrice;
    // Each boundary is read from core, so the check and the app agree on where a plan ends.
    const [a, b, c, d] = FLAT_PRICE_TIERS.map((t) => `${coreFormatUsd(t.monthlyCents)}/month`);
    expect([a, b, c, d]).toEqual(["$9/month", "$19/month", "$39/month", "$79/month"]);
    expect(price(1)).toBe(a);
    expect(price(SMALL_LIST_EXAMPLE)).toBe(a);
    expect(price(10_000)).toBe(a);
    expect(price(10_001)).toBe(b);
    expect(price(12_500)).toBe(b);
    expect(price(25_000)).toBe(b);
    expect(price(25_001)).toBe(c);
    expect(price(75_000)).toBe(c);
    expect(price(75_001)).toBe(d);
    expect(price(150_000)).toBe(d);
    expect(price(150_001)).toBe("Contact us");
  });

  it("describes each plan by the list sizes it covers", () => {
    expect(FLAT_PRICE_TIERS.map(planRange)).toEqual([
      "Up to 10,000",
      "10,001 to 25,000",
      "25,001 to 75,000",
      "75,001 to 150,000",
    ]);
    const view = (active: number) =>
      describeResult(check({ activeProfiles: active, meetingCriteria: 1, unit: "profiles", plan: "email" })).tierSaverPlan;
    expect(view(8_000)).toBe("Monthly plan for lists of up to 10,000 active profiles");
    expect(view(12_500)).toBe("Monthly plan for lists of 10,001 to 25,000 active profiles");
    expect(view(150_001)).toBe("Lists above 150,000 active profiles are quoted individually");
  });

  it("is set by the list's current size, not by how many profiles are suppressed", () => {
    const few = check({ activeProfiles: 30_000, meetingCriteria: 10, unit: "profiles", plan: "email" });
    const many = check({ activeProfiles: 30_000, meetingCriteria: 20_000, unit: "profiles", plan: "email" });
    expect(few.tierSaverPlan).toEqual(many.tierSaverPlan);
    expect(describeResult(many).tierSaverPrice).toBe("$39/month");
  });
});

describe("what the check never does", () => {
  it("computes no saving, price difference or fee derived from Klaviyo prices", () => {
    const r = check(DEFAULT_EXAMPLE);
    for (const key of Object.keys(r)) expect(key).not.toMatch(/saving|fee|keep|diff|delta/i);
    const view = describeResult(r);
    const text = Object.values(view).join(" ");
    expect(text).not.toMatch(/sav(e|ing)|you keep|cheaper|less/i);
  });

  it("shows Klaviyo plan sizes only: the one amount in the result is TierSaver's own price", () => {
    const tierSaverPrices = new Set(FLAT_PRICE_TIERS.map((t) => `$${t.monthlyCents / 100}/month`));
    for (const plan of ["email", "marketing", "free"] as const) {
      for (const active of [240, 8_000, 12_500, 50_000, 150_000, 180_000, 1_000_000]) {
        const view = describeResult(check({ activeProfiles: active, meetingCriteria: 1, unit: "profiles", plan }));
        const amounts = Object.values(view).join(" ").match(/[$][0-9,.]+[/]month/g) ?? [];
        for (const amount of amounts) expect(tierSaverPrices.has(amount), `${plan} ${active}: ${amount}`).toBe(true);
        expect(Object.values(view).join(" ").match(/[$]/g)?.length ?? 0).toBe(amounts.length);
        expect(view.klaviyoBefore).not.toMatch(/[$]|price|[/]mo/i);
        expect(view.klaviyoAfter).not.toMatch(/[$]|price|[/]mo/i);
      }
    }
    const view = describeResult(check(DEFAULT_EXAMPLE));
    expect(view.klaviyoBefore).toBe("Up to 12,500 profiles");
    expect(view.klaviyoAfter).toBe("Up to 10,000 profiles");
  });
});

describe("honest cases", () => {
  it("above 150,000 profiles: contact us, and no Klaviyo plan size is published", () => {
    const view = describeResult(check({ activeProfiles: 180_000, meetingCriteria: 10_000, unit: "profiles", plan: "email" }));
    expect(view.figure).toBe("170,000");
    expect(view.tierSaverPrice).toBe("Contact us");
    expect(view.klaviyoBefore).toBe("Above 150,000 profiles: no plan size is published");
    expect(view.klaviyoAfter).toBe("Above 150,000 profiles: no plan size is published");
  });

  it("free Klaviyo plan: no plan size is shown", () => {
    const view = describeResult(check({ activeProfiles: 240, meetingCriteria: 40, unit: "profiles", plan: "free" }));
    expect(view.figure).toBe("200");
    expect(view.klaviyoBefore).toBe("Free plan");
    expect(view.klaviyoAfter).toBe("Free plan");
  });

  it("nobody meets the criteria: nothing to suppress, and no plan starts without a first cleanup", () => {
    const view = describeResult(check({ activeProfiles: 9_000, meetingCriteria: 0, unit: "profiles", plan: "email" }));
    expect(view.figure).toBe("9,000");
    expect(view.message).toMatch(/nothing to suppress/);
    expect(view.message).toMatch(/The audit is free, and the plan only starts when you approve a first cleanup\./);
    expect(view.message).not.toMatch(/not charged/);
  });

  it("unusable input is reported, never computed", () => {
    for (const input of [
      { activeProfiles: Number.NaN, meetingCriteria: 10, unit: "profiles", plan: "email" },
      { activeProfiles: 1_000, meetingCriteria: -1, unit: "profiles", plan: "email" },
      { activeProfiles: 1_000, meetingCriteria: 101, unit: "percent", plan: "email" },
      { activeProfiles: 5_000, meetingCriteria: 6_000, unit: "profiles", plan: "email" },
    ] satisfies CheckInput[]) {
      const r = check(input);
      expect(r.valid).toBe(false);
      expect(describeResult(r).figure).toBe("Check the numbers");
    }
  });
});

describe("wording and field messages", () => {
  const view = (activeProfiles: number, meetingCriteria: number) =>
    describeResult(check({ activeProfiles, meetingCriteria, unit: "profiles", plan: "email" }));

  it("agrees in number when exactly one profile is involved", () => {
    const one = view(10_001, 1);
    expect(one.message).toBe(
      "1 of 10,001 profiles meets the cleanup criteria. It would be suppressed only after you approve a simulation. Nothing is deleted.",
    );
    expect(one.leaving).toBe("1 meets the cleanup criteria");
    expect(one.staying).toBe("10,000 stay active");
    expect(view(2, 1).staying).toBe("1 stays active");
    const many = view(10_000, 2_500);
    expect(many.message).toContain("2,500 of 10,000 profiles meet the cleanup criteria. They would be suppressed only after you approve");
    expect(many.leaving).toBe("2,500 meet the cleanup criteria");
  });

  it("says which field is wrong and why", () => {
    expect(fieldErrors("12,500", "2,500", "profiles")).toEqual({ active: null, criteria: null });
    expect(fieldErrors("abc", "2,500", "profiles")).toEqual({ active: FIELD_MESSAGES.wholeNumber, criteria: null });
    expect(fieldErrors("5,000", "6,000", "profiles")).toEqual({ active: null, criteria: FIELD_MESSAGES.tooLarge });
    expect(fieldErrors("5,000", "x", "profiles")).toEqual({ active: null, criteria: FIELD_MESSAGES.wholeNumber });
    expect(fieldErrors("5,000", "101", "percent")).toEqual({ active: null, criteria: FIELD_MESSAGES.percent });
    expect(fieldErrors("5,000", "12.5", "percent")).toEqual({ active: null, criteria: null });
    expect(fieldErrors("", "", "percent")).toEqual({ active: FIELD_MESSAGES.wholeNumber, criteria: FIELD_MESSAGES.percent });
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
  it("formats money with core's own formatter", () => {
    expect(formatUsd).toBe(coreFormatUsd);
    expect(formatUsd(1_900)).toBe("$19");
    expect(formatUsd(123_450)).toBe("$1,234.50");
  });
});

describe("default example rendered into the pages", () => {
  it("matches the live calculation", () => {
    const data = siteData();
    const view = describeResult(check(DEFAULT_EXAMPLE));
    expect(data["check.figure"]).toBe("10,000");
    expect(data["check.figure"]).toBe(view.figure);
    expect(data["check.tierSaverPrice"]).toBe("$19/month");
    expect(data["check.tierSaverPlan"]).toBe(view.tierSaverPlan);
    expect(data["plans.defaultExamplePrice"]).toBe("$19");
    expect(data["plans.smallExamplePrice"]).toBe("$9");
    expect(data["plans.lowestPrice"]).toBe(coreFormatUsd(FLAT_PRICE_TIERS[0]!.monthlyCents));
    expect(data["plan.intervalDays"]).toBe(String(DEFAULT_FEE_POLICY.billingIntervalDays));
    // The tokens of the per-cleanup model are gone.
    for (const token of ["fee.minDays", "fee.maxPerWindow", "fee.holdHours", "fee.windowDays"]) expect(data).not.toHaveProperty([token]);
    expect(data["check.klaviyoBefore"]).toBe("Up to 12,500 profiles");
    expect(data["check.klaviyoAfter"]).toBe("Up to 10,000 profiles");
    expect(data["check.keptPercent"]).toBe("80");
  });
});
