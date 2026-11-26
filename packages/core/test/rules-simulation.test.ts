import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULE_SETTINGS,
  PURCHASE_DATA_MAX_AGE_HOURS,
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

/** The opt-in wider mode at its tightest allowed values. */
const WIDE = { ...DEFAULT_RULE_SETTINGS, purchaseDays: 365, clickDays: 182, openDays: 182, siteActivityDays: 182, newProfileDays: 180 };

describe("defaults follow Klaviyo's published criteria", () => {
  it("never engaged, old enough and written to: candidate", () => {
    expect(evalP(inactiveProfile())).toEqual({ kind: "candidate", reason: "never_engaged" });
  });

  const everCases: [string, Partial<ProfileSignals>, string][] = [
    ["a purchase years ago", { lastPurchaseAt: daysAgo(1500) }, "recent_purchase"],
    ["a click years ago", { lastClickAt: daysAgo(1500) }, "recent_click"],
    ["an open years ago", { lastOpenAt: daysAgo(1500) }, "recent_open"],
    ["site activity years ago", { lastSiteActivityAt: daysAgo(1500) }, "recent_site_activity"],
  ];
  for (const [name, overrides, reason] of everCases) {
    it(`protects on ${name}: any engagement in history counts`, () => {
      const d = evalP(inactiveProfile({ createdAt: daysAgo(1900), ...overrides }));
      expect(d.kind).toBe("protected");
      if (d.kind === "protected") expect(d.reasons).toContain(reason);
    });
  }

  it("a profile younger than 365 days is never a candidate", () => {
    expect(evalP(inactiveProfile({ createdAt: daysAgo(364) }))).toMatchObject({ kind: "protected", reasons: ["new_profile"] });
    expect(evalP(inactiveProfile({ createdAt: daysAgo(365) })).kind).toBe("candidate");
  });

  it("a profile that was barely written to is not inactive", () => {
    expect(evalP(inactiveProfile({ emailsReceived: 4 }))).toMatchObject({ kind: "protected", reasons: ["not_enough_emails_received"] });
    expect(evalP(inactiveProfile({ emailsReceived: 0 })).kind).toBe("protected");
    expect(evalP(inactiveProfile({ emailsReceived: 5 })).kind).toBe("candidate");
  });

  it("an unknown send history protects", () => {
    expect(evalP(inactiveProfile({ emailsReceived: null }))).toMatchObject({ kind: "protected", reasons: ["unknown_send_history"] });
    expect(evalP(inactiveProfile({ emailsReceived: undefined })).kind).toBe("protected");
    expect(evalP(inactiveProfile({ emailsReceived: Number.NaN })).kind).toBe("protected");
  });

  it("a restored profile is not a candidate again for 365 days", () => {
    expect(evalP(inactiveProfile({ reactivatedAt: daysAgo(364) }))).toMatchObject({ kind: "protected", reasons: ["recently_reactivated"] });
    expect(evalP(inactiveProfile({ reactivatedAt: daysAgo(365) })).kind).toBe("candidate");
  });
});

describe("always protected", () => {
  const cases: [string, Partial<ProfileSignals>, string][] = [
    ["unknown age", { createdAt: null }, "unknown_profile_age"],
    ["sms consent", { smsConsent: true }, "sms_consent"],
    ["protected group", { inProtectedGroup: true }, "protected_group"],
  ];
  for (const [name, overrides, reason] of cases) {
    for (const [mode, settings] of [["default", DEFAULT_RULE_SETTINGS], ["wide", WIDE]] as const) {
      it(`protects on ${name} (${mode} mode)`, () => {
        const d = evalP(inactiveProfile(overrides), FULL_COVERAGE, settings);
        expect(d.kind).toBe("protected");
        if (d.kind === "protected") expect(d.reasons).toContain(reason);
      });
    }
  }
});

