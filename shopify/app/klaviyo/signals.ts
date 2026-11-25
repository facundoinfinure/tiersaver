import type { DataCoverage, ProfileSignals } from "@tiersaver/core";
import type { EngagementEvent, KlaviyoProfileRecord } from "./api";
import type { EngagementSignal } from "./config";

/**
 * From Klaviyo data to the rule engine's inputs (`ProfileSignals`,
 * `DataCoverage`). Pure functions, no I/O.
 *
 * One rule governs everything here: missing, unknown or unreadable data must
 * end in protection, never in candidacy. Each unknown is therefore replaced by
 * the value that protects, and reported in `gaps` so the UI can say why.
 *
 * ## How engagement is read (design decision, 2026-11-25)
 *
 * GET /api/profiles has no "last opened / clicked / ordered" field, so the
 * dates come from somewhere else. Options checked against the 2026-10-15 spec:
 *
 * 1. Events API, one scan per metric over the rule window (chosen).
 *    GET /api/events?filter=equals(metric_id,..),greater-or-equal(datetime,..)
 *    returns up to 1,000 events per request with the profile id in
 *    `relationships`, at 350/s and 3,500/m. Gives real dates (what
 *    `ProfileSignals` needs), tells machine opens apart, needs read scopes
 *    only, creates nothing in the merchant's account, works unchanged on the
 *    seeded test account (different metric ids), and an interrupted scan is
 *    simply "coverage unknown". Cost grows with event volume, not profiles.
 * 2. Segments with metric conditions ("opened 0 times in 90 days"). Bounded by
 *    profile count (members are read 100 per request), but needs
 *    `segments:write`, leaves segments visible in the merchant's account, is
 *    limited to 100 segment creations per day per account, yields only
 *    yes/no (no dates), bakes the merchant's thresholds into the segment, and
 *    a segment that is still processing looks exactly like "nobody engaged",
 *    which is the unsafe direction.
 * 3. Query Metric Aggregates: cannot group by profile (the `by` enum has no
 *    profile dimension). Not usable.
 * 4. Events per profile: one request per profile per metric. Not usable.
 *
 * Request budget for an account with 150,000 profiles (the profile and group
 * numbers are exact; event volumes are ESTIMATES that depend on how much the
 * merchant sends):
 *   profiles            150,000 / 100            = 1,500 requests
 *   metrics             1-2 pages                = 2
 *   opens, 90 days      ~750,000 events / 1,000  = ~750
 *   clicks, 180 days    ~90,000 / 1,000          = ~90
 *   orders, 365 days    ~60,000 / 1,000          = ~60
 *   checkouts, 180 days ~50,000 / 1,000          = ~50
 *   active on site, 180 days ~500,000 / 1,000    = ~500
 *   protected groups    members / 100 per group  = e.g. 50 for 5,000 VIPs
 *   account + billing usage                      = 2
 *   total                                        ≈ 3,000 (1,500 fixed + events)
 * At half the published rate limits that is about 5 minutes of wall time,
 * dominated by the profile pages. It does not fit in one Worker invocation
 * (1,000 subrequests on Workers Paid, 50 on Free), so every reader is
 * page-at-a-time and the audit has to run as resumable steps.
 */

export interface ProfileEngagement {
  lastOpenAt: Date | null;
  lastOpenIsMachine: boolean;
  lastHumanOpenAt: Date | null;
  lastClickAt: Date | null;
  /** From Klaviyo's order metric. Shopify orders are merged in `toProfileSignals`. */
  lastOrderAt: Date | null;
  /** Latest of "checkout started" and "active on site". */
  lastSiteActivityAt: Date | null;
}

export function emptyEngagement(): ProfileEngagement {
  return {
    lastOpenAt: null,
    lastOpenIsMachine: false,
    lastHumanOpenAt: null,
    lastClickAt: null,
    lastOrderAt: null,
    lastSiteActivityAt: null,
  };
}

