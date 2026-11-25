import { DEFAULT_RULE_SETTINGS, evaluateProfile, type DataCoverage, type Decision } from "@tiersaver/core";
import { describe, expect, it } from "vitest";
import type { EngagementEvent, KlaviyoProfileRecord } from "../app/klaviyo/api";
import {
  buildDataCoverage,
  candidateSegmentCoverage,
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

/**
 * The normal case: the profile came out of the candidate segment, so Klaviyo
 * vouches for its whole engagement history, and our Shopify order data reaches
 * back to before the profile existed.
 */
const FULL: DataCoverage = candidateSegmentCoverage({ shopifyOrdersSince: daysAgo(3000) });

/** The opt-in wider mode: dated windows instead of "ever". */
const WINDOWED = { ...DEFAULT_RULE_SETTINGS, purchaseDays: 365, clickDays: 182, openDays: 182, siteActivityDays: 182 };

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

const MEMBER = { minEmailsReceived: 5 };
const KNOWN: ProfileContext = { inProtectedGroup: false, candidateSegment: MEMBER };

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
      emailsReceived: 5,
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

    expect(reasons(decide(profile(), { ...KNOWN, inProtectedGroup: true }))).toEqual(["protected_group"]);
    // Restored by an undo: out of every run for a year.
    expect(reasons(decide(profile(), { ...KNOWN, reactivatedAt: daysAgo(300) }))).toEqual(["recently_reactivated"]);
    expect(decide(profile(), { ...KNOWN, reactivatedAt: daysAgo(400) }).kind).toBe("candidate");
  });

  it("merges Shopify and Klaviyo purchases and takes the most recent", () => {
    const engagement: ProfileEngagement = { ...emptyEngagement(), lastOrderAt: daysAgo(500) };
    const context: ProfileContext = { ...KNOWN, engagement, shopifyLastPurchaseAt: daysAgo(100) };
    expect(toProfileSignals(profile(), context).signals.lastPurchaseAt).toEqual(daysAgo(100));
    // Default rules: anyone who ever bought is protected, however long ago, from either source.
    expect(reasons(decide(profile(), context))).toEqual(["recent_purchase"]);
    expect(reasons(decide(profile(), { ...KNOWN, shopifyLastPurchaseAt: daysAgo(2000) }))).toEqual(["recent_purchase"]);
    expect(reasons(decide(profile(), { ...KNOWN, engagement: { ...emptyEngagement(), lastOrderAt: daysAgo(2000) } }))).toEqual(["recent_purchase"]);
    // Wider mode with a 365-day purchase window: old purchases on both sides no longer protect.
    expect(decide(profile(), { ...KNOWN, engagement, shopifyLastPurchaseAt: daysAgo(600) }, FULL, WINDOWED)).toEqual({
      kind: "candidate",
      reason: "lapsed",
    });
  });

  it("the profile must be at least a year old", () => {
    expect(reasons(decide(profile({ createdAt: daysAgo(364), email: null as never })))).toContain("new_profile");
    const young = profile({ createdAt: daysAgo(364), email: { canReceiveMarketing: true, consent: "SUBSCRIBED", consentAt: null, suppressionReasons: [] } });
    expect(reasons(decide(young))).toEqual(["new_profile"]);
    const old = profile({ createdAt: daysAgo(366), email: { canReceiveMarketing: true, consent: "SUBSCRIBED", consentAt: null, suppressionReasons: [] } });
    expect(decide(old).kind).toBe("candidate");
  });
});