describe("wider mode (opt-in windows)", () => {
  const evalW = (p: ProfileSignals, coverage = FULL_COVERAGE) => evalP(p, coverage, WIDE);

  it("old engagement outside every window is lapsed", () => {
    const p = inactiveProfile({ lastOpenAt: daysAgo(400), lastClickAt: daysAgo(500), lastPurchaseAt: daysAgo(900) });
    expect(evalW(p)).toEqual({ kind: "candidate", reason: "lapsed" });
  });

  it("boundaries: inside the window protects, exactly N days ago does not", () => {
    expect(evalW(inactiveProfile({ lastPurchaseAt: daysAgo(364) })).kind).toBe("protected");
    expect(evalW(inactiveProfile({ lastPurchaseAt: daysAgo(365) })).kind).toBe("candidate");
    expect(evalW(inactiveProfile({ lastClickAt: daysAgo(181) })).kind).toBe("protected");
    expect(evalW(inactiveProfile({ lastClickAt: daysAgo(182) })).kind).toBe("candidate");
    expect(evalW(inactiveProfile({ lastOpenAt: daysAgo(181) })).kind).toBe("protected");
    expect(evalW(inactiveProfile({ lastOpenAt: daysAgo(182) })).kind).toBe("candidate");
    expect(evalW(inactiveProfile({ lastSiteActivityAt: daysAgo(181) })).kind).toBe("protected");
    expect(evalW(inactiveProfile({ createdAt: daysAgo(179) })).kind).toBe("protected");
  });

  it("machine opens protect by default", () => {
    const p = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: true, lastHumanOpenAt: null });
    expect(evalW(p).kind).toBe("protected");
  });
  it("machine opens can be ignored when the merchant opts in", () => {
    const settings = { ...WIDE, countMachineOpens: false };
    const p = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: true, lastHumanOpenAt: daysAgo(400) });
    expect(evalP(p, FULL_COVERAGE, settings).kind).toBe("candidate");
    const unknownHuman = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: true });
    expect(evalP(unknownHuman, FULL_COVERAGE, settings).kind).toBe("protected");
    const human = inactiveProfile({ lastOpenAt: daysAgo(5), lastOpenIsMachine: false });
    expect(evalP(human, FULL_COVERAGE, settings).kind).toBe("protected");
  });

  it("protects when history does not cover the window", () => {
    expect(evalW(inactiveProfile(), { ...FULL_COVERAGE, purchasesSince: daysAgo(60) })).toMatchObject({
      kind: "protected",
      reasons: ["insufficient_purchase_history"],
    });
    expect(evalW(inactiveProfile(), { ...FULL_COVERAGE, engagementSince: daysAgo(100) })).toMatchObject({
      kind: "protected",
      reasons: ["insufficient_engagement_history"],
    });
  });
});