function later(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Adds one page of events of `signal` to the per-profile state. Order does not
 * matter, and feeding the same page twice changes nothing, so a resumed scan
 * can safely re-read its last page.
 */
export function foldEngagement(
  state: Map<string, ProfileEngagement>,
  signal: EngagementSignal,
  events: readonly EngagementEvent[],
): Map<string, ProfileEngagement> {
  for (const event of events) {
    let e = state.get(event.profileId);
    if (!e) {
      e = emptyEngagement();
      state.set(event.profileId, e);
    }
    switch (signal) {
      case "open": {
        const t = event.at.getTime();
        const current = e.lastOpenAt?.getTime() ?? Number.NEGATIVE_INFINITY;
        if (t > current) {
          e.lastOpenAt = event.at;
          e.lastOpenIsMachine = event.machineOpen;
        } else if (t === current && !event.machineOpen) {
          // Two opens at the same instant, one of them a person's: the person wins.
          e.lastOpenIsMachine = false;
        }
        if (!event.machineOpen) e.lastHumanOpenAt = later(e.lastHumanOpenAt, event.at);
        break;
      }
      case "click":
        e.lastClickAt = later(e.lastClickAt, event.at);
        break;
      case "purchase":
        e.lastOrderAt = later(e.lastOrderAt, event.at);
        break;
      case "checkout":
      case "activeOnSite":
        e.lastSiteActivityAt = later(e.lastSiteActivityAt, event.at);
        break;
    }
  }
  return state;
}

/** Something we could not read for a profile; each one forces protection. */
export type SignalGap =
  | "created_unknown"
  | "email_subscription_unknown"
  | "sms_consent_unknown"
  | "protected_group_membership_unknown";

export interface ProfileContext {
  /** Engagement folded from the Events API; undefined when the profile had no events in the scanned windows. */
  engagement?: ProfileEngagement | null;
  /** Last order of this email in Shopify (matched by hash); null when there is none on record. */
  shopifyLastPurchaseAt?: Date | null;
  /**
   * Whether the profile is in a list/segment the merchant protects. Pass null
   * when that is not known for certain (a membership scan did not finish, or a
   * protected group could not be read): the profile is then treated as a member.
   */
  inProtectedGroup: boolean | null;
  /** Last time TierSaver unsuppressed this profile (undo or reactivation), from our own run history. */
  reactivatedAt?: Date | null;
  /**
   * Test accounts only: use the profile's seeded creation date instead of
   * Klaviyo's (which is always the import time). Never set for a merchant.
   */
  useTestCreatedAt?: boolean;
}

export interface MappedProfile {
  signals: ProfileSignals;
  gaps: SignalGap[];
}

/**
 * Builds the rule engine's view of one profile.
 *
 * Unknowns and what they become:
 * - creation date missing            -> `createdAt: null` (engine: unknown_profile_age)
 * - email subscription data missing  -> not treated as suppressed (so it is
 *   evaluated and counted as billable) and `smsConsent: true` to force protection
 * - SMS consent missing or unreadable -> `smsConsent: true`
 * - protected group membership unknown -> `inProtectedGroup: true`
 * A profile with any gap can never come out as a candidate.
 *
 * SMS consent is true when Klaviyo says the profile can receive SMS marketing
 * or its consent is SUBSCRIBED. Any consent value other than the known
 * negative ones also counts as consent.
 */
export function toProfileSignals(profile: KlaviyoProfileRecord, context: ProfileContext): MappedProfile {
  const gaps: SignalGap[] = [];
  const engagement = context.engagement ?? emptyEngagement();

  // Age: Klaviyo's creation date or the email consent date, whichever is later.
  const created = context.useTestCreatedAt ? (profile.testCreatedAt ?? null) : profile.createdAt;
  let createdAt: Date | null = null;
  if (!created) gaps.push("created_unknown");
  else createdAt = later(created, profile.email?.consentAt);

  // Email suppression.
  let emailSuppressed = false;
  let forceProtection = false;
  if (!profile.email || profile.email.canReceiveMarketing === null) {
    if (profile.emailHash !== null) {
      gaps.push("email_subscription_unknown");
      forceProtection = true;
    }
    // Explicit suppression reasons are still facts, even when the summary flag is missing.
    emailSuppressed = (profile.email?.suppressionReasons.length ?? 0) > 0;
  } else {
    emailSuppressed = profile.email.suppressionReasons.length > 0 || profile.email.canReceiveMarketing === false;
  }

  // SMS consent.
  let smsConsent: boolean;
  const NO_CONSENT = new Set(["NEVER_SUBSCRIBED", "UNSUBSCRIBED"]);
  if (!profile.sms || profile.sms.canReceiveMarketing === null || profile.sms.consent === null) {
    gaps.push("sms_consent_unknown");
    smsConsent = true;
  } else {
    smsConsent =
      profile.sms.canReceiveMarketing === true ||
      profile.sms.consent === "SUBSCRIBED" ||
      !NO_CONSENT.has(profile.sms.consent);
  }
  if (forceProtection) smsConsent = true;

  // Protected groups.
  let inProtectedGroup: boolean;
  if (context.inProtectedGroup === null || context.inProtectedGroup === undefined) {
    gaps.push("protected_group_membership_unknown");
    inProtectedGroup = true;
  } else {
    inProtectedGroup = context.inProtectedGroup;
  }

  return {
    signals: {
      id: profile.id,
      hasEmail: profile.emailHash !== null,
      emailSuppressed,
      createdAt,
      lastOpenAt: engagement.lastOpenAt,
      lastOpenIsMachine: engagement.lastOpenAt ? engagement.lastOpenIsMachine : false,
      lastHumanOpenAt: engagement.lastHumanOpenAt,
      lastClickAt: engagement.lastClickAt,
      lastPurchaseAt: later(engagement.lastOrderAt, context.shopifyLastPurchaseAt),
      lastSiteActivityAt: engagement.lastSiteActivityAt,
      smsConsent,
      inProtectedGroup,
      reactivatedAt: context.reactivatedAt ?? null,
    },
    gaps,
  };
}

/** The outcome of scanning one signal's events. */
export interface SignalScan {
  /** Metric ids scanned. Empty means the metric was not found in the account. */
  metricIds: readonly string[];
  /** Start of the scanned window (the `since` passed to the Events API). */
  since: Date;
  /** True only when every metric id was read through to its last page. */
  complete: boolean;
  /** Sum of `unattributed` over all pages read. */
  unattributed: number;
}

function scanCovers(scan: SignalScan | null | undefined): scan is SignalScan {
  return Boolean(scan && scan.metricIds.length > 0 && scan.complete && scan.unattributed === 0);
}

/**
 * How far back the data can be trusted. A window counts only if its scan
 * found the metric, finished, and attributed every event; anything less is
 * "unknown" (null), and the rule engine then protects every profile that has
 * no recent event of that kind.
 *
 * - Engagement needs both opens and clicks; it reaches back to the later of
 *   the two scan starts.
 * - Purchases need BOTH sources: Shopify orders (`shopifyOrdersSince`, null
 *   until read_all_orders allows a full window) and Klaviyo's order metric.
 * - Site activity: checkout and active-on-site scans. If either is missing
 *   the rule is "not tracked" (null), as the engine defines it.
 */
export function buildDataCoverage(input: {
  open: SignalScan | null;
  click: SignalScan | null;
  purchase: SignalScan | null;
  shopifyOrdersSince: Date | null;
  checkout?: SignalScan | null;
  activeOnSite?: SignalScan | null;
}): DataCoverage {
  const latest = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

  const engagementSince =
    scanCovers(input.open) && scanCovers(input.click) ? latest(input.open.since, input.click.since) : null;

  const purchasesSince =
    scanCovers(input.purchase) && input.shopifyOrdersSince
      ? latest(input.purchase.since, input.shopifyOrdersSince)
      : null;

  const siteActivitySince =
    scanCovers(input.checkout) && scanCovers(input.activeOnSite)
      ? latest(input.checkout.since, input.activeOnSite.since)
      : null;

  return { engagementSince, purchasesSince, siteActivitySince };
}
