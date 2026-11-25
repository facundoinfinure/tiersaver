/**
 * Cohort catalogue. Each cohort isolates one rule of packages/core/src/rules.ts
 * so the expected decision is unambiguous.
 *
 * Ages are in days before the dataset's `now`. Core's window test is
 * `now - date < days`, so an event exactly 89 days old is inside a 90-day
 * window and one 91 days old is outside.
 */
import type { CandidateReason, ProtectionReason, SkipReason } from "@tiersaver/core";
import type { MetricKey } from "./klaviyo-config.js";
import type { Rng } from "./prng.js";

export type ExpectedDecision =
  | { kind: "candidate"; reason: CandidateReason }
  | { kind: "protected"; reasons: ProtectionReason[] }
  | { kind: "skipped"; reason: SkipReason };

export interface RecipeEvent {
  metric: MetricKey;
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
  smsConsent?: boolean;
  suppressed?: boolean;
  protectedGroup?: boolean;
  /** Suppressed and then unsuppressed by the seed run. */
  reactivated?: boolean;
}

export interface CohortDefinition {
  id: string;
  description: string;
  /** Share of the dataset, per mille. All shares add up to 1000. */
  share: number;
  /** Decision under DEFAULT_RULE_SETTINGS with full data coverage, evaluated at `now`. */
  expected: ExpectedDecision;
  /** Decision when the merchant turns `countMachineOpens` off. Defaults to `expected`. */
  expectedIgnoringMachineOpens?: ExpectedDecision;
  build(rng: Rng): Recipe;
}

const protectedBy = (...reasons: ProtectionReason[]): ExpectedDecision => ({ kind: "protected", reasons });
const LAPSED: ExpectedDecision = { kind: "candidate", reason: "lapsed" };
const NEVER_ENGAGED: ExpectedDecision = { kind: "candidate", reason: "never_engaged" };

/** Engagement that is older than every default window (purchase 365, click/site 180, open 90). */
function oldHistory(rng: Rng, opts: { atLeastOne?: boolean } = {}): RecipeEvent[] {
  const events: RecipeEvent[] = [];
  if (rng.chance(0.7)) events.push({ metric: "open", daysAgo: rng.int(200, 900) });
  if (rng.chance(0.4)) events.push({ metric: "click", daysAgo: rng.int(200, 900) });
  if (rng.chance(0.3)) events.push({ metric: "purchase", daysAgo: rng.int(400, 1000) });
  if (rng.chance(0.3)) events.push({ metric: rng.chance(0.5) ? "activeOnSite" : "startedCheckout", daysAgo: rng.int(200, 900) });
  if (opts.atLeastOne && events.length === 0) events.push({ metric: "open", daysAgo: rng.int(200, 900) });
  return events;
}

const oldProfileAge = (rng: Rng): number => rng.int(120, 1100);

function boundary(
  id: string,
  description: string,
  expected: ExpectedDecision,
  recipe: Recipe,
  expectedIgnoringMachineOpens?: ExpectedDecision,
): CohortDefinition {
  return { id, description, share: 2, expected, expectedIgnoringMachineOpens, build: () => structuredClone(recipe) };
}