describe("missing data is conservative (default mode: history must reach back to the profile's creation)", () => {
  it("protects when purchase data starts after the profile was created", () => {
    const d = evalP(inactiveProfile({ createdAt: daysAgo(800) }), { ...FULL_COVERAGE, purchasesSince: daysAgo(799) });
    expect(d).toMatchObject({ kind: "protected", reasons: ["insufficient_purchase_history"] });
    expect(evalP(inactiveProfile({ createdAt: daysAgo(800) }), { ...FULL_COVERAGE, purchasesSince: daysAgo(800) }).kind).toBe("candidate");
  });
  it("protects when purchase coverage is unknown", () => {
    expect(evalP(inactiveProfile(), { ...FULL_COVERAGE, purchasesSince: null }).kind).toBe("protected");
  });
  it("protects when purchase data is not known to be current, however far back it reaches", () => {
    const stale = (purchasesUntil: Date | null | undefined) => evalP(inactiveProfile(), { ...FULL_COVERAGE, purchasesUntil });
    // No "until" at all: order data frozen at some unknown moment (the install-time backfill).
    expect(evalP(inactiveProfile(), { engagementSince: daysAgo(2000), purchasesSince: daysAgo(2000) })).toMatchObject({
      kind: "protected",
      reasons: ["insufficient_purchase_history"],
    });
    expect(stale(null)).toMatchObject({ kind: "protected", reasons: ["insufficient_purchase_history"] });
    expect(stale(new Date(Number.NaN)).kind).toBe("protected");
    expect(stale(daysAgo(30))).toMatchObject({ kind: "protected", reasons: ["insufficient_purchase_history"] });
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    expect(stale(hoursAgo(PURCHASE_DATA_MAX_AGE_HOURS + 1)).kind).toBe("protected");
    expect(stale(hoursAgo(PURCHASE_DATA_MAX_AGE_HOURS)).kind).toBe("candidate");
    // Refreshed after the scan started: still current.
    expect(stale(hoursAgo(-1)).kind).toBe("candidate");
  });
  it("stale purchase data protects in the wider mode too, and a known purchase still counts", () => {
    const wide = { ...DEFAULT_RULE_SETTINGS, purchaseDays: 365 };
    const staleCoverage = { ...FULL_COVERAGE, purchasesUntil: daysAgo(305) };
    expect(evalP(inactiveProfile(), staleCoverage, wide)).toMatchObject({ kind: "protected", reasons: ["insufficient_purchase_history"] });
    expect(evalP(inactiveProfile({ lastPurchaseAt: daysAgo(900) }), { ...FULL_COVERAGE, purchasesUntil: null })).toMatchObject({
      kind: "protected",
      reasons: ["recent_purchase"],
    });
  });
  it("protects when engagement data starts after the profile was created", () => {
    const d = evalP(inactiveProfile({ createdAt: daysAgo(800) }), { ...FULL_COVERAGE, engagementSince: daysAgo(700) });
    expect(d).toMatchObject({ kind: "protected", reasons: ["insufficient_engagement_history"] });
  });
  it("60 days of Shopify orders are never enough to call someone a non-buyer", () => {
    const d = evalP(inactiveProfile(), { ...FULL_COVERAGE, purchasesSince: daysAgo(60) });
    expect(d.kind).toBe("protected");
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
  it("defaults are Klaviyo's criteria", () => {
    expect(validateRuleSettings({}).settings).toEqual({
      purchaseDays: null,
      clickDays: null,
      openDays: null,
      siteActivityDays: null,
      newProfileDays: 365,
      minEmailsReceived: 5,
      reactivationLockDays: 365,
      countMachineOpens: true,
    });
  });
  it("accepts windows at or above the floor, and null for any time", () => {
    const { settings, errors } = validateRuleSettings({ clickDays: 182, purchaseDays: 365, openDays: null, newProfileDays: 180 });
    expect(errors).toEqual([]);
    expect(settings).toMatchObject({ clickDays: 182, purchaseDays: 365, openDays: null, newProfileDays: 180 });
  });
  it("rejects values below the floor and keeps the conservative default", () => {
    const { settings, errors } = validateRuleSettings({
      purchaseDays: 364,
      clickDays: 181,
      openDays: 90,
      siteActivityDays: 30,
      newProfileDays: 179,
      minEmailsReceived: 4,
      reactivationLockDays: 90,
    });
    expect(errors).toHaveLength(7);
    expect(settings).toEqual(DEFAULT_RULE_SETTINGS);
  });
  it("rejects null where a number is required", () => {
    const { errors } = validateRuleSettings({ newProfileDays: null as unknown as number });
    expect(errors).toHaveLength(1);
  });
});

describe("simulate", () => {
  const profiles: ProfileSignals[] = [
    ...Array.from({ length: 3_000 }, (_, i) => inactiveProfile({ id: `never_${i}` })),
    ...Array.from({ length: 500 }, (_, i) => inactiveProfile({ id: `clicked_once_${i}`, lastClickAt: daysAgo(400) })),
    ...Array.from({ length: 200 }, (_, i) => inactiveProfile({ id: `buyer_${i}`, lastPurchaseAt: daysAgo(900) })),
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

  it("counts by decision and reason; anyone who ever engaged or bought stays", () => {
    expect(result.summary).toMatchObject({ evaluated: 3_750, candidates: 3_000, protected: 700, skipped: 50 });
    expect(result.summary.candidatesByReason).toEqual({ never_engaged: 3_000, lapsed: 0 });
    expect(result.summary.protectedByReason.recent_purchase).toBe(200);
    expect(result.summary.protectedByReason.recent_click).toBe(500);
    expect(result.candidates).toHaveLength(3_000);
    expect(result.candidates.every((c) => c.id.startsWith("never_"))).toBe(true);
  });
  it("quotes the flat fee for the list size, independent of any plan change", () => {
    expect(result.savings.profilesAfter).toBe(9_400);
    expect(result.charge).toMatchObject({ activeProfiles: 12_400, feeCents: 2_900, noChargeReason: null });
  });
  it("a simulation with no candidates quotes no charge", () => {
    const empty = simulate({ profiles: [], settings: DEFAULT_RULE_SETTINGS, coverage: FULL_COVERAGE, activeProfiles: 12_400, table: TEST_TABLE, now: NOW });
    expect(empty.charge).toMatchObject({ feeCents: 0, noChargeReason: "no_cleanup" });
  });

  it("the final charge is the approved price, or nothing if nobody was suppressed", () => {
    expect(finalChargeForRun({ simulated: result, actuallySuppressed: 1_000, now: NOW }).feeCents).toBe(2_900);
    expect(finalChargeForRun({ simulated: result, actuallySuppressed: 99_999, now: NOW }).feeCents).toBe(result.charge.feeCents);
    expect(finalChargeForRun({ simulated: result, actuallySuppressed: 0, now: NOW })).toMatchObject({ feeCents: 0, noChargeReason: "no_cleanup" });
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
