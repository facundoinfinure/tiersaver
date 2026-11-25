/**
 * Cohort catalogue. Each cohort isolates one rule of packages/core/src/rules.ts
 * so the expected decision is unambiguous, and declares that decision under
 * BOTH rule modes:
 *
 * - default: DEFAULT_RULE_SETTINGS, Klaviyo's own suppression-recommendation
 *   criteria (created 365+ days ago, 5+ emails received in ~72 weeks, never
 *   opened, clicked, visited, started a checkout or purchased);
 * - wide: WIDE_RULE_SETTINGS, the opt-in wider mode at its floors.
 *
 * Ages are in days before the dataset's `now`. Core's window test is
 * `now - date < days`, so an event exactly 181 days old is inside a 182-day
 * window and one exactly 182 days old is outside.
 */
import {
  DEFAULT_RULE_SETTINGS,
  EMAILS_RECEIVED_WINDOW_DAYS,
  RULE_LIMITS,
  type CandidateReason,
  type ProtectionReason,
  type RuleSettings,
  type SkipReason,
} from "@tiersaver/core";
import type { MetricKey } from "./klaviyo-config.js";
import type { Rng } from "./prng.js";

/** The opt-in wider mode at the lowest values core accepts (RULE_LIMITS floors). */
export const WIDE_RULE_SETTINGS: RuleSettings = Object.freeze({
  ...DEFAULT_RULE_SETTINGS,
  purchaseDays: RULE_LIMITS.purchaseDays.min,
  clickDays: RULE_LIMITS.clickDays.min,
  openDays: RULE_LIMITS.openDays.min,
  siteActivityDays: RULE_LIMITS.siteActivityDays.min,
  newProfileDays: RULE_LIMITS.newProfileDays.min,
  minEmailsReceived: RULE_LIMITS.minEmailsReceived.min,
  reactivationLockDays: RULE_LIMITS.reactivationLockDays.min,
});

export type RuleMode = "default" | "wide";
export const RULE_MODES: readonly RuleMode[] = ["default", "wide"];
export const RULE_SETTINGS_BY_MODE: Readonly<Record<RuleMode, RuleSettings>> = {
  default: DEFAULT_RULE_SETTINGS,
  wide: WIDE_RULE_SETTINGS,
};

export type ExpectedDecision =
  | { kind: "candidate"; reason: CandidateReason }
  | { kind: "protected"; reasons: ProtectionReason[] }
  | { kind: "skipped"; reason: SkipReason };

/** One expected decision per rule mode. */
export type ExpectedByMode = Record<RuleMode, ExpectedDecision>;

/** Engagement metrics a recipe can place. "Received Email" is declared with `emailsReceived` instead. */
export type EngagementMetricKey = Exclude<MetricKey, "received">;

export interface RecipeEvent {
  metric: EngagementMetricKey;
  daysAgo: number;
  /** Only for opens: flagged as a machine / Apple privacy open. */
  machine?: boolean;
  /** Boundary events sit exactly N days before `now`; the rest get a random time of day. */
  exact?: boolean;
}

export interface Recipe {
  /** Intended profile age. Raised automatically so it predates every event. */
  createdDaysAgo: number;
  /** Keep `createdDaysAgo` exactly as given (boundary cohorts). */
  exactCreated?: boolean;
  events: RecipeEvent[];
  /**
   * "Received Email" events inside the last EMAILS_RECEIVED_WINDOW_DAYS days
   * (and after the profile was created). This is the `emailsReceived` signal.
   */
  emailsReceived: number;
  /** "Received Email" events older than that window: they must NOT count. Needs a profile older than the window. */
  emailsReceivedBeforeWindow?: number;
  smsConsent?: boolean;
  suppressed?: boolean;
  protectedGroup?: boolean;
  /** Suppressed and then unsuppressed by the seed run. */
  restored?: boolean;
}

