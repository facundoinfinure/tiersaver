import { DEFAULT_RULE_SETTINGS, evaluateProfile, type DataCoverage, type Decision } from "@tiersaver/core";
import { describe, expect, it } from "vitest";
import type { EngagementEvent, KlaviyoProfileRecord } from "../app/klaviyo/api";
import {
  buildDataCoverage,
  emptyEngagement,
  foldEngagement,
  toProfileSignals,
  type ProfileContext,
  type ProfileEngagement,
  type SignalScan,
} from "../app/klaviyo/signals";

const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** Coverage that reaches far enough back for every rule. */
const FULL: DataCoverage = { engagementSince: daysAgo(400), purchasesSince: daysAgo(400), siteActivitySince: daysAgo(400) };

/** An old, subscribed, never-engaged profile with complete data: the textbook candidate. */
function profile(overrides: Partial<KlaviyoProfileRecord> = {}): KlaviyoProfileRecord {
  return {
    id: "P1",
    emailHash: "a".repeat(64),
    createdAt: daysAgo(800),
    lastEventAt: daysAgo(500),
    email: { canReceiveMarketing: true, consent: "SUBSCRIBED", consentAt: daysAgo(790), suppressionReasons: [] },
    sms: { canReceiveMarketing: false, consent: "NEVER_SUBSCRIBED" },
    ...overrides,
  };
}

const KNOWN: ProfileContext = { inProtectedGroup: false };

function decide(p: KlaviyoProfileRecord, context: ProfileContext = KNOWN, coverage = FULL, settings = DEFAULT_RULE_SETTINGS): Decision {
  return evaluateProfile(toProfileSignals(p, context).signals, settings, coverage, NOW);
}

function reasons(d: Decision): string[] {
  return d.kind === "protected" ? d.reasons : [];
}

const event = (profileId: string, days: number, machineOpen = false): EngagementEvent => ({ profileId, at: daysAgo(days), machineOpen });

describe("toProfileSignals: complete data", () => {
  it("a profile with complete data and no activity is a candidate (the baseline every other test moves away from)", () => {
    const mapped = toProfileSignals(profile(), KNOWN);
    expect(mapped.gaps).toEqual([]);
    expect(mapped.signals).toEqual({
      id: "P1",
      hasEmail: true,
      emailSuppressed: false,
      createdAt: daysAgo(790),
      lastOpenAt: null,
      lastOpenIsMachine: false,
      lastHumanOpenAt: null,
      lastClickAt: null,
      lastPurchaseAt: null,
      lastSiteActivityAt: null,
      smsConsent: false,
      inProtectedGroup: false,
      reactivatedAt: null,
    });
    expect(decide(profile())).toEqual({ kind: "candidate", reason: "never_engaged" });
  });

  it("uses the later of creation and email consent as the profile age", () => {
    const recentlyResubscribed = profile({
      email: { canReceiveMarketing: true, consent: "SUBSCRIBED", consentAt: daysAgo(10), suppressionReasons: [] },
    });
    expect(toProfileSignals(recentlyResubscribed, KNOWN).signals.createdAt).toEqual(daysAgo(10));
    expect(reasons(decide(recentlyResubscribed))).toContain("new_profile");
  });

  it("skips profiles that are already suppressed or have no email", () => {
    for (const reason of ["USER_SUPPRESSED", "UNSUBSCRIBE", "HARD_BOUNCE", "INVALID_EMAIL", "SPAM_COMPLAINT"]) {
      const p = profile({ email: { canReceiveMarketing: false, consent: "SUBSCRIBED", consentAt: null, suppressionReasons: [reason] } });
      expect(decide(p)).toEqual({ kind: "skipped", reason: "already_suppressed" });
    }
    const flagOnly = profile({ email: { canReceiveMarketing: false, consent: "UNSUBSCRIBED", consentAt: null, suppressionReasons: [] } });
    expect(decide(flagOnly)).toEqual({ kind: "skipped", reason: "already_suppressed" });
    expect(decide(profile({ emailHash: null }))).toEqual({ kind: "skipped", reason: "no_email" });
  });

  it("protects SMS consent, protected groups and recent reactivation", () => {
    expect(reasons(decide(profile({ sms: { canReceiveMarketing: true, consent: "SUBSCRIBED" } })))).toEqual(["sms_consent"]);
    // Either positive signal is enough.
    expect(reasons(decide(profile({ sms: { canReceiveMarketing: false, consent: "SUBSCRIBED" } })))).toEqual(["sms_consent"]);
    expect(reasons(decide(profile({ sms: { canReceiveMarketing: true, consent: "NEVER_SUBSCRIBED" } })))).toEqual(["sms_consent"]);
    expect(decide(profile({ sms: { canReceiveMarketing: false, consent: "UNSUBSCRIBED" } })).kind).toBe("candidate");

    expect(reasons(decide(profile(), { inProtectedGroup: true }))).toEqual(["protected_group"]);
    expect(reasons(decide(profile(), { inProtectedGroup: false, reactivatedAt: daysAgo(30) }))).toEqual(["recently_reactivated"]);
    expect(decide(profile(), { inProtectedGroup: false, reactivatedAt: daysAgo(120) }).kind).toBe("candidate");
  });

  it("merges Shopify and Klaviyo purchases and takes the most recent", () => {
    const engagement: ProfileEngagement = { ...emptyEngagement(), lastOrderAt: daysAgo(500) };
    const both = toProfileSignals(profile(), { inProtectedGroup: false, engagement, shopifyLastPurchaseAt: daysAgo(100) });
    expect(both.signals.lastPurchaseAt).toEqual(daysAgo(100));
    expect(reasons(decide(profile(), { inProtectedGroup: false, engagement, shopifyLastPurchaseAt: daysAgo(100) }))).toEqual(["recent_purchase"]);
    // Only Klaviyo knows about a recent order: still protected.
    const klaviyoOnly: ProfileEngagement = { ...emptyEngagement(), lastOrderAt: daysAgo(20) };
    expect(reasons(decide(profile(), { inProtectedGroup: false, engagement: klaviyoOnly, shopifyLastPurchaseAt: null }))).toEqual(["recent_purchase"]);
    // Old purchases on both sides: lapsed.
    expect(decide(profile(), { inProtectedGroup: false, engagement, shopifyLastPurchaseAt: daysAgo(600) })).toEqual({
      kind: "candidate",
      reason: "lapsed",
    });
  });
});