describe("emails received and the candidate segment", () => {
  it("a profile that did not come out of the candidate segment is never a candidate", () => {
    const mapped = toProfileSignals(profile(), { inProtectedGroup: false });
    expect(mapped.signals.emailsReceived).toBeNull();
    expect(mapped.gaps).toEqual(["send_history_unknown"]);
    expect(reasons(evaluateProfile(mapped.signals, DEFAULT_RULE_SETTINGS, FULL, NOW))).toEqual(["unknown_send_history"]);
    for (const bad of [null, undefined, { minEmailsReceived: 0 }, { minEmailsReceived: Number.NaN }, {} as { minEmailsReceived: number }]) {
      const m = toProfileSignals(profile(), { inProtectedGroup: false, candidateSegment: bad });
      expect(m.signals.emailsReceived).toBeNull();
      expect(evaluateProfile(m.signals, DEFAULT_RULE_SETTINGS, FULL, NOW).kind).toBe("protected");
    }
  });

  it("a member carries the minimum Klaviyo vouched for, checked against the current rules", () => {
    expect(decide(profile(), { inProtectedGroup: false, candidateSegment: { minEmailsReceived: 5 } }).kind).toBe("candidate");
    // The segment was built for 5 but the merchant now requires 8: not enough is known.
    const stricter = { ...DEFAULT_RULE_SETTINGS, minEmailsReceived: 8 };
    expect(reasons(decide(profile(), KNOWN, FULL, stricter))).toEqual(["not_enough_emails_received"]);
  });

  it("an explicit count is used outside the segment path, and bad counts are unknown", () => {
    expect(decide(profile(), { inProtectedGroup: false, emailsReceived: 12 }).kind).toBe("candidate");
    expect(reasons(decide(profile(), { inProtectedGroup: false, emailsReceived: 4 }))).toEqual(["not_enough_emails_received"]);
    expect(reasons(decide(profile(), { inProtectedGroup: false, emailsReceived: 0 }))).toEqual(["not_enough_emails_received"]);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reasons(decide(profile(), { inProtectedGroup: false, emailsReceived: bad }))).toEqual(["unknown_send_history"]);
    }
  });

  it("the Events fold never counts received emails (a re-read page would inflate the count)", () => {
    const state = foldEngagement(new Map(), "received", [event("P1", 10), event("P1", 20), event("P1", 30), event("P1", 40), event("P1", 50)]);
    const mapped = toProfileSignals(profile(), { inProtectedGroup: false, engagement: state.get("P1") });
    expect(mapped.signals.emailsReceived).toBeNull();
  });

  it("segment coverage reaches the beginning of history, but purchases still need Shopify's order data", () => {
    expect(candidateSegmentCoverage({ shopifyOrdersSince: daysAgo(3000) })).toEqual({
      engagementSince: new Date(0),
      purchasesSince: daysAgo(3000),
      siteActivitySince: new Date(0),
    });
    // Order data missing, or younger than the profile: under the "ever" rule we cannot say "never bought".
    expect(reasons(decide(profile(), KNOWN, candidateSegmentCoverage({ shopifyOrdersSince: null })))).toEqual(["insufficient_purchase_history"]);
    expect(reasons(decide(profile(), KNOWN, candidateSegmentCoverage({ shopifyOrdersSince: daysAgo(60) })))).toEqual(["insufficient_purchase_history"]);
    // The profile's age for the rules is the later of creation (800 days) and consent (790 days).
    expect(reasons(decide(profile(), KNOWN, candidateSegmentCoverage({ shopifyOrdersSince: daysAgo(789) })))).toEqual(["insufficient_purchase_history"]);
    expect(decide(profile(), KNOWN, candidateSegmentCoverage({ shopifyOrdersSince: daysAgo(791) })).kind).toBe("candidate");
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
    ["group membership unknown", profile(), { ...KNOWN, inProtectedGroup: null }, "protected_group_membership_unknown", "protected_group"],
    ["not read from the candidate segment", profile(), { inProtectedGroup: false }, "send_history_unknown", "unknown_send_history"],
    [
      "seeded creation date requested but absent",
      profile({ testCreatedAt: null }),
      { ...KNOWN, useTestCreatedAt: true },
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
    expect(mapped.signals.emailsReceived).toBeNull();
    expect(mapped.gaps).toEqual(["send_history_unknown", "protected_group_membership_unknown"]);
  });

  it("no combination of gaps can produce a candidate", () => {
    const emails = [profile().email, null, { canReceiveMarketing: null, consent: null, consentAt: null, suppressionReasons: [] }];
    const smses = [profile().sms, null, { canReceiveMarketing: null, consent: null }, { canReceiveMarketing: false, consent: null }];
    const createds = [daysAgo(800), null];
    const memberships: (boolean | null)[] = [false, null];
    const segments = [MEMBER, null];
    let checked = 0;
    for (const settings of [DEFAULT_RULE_SETTINGS, WINDOWED])
      for (const email of emails)
        for (const sms of smses)
          for (const createdAt of createds)
            for (const inProtectedGroup of memberships)
              for (const candidateSegment of segments) {
                const mapped = toProfileSignals(profile({ email, sms, createdAt }), { inProtectedGroup, candidateSegment });
                const decision = evaluateProfile(mapped.signals, settings, FULL, NOW);
                if (mapped.gaps.length === 0) expect(decision.kind).toBe("candidate");
                else expect(decision.kind).toBe("protected");
                checked++;
              }
    expect(checked).toBe(192);
  });

  it("the seeded creation date is used only on request", () => {
    const seeded = profile({ createdAt: daysAgo(1), testCreatedAt: daysAgo(800) });
    expect(reasons(decide(seeded))).toContain("new_profile");
    expect(decide(seeded, { ...KNOWN, useTestCreatedAt: true }).kind).toBe("candidate");
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
    foldEngagement(state, "activeOnSite", [event("A", 70), event("A", 120)]);
    foldEngagement(state, "viewedProduct", [event("A", 60)]);
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

describe("machine opens end to end (event -> signals -> decision), events path", () => {
  const ignoreMachine = { ...WINDOWED, countMachineOpens: false };
  const withOpens = (events: EngagementEvent[]): ProfileContext => ({
    inProtectedGroup: false,
    emailsReceived: 10,
    engagement: foldEngagement(new Map(), "open", events).get("P1"),
  });

  it("by default every open protects, machine or not, whenever it happened", () => {
    expect(reasons(decide(profile(), withOpens([event("P1", 10, true)])))).toEqual(["recent_open"]);
    expect(reasons(decide(profile(), withOpens([event("P1", 700, true)])))).toEqual(["recent_open"]);
    expect(reasons(decide(profile(), withOpens([event("P1", 10, false)])))).toEqual(["recent_open"]);
    expect(reasons(decide(profile(), withOpens([event("P1", 10, true)]), FULL, WINDOWED))).toEqual(["recent_open"]);
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
    // Under the default "ever" rule the same old human open still protects.
    expect(reasons(decide(profile(), stale, FULL, { ...DEFAULT_RULE_SETTINGS, countMachineOpens: false }))).toEqual(["recent_open"]);
  });
});

describe("buildDataCoverage (events path)", () => {
  const COUNTED: ProfileContext = { inProtectedGroup: false, emailsReceived: 10 };
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
    const decision = decide(profile(), COUNTED, coverage, WINDOWED);
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
    const decision = decide(profile(), COUNTED, coverage, WINDOWED);
    expect(decision.kind).toBe("protected");
    expect(reasons(decision)).toContain("insufficient_purchase_history");
  });

  it("windows shorter than the rule protect too (60 days of Shopify orders against a 365-day rule)", () => {
    const coverage = buildDataCoverage({ ...full, shopifyOrdersSince: daysAgo(60) });
    expect(reasons(decide(profile(), COUNTED, coverage, WINDOWED))).toContain("insufficient_purchase_history");
    const shortEngagement = buildDataCoverage({ ...full, open: scan(30), click: scan(30) });
    expect(reasons(decide(profile(), COUNTED, shortEngagement, WINDOWED))).toContain("insufficient_engagement_history");
  });

  it("site activity is 'not tracked' unless both of its scans are complete", () => {
    expect(buildDataCoverage({ ...full, activeOnSite: null }).siteActivitySince).toBeNull();
    expect(buildDataCoverage({ ...full, checkout: scan(180, { complete: false }) }).siteActivitySince).toBeNull();
    const { checkout: _c, activeOnSite: _a, ...withoutSite } = full;
    expect(buildDataCoverage(withoutSite).siteActivitySince).toBeNull();
  });

  it("windowed scans satisfy the wider mode but never the default 'ever' rules", () => {
    const wide = buildDataCoverage({ ...full, open: scan(400), click: scan(400), purchase: scan(400), shopifyOrdersSince: daysAgo(400) });
    expect(decide(profile(), COUNTED, wide, WINDOWED).kind).toBe("candidate");
    // The profile is 800 days old and the scans cover 400: "never opened" cannot be claimed.
    const strict = decide(profile(), COUNTED, wide);
    expect(strict.kind).toBe("protected");
    expect(reasons(strict)).toEqual(expect.arrayContaining(["insufficient_engagement_history", "insufficient_purchase_history"]));
  });
});