export interface CohortDefinition {
  id: string;
  description: string;
  /** Share of the dataset, per mille. All shares add up to 1000. */
  share: number;
  /** Decision per mode with full data coverage, evaluated at `now`. */
  expected: ExpectedByMode;
  /** Decision per mode when the merchant turns `countMachineOpens` off. Defaults to `expected`. */
  expectedIgnoringMachineOpens?: ExpectedByMode;
  build(rng: Rng): Recipe;
}

const protectedBy = (...reasons: ProtectionReason[]): ExpectedDecision => ({ kind: "protected", reasons });
const LAPSED: ExpectedDecision = { kind: "candidate", reason: "lapsed" };
const NEVER_ENGAGED: ExpectedDecision = { kind: "candidate", reason: "never_engaged" };
const both = (decision: ExpectedDecision): ExpectedByMode => ({ default: decision, wide: decision });

/** Old enough for the default rules (365 days) and so also for the wide floor (180). */
const oldAge = (rng: Rng): number => rng.int(400, 1100);
/** At or above `minEmailsReceived` (5) in both modes. */
const enoughEmails = (rng: Rng): number => rng.int(5, 9);
/** Older than every wide-mode engagement window (182 days). */
const longAgo = (rng: Rng): number => rng.int(200, 1000);
/** Older than the wide-mode purchase window (365 days). */
const purchaseLongAgo = (rng: Rng): number => rng.int(400, 1000);
/** Inside every wide-mode engagement window. */
const recently = (rng: Rng): number => rng.int(3, 170);
const siteMetric = (rng: Rng): EngagementMetricKey => (rng.chance(0.5) ? "activeOnSite" : "startedCheckout");

/** Never engaged, old, written to: a candidate in both modes unless the cohort adds something. */
const inactive = (rng: Rng): Recipe => ({ createdDaysAgo: oldAge(rng), exactCreated: true, events: [], emailsReceived: enoughEmails(rng) });

function boundary(
  id: string,
  description: string,
  expected: ExpectedByMode,
  recipe: Recipe,
  expectedIgnoringMachineOpens?: ExpectedByMode,
): CohortDefinition {
  return { id, description, share: 2, expected, expectedIgnoringMachineOpens, build: () => structuredClone(recipe) };
}