describe("toProfileSignals: missing or unknown data always protects", () => {
  const cases: [string, KlaviyoProfileRecord, ProfileContext, string, string][] = [
    ["creation date missing", profile({ createdAt: null }), KNOWN, "created_unknown", "unknown_profile_age"],
    [
      "creation date missing even though consent has a date",
      profile({ createdAt: null, email: { canReceiveMarketing: true, consent: "SUBSCRIBED", consentAt: daysAgo(700), suppressionReasons: [] } }),
      KNOWN,
      "created_unknown",
      "unknown_profile_age",
    ],
    ["no subscription data at all", profile({ email: null, sms: null }), KNOWN, "email_subscription_unknown", "sms_consent"],
    ["email subscription block missing", profile({ email: null }), KNOWN, "email_subscription_unknown", "sms_consent"],
    [
      "email can-receive flag unreadable",
      profile({ email: { canReceiveMarketing: null, consent: "SUBSCRIBED", consentAt: null, suppressionReasons: [] } }),
      KNOWN,
      "email_subscription_unknown",
      "sms_consent",
    ],
    ["SMS block missing", profile({ sms: null }), KNOWN, "sms_consent_unknown", "sms_consent"],
    ["SMS flag unreadable", profile({ sms: { canReceiveMarketing: null, consent: "NEVER_SUBSCRIBED" } }), KNOWN, "sms_consent_unknown", "sms_consent"],
    ["SMS consent value missing", profile({ sms: { canReceiveMarketing: false, consent: null } }), KNOWN, "sms_consent_unknown", "sms_consent"],
    ["group membership unknown", profile(), { inProtectedGroup: null }, "protected_group_membership_unknown", "protected_group"],
    [
      "seeded creation date requested but absent",
      profile({ testCreatedAt: null }),
      { inProtectedGroup: false, useTestCreatedAt: true },
      "created_unknown",
      "unknown_profile_age",
    ],
  ];

  it.each(cases)("%s", (_name, p, context, gap, reason) => {
    const mapped = toProfileSignals(p, context);
    expect(mapped.gaps).toContain(gap);
    const decision = evaluateProfile(mapped.signals, DEFAULT_RULE_SETTINGS, FULL, NOW);
    expect(decision.kind).toBe("protected");
    expect(reasons(decision)).toContain(reason);
  });

  it("an SMS consent value we do not know counts as consent", () => {
    const p = profile({ sms: { canReceiveMarketing: false, consent: "PENDING_DOUBLE_OPT_IN" } });
    expect(reasons(decide(p))).toEqual(["sms_consent"]);
  });

  it("a profile with unknown subscription data is still counted as billable, not hidden as suppressed", () => {
    const mapped = toProfileSignals(profile({ email: null }), KNOWN);
    expect(mapped.signals.emailSuppressed).toBe(false);
    // But an explicit suppression reason remains a fact.
    const reasonOnly = profile({ email: { canReceiveMarketing: null, consent: null, consentAt: null, suppressionReasons: ["HARD_BOUNCE"] } });
    expect(decide(reasonOnly)).toEqual({ kind: "skipped", reason: "already_suppressed" });
  });

  it("a context without membership information is treated as unknown", () => {
    const mapped = toProfileSignals(profile(), {} as ProfileContext);
    expect(mapped.signals.inProtectedGroup).toBe(true);
    expect(mapped.gaps).toEqual(["protected_group_membership_unknown"]);
  });

  it("no combination of gaps can produce a candidate", () => {
    const emails = [profile().email, null, { canReceiveMarketing: null, consent: null, consentAt: null, suppressionReasons: [] }];
    const smses = [profile().sms, null, { canReceiveMarketing: null, consent: null }, { canReceiveMarketing: false, consent: null }];
    const createds = [daysAgo(800), null];
    const memberships: (boolean | null)[] = [false, null];
    let checked = 0;
    for (const email of emails)
      for (const sms of smses)
        for (const createdAt of createds)
          for (const inProtectedGroup of memberships) {
            const mapped = toProfileSignals(profile({ email, sms, createdAt }), { inProtectedGroup });
            const decision = evaluateProfile(mapped.signals, DEFAULT_RULE_SETTINGS, FULL, NOW);
            if (mapped.gaps.length === 0) expect(decision.kind).toBe("candidate");
            else expect(decision.kind).toBe("protected");
            checked++;
          }
    expect(checked).toBe(48);
  });

  it("the seeded creation date is used only on request", () => {
    const seeded = profile({ createdAt: daysAgo(1), testCreatedAt: daysAgo(800) });
    expect(reasons(decide(seeded))).toContain("new_profile");
    expect(decide(seeded, { inProtectedGroup: false, useTestCreatedAt: true }).kind).toBe("candidate");
  });
});

