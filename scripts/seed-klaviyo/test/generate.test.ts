import { DEFAULT_RULE_SETTINGS, EMAILS_RECEIVED_WINDOW_DAYS, RULE_LIMITS, evaluateProfile, validateRuleSettings, type Decision } from "@tiersaver/core";
import { describe, expect, it } from "vitest";
import { COHORTS, RULE_MODES, RULE_SETTINGS_BY_MODE, TOTAL_SHARE, WIDE_RULE_SETTINGS, allocateCohorts, type ExpectedDecision } from "../src/cohorts.js";
import {
  DEFAULT_COUNT,
  DEFAULT_SEED,
  countByCohort,
  countEmailsReceived,
  evaluateSeedProfile,
  expectedDecisions,
  formatDecision,
  fullCoverage,
  generateDataset,
  toProfileSignals,
} from "../src/generate.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Protection reasons are a set: order is an implementation detail of the rule engine. */
const normalize = (d: Decision | ExpectedDecision) => (d.kind === "protected" ? { kind: d.kind, reasons: [...d.reasons].sort() } : d);

describe("generateDataset: determinism", () => {
  it("returns the same dataset for the same options", () => {
    const a = generateDataset({ now: NOW });
    const b = generateDataset({ now: NOW, seed: DEFAULT_SEED, count: DEFAULT_COUNT });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes activity, not identity or cohorts, with another seed", () => {
    const a = generateDataset({ now: NOW, seed: 1, runTag: "ts-seed-x" });
    const b = generateDataset({ now: NOW, seed: 2, runTag: "ts-seed-x" });
    expect(a.profiles.map((p) => p.email)).toEqual(b.profiles.map((p) => p.email));
    expect(a.profiles.map((p) => p.cohort)).toEqual(b.profiles.map((p) => p.cohort));
    expect(JSON.stringify(a.profiles)).not.toBe(JSON.stringify(b.profiles));
  });

  it("keeps every age relative to now", () => {
    const later = new Date(NOW.getTime() + 10 * DAY);
    const a = generateDataset({ now: NOW });
    const b = generateDataset({ now: later });
    expect(b.profiles[0]!.events[0]!.time.getTime() - a.profiles[0]!.events[0]!.time.getTime()).toBe(10 * DAY);
  });

  it("truncates now to the second, like Klaviyo event times", () => {
    expect(generateDataset({ now: new Date("2026-11-25T12:00:00.789Z") }).now.toISOString()).toBe("2026-11-25T12:00:00.000Z");
  });
});