export const COHORTS: readonly CohortDefinition[] = [
  // The expected candidates of the default rules.
  {
    id: "never_engaged",
    description: "Created 400+ days ago, received 5+ emails in the window, no event of any other kind. Candidate in both modes.",
    share: 148,
    expected: both(NEVER_ENGAGED),
    build: inactive,
  },

  // Engaged long ago, one way per cohort: any engagement in history protects by default; "lapsed" only in wide mode.
  {
    id: "opened_long_ago",
    description: "One human open 200-1000 days ago, nothing since.",
    share: 50,
    expected: { default: protectedBy("recent_open"), wide: LAPSED },
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "open", daysAgo: longAgo(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "clicked_long_ago",
    description: "One click 200-1000 days ago, nothing since.",
    share: 50,
    expected: { default: protectedBy("recent_click"), wide: LAPSED },
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "click", daysAgo: longAgo(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "purchased_long_ago",
    description: "One order 400-1000 days ago, nothing since.",
    share: 50,
    expected: { default: protectedBy("recent_purchase"), wide: LAPSED },
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "purchase", daysAgo: purchaseLongAgo(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "site_activity_long_ago",
    description: "Active on Site or Started Checkout 200-1000 days ago, nothing since.",
    share: 40,
    expected: { default: protectedBy("recent_site_activity"), wide: LAPSED },
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: siteMetric(rng), daysAgo: longAgo(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "engaged_long_ago_mixed",
    description: "Opened, clicked, visited and ordered, all outside the wide windows.",
    share: 40,
    expected: { default: protectedBy("recent_open", "recent_click", "recent_purchase", "recent_site_activity"), wide: LAPSED },
    build: (rng) => ({
      createdDaysAgo: oldAge(rng),
      events: [
        { metric: "open", daysAgo: longAgo(rng) },
        { metric: "click", daysAgo: longAgo(rng) },
        { metric: "purchase", daysAgo: purchaseLongAgo(rng) },
        { metric: siteMetric(rng), daysAgo: longAgo(rng) },
      ],
      emailsReceived: enoughEmails(rng),
    }),
  },

  // Engaged recently: protected in both modes.
  {
    id: "recent_purchaser",
    description: "Placed an order 3-330 days ago (inside the wide 365-day window).",
    share: 50,
    expected: both(protectedBy("recent_purchase")),
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "purchase", daysAgo: rng.int(3, 330) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "recent_clicker",
    description: "Clicked 3-170 days ago (inside the wide 182-day window); no open on record.",
    share: 40,
    expected: both(protectedBy("recent_click")),
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "click", daysAgo: recently(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "recent_opener_human",
    description: "Human open 3-170 days ago.",
    share: 40,
    expected: both(protectedBy("recent_open")),
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "open", daysAgo: recently(rng) }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "recent_clicker_and_opener",
    description: "Clicked and opened inside both wide windows.",
    share: 30,
    expected: both(protectedBy("recent_click", "recent_open")),
    build: (rng) => {
      const daysAgo = rng.int(3, 169);
      return {
        createdDaysAgo: oldAge(rng),
        events: [{ metric: "click", daysAgo }, { metric: "open", daysAgo: daysAgo + 1 }],
        emailsReceived: enoughEmails(rng),
      };
    },
  },
  {
    id: "recent_site_activity",
    description: "Active on Site or Started Checkout 3-170 days ago; no email engagement, no order.",
    share: 40,
    expected: both(protectedBy("recent_site_activity")),
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: siteMetric(rng), daysAgo: recently(rng) }], emailsReceived: enoughEmails(rng) }),
  },

  // Machine / Apple privacy opens only. They protect unless the merchant turns `countMachineOpens` off.
  {
    id: "machine_open_only_recent",
    description: "Only machine opens, the latest 3-170 days ago; never a human open.",
    share: 40,
    expected: both(protectedBy("recent_open")),
    expectedIgnoringMachineOpens: both(LAPSED),
    build: (rng) => {
      const daysAgo = recently(rng);
      const events: RecipeEvent[] = [{ metric: "open", daysAgo, machine: true }];
      if (rng.chance(0.5)) events.push({ metric: "open", daysAgo: daysAgo + rng.int(1, 200), machine: true });
      return { createdDaysAgo: oldAge(rng), events, emailsReceived: enoughEmails(rng) };
    },
  },
  {
    id: "machine_open_only_long_ago",
    description: "Only a machine open, 200-1000 days ago.",
    share: 30,
    expected: { default: protectedBy("recent_open"), wide: LAPSED },
    expectedIgnoringMachineOpens: both(LAPSED),
    build: (rng) => ({ createdDaysAgo: oldAge(rng), events: [{ metric: "open", daysAgo: longAgo(rng), machine: true }], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "machine_open_recent_human_open_long_ago",
    description: "Machine open 3-170 days ago; the last human open is 200-1000 days old.",
    share: 20,
    expected: both(protectedBy("recent_open")),
    // The old human open still counts under "ever"; under the wide window it does not.
    expectedIgnoringMachineOpens: { default: protectedBy("recent_open"), wide: LAPSED },
    build: (rng) => ({
      createdDaysAgo: oldAge(rng),
      events: [
        { metric: "open", daysAgo: recently(rng), machine: true },
        { metric: "open", daysAgo: longAgo(rng) },
      ],
      emailsReceived: enoughEmails(rng),
    }),
  },

  // Send history: nobody is inactive if they were barely written to.
  {
    id: "no_emails_received",
    description: "Old and never engaged, but no email was ever sent to them. This profile has no events at all.",
    share: 40,
    expected: both(protectedBy("not_enough_emails_received")),
    build: (rng) => ({ ...inactive(rng), emailsReceived: 0 }),
  },
  {
    id: "few_emails_received",
    description: "Old and never engaged; received 1 to 4 emails in the window.",
    share: 30,
    expected: both(protectedBy("not_enough_emails_received")),
    build: (rng) => ({ ...inactive(rng), emailsReceived: rng.int(1, 4) }),
  },
  {
    id: "emails_received_before_window",
    description: `Received 6 emails, all more than ${EMAILS_RECEIVED_WINDOW_DAYS} days ago: none counts.`,
    share: 20,
    expected: both(protectedBy("not_enough_emails_received")),
    build: (rng) => ({ createdDaysAgo: rng.int(700, 1100), exactCreated: true, events: [], emailsReceived: 0, emailsReceivedBeforeWindow: 6 }),
  },

  // Profile age.
  {
    id: "new_profile",
    description: "Created 14-170 days ago, never engaged, 5+ emails received. Too new in both modes.",
    share: 40,
    expected: both(protectedBy("new_profile")),
    build: (rng) => ({ createdDaysAgo: rng.int(14, 170), exactCreated: true, events: [], emailsReceived: enoughEmails(rng) }),
  },
  {
    id: "profile_180_to_364_days",
    description: "Created 185-360 days ago, never engaged, 5+ emails received. Too new by default, eligible in wide mode.",
    share: 50,
    expected: { default: protectedBy("new_profile"), wide: NEVER_ENGAGED },
    build: (rng) => ({ createdDaysAgo: rng.int(185, 360), exactCreated: true, events: [], emailsReceived: enoughEmails(rng) }),
  },

  // Protections that do not depend on activity, and the skip.
  {
    id: "sms_consented",
    description: "Would be a candidate, but holds SMS marketing consent.",
    share: 40,
    expected: both(protectedBy("sms_consent")),
    build: (rng) => ({ ...inactive(rng), smsConsent: true }),
  },
  {
    id: "protected_group",
    description: "Would be a candidate, but is in the list/segment the merchant marks as protected.",
    share: 30,
    expected: both(protectedBy("protected_group")),
    build: (rng) => ({ ...inactive(rng), protectedGroup: true }),
  },
  {
    id: "restored",
    description: "Would be a candidate, but was suppressed and then unsuppressed by the seed run (365-day lock after a restore).",
    share: 10,
    expected: both(protectedBy("recently_reactivated")),
    build: (rng) => ({ ...inactive(rng), restored: true }),
  },
  {
    id: "already_suppressed",
    description: "Suppressed for email by the seed run. Not billable, so the rules skip it.",
    share: 40,
    expected: both({ kind: "skipped", reason: "already_suppressed" }),
    build: (rng) => {
      const events: RecipeEvent[] = [];
      if (rng.chance(0.5)) events.push({ metric: "open", daysAgo: longAgo(rng) });
      if (rng.chance(0.3)) events.push({ metric: "purchase", daysAgo: purchaseLongAgo(rng) });
      return { createdDaysAgo: oldAge(rng), events, emailsReceived: rng.int(0, 9), suppressed: true };
    },
  },

  // Boundary cases: one step inside and one step outside every default and wide-mode threshold.
  boundary("boundary_created_364d", "Created exactly 364 days ago (inside the default 365).", { default: protectedBy("new_profile"), wide: NEVER_ENGAGED }, {
    createdDaysAgo: 364,
    exactCreated: true,
    events: [],
    emailsReceived: 6,
  }),
  boundary("boundary_created_365d", "Created exactly 365 days ago (outside the default 365).", both(NEVER_ENGAGED), {
    createdDaysAgo: 365,
    exactCreated: true,
    events: [],
    emailsReceived: 6,
  }),
  boundary("boundary_created_179d", "Created exactly 179 days ago (inside the wide 180).", both(protectedBy("new_profile")), {
    createdDaysAgo: 179,
    exactCreated: true,
    events: [],
    emailsReceived: 6,
  }),
  boundary("boundary_created_180d", "Created exactly 180 days ago (outside the wide 180).", { default: protectedBy("new_profile"), wide: NEVER_ENGAGED }, {
    createdDaysAgo: 180,
    exactCreated: true,
    events: [],
    emailsReceived: 6,
  }),
  boundary("boundary_emails_received_4", "Received exactly 4 emails in the window (below the minimum of 5).", both(protectedBy("not_enough_emails_received")), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [],
    emailsReceived: 4,
  }),
  boundary("boundary_emails_received_5", "Received exactly 5 emails in the window (the minimum).", both(NEVER_ENGAGED), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [],
    emailsReceived: 5,
  }),
  boundary("boundary_click_181d", "Click exactly 181 days ago (inside the wide 182).", both(protectedBy("recent_click")), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "click", daysAgo: 181, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_click_182d", "Click exactly 182 days ago (outside the wide 182).", { default: protectedBy("recent_click"), wide: LAPSED }, {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "click", daysAgo: 182, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_open_181d", "Human open exactly 181 days ago (inside the wide 182).", both(protectedBy("recent_open")), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "open", daysAgo: 181, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_open_182d", "Human open exactly 182 days ago (outside the wide 182).", { default: protectedBy("recent_open"), wide: LAPSED }, {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "open", daysAgo: 182, exact: true }],
    emailsReceived: 6,
  }),
  boundary(
    "boundary_machine_open_181d",
    "Machine open exactly 181 days ago; never a human open.",
    both(protectedBy("recent_open")),
    { createdDaysAgo: 600, exactCreated: true, events: [{ metric: "open", daysAgo: 181, exact: true, machine: true }], emailsReceived: 6 },
    both(LAPSED),
  ),
  boundary(
    "boundary_machine_open_182d",
    "Machine open exactly 182 days ago; never a human open.",
    { default: protectedBy("recent_open"), wide: LAPSED },
    { createdDaysAgo: 600, exactCreated: true, events: [{ metric: "open", daysAgo: 182, exact: true, machine: true }], emailsReceived: 6 },
    both(LAPSED),
  ),
  boundary("boundary_site_181d", "Started Checkout exactly 181 days ago (inside the wide 182).", both(protectedBy("recent_site_activity")), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "startedCheckout", daysAgo: 181, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_site_182d", "Active on Site exactly 182 days ago (outside the wide 182).", { default: protectedBy("recent_site_activity"), wide: LAPSED }, {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "activeOnSite", daysAgo: 182, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_purchase_364d", "Order exactly 364 days ago (inside the wide 365).", both(protectedBy("recent_purchase")), {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "purchase", daysAgo: 364, exact: true }],
    emailsReceived: 6,
  }),
  boundary("boundary_purchase_365d", "Order exactly 365 days ago (outside the wide 365).", { default: protectedBy("recent_purchase"), wide: LAPSED }, {
    createdDaysAgo: 600,
    exactCreated: true,
    events: [{ metric: "purchase", daysAgo: 365, exact: true }],
    emailsReceived: 6,
  }),
];

export const TOTAL_SHARE = 1000;

/**
 * Splits `count` profiles across cohorts by share (largest remainder method).
 * Every cohort gets at least one profile for any count in the supported range.
 */
export function allocateCohorts(count: number, cohorts: readonly CohortDefinition[] = COHORTS): Map<string, number> {
  const total = cohorts.reduce((sum, c) => sum + c.share, 0);
  const exact = cohorts.map((c) => (count * c.share) / total);
  const sizes = exact.map((x) => Math.floor(x));
  let remaining = count - sizes.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    sizes[i] = (sizes[i] ?? 0) + 1;
    remaining -= 1;
  }
  return new Map(cohorts.map((c, i) => [c.id, sizes[i] ?? 0]));
}
