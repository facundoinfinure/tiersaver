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
 * ## How engagement is read (design decision, 2026-11-25, revised the same day)
 *
 * The default rules are Klaviyo's own "long-term inactive" criteria: created
 * at least 365 days ago, 5 or more emails received in the last 504 days, and
 * NO open, click, site visit, product view, checkout or order at any time.
 * So the questions are "did this profile EVER do X" and "how many emails did
 * it receive", over the account's whole history. GET /api/profiles answers
 * neither. Options checked against the 2026-10-15 spec:
 *
 * 1. One segment holding exactly those conditions, evaluated by Klaviyo
 *    (chosen; `buildCandidateSegmentDefinition` in api.ts). Klaviyo already
 *    has every event indexed, "over all time" included, so the answer covers
 *    the full history at no extra cost, and it is the same engine Klaviyo's
 *    own recommendation uses. We read the members (100 per request). Only
 *    members can become candidates, so every failure mode is safe: a segment
 *    that is missing, processing, deactivated or edited yields no candidates.
 *    Costs: the `segments:write` scope, one segment visible in the merchant's
 *    account, and a per-profile answer that is yes/no without dates.
 * 2. Events API, scanning each metric. Gives dates, needs read scopes only.
 *    But "ever" means reading the account's entire open / click / order /
 *    site history, and the received count means reading every send of the
 *    last 72 weeks, then counting per profile without double counting across
 *    retries. See the budget below. Kept as an alternative reader
 *    (`listEngagementEventsPage`, `foldEngagement`), not used and not scoped.
 * 3. Query Metric Aggregates: cannot group by profile. Not usable.
 * 4. Events per profile: one request per profile per metric. Not usable.
 *
 * Request budget for an account with 150,000 profiles. Counts of profiles and
 * pages are exact; shares and event volumes are ESTIMATES that depend on the
 * merchant, shown so the orders of magnitude can be compared.
 *
 *   Segment path (chosen)
 *     metrics list                                   1-2
 *     find segment by name                           1
 *     create / update segment                        0 (1 when rules change)
 *     poll until processed                           a few
 *     members, 100 per page: 20% inactive = 30,000   300   (worst case 1,500)
 *     protected group members, 100 per page          e.g. 50 for 5,000 VIPs
 *     total                                          ~360  (worst case ~1,560)
 *   Fits one Workers Paid invocation (1,000 subrequests) in the usual case and
 *   takes about a minute at half the published rate; on Workers Free (50) it
 *   needs about 8 invocations. Segment writes: 1 per rules change, against a
 *   limit of 100 per day per account.
 *
 *   Events path (rejected for "ever" rules)
 *     received, 504 days: 150,000 x ~60% x ~8/month x 16.5  ~12,000,000 events = ~12,000 requests
 *     opens, all time: several times that                    tens of thousands
 *     clicks, orders, checkouts, site, product views         thousands more
 *     profiles, 100 per page                                 1,500
 *     total                                                  30,000+ requests and millions of rows to hold
 *
 * Every reader is still page-at-a-time with a cursor, so the caller decides
 * how much fits in one invocation and can resume anywhere.
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
 * Events path only (alternative reader, see above).
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
      case "viewedProduct":
        e.lastSiteActivityAt = later(e.lastSiteActivityAt, event.at);
        break;
      case "received":
        // Deliberately not counted here: a count is not idempotent, so a page read
        // twice would inflate it, and a higher count is what makes a candidate.
        break;
    }
  }
  return state;
}

/** Something we could not read for a profile; each one forces protection. */
export type SignalGap =
  | "send_history_unknown"
  | "created_unknown"
  | "email_subscription_unknown"
  | "sms_consent_unknown"
  | "protected_group_membership_unknown";

export interface ProfileContext {
  /**
   * Set when the profile was read as a member of the candidate segment, from
   * a segment that was not processing, was active and had the expected
   * definition. Klaviyo then vouches that the profile received at least
   * `minEmailsReceived` emails in the send window and has none of the events
   * the definition excludes. Leave it out for any other profile.
   */
  candidateSegment?: { minEmailsReceived: number } | null;
  /** Events path: engagement folded from the Events API. */
  engagement?: ProfileEngagement | null;
  /** Events path: emails received in the send window, when counted reliably. */
  emailsReceived?: number | null;
  /** Last order of this email in Shopify (matched by hash); null when there is none on record. */
  shopifyLastPurchaseAt?: Date | null;
  /**
   * Whether the profile is in a list/segment the merchant protects. Pass null
   * when that is not known for certain (a membership scan did not finish, or a
   * protected group could not be read): the profile is then treated as a member.
   */
  inProtectedGroup: boolean | null;
  /** Last time TierSaver unsuppressed this profile (an undo run), from our own run history. */
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
 * - emails received unknown (not a segment member, not counted) ->
 *   `emailsReceived: null` (engine: unknown_send_history)
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

  // Emails received. For a segment member this is the minimum Klaviyo vouched for, not the exact count.
  let emailsReceived: number | null = null;
  const vouched = context.candidateSegment?.minEmailsReceived;
  if (typeof vouched === "number" && Number.isFinite(vouched) && vouched >= 1) emailsReceived = vouched;
  else if (typeof context.emailsReceived === "number" && Number.isFinite(context.emailsReceived) && context.emailsReceived >= 0) {
    emailsReceived = context.emailsReceived;
  }
  if (emailsReceived === null) gaps.push("send_history_unknown");

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
      emailsReceived,
      smsConsent,
      inProtectedGroup,
      reactivatedAt: context.reactivatedAt ?? null,
    },
    gaps,
  };
}

/**
 * Coverage for profiles read as members of the candidate segment.
 *
 * Klaviyo evaluated the segment's conditions over its complete event history,
 * so engagement and site activity are covered from the beginning of time
 * (which satisfies the "ever" rules for a profile of any age). Purchases also
 * need our own Shopify order data: pass how far back it is complete, or null
 * when it is not (then every member is protected by the purchase rule, and
 * under an "ever" rule so is every member older than the order data).
 *
 * Valid only together with `ProfileContext.candidateSegment`, i.e. for
 * profiles that really came out of a verified segment read.
 */
export function candidateSegmentCoverage(input: { shopifyOrdersSince: Date | null }): DataCoverage {
  const beginning = new Date(0);
  return { engagementSince: beginning, purchasesSince: input.shopifyOrdersSince, siteActivitySince: beginning };
}

/** Events path: the outcome of scanning one signal's events. */
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
 * Events path only. How far back the data can be trusted. A window counts only if its scan
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
