import { describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_TABLES,
  DEFAULT_FEE_POLICY,
  KLAVIYO_EMAIL_2026_11,
  KLAVIYO_MARKETING_2026_11,
  estimateSavings,
  formatUsd,
  quoteCharge,
  tierFor,
} from "@tiersaver/core";
import {
  calculate,
  describe as describeResult,
  inactiveCount,
  largestKnownTier,
  parseCount,
  parsePercent,
  tableForPlan,
  type CalculatorInput,
} from "../src/calculator/estimate.js";
import { DOCUMENTED_EXAMPLES, siteData } from "../src/data.js";

/** What core says, computed here without going through the calculator. */
function core(profilesBefore: number, profilesRemoved: number, plan: "email" | "email_sms", onFreePlan = false) {
  const table = CURRENT_PRICE_TABLES[plan];
  const savings = estimateSavings({ profilesBefore, profilesRemoved, table, onFreePlan });
  const charge = quoteCharge({ monthlySavingsCents: savings.monthlySavingsCents });
  return { savings, charge };
}

describe("calculator uses core's tables and policy", () => {
  it("maps plans onto core's current price tables", () => {
    expect(tableForPlan("email")).toBe(KLAVIYO_EMAIL_2026_11);
    expect(tableForPlan("marketing")).toBe(KLAVIYO_MARKETING_2026_11);
    expect(largestKnownTier()).toBe(150_000);
  });
});

describe("documented examples (docs/04-PRECIO-Y-COBRO.md)", () => {
  it("12,500 to 10,000 on the Email plan saves $125; fee $25; merchant keeps $100", () => {
    const r = calculate(DOCUMENTED_EXAMPLES.ex1);
    expect(r.status).toBe("saving");
    expect(r.profilesAfter).toBe(10_000);
    expect(r.tierBefore?.monthlyCents).toBe(27_500);
    expect(r.tierAfter?.monthlyCents).toBe(15_000);
    expect(r.monthlySavingsCents).toBe(12_500);
    expect(r.feeCents).toBe(2_500);
    expect(r.keepCents).toBe(10_000);
    expect(r.capApplied).toBe(false);
  });

  it("50,000 to 20,000 on the Email plan saves $345; fee $69", () => {
    const r = calculate(DOCUMENTED_EXAMPLES.ex2);
    expect(r.status).toBe("saving");
    expect(r.profilesAfter).toBe(20_000);
    expect(r.monthlySavingsCents).toBe(34_500);
    expect(r.feeCents).toBe(6_900);
    expect(r.keepCents).toBe(27_600);
  });

  it("a $1,000 saving is charged the $149 cap", () => {
    const q = quoteCharge({ monthlySavingsCents: 100_000 });
    expect(q.feeCents).toBe(14_900);
    expect(siteData()["fee.capExampleFee"]).toBe("$149");
  });
});

describe("calculator equals core for a grid of cases", () => {
  const actives = [0, 1, 250, 500, 501, 4_999, 10_000, 10_001, 12_500, 13_250, 27_400, 50_000, 99_999, 150_000];
  const removals = [0, 1, 500, 2_500, 9_999, 30_000, 149_999];
  for (const plan of ["email", "marketing"] as const) {
    for (const active of actives) {
      for (const removed of removals) {
        it(`${plan}: ${active} active, ${removed} stopped engaging`, () => {
          const r = calculate({ activeProfiles: active, inactive: removed, inactiveUnit: "profiles", plan });
          const expected = core(active, Math.min(removed, active), plan === "marketing" ? "email_sms" : "email");
          expect(r.monthlySavingsCents).toBe(expected.savings.monthlySavingsCents);
          expect(r.feeCents).toBe(expected.charge.feeCents);
          expect(r.capApplied).toBe(expected.charge.capApplied);
          expect(r.keepCents).toBe(expected.savings.monthlySavingsCents - expected.charge.feeCents);
          expect(r.tierBefore).toEqual(expected.savings.tierBefore);
          expect(r.tierAfter).toEqual(expected.savings.tierAfter);
          expect(r.profilesAfter).toBe(expected.savings.profilesAfter);
          expect(r.status).toBe(expected.savings.unavailableReason ?? "saving");
          expect(r.priceTableId).toBe(expected.savings.priceTableId);
          expect(r.isEstimate).toBe(true);
        });
      }
    }
  }
});