describe("generateDataset: bounds and identity", () => {
  it.each([0, 1999, 5001, 2500.5, Number.NaN])("rejects count %s", (count) => {
    expect(() => generateDataset({ now: NOW, count })).toThrow(RangeError);
  });

  it.each([2000, 5000])("accepts count %i", (count) => {
    expect(generateDataset({ now: NOW, count }).profiles).toHaveLength(count);
  });

  it("rejects an invalid seed, run tag, domain or date", () => {
    expect(() => generateDataset({ now: NOW, seed: -1 })).toThrow(RangeError);
    expect(() => generateDataset({ now: NOW, runTag: "Bad Tag" })).toThrow(RangeError);
    expect(() => generateDataset({ now: NOW, emailDomain: "not a domain" })).toThrow(RangeError);
    expect(() => generateDataset({ now: new Date("nope") })).toThrow(RangeError);
  });

  it("produces unique, obviously fictitious identities", () => {
    const ds = generateDataset({ now: NOW, count: 5000 });
    expect(new Set(ds.profiles.map((p) => p.email)).size).toBe(5000);
    for (const p of ds.profiles) {
      expect(p.email).toMatch(/^ts-seed-20261125-\d{5}@example\.com$/);
      expect(p.email.length).toBeLessThanOrEqual(100);
      expect(p.lastName).toMatch(/^Seed-\d{5}$/);
    }
    const phones = ds.profiles.filter((p) => p.phoneNumber).map((p) => p.phoneNumber as string);
    expect(phones).toHaveLength(ds.profiles.filter((p) => p.smsConsent).length);
    expect(new Set(phones).size).toBe(phones.length);
    // North American fictional range: exchange 555, line 0100-0199.
    for (const phone of phones) expect(phone).toMatch(/^\+1\d{3}55501\d{2}$/);
  });

  it("produces events Klaviyo accepts: unique ids, past timestamps, after profile creation", () => {
    const ds = generateDataset({ now: NOW, count: 5000 });
    const ids = ds.profiles.flatMap((p) => p.events.map((e) => e.uniqueId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ds.profiles) {
      expect(p.createdAt.getTime()).toBeLessThan(NOW.getTime());
      for (const e of p.events) {
        expect(e.uniqueId.length).toBeLessThanOrEqual(255);
        expect(e.time.getTime()).toBeLessThan(NOW.getTime());
        expect(e.time.getUTCFullYear()).toBeGreaterThanOrEqual(2020);
        expect(e.time.getTime() % 1000).toBe(0);
        expect(p.createdAt.getTime()).toBeLessThanOrEqual(e.time.getTime());
      }
    }
  });
});

describe("cohort shares", () => {
  it("shares add up to 1000 per mille and ids are unique", () => {
    expect(COHORTS.reduce((sum, c) => sum + c.share, 0)).toBe(TOTAL_SHARE);
    expect(new Set(COHORTS.map((c) => c.id)).size).toBe(COHORTS.length);
  });

  it("gives each cohort exactly its share at the default count", () => {
    const counts = countByCohort(generateDataset({ now: NOW }));
    for (const cohort of COHORTS) expect(counts.get(cohort.id)).toBe((DEFAULT_COUNT * cohort.share) / TOTAL_SHARE);
  });

  it.each([2000, 2001, 2777, 3333, 4999, 5000])("allocates %i profiles within one of the exact share, none empty", (count) => {
    const sizes = allocateCohorts(count);
    expect([...sizes.values()].reduce((a, b) => a + b, 0)).toBe(count);
    for (const cohort of COHORTS) {
      const size = sizes.get(cohort.id) as number;
      expect(size).toBeGreaterThanOrEqual(1);
      expect(Math.abs(size - (count * cohort.share) / TOTAL_SHARE)).toBeLessThan(1);
    }
    expect(countByCohort(generateDataset({ now: NOW, count }))).toEqual(sizes);
  });
});

describe("WIDE_RULE_SETTINGS", () => {
  it("is the wider mode at core's floors and passes core's own validation", () => {
    expect(WIDE_RULE_SETTINGS).toEqual({
      purchaseDays: 365,
      clickDays: 182,
      openDays: 182,
      siteActivityDays: 182,
      newProfileDays: 180,
      minEmailsReceived: 5,
      reactivationLockDays: 365,
      countMachineOpens: true,
    });
    for (const key of Object.keys(RULE_LIMITS) as (keyof typeof RULE_LIMITS)[]) expect(WIDE_RULE_SETTINGS[key], key).toBe(RULE_LIMITS[key].min);
    expect(validateRuleSettings(WIDE_RULE_SETTINGS)).toEqual({ settings: WIDE_RULE_SETTINGS, errors: [] });
  });

  it("the default mode is core's default: every engagement window is 'ever'", () => {
    expect(RULE_SETTINGS_BY_MODE.default).toBe(DEFAULT_RULE_SETTINGS);
    expect(DEFAULT_RULE_SETTINGS).toMatchObject({ purchaseDays: null, clickDays: null, openDays: null, siteActivityDays: null, newProfileDays: 365, minEmailsReceived: 5 });
  });
});

describe("received emails", () => {
  it("seeds 'Received Email' events on the declared side of the 504-day window, after the profile was created", () => {
    const ds = generateDataset({ now: NOW, count: 5000 });
    const windowStart = NOW.getTime() - EMAILS_RECEIVED_WINDOW_DAYS * DAY;
    const counts = new Map<string, Set<number>>();
    for (const p of ds.profiles) {
      const received = p.events.filter((e) => e.metric === "received");
      for (const e of received) {
        expect(e.metricName).toBe("Received Email");
        expect(e.time.getTime()).toBeGreaterThan(p.createdAt.getTime());
        // Never within an hour of the window edge: the count must not hinge on how the app rounds.
        expect(Math.abs(e.time.getTime() - windowStart)).toBeGreaterThanOrEqual(3_600_000);
      }
      const inWindow = received.filter((e) => e.time.getTime() > windowStart).length;
      expect(countEmailsReceived(p, ds.now)).toBe(inWindow);
      expect(toProfileSignals(p, ds).emailsReceived).toBe(inWindow);
      counts.set(p.cohort, (counts.get(p.cohort) ?? new Set()).add(inWindow));
      if (p.cohort === "emails_received_before_window") expect(received).toHaveLength(6);
    }
    expect([...counts.get("no_emails_received")!]).toEqual([0]);
    expect([...counts.get("emails_received_before_window")!]).toEqual([0]);
    expect([...counts.get("boundary_emails_received_4")!]).toEqual([4]);
    expect([...counts.get("boundary_emails_received_5")!]).toEqual([5]);
    expect([...counts.get("few_emails_received")!].sort()).toEqual([1, 2, 3, 4]);
    expect(Math.min(...counts.get("never_engaged")!)).toBe(5);
  });

  it("an unknown send history protects every profile that is not skipped", () => {
    const ds = generateDataset({ now: NOW });
    for (const mode of RULE_MODES) {
      for (const profile of ds.profiles.filter((p) => !p.suppressed)) {
        const decision = evaluateSeedProfile(profile, ds, { settings: RULE_SETTINGS_BY_MODE[mode], emailsReceived: null });
        expect(decision.kind, `${profile.email} ${mode}`).toBe("protected");
        if (decision.kind === "protected") expect(decision.reasons).toContain("unknown_send_history");
      }
    }
  });
});

describe("expected decisions agree with @tiersaver/core", () => {
  const cases = [
    { seed: DEFAULT_SEED, count: 3000 },
    { seed: 1, count: 2000 },
    { seed: 987654321, count: 5000 },
  ];
  const modes = RULE_MODES.flatMap((mode) => cases.map((c) => ({ mode, ...c })));

  it.each(modes)("under the $mode rules (seed $seed, count $count)", ({ mode, seed, count }) => {
    const ds = generateDataset({ now: NOW, seed, count });
    const rows = expectedDecisions(ds);
    expect(rows).toHaveLength(count);
    const mismatches: string[] = [];
    ds.profiles.forEach((profile, i) => {
      const actual = evaluateProfile(toProfileSignals(profile, ds), RULE_SETTINGS_BY_MODE[mode], fullCoverage(ds.now), ds.now);
      const expected = rows[i]!.expected[mode];
      if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
        mismatches.push(`${profile.email} [${profile.cohort}]: expected ${formatDecision(expected)}, core says ${formatDecision(actual)}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it.each(modes)("under the $mode rules with machine opens ignored (seed $seed, count $count)", ({ mode, seed, count }) => {
    const ds = generateDataset({ now: NOW, seed, count });
    const settings = { ...RULE_SETTINGS_BY_MODE[mode], countMachineOpens: false };
    const rows = expectedDecisions(ds);
    ds.profiles.forEach((profile, i) => {
      expect(normalize(evaluateSeedProfile(profile, ds, { settings })), profile.email).toEqual(normalize(rows[i]!.expectedIgnoringMachineOpens[mode]));
    });
  });

  it("covers every decision the seed can produce in Klaviyo, in the mode where it belongs", () => {
    const rows = expectedDecisions(generateDataset({ now: NOW }));
    const seen = (mode: "default" | "wide") => new Set(rows.flatMap((r) => formatDecision(r.expected[mode]).split(/[:+]/).slice(1)));
    const always = [
      "recent_purchase",
      "recent_click",
      "recent_open",
      "recent_site_activity",
      "new_profile",
      "sms_consent",
      "protected_group",
      "recently_reactivated",
      "not_enough_emails_received",
      "never_engaged",
      "already_suppressed",
    ];
    for (const reason of always) {
      expect(seen("default"), reason).toContain(reason);
      expect(seen("wide"), reason).toContain(reason);
    }
    // "Lapsed" needs a window: with the default rules any past engagement protects.
    expect(seen("wide")).toContain("lapsed");
    expect(seen("default")).not.toContain("lapsed");
  });

  it("under the default rules the only candidates are never-engaged, 365+ days old, with 5+ emails received", () => {
    const ds = generateDataset({ now: NOW, count: 5000 });
    const candidates = ds.profiles.filter((p) => p.expected.default.kind === "candidate");
    expect(candidates.length).toBeGreaterThan(500);
    for (const p of candidates) {
      expect(p.events.every((e) => e.metric === "received"), p.email).toBe(true);
      expect(NOW.getTime() - p.createdAt.getTime(), p.email).toBeGreaterThanOrEqual(365 * DAY);
      expect(countEmailsReceived(p, ds.now), p.email).toBeGreaterThanOrEqual(5);
      expect(p.smsConsent || p.protectedGroup || p.restored || p.suppressed, p.email).toBe(false);
    }
    // Everything the default rules would suppress, the wider mode would too.
    for (const p of candidates) expect(p.expected.wide.kind, p.email).toBe("candidate");
    expect(ds.profiles.filter((p) => p.expected.wide.kind === "candidate").length).toBeGreaterThan(candidates.length);
  });

  it("anyone who ever opened, clicked, visited or ordered is protected by default", () => {
    const ds = generateDataset({ now: NOW });
    const engaged = ds.profiles.filter((p) => !p.suppressed && p.events.some((e) => e.metric !== "received"));
    expect(engaged.length).toBeGreaterThan(1000);
    for (const p of engaged) expect(p.expected.default.kind, p.email).toBe("protected");
    for (const id of ["opened_long_ago", "clicked_long_ago", "purchased_long_ago", "site_activity_long_ago", "engaged_long_ago_mixed"]) {
      const cohort = COHORTS.find((c) => c.id === id)!;
      expect(cohort.expected.default.kind, id).toBe("protected");
      expect(cohort.expected.wide, id).toEqual({ kind: "candidate", reason: "lapsed" });
    }
  });

  it("isolates one protection reason per cohort, except the combined ones", () => {
    const combined: Record<string, number> = { recent_clicker_and_opener: 2, engaged_long_ago_mixed: 4 };
    for (const cohort of COHORTS) {
      for (const mode of RULE_MODES) {
        const expected = cohort.expected[mode];
        if (expected.kind !== "protected") continue;
        expect(expected.reasons, `${cohort.id} ${mode}`).toHaveLength(combined[cohort.id] ?? 1);
      }
    }
  });

  it("flips each boundary pair one step apart", () => {
    const ds = generateDataset({ now: NOW });
    const kindOf = (cohort: string, mode: "default" | "wide", at?: Date) =>
      evaluateSeedProfile(ds.profiles.find((p) => p.cohort === cohort)!, ds, { at, settings: RULE_SETTINGS_BY_MODE[mode] }).kind;
    const pairs: [string, string, "default" | "wide"][] = [
      ["boundary_created_364d", "boundary_created_365d", "default"],
      ["boundary_created_179d", "boundary_created_180d", "wide"],
      ["boundary_click_181d", "boundary_click_182d", "wide"],
      ["boundary_open_181d", "boundary_open_182d", "wide"],
      ["boundary_machine_open_181d", "boundary_machine_open_182d", "wide"],
      ["boundary_site_181d", "boundary_site_182d", "wide"],
      ["boundary_purchase_364d", "boundary_purchase_365d", "wide"],
    ];
    for (const [inside, outside, mode] of pairs) {
      expect(kindOf(inside, mode), inside).toBe("protected");
      expect(kindOf(outside, mode), outside).toBe("candidate");
      // The inside case leaves its window once a full day has passed.
      expect(kindOf(inside, mode, new Date(NOW.getTime() + DAY)), `${inside} a day later`).toBe("candidate");
    }
    for (const mode of RULE_MODES) {
      expect(kindOf("boundary_emails_received_4", mode)).toBe("protected");
      expect(kindOf("boundary_emails_received_5", mode)).toBe("candidate");
    }
    // Under the default rules no engagement boundary exists: both sides stay protected.
    for (const [inside, outside] of pairs.slice(2)) {
      expect(kindOf(inside, "default"), inside).toBe("protected");
      expect(kindOf(outside, "default"), outside).toBe("protected");
    }
  });

  it("the 365-day lock after a restore holds at 364 days and ends at 365 (not seedable: the restore happens when the seed runs)", () => {
    const ds = generateDataset({ now: NOW });
    const restored = ds.profiles.find((p) => p.cohort === "restored")!;
    for (const mode of RULE_MODES) {
      const settings = RULE_SETTINGS_BY_MODE[mode];
      const at = (days: number) => evaluateSeedProfile(restored, ds, { settings, restoredAt: new Date(NOW.getTime() - days * DAY) });
      expect(at(0)).toEqual({ kind: "protected", reasons: ["recently_reactivated"] });
      expect(at(364)).toEqual({ kind: "protected", reasons: ["recently_reactivated"] });
      expect(at(365)).toEqual({ kind: "candidate", reason: "never_engaged" });
    }
  });

  it("profiles 180 to 364 days old are protected by default and eligible in the wider mode", () => {
    const ds = generateDataset({ now: NOW, count: 5000 });
    const cohort = ds.profiles.filter((p) => p.cohort === "profile_180_to_364_days");
    expect(cohort.length).toBe(250);
    for (const p of cohort) {
      const age = (NOW.getTime() - p.createdAt.getTime()) / DAY;
      expect(age).toBeGreaterThanOrEqual(180);
      expect(age).toBeLessThan(365);
      expect(evaluateSeedProfile(p, ds)).toEqual({ kind: "protected", reasons: ["new_profile"] });
      expect(evaluateSeedProfile(p, ds, { settings: WIDE_RULE_SETTINGS })).toEqual({ kind: "candidate", reason: "never_engaged" });
    }
  });

  it.each(RULE_MODES)("predicts that every profile is protected as new when Klaviyo's real created date is used (%s rules)", (mode) => {
    const ds = generateDataset({ now: NOW });
    const settings = RULE_SETTINGS_BY_MODE[mode];
    for (const p of ds.profiles.filter((q) => !q.suppressed)) {
      const decision = evaluateSeedProfile(p, ds, { createdAt: ds.now, settings });
      expect(decision.kind, p.email).toBe("protected");
      if (decision.kind === "protected") expect(decision.reasons, p.email).toContain("new_profile");
    }
    // Still true 364 days after seeding under the default rules (179 in the wider mode), whatever else has changed by then.
    const lastDay = settings.newProfileDays - 1;
    const later = new Date(NOW.getTime() + lastDay * DAY);
    const sample = ds.profiles.find((p) => p.cohort === "never_engaged")!;
    expect(evaluateSeedProfile(sample, ds, { createdAt: ds.now, settings, at: later })).toMatchObject({ kind: "protected", reasons: expect.arrayContaining(["new_profile"]) });
  });
});
