import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULE_SETTINGS,
  evaluateProfile,
  finalChargeForRun,
  simulate,
  validateRuleSettings,
  whyNotExecutable,
  type ProfileSignals,
} from "../src/index.js";
import { FULL_COVERAGE, NOW, TEST_TABLE, daysAgo, inactiveProfile } from "./fixtures.js";

const evalP = (p: ProfileSignals, coverage = FULL_COVERAGE, settings = DEFAULT_RULE_SETTINGS) =>
  evaluateProfile(p, settings, coverage, NOW);

describe("evaluateProfile: candidates", () => {
  it("never-engaged old profile is a candidate", () => {
    expect(evalP(inactiveProfile())).toEqual({ kind: "candidate", reason: "never_engaged" });
  });
  it("profile with only old engagement is lapsed", () => {
    const p = inactiveProfile({ lastOpenAt: daysAgo(400), lastClickAt: daysAgo(500), lastPurchaseAt: daysAgo(900) });
    expect(evalP(p)).toEqual({ kind: "candidate", reason: "lapsed" });
  });
});

describe("evaluateProfile: protection rules", () => {
  const cases: [string, Partial<ProfileSignals>, string][] = [
    ["recent purchase", { lastPurchaseAt: daysAgo(364) }, "recent_purchase"],
    ["recent click", { lastClickAt: daysAgo(179) }, "recent_click"],
    ["recent open", { lastOpenAt: daysAgo(89) }, "recent_open"],
    ["new profile", { createdAt: daysAgo(30) }, "new_profile"],
    ["unknown age", { createdAt: null }, "unknown_profile_age"],
    ["sms consent", { smsConsent: true }, "sms_consent"],
    ["protected group", { inProtectedGroup: true }, "protected_group"],
    ["recently reactivated", { reactivatedAt: daysAgo(10) }, "recently_reactivated"],
    ["recent site activity", { lastSiteActivityAt: daysAgo(20) }, "recent_site_activity"],
  ];
  for (const [name, overrides, reason] of cases) {
    it(`protects on ${name}`, () => {
      const d = evalP(inactiveProfile(overrides));
      expect(d.kind).toBe("protected");
      if (d.kind === "protected") expect(d.reasons).toContain(reason);
    });
  }

  it("boundaries: exactly N days ago no longer protects", () => {
    expect(evalP(inactiveProfile({ lastPurchaseAt: daysAgo(365) })).kind).toBe("candidate");
    expect(evalP(inactiveProfile({ lastClickAt: daysAgo(180) })).kind).toBe("candidate");
    expect(evalP(inactiveProfile({ lastOpenAt: daysAgo(90) })).kind).toBe("candidate");
    expect(evalP(inactiveProfile({ reactivatedAt: daysAgo(90) })).kind).toBe("candidate");
  });

  it("machine opens protect by default", () => {
    const p = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: true, lastHumanOpenAt: null });
    expect(evalP(p).kind).toBe("protected");
  });
  it("machine opens can be ignored when the merchant opts in", () => {
    const settings = { ...DEFAULT_RULE_SETTINGS, countMachineOpens: false };
    const p = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: true, lastHumanOpenAt: daysAgo(400) });
    expect(evalP(p, FULL_COVERAGE, settings).kind).toBe("candidate");
    const human = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: false });
    expect(evalP(human, FULL_COVERAGE, settings).kind).toBe("protected");
  });
});

describe("evaluateProfile: missing data is conservative", () => {
  it("protects when purchase history does not cover the window", () => {
    const d = evalP(inactiveProfile(), { ...FULL_COVERAGE, purchasesSince: daysAgo(60) });
    expect(d).toMatchObject({ kind: "protected", reasons: ["insufficient_purchase_history"] });
  });
  it("protects when purchase coverage is unknown", () => {
    expect(evalP(inactiveProfile(), { ...FULL_COVERAGE, purchasesSince: null }).kind).toBe("protected");
  });
  it("protects when engagement history does not cover the window", () => {
    const d = evalP(inactiveProfile(), { ...FULL_COVERAGE, engagementSince: daysAgo(100) });
    expect(d).toMatchObject({ kind: "protected", reasons: ["insufficient_engagement_history"] });
  });
});

