/**
 * Deterministic dataset generator. Pure: same options, same output.
 * Nothing here touches the network or the file system.
 */
import {
  DEFAULT_RULE_SETTINGS,
  EMAILS_RECEIVED_WINDOW_DAYS,
  evaluateProfile,
  type DataCoverage,
  type Decision,
  type ProfileSignals,
  type RuleSettings,
} from "@tiersaver/core";
import { COHORTS, allocateCohorts, type CohortDefinition, type ExpectedByMode, type ExpectedDecision } from "./cohorts.js";
import { LIMITS, METRICS, type MetricKey } from "./klaviyo-config.js";
import { createRng, deriveSeed } from "./prng.js";

export const DEFAULT_SEED = 20261125;
export const DEFAULT_COUNT = 3000;
export const MIN_COUNT = 2000;
export const MAX_COUNT = 5000;
/** RFC 2606 reserved domain. Fine for planning; see README before a real run. */
export const DEFAULT_EMAIL_DOMAIN = "example.com";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GenerateOptions {
  seed?: number;
  count?: number;
  /** Instant every age is relative to. Truncated to the second (Klaviyo stores event time in seconds). */
  now: Date;
  emailDomain?: string;
  /** Prefix of every email and event id. Defaults to `ts-seed-<seed>`. */
  runTag?: string;
}

export interface SeedEvent {
  metric: MetricKey;
  metricName: string;
  time: Date;
  /** Deterministic idempotency key: Klaviyo dedupes on (profile, metric, unique_id). */
  uniqueId: string;
  machineOpen?: boolean;
  /** Order value in USD, purchases only. */
  value?: number;
}

export interface SeedProfile {
  /** 1-based position in the dataset. */
  index: number;
  email: string;
  firstName: string;
  lastName: string;
  /** Fictional E.164 number (555-01XX range). Only on the SMS cohort. */
  phoneNumber: string | null;
  cohort: string;
  /** Intended age. Klaviyo's own `created` will be the import time, see README. */
  createdAt: Date;
  events: SeedEvent[];
  smsConsent: boolean;
  suppressed: boolean;
  protectedGroup: boolean;
  /** Suppressed and then unsuppressed by the seed run. */
  restored: boolean;
  /** Expected decision under DEFAULT_RULE_SETTINGS and under WIDE_RULE_SETTINGS. */
  expected: ExpectedByMode;
  expectedIgnoringMachineOpens: ExpectedByMode;
}

export interface SeedDataset {
  seed: number;
  count: number;
  now: Date;
  emailDomain: string;
  runTag: string;
  profiles: SeedProfile[];
}

/** NATO alphabet: obviously not real people. */
const FIRST_NAMES = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett", "Kilo", "Lima"];

/** North American area codes used with the fictional 555-0100..0199 exchange. */
const AREA_CODES = ["212", "312", "415", "617", "206", "303", "404", "512", "602", "702"];

const METRIC_CODE: Record<MetricKey, string> = {
  open: "open",
  click: "click",
  purchase: "order",
  activeOnSite: "site",
  startedCheckout: "checkout",
  received: "recv",
};

const RUN_TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DOMAIN_PATTERN = /^(?=.{4,60}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function validateCount(count: number): void {
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new RangeError(`count must be a whole number between ${MIN_COUNT} and ${MAX_COUNT}, got ${count}`);
  }
}

export function defaultRunTag(seed: number): string {
  return `ts-seed-${seed}`;
}

function fictionalPhone(position: number): string {
  const areaCode = AREA_CODES[Math.floor(position / 100)];
  if (!areaCode) throw new RangeError("not enough fictional phone numbers for the SMS cohort");
  return `+1${areaCode}55501${String(position % 100).padStart(2, "0")}`;
}