export const COHORTS: readonly CohortDefinition[] = [
  {
    id: "recent_purchaser",
    description: "Placed an order inside the 365-day window; any email engagement is older than its window.",
    share: 110,
    expected: protectedBy("recent_purchase"),
    build: (rng) => ({
      createdDaysAgo: oldProfileAge(rng),
      events: [{ metric: "purchase", daysAgo: rng.int(3, 330) }, ...oldHistory(rng)],
    }),
  },
  {
    id: "recent_clicker",
    description: "Clicked 100-170 days ago (inside 180) and opened the same day (outside 90).",
    share: 100,
    expected: protectedBy("recent_click"),
    build: (rng) => {
      const daysAgo = rng.int(100, 170);
      return {
        createdDaysAgo: oldProfileAge(rng),
        events: [{ metric: "click", daysAgo }, { metric: "open", daysAgo: daysAgo + 1 }, ...oldHistory(rng)],
      };
    },
  },
  {
    id: "recent_opener_human",
    description: "Most recent open is a human open inside the 90-day window; no click inside 180.",
    share: 100,
    expected: protectedBy("recent_open"),
    build: (rng) => ({
      createdDaysAgo: oldProfileAge(rng),
      events: [{ metric: "open", daysAgo: rng.int(3, 85) }, ...oldHistory(rng)],
    }),
  },
  {
    id: "recent_opener_machine_only",
    description: "Only recent opens are machine / Apple privacy opens; the last human open, if any, is old.",
    share: 80,
    expected: protectedBy("recent_open"),
    expectedIgnoringMachineOpens: LAPSED,
    build: (rng) => {
      const events: RecipeEvent[] = [{ metric: "open", daysAgo: rng.int(3, 85), machine: true }];
      if (rng.chance(0.5)) events.push({ metric: "open", daysAgo: rng.int(30, 85) + 1, machine: true });
      if (rng.chance(0.5)) events.push({ metric: "open", daysAgo: rng.int(200, 600) });
      return { createdDaysAgo: oldProfileAge(rng), events };
    },
  },
  {
    id: "recent_clicker_and_opener",
    description: "Clicked and opened inside both windows.",
    share: 60,
    expected: protectedBy("recent_click", "recent_open"),
    build: (rng) => {
      const daysAgo = rng.int(3, 84);
      return {
        createdDaysAgo: oldProfileAge(rng),
        events: [{ metric: "click", daysAgo }, { metric: "open", daysAgo: daysAgo + 1 }, ...oldHistory(rng)],
      };
    },
  },
  {
    id: "purchased_long_ago_clicked_recently",
    description: "Last order is older than 365 days, but there is a click inside 180 days.",
    share: 40,
    expected: protectedBy("recent_click"),
    build: (rng) => ({
      createdDaysAgo: oldProfileAge(rng),
      events: [
        { metric: "purchase", daysAgo: rng.int(400, 900) },
        { metric: "click", daysAgo: rng.int(100, 170) },
        { metric: "open", daysAgo: rng.int(200, 600) },
      ],
    }),
  },
  {
    id: "site_activity_only",
    description: "Active on Site / Started Checkout inside 180 days; no email engagement, no order.",
    share: 60,
    expected: protectedBy("recent_site_activity"),
    build: (rng) => {
      const events: RecipeEvent[] = [{ metric: rng.chance(0.5) ? "activeOnSite" : "startedCheckout", daysAgo: rng.int(3, 170) }];
      if (rng.chance(0.4)) events.push({ metric: "activeOnSite", daysAgo: rng.int(200, 600) });
      return { createdDaysAgo: oldProfileAge(rng), events };
    },
  },
  {
    id: "new_profile",
    description: "Created less than 90 days ago and never engaged.",
    share: 70,
    expected: protectedBy("new_profile"),
    build: (rng) => ({ createdDaysAgo: rng.int(1, 84), exactCreated: true, events: [] }),
  },
  {
    id: "sms_consented",
    description: "Lapsed on email, but holds SMS marketing consent.",
    share: 50,
    expected: protectedBy("sms_consent"),
    build: (rng) => ({ createdDaysAgo: oldProfileAge(rng), events: oldHistory(rng), smsConsent: true }),
  },
  {
    id: "protected_group",
    description: "Lapsed, but member of the list/segment the merchant marks as protected.",
    share: 30,
    expected: protectedBy("protected_group"),
    build: (rng) => ({ createdDaysAgo: oldProfileAge(rng), events: oldHistory(rng), protectedGroup: true }),
  },
  {
    id: "reactivated",
    description: "Lapsed, suppressed and then unsuppressed by the seed run (90-day reactivation lock).",
    share: 10,
    expected: protectedBy("recently_reactivated"),
    build: (rng) => ({ createdDaysAgo: oldProfileAge(rng), events: oldHistory(rng), reactivated: true }),
  },
  {
    id: "lapsed",
    description: "Engaged long ago; nothing inside any window. Expected candidate.",
    share: 126,
    expected: LAPSED,
    build: (rng) => ({ createdDaysAgo: oldProfileAge(rng), events: oldHistory(rng, { atLeastOne: true }) }),
  },
  {
    id: "never_engaged",
    description: "Older than 90 days with no event at all. Expected candidate.",
    share: 100,
    expected: NEVER_ENGAGED,
    build: (rng) => ({ createdDaysAgo: rng.int(120, 900), exactCreated: true, events: [] }),
  },
  {
    id: "already_suppressed",
    description: "Suppressed for email by the seed run. Not billable, so the rules skip it.",
    share: 40,
    expected: { kind: "skipped", reason: "already_suppressed" },
    build: (rng) => ({ createdDaysAgo: oldProfileAge(rng), events: oldHistory(rng), suppressed: true }),
  },

  // Boundary cases: one day inside and one day outside each default window.
  boundary("boundary_open_89d", "Human open exactly 89 days ago (inside 90).", protectedBy("recent_open"), {
    createdDaysAgo: 400,
    events: [{ metric: "open", daysAgo: 89, exact: true }],
  }),
  boundary("boundary_open_91d", "Human open exactly 91 days ago (outside 90).", LAPSED, {
    createdDaysAgo: 400,
    events: [{ metric: "open", daysAgo: 91, exact: true }],
  }),
  boundary(
    "boundary_machine_open_89d",
    "Machine open exactly 89 days ago; human open 300 days ago.",
    protectedBy("recent_open"),
    {
      createdDaysAgo: 400,
      events: [
        { metric: "open", daysAgo: 89, exact: true, machine: true },
        { metric: "open", daysAgo: 300, exact: true },
      ],
    },
    LAPSED,
  ),
  boundary("boundary_machine_open_91d", "Machine open exactly 91 days ago (outside 90 either way).", LAPSED, {
    createdDaysAgo: 400,
    events: [{ metric: "open", daysAgo: 91, exact: true, machine: true }],
  }),
  boundary("boundary_click_179d", "Click exactly 179 days ago (inside 180).", protectedBy("recent_click"), {
    createdDaysAgo: 400,
    events: [{ metric: "click", daysAgo: 179, exact: true }],
  }),
  boundary("boundary_click_181d", "Click exactly 181 days ago (outside 180).", LAPSED, {
    createdDaysAgo: 400,
    events: [{ metric: "click", daysAgo: 181, exact: true }],
  }),
  boundary("boundary_purchase_364d", "Order exactly 364 days ago (inside 365).", protectedBy("recent_purchase"), {
    createdDaysAgo: 500,
    events: [{ metric: "purchase", daysAgo: 364, exact: true }],
  }),
  boundary("boundary_purchase_366d", "Order exactly 366 days ago (outside 365).", LAPSED, {
    createdDaysAgo: 500,
    events: [{ metric: "purchase", daysAgo: 366, exact: true }],
  }),
  boundary("boundary_site_179d", "Started Checkout exactly 179 days ago (inside 180).", protectedBy("recent_site_activity"), {
    createdDaysAgo: 400,
    events: [{ metric: "startedCheckout", daysAgo: 179, exact: true }],
  }),
  boundary("boundary_site_181d", "Active on Site exactly 181 days ago (outside 180).", LAPSED, {
    createdDaysAgo: 400,
    events: [{ metric: "activeOnSite", daysAgo: 181, exact: true }],
  }),
  boundary("boundary_created_89d", "Created exactly 89 days ago (inside 90), never engaged.", protectedBy("new_profile"), {
    createdDaysAgo: 89,
    exactCreated: true,
    events: [],
  }),
  boundary("boundary_created_91d", "Created exactly 91 days ago (outside 90), never engaged.", NEVER_ENGAGED, {
    createdDaysAgo: 91,
    exactCreated: true,
    events: [],
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