describe("evaluateProfile: skips", () => {
  it("skips already suppressed profiles", () => {
    expect(evalP(inactiveProfile({ emailSuppressed: true }))).toEqual({ kind: "skipped", reason: "already_suppressed" });
  });
  it("skips profiles without email", () => {
    expect(evalP(inactiveProfile({ hasEmail: false }))).toEqual({ kind: "skipped", reason: "no_email" });
  });
});

describe("validateRuleSettings", () => {
  it("keeps defaults and accepts valid values", () => {
    const { settings, errors } = validateRuleSettings({ clickDays: 120 });
    expect(errors).toEqual([]);
    expect(settings.clickDays).toBe(120);
    expect(settings.purchaseDays).toBe(365);
  });
  it("rejects values below the safety floor", () => {
    const { settings, errors } = validateRuleSettings({ purchaseDays: 10, reactivationLockDays: 30 });
    expect(errors).toHaveLength(2);
    expect(settings.purchaseDays).toBe(365);
    expect(settings.reactivationLockDays).toBe(90);
  });
});

describe("simulate", () => {
  const profiles: ProfileSignals[] = [
    ...Array.from({ length: 3_000 }, (_, i) => inactiveProfile({ id: `never_${i}` })),
    ...Array.from({ length: 500 }, (_, i) => inactiveProfile({ id: `lapsed_${i}`, lastClickAt: daysAgo(400) })),
    ...Array.from({ length: 200 }, (_, i) => inactiveProfile({ id: `buyer_${i}`, lastPurchaseAt: daysAgo(10) })),
    ...Array.from({ length: 50 }, (_, i) => inactiveProfile({ id: `sup_${i}`, emailSuppressed: true })),
    inactiveProfile({ id: "never_0" }), // duplicate id is ignored
  ];

  const result = simulate({
    profiles,
    settings: DEFAULT_RULE_SETTINGS,
    coverage: FULL_COVERAGE,
    activeProfiles: 12_400,
    table: TEST_TABLE,
    now: NOW,
  });

  it("counts by decision and reason", () => {
    expect(result.summary).toMatchObject({ evaluated: 3_750, candidates: 3_500, protected: 200, skipped: 50 });
    expect(result.summary.candidatesByReason).toEqual({ never_engaged: 3_000, lapsed: 500 });
    expect(result.summary.protectedByReason.recent_purchase).toBe(200);
    expect(result.candidates).toHaveLength(3_500);
    expect(result.candidates.some((c) => c.id.startsWith("buyer_"))).toBe(false);
  });
  it("computes savings and fee from the projected tier", () => {
    expect(result.savings.profilesAfter).toBe(8_900);
    expect(result.savings.monthlySavingsCents).toBe(12_500);
    expect(result.charge.feeCents).toBe(2_500);
  });

  it("final charge only goes down when fewer profiles were suppressed", () => {
    const partial = finalChargeForRun({ simulated: result, actuallySuppressed: 1_000, activeProfiles: 12_400, table: TEST_TABLE, now: NOW });
    expect(partial.savings.monthlySavingsCents).toBe(0);
    expect(partial.charge.feeCents).toBe(0);
    const full = finalChargeForRun({ simulated: result, actuallySuppressed: 99_999, activeProfiles: 12_400, table: TEST_TABLE, now: NOW });
    expect(full.charge.feeCents).toBe(result.charge.feeCents);
  });
});

describe("whyNotExecutable", () => {
  const base = { createdAt: daysAgo(0.5), approvedAt: daysAgo(0.4), executedAt: null, superseded: false };
  it("allows a fresh approved simulation", () => {
    expect(whyNotExecutable(base, NOW)).toBeNull();
  });
  it("blocks unapproved, expired, executed and superseded simulations", () => {
    expect(whyNotExecutable({ ...base, approvedAt: null }, NOW)).toBe("not_approved");
    expect(whyNotExecutable({ ...base, createdAt: daysAgo(1), approvedAt: daysAgo(0.9) }, NOW)).toBe("expired");
    expect(whyNotExecutable({ ...base, executedAt: daysAgo(0.1) }, NOW)).toBe("already_executed");
    expect(whyNotExecutable({ ...base, superseded: true }, NOW)).toBe("superseded");
  });
});