describe("foldEngagement", () => {
  it("keeps the most recent date per profile and signal, in any order, idempotently", () => {
    const state = new Map<string, ProfileEngagement>();
    const opens = [event("A", 200), event("A", 20), event("A", 50), event("B", 5)];
    foldEngagement(state, "open", opens);
    foldEngagement(state, "open", opens); // a resumed scan re-reads a page
    foldEngagement(state, "click", [event("A", 300), event("A", 150)]);
    foldEngagement(state, "purchase", [event("A", 400)]);
    foldEngagement(state, "checkout", [event("A", 90)]);
    foldEngagement(state, "activeOnSite", [event("A", 60), event("A", 120)]);
    expect(state.get("A")).toEqual({
      lastOpenAt: daysAgo(20),
      lastOpenIsMachine: false,
      lastHumanOpenAt: daysAgo(20),
      lastClickAt: daysAgo(150),
      lastOrderAt: daysAgo(400),
      lastSiteActivityAt: daysAgo(60),
    });
    expect(state.get("B")?.lastOpenAt).toEqual(daysAgo(5));
    expect(state.has("C")).toBe(false);
  });

  it("tracks machine opens separately from human opens", () => {
    const state = new Map<string, ProfileEngagement>();
    foldEngagement(state, "open", [event("A", 100, false), event("A", 10, true), event("B", 10, true), event("C", 10, true), event("C", 10, false)]);
    expect(state.get("A")).toMatchObject({ lastOpenAt: daysAgo(10), lastOpenIsMachine: true, lastHumanOpenAt: daysAgo(100) });
    expect(state.get("B")).toMatchObject({ lastOpenAt: daysAgo(10), lastOpenIsMachine: true, lastHumanOpenAt: null });
    // Same instant, one machine and one human open: it counts as human, whatever the order.
    expect(state.get("C")).toMatchObject({ lastOpenIsMachine: false, lastHumanOpenAt: daysAgo(10) });
    const reversed = foldEngagement(new Map(), "open", [event("C", 10, false), event("C", 10, true)]);
    expect(reversed.get("C")).toMatchObject({ lastOpenIsMachine: false, lastHumanOpenAt: daysAgo(10) });
  });
});