describe("honest cases", () => {
  it("free plan: no saving, no fee", () => {
    const r = calculate({ activeProfiles: 240, inactive: 100, inactiveUnit: "profiles", plan: "free" });
    expect(r.status).toBe("free_plan");
    expect(r.monthlySavingsCents).toBe(0);
    expect(r.feeCents).toBe(0);
    expect(describeResult(r).message).toMatch(/would not charge/);
  });

  it("above 150,000 profiles: custom pricing, no estimate", () => {
    const r = calculate({ activeProfiles: 150_001, inactive: 60_000, inactiveUnit: "profiles", plan: "email" });
    expect(r.status).toBe("above_known_tiers");
    expect(r.monthlySavingsCents).toBe(0);
    expect(r.feeCents).toBe(0);
    const view = describeResult(r);
    expect(view.figure).toBe("No estimate");
    expect(view.message).toMatch(/150,000/);
    expect(view.message).toMatch(/custom pricing/);
  });

  it("no tier change: you would not be charged", () => {
    const r = calculate({ activeProfiles: 9_000, inactive: 1_000, inactiveUnit: "profiles", plan: "email" });
    expect(r.status).toBe("no_change");
    expect(r.feeCents).toBe(0);
    expect(describeResult(r).message).toMatch(/You would not be charged/);
  });

  it("the cap limits the fee on large savings", () => {
    const r = calculate({ activeProfiles: 150_000, inactive: 100_000, inactiveUnit: "profiles", plan: "email" });
    const expected = core(150_000, 100_000, "email");
    expect(expected.savings.monthlySavingsCents).toBeGreaterThan(74_500);
    expect(r.feeCents).toBe(DEFAULT_FEE_POLICY.windowCapCents);
    expect(r.capApplied).toBe(true);
    expect(describeResult(r).fee).toBe("$149 (cap reached)");
  });

  it("unusable input is reported, never estimated", () => {
    for (const input of [
      { activeProfiles: Number.NaN, inactive: 10, inactiveUnit: "profiles", plan: "email" },
      { activeProfiles: 1_000, inactive: -1, inactiveUnit: "profiles", plan: "email" },
      { activeProfiles: 1_000, inactive: 101, inactiveUnit: "percent", plan: "email" },
    ] satisfies CalculatorInput[]) {
      const r = calculate(input);
      expect(r.status).toBe("invalid");
      expect(r.monthlySavingsCents).toBe(0);
      expect(r.feeCents).toBe(0);
    }
  });
});

describe("percentage input", () => {
  it("converts a percentage to whole profiles, rounding down", () => {
    expect(inactiveCount(12_500, 20, "percent")).toBe(2_500);
    expect(inactiveCount(999, 33.3, "percent")).toBe(332);
    expect(inactiveCount(1_000, 5_000, "profiles")).toBe(1_000);
  });

  it("20% of 12,500 gives the same result as 2,500 profiles", () => {
    const byPercent = calculate({ activeProfiles: 12_500, inactive: 20, inactiveUnit: "percent", plan: "email" });
    expect(byPercent).toEqual(calculate(DOCUMENTED_EXAMPLES.ex1));
  });
});

describe("parsing", () => {
  it("accepts whole numbers with separators", () => {
    expect(parseCount("12,500")).toBe(12_500);
    expect(parseCount(" 12 500 ")).toBe(12_500);
    expect(parseCount("12.5")).toBeNaN();
    expect(parseCount("abc")).toBeNaN();
    expect(parseCount("")).toBeNaN();
  });
  it("accepts percentages", () => {
    expect(parsePercent("20%")).toBe(20);
    expect(parsePercent("12.5")).toBe(12.5);
    expect(parsePercent("-3")).toBeNaN();
  });
});

describe("result text", () => {
  it("labels the default example with core's formatting", () => {
    const view = describeResult(calculate(DOCUMENTED_EXAMPLES.ex1));
    const before = tierFor(12_500, KLAVIYO_EMAIL_2026_11)!.tier;
    expect(view.figure).toBe(formatUsd(12_500));
    expect(view.tierBefore).toBe(`Up to 12,500 profiles · ${formatUsd(before.monthlyCents)}/mo`);
    expect(view.fee).toBe("$25 (20%)");
    expect(view.keep).toBe("$100");
    expect(view.keptPercent).toBe(80);
    expect(view.figureLabel).toMatch(/Estimated/);
  });
});
