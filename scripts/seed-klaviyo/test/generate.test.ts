import { DEFAULT_RULE_SETTINGS, evaluateProfile, type Decision } from "@tiersaver/core";
import { describe, expect, it } from "vitest";
import { COHORTS, TOTAL_SHARE, allocateCohorts, type ExpectedDecision } from "../src/cohorts.js";
import {
  DEFAULT_COUNT,
  DEFAULT_SEED,
  countByCohort,
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

describe("expected decisions agree with @tiersaver/core", () => {
  const cases = [
    { seed: DEFAULT_SEED, count: 3000 },
    { seed: 1, count: 2000 },
    { seed: 987654321, count: 5000 },
  ];

  it.each(cases)("under DEFAULT_RULE_SETTINGS (seed $seed, count $count)", ({ seed, count }) => {
    const ds = generateDataset({ now: NOW, seed, count });
    const rows = expectedDecisions(ds);
    expect(rows).toHaveLength(count);
    const mismatches: string[] = [];
    ds.profiles.forEach((profile, i) => {
      const actual = evaluateProfile(toProfileSignals(profile, ds), DEFAULT_RULE_SETTINGS, fullCoverage(ds.now), ds.now);
      const expected = rows[i]!.expected;
      if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
        mismatches.push(`${profile.email} [${profile.cohort}]: expected ${formatDecision(expected)}, core says ${formatDecision(actual)}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it.each(cases)("with machine opens ignored (seed $seed, count $count)", ({ seed, count }) => {
    const ds = generateDataset({ now: NOW, seed, count });
    const settings = { ...DEFAULT_RULE_SETTINGS, countMachineOpens: false };
    for (const profile of ds.profiles) {
      expect(normalize(evaluateSeedProfile(profile, ds, { settings })), profile.email).toEqual(normalize(profile.expectedIgnoringMachineOpens));
    }
  });

  it("covers every decision the seed can produce in Klaviyo", () => {
    const seen = new Set(expectedDecisions(generateDataset({ now: NOW })).flatMap((r) => formatDecision(r.expected).split(/[:+]/).slice(1)));
    for (const reason of [
      "recent_purchase",
      "recent_click",
      "recent_open",
      "recent_site_activity",
      "new_profile",
      "sms_consent",
      "protected_group",
      "recently_reactivated",
      "lapsed",
      "never_engaged",
      "already_suppressed",
    ]) {
      expect(seen, reason).toContain(reason);
    }
  });

  it("isolates one protection reason per cohort, except the combined one", () => {
    for (const cohort of COHORTS) {
      if (cohort.expected.kind !== "protected") continue;
      expect(cohort.expected.reasons, cohort.id).toHaveLength(cohort.id === "recent_clicker_and_opener" ? 2 : 1);
    }
  });

  it("flips each boundary pair one day apart", () => {
    const ds = generateDataset({ now: NOW });
    const kindOf = (cohort: string, at?: Date) => evaluateSeedProfile(ds.profiles.find((p) => p.cohort === cohort)!, ds, { at }).kind;
    for (const [inside, outside] of [
      ["boundary_open_89d", "boundary_open_91d"],
      ["boundary_click_179d", "boundary_click_181d"],
      ["boundary_purchase_364d", "boundary_purchase_366d"],
      ["boundary_site_179d", "boundary_site_181d"],
      ["boundary_created_89d", "boundary_created_91d"],
    ] as const) {
      expect(kindOf(inside), inside).toBe("protected");
      expect(kindOf(outside), outside).toBe("candidate");
      // The inside case ages out of its window once a full day has passed.
      expect(kindOf(inside, new Date(NOW.getTime() + DAY)), `${inside} a day later`).toBe("candidate");
    }
  });

  it("predicts that every profile is protected as new when Klaviyo's real created date is used", () => {
    const ds = generateDataset({ now: NOW });
    const kinds = new Set(
      ds.profiles.filter((p) => !p.suppressed).map((p) => evaluateSeedProfile(p, ds, { createdAt: ds.now }).kind),
    );
    expect([...kinds]).toEqual(["protected"]);
  });
});