describe("machine opens end to end (event -> signals -> decision)", () => {
  const ignoreMachine = { ...DEFAULT_RULE_SETTINGS, countMachineOpens: false };
  const withOpens = (events: EngagementEvent[]): ProfileContext => ({
    inProtectedGroup: false,
    engagement: foldEngagement(new Map(), "open", events).get("P1"),
  });

  it("by default every recent open protects, machine or not", () => {
    expect(reasons(decide(profile(), withOpens([event("P1", 10, true)])))).toEqual(["recent_open"]);
    expect(reasons(decide(profile(), withOpens([event("P1", 10, false)])))).toEqual(["recent_open"]);
  });

  it("when the merchant ignores machine opens, only an open clearly flagged as machine stops protecting", () => {
    const flagged = withOpens([event("P1", 10, true)]);
    expect(decide(profile(), flagged, FULL, ignoreMachine)).toEqual({ kind: "candidate", reason: "lapsed" });
    // An open whose flag was missing, unknown or not requested arrives as machineOpen = false: it protects.
    const unflagged = withOpens([event("P1", 10, false)]);
    expect(reasons(decide(profile(), unflagged, FULL, ignoreMachine))).toEqual(["recent_open"]);
    // A machine open after a recent human open: the human one still protects.
    const mixed = withOpens([event("P1", 40, false), event("P1", 5, true)]);
    expect(reasons(decide(profile(), mixed, FULL, ignoreMachine))).toEqual(["recent_open"]);
    // A machine open after an old human open: nothing recent from a person.
    const stale = withOpens([event("P1", 200, false), event("P1", 5, true)]);
    expect(decide(profile(), stale, FULL, ignoreMachine).kind).toBe("candidate");
  });
});

describe("buildDataCoverage", () => {
  const scan = (days: number, overrides: Partial<SignalScan> = {}): SignalScan => ({
    metricIds: ["M1"],
    since: daysAgo(days),
    complete: true,
    unattributed: 0,
    ...overrides,
  });
  const full = { open: scan(180), click: scan(180), purchase: scan(365), shopifyOrdersSince: daysAgo(365), checkout: scan(180), activeOnSite: scan(180) };

  it("reports how far back each window reaches when every scan is complete", () => {
    expect(buildDataCoverage(full)).toEqual({
      engagementSince: daysAgo(180),
      purchasesSince: daysAgo(365),
      siteActivitySince: daysAgo(180),
    });
    // The shorter of two windows limits the coverage.
    expect(buildDataCoverage({ ...full, open: scan(90) }).engagementSince).toEqual(daysAgo(90));
    expect(buildDataCoverage({ ...full, shopifyOrdersSince: daysAgo(60) }).purchasesSince).toEqual(daysAgo(60));
  });

  it.each([
    ["open metric not found", { open: scan(180, { metricIds: [] }) }],
    ["open scan not run", { open: null }],
    ["open scan interrupted", { open: scan(180, { complete: false }) }],
    ["open events without a profile", { open: scan(180, { unattributed: 3 }) }],
    ["click metric not found", { click: scan(180, { metricIds: [] }) }],
    ["click scan interrupted", { click: scan(180, { complete: false }) }],
  ])("engagement coverage is unknown when: %s", (_name, change) => {
    const coverage = buildDataCoverage({ ...full, ...change });
    expect(coverage.engagementSince).toBeNull();
    const decision = decide(profile(), KNOWN, coverage);
    expect(decision.kind).toBe("protected");
    expect(reasons(decision)).toContain("insufficient_engagement_history");
  });

  it.each([
    ["Klaviyo order metric not found", { purchase: scan(365, { metricIds: [] }) }],
    ["Klaviyo order scan interrupted", { purchase: scan(365, { complete: false }) }],
    ["Klaviyo order scan not run", { purchase: null }],
    ["Shopify orders not covered", { shopifyOrdersSince: null }],
  ])("purchase coverage is unknown when: %s", (_name, change) => {
    const coverage = buildDataCoverage({ ...full, ...change });
    expect(coverage.purchasesSince).toBeNull();
    const decision = decide(profile(), KNOWN, coverage);
    expect(decision.kind).toBe("protected");
    expect(reasons(decision)).toContain("insufficient_purchase_history");
  });

  it("windows shorter than the rule protect too (60 days of Shopify orders against a 365-day rule)", () => {
    const coverage = buildDataCoverage({ ...full, shopifyOrdersSince: daysAgo(60) });
    expect(reasons(decide(profile(), KNOWN, coverage))).toContain("insufficient_purchase_history");
    const shortEngagement = buildDataCoverage({ ...full, open: scan(30), click: scan(30) });
    expect(reasons(decide(profile(), KNOWN, shortEngagement))).toContain("insufficient_engagement_history");
  });

  it("site activity is 'not tracked' unless both of its scans are complete", () => {
    expect(buildDataCoverage({ ...full, activeOnSite: null }).siteActivitySince).toBeNull();
    expect(buildDataCoverage({ ...full, checkout: scan(180, { complete: false }) }).siteActivitySince).toBeNull();
    const { checkout: _c, activeOnSite: _a, ...withoutSite } = full;
    expect(buildDataCoverage(withoutSite).siteActivitySince).toBeNull();
  });

  it("with full coverage and complete data the candidate is still a candidate", () => {
    expect(decide(profile(), KNOWN, buildDataCoverage({ ...full, open: scan(400), click: scan(400), purchase: scan(400), shopifyOrdersSince: daysAgo(400) })).kind).toBe(
      "candidate",
    );
  });
});