function buildProfile(
  cohort: CohortDefinition,
  index: number,
  positionInCohort: number,
  ctx: { seed: number; nowMs: number; emailDomain: string; runTag: string },
): SeedProfile {
  const rng = createRng(deriveSeed(ctx.seed, index));
  const recipe = cohort.build(rng);

  const perMetric = new Map<MetricKey, number>();
  const makeEvent = (metric: MetricKey, timeMs: number): SeedEvent => {
    const n = (perMetric.get(metric) ?? 0) + 1;
    perMetric.set(metric, n);
    return { metric, metricName: METRICS[metric], time: new Date(timeMs), uniqueId: `${ctx.runTag}-${index}-${METRIC_CODE[metric]}-${n}` };
  };
  const events: SeedEvent[] = recipe.events.map((e) => {
    const jitterMs = e.exact ? 0 : rng.int(0, 86_399) * 1000;
    const event = makeEvent(e.metric, ctx.nowMs - e.daysAgo * DAY_MS - jitterMs);
    if (e.metric === "open") event.machineOpen = e.machine === true;
    if (e.metric === "purchase") event.value = rng.int(1500, 25_000) / 100;
    return event;
  });
  events.sort((a, b) => a.time.getTime() - b.time.getTime());

  let createdMs = ctx.nowMs - recipe.createdDaysAgo * DAY_MS;
  const firstEvent = events[0];
  if (!recipe.exactCreated && firstEvent && firstEvent.time.getTime() - DAY_MS < createdMs) {
    // A profile cannot be younger than its first event.
    createdMs = firstEvent.time.getTime() - rng.int(1, 30) * DAY_MS;
  }

  // "Received Email" events: after the profile was created, and on the declared side of the counting window.
  const ageSeconds = Math.floor((ctx.nowMs - createdMs) / 1000);
  const windowSeconds = EMAILS_RECEIVED_WINDOW_DAYS * 86_400;
  const receivedBetween = (howMany: number, fromSecondsAgo: number, toSecondsAgo: number): void => {
    if (howMany > 0 && fromSecondsAgo > toSecondsAgo) throw new RangeError(`cohort ${cohort.id}: the profile is too young for its received emails`);
    for (let i = 0; i < howMany; i += 1) events.push(makeEvent("received", ctx.nowMs - rng.int(fromSecondsAgo, toSecondsAgo) * 1000));
  };
  // An hour clear of `now`, of the profile's creation and of the window edge, so no count hinges on a second.
  receivedBetween(recipe.emailsReceived, 3_600, Math.min(windowSeconds, ageSeconds) - 3_600);
  receivedBetween(recipe.emailsReceivedBeforeWindow ?? 0, windowSeconds + 3_600, ageSeconds - 3_600);
  events.sort((a, b) => a.time.getTime() - b.time.getTime() || a.uniqueId.localeCompare(b.uniqueId));

  return {
    index,
    email: `${ctx.runTag}-${String(index).padStart(5, "0")}@${ctx.emailDomain}`,
    firstName: rng.pick(FIRST_NAMES),
    lastName: `Seed-${String(index).padStart(5, "0")}`,
    phoneNumber: recipe.smsConsent ? fictionalPhone(positionInCohort) : null,
    cohort: cohort.id,
    createdAt: new Date(createdMs),
    events,
    smsConsent: recipe.smsConsent === true,
    suppressed: recipe.suppressed === true,
    protectedGroup: recipe.protectedGroup === true,
    restored: recipe.restored === true,
    expected: structuredClone(cohort.expected),
    expectedIgnoringMachineOpens: structuredClone(cohort.expectedIgnoringMachineOpens ?? cohort.expected),
  };
}

export function generateDataset(options: GenerateOptions): SeedDataset {
  const seed = options.seed ?? DEFAULT_SEED;
  const count = options.count ?? DEFAULT_COUNT;
  const emailDomain = (options.emailDomain ?? DEFAULT_EMAIL_DOMAIN).toLowerCase();
  const runTag = options.runTag ?? defaultRunTag(seed);

  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("seed must be a whole number between 0 and 4294967295");
  }
  validateCount(count);
  if (Number.isNaN(options.now.getTime())) throw new RangeError("now is not a valid date");
  if (!RUN_TAG_PATTERN.test(runTag)) {
    throw new RangeError("run tag must be 1-40 characters of a-z, 0-9 or '-', starting with a letter or digit");
  }
  if (!DOMAIN_PATTERN.test(emailDomain)) throw new RangeError(`"${emailDomain}" is not a valid email domain`);

  const nowMs = Math.floor(options.now.getTime() / 1000) * 1000;
  const ctx = { seed, nowMs, emailDomain, runTag };
  const sizes = allocateCohorts(count);

  const profiles: SeedProfile[] = [];
  for (const cohort of COHORTS) {
    const size = sizes.get(cohort.id) ?? 0;
    for (let position = 0; position < size; position += 1) {
      profiles.push(buildProfile(cohort, profiles.length + 1, position, ctx));
    }
  }

  const longest = profiles[profiles.length - 1]?.email.length ?? 0;
  if (longest > LIMITS.maxEmailLength) throw new RangeError("generated emails exceed Klaviyo's 100-character limit");

  return { seed, count, now: new Date(nowMs), emailDomain, runTag, profiles };
}

/**
 * Coverage that reaches further back than any event or profile the generator
 * produces. The default rules look at the whole history ("ever"), and core
 * then requires the data to start at or before each profile's `createdAt`.
 */
export function fullCoverage(now: Date): DataCoverage {
  const since = new Date(now.getTime() - 5000 * DAY_MS);
  return { engagementSince: since, purchasesSince: since, siteActivitySince: since };
}

function latest(dates: Date[]): Date | null {
  let max: Date | null = null;
  for (const d of dates) if (!max || d.getTime() > max.getTime()) max = d;
  return max;
}

export interface SignalOverrides {
  /**
   * Replace the intended creation date, e.g. with the real Klaviyo `created`
   * (the import time) to predict what the app sees without a test hook.
   */
  createdAt?: Date | null;
  /** When the seed run unsuppressed the "restored" cohort. Defaults to the dataset `now`. */
  restoredAt?: Date;
  /**
   * Replace the count of emails received, e.g. `null` for "the app could not
   * read the send history". Defaults to counting the seeded "Received Email" events.
   */
  emailsReceived?: number | null;
  /** Instant the emails-received window is counted back from. Defaults to the dataset `now`. */
  at?: Date;
}

/** Seeded "Received Email" events inside the last EMAILS_RECEIVED_WINDOW_DAYS days before `at`. */
export function countEmailsReceived(profile: Pick<SeedProfile, "events">, at: Date): number {
  const windowMs = EMAILS_RECEIVED_WINDOW_DAYS * DAY_MS;
  return profile.events.filter((e) => e.metric === "received" && e.time.getTime() <= at.getTime() && at.getTime() - e.time.getTime() < windowMs).length;
}

/** The signals the app should derive for a seeded profile once it reads it back from Klaviyo. */
export function toProfileSignals(profile: SeedProfile, dataset: Pick<SeedDataset, "now">, overrides: SignalOverrides = {}): ProfileSignals {
  const opens = profile.events.filter((e) => e.metric === "open");
  const lastOpen = opens.reduce<SeedEvent | null>((best, e) => (!best || e.time.getTime() > best.time.getTime() ? e : best), null);
  const times = (metrics: MetricKey[]) => profile.events.filter((e) => metrics.includes(e.metric)).map((e) => e.time);
  return {
    id: `seed-${profile.index}`,
    hasEmail: true,
    emailSuppressed: profile.suppressed,
    createdAt: overrides.createdAt !== undefined ? overrides.createdAt : profile.createdAt,
    lastOpenAt: lastOpen?.time ?? null,
    lastOpenIsMachine: lastOpen?.machineOpen === true,
    lastHumanOpenAt: latest(opens.filter((e) => !e.machineOpen).map((e) => e.time)),
    lastClickAt: latest(times(["click"])),
    lastPurchaseAt: latest(times(["purchase"])),
    lastSiteActivityAt: latest(times(["activeOnSite", "startedCheckout"])),
    emailsReceived: overrides.emailsReceived !== undefined ? overrides.emailsReceived : countEmailsReceived(profile, overrides.at ?? dataset.now),
    smsConsent: profile.smsConsent,
    inProtectedGroup: profile.protectedGroup,
    // Core still calls the restore date `reactivatedAt`; it is the last unsuppression, by anyone.
    reactivatedAt: profile.restored ? (overrides.restoredAt ?? dataset.now) : null,
  };
}

export interface ExpectedRow {
  index: number;
  email: string;
  cohort: string;
  /** `expected.default` under DEFAULT_RULE_SETTINGS, `expected.wide` under WIDE_RULE_SETTINGS. */
  expected: ExpectedByMode;
  /** The same two modes with `countMachineOpens: false`. */
  expectedIgnoringMachineOpens: ExpectedByMode;
}

/**
 * Expected decision for every generated profile under both rule modes
 * (DEFAULT_RULE_SETTINGS and WIDE_RULE_SETTINGS), with full data coverage,
 * evaluated at the dataset's `now`.
 *
 * This is a declaration (it comes from the cohort catalogue, not from the rule
 * engine); test/generate.test.ts checks it against `evaluateProfile` so the
 * dataset and the rules cannot drift apart.
 */
export function expectedDecisions(dataset: SeedDataset): ExpectedRow[] {
  return dataset.profiles.map((p) => ({
    index: p.index,
    email: p.email,
    cohort: p.cohort,
    expected: p.expected,
    expectedIgnoringMachineOpens: p.expectedIgnoringMachineOpens,
  }));
}

/** Compact form stored in the `ts_seed_expected` and `ts_seed_expected_wide` profile properties. */
export function formatDecision(decision: ExpectedDecision | Decision): string {
  if (decision.kind === "protected") return `protected:${[...decision.reasons].sort().join("+")}`;
  return `${decision.kind}:${decision.reason}`;
}

export interface EvaluateOptions extends SignalOverrides {
  /** Evaluation instant. Defaults to the dataset `now`; pass a later date to see how the dataset has aged. */
  at?: Date;
  /** Defaults to DEFAULT_RULE_SETTINGS. Pass WIDE_RULE_SETTINGS for the wider mode. */
  settings?: RuleSettings;
  coverage?: DataCoverage;
}

/**
 * Runs the real rule engine on a seeded profile. Use it when the declared
 * expectation does not apply as is: evaluating days after seeding, with other
 * settings, or with Klaviyo's real `created` date.
 */
export function evaluateSeedProfile(profile: SeedProfile, dataset: Pick<SeedDataset, "now">, options: EvaluateOptions = {}): Decision {
  const at = options.at ?? dataset.now;
  return evaluateProfile(
    toProfileSignals(profile, dataset, { ...options, at }),
    options.settings ?? DEFAULT_RULE_SETTINGS,
    options.coverage ?? fullCoverage(at),
    at,
  );
}

export function countByCohort(dataset: SeedDataset): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of dataset.profiles) counts.set(p.cohort, (counts.get(p.cohort) ?? 0) + 1);
  return counts;
}
