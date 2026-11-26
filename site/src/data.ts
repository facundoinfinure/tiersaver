/**
 * Build-time data for the static pages. build/build.mjs bundles this module,
 * calls siteData() and replaces {{token}} placeholders in src/pages.
 *
 * Everything the app also knows comes from @tiersaver/core: Klaviyo's plan
 * sizes and list prices (price table), TierSaver's own prices
 * (FLAT_PRICE_TIERS) and the cleanup criteria (rules.ts). The one fact core
 * does not hold, Klaviyo's re-suppression waiting period, is in
 * src/site-config.ts. No page types one of these numbers by hand.
 */
import {
  CURRENT_PRICE_TABLES,
  DEFAULT_FEE_POLICY,
  DEFAULT_RULE_SETTINGS,
  DEFAULT_SCHEDULE,
  EMAILS_RECEIVED_WINDOW_DAYS,
  FLAT_PRICE_TIERS,
  RULE_LIMITS,
  SIMULATION_TTL_MS,
  flatTierFor,
} from "@tiersaver/core";
import {
  check,
  describe,
  formatCount,
  formatUsd,
  largestPublishedPlan,
  largestTierSaverPlan,
  planRange,
  type CheckInput,
} from "./check/check.js";
import {
  CANDIDATE_SEGMENT_NAME,
  CHARGE_HOLD_HOURS,
  CHARGE_WINDOW_DAYS,
  CSV_PART_SIZE,
  GROUPS_LISTED_PER_KIND,
  KLAVIYO_RESUPPRESS_WAIT_DAYS,
  MAX_LEAD_DAYS,
  MAX_PROTECTED_GROUPS,
} from "./site-config.js";
import { KLAVIYO_PRICING_PAGE, KLAVIYO_SOURCES, SOURCES_READ_ON } from "./sources.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-25" as "November 25, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The example the hero and the list health check show before anyone types. */
export const DEFAULT_EXAMPLE = {
  activeProfiles: 12_500,
  meetingCriteria: 2_500,
  unit: "profiles",
  plan: "email",
} as const satisfies CheckInput;

/** Smaller list used next to the default example where a page names two prices. */
export const SMALL_LIST_EXAMPLE = 8_000;

/**
 * The cleanup criteria the pages state, derived from core's rules.
 * Throws instead of printing a number that no longer matches how a page words it.
 */
export function cleanupCriteria() {
  const d = DEFAULT_RULE_SETTINGS;
  // The pages say "never opened, clicked, visited or bought": every default window must be "ever".
  if (d.purchaseDays !== null || d.clickDays !== null || d.openDays !== null || d.siteActivityDays !== null) {
    throw new Error("Core's default rules no longer mean 'never engaged'; the criteria pages need rewording");
  }
  if (EMAILS_RECEIVED_WINDOW_DAYS % 7 !== 0) throw new Error("Emails-received window is not a whole number of weeks");
  // The help article has one row for opens, clicks and site activity.
  const engagement = [RULE_LIMITS.openDays.min, RULE_LIMITS.clickDays.min, RULE_LIMITS.siteActivityDays.min];
  if (new Set(engagement).size !== 1) throw new Error("Wider-mode floors for opens, clicks and site activity differ");
  return {
    /** Default: the profile was created at least this many days ago. */
    minProfileAgeDays: d.newProfileDays,
    /** Default: the profile received at least this many emails… */
    minEmailsReceived: d.minEmailsReceived,
    /** …in roughly this many weeks. */
    emailsReceivedWeeks: EMAILS_RECEIVED_WINDOW_DAYS / 7,
    /** Wider mode: shortest window allowed for opens, clicks and site activity. */
    widerMinEngagementDays: engagement[0]!,
    /** Wider mode: shortest window allowed for purchases. */
    widerMinPurchaseDays: RULE_LIMITS.purchaseDays.min,
    /** Wider mode: youngest profile age allowed. */
    widerMinProfileAgeDays: RULE_LIMITS.newProfileDays.min,
    /** Profiles restored by an undo are not eligible for cleanup again for this long. */
    undoLockDays: d.reactivationLockDays,
  };
}

function planCards(): string {
  const cards = FLAT_PRICE_TIERS.map(
    (plan) => `          <li class="plan">
            <p class="plan__range">${planRange(plan)} active profiles</p>
            <p class="plan__price"><span class="plan__amount">${formatUsd(plan.monthlyCents)}</span> <span class="plan__per">per month</span></p>
          </li>`,
  );
  cards.push(`          <li class="plan plan--contact">
            <p class="plan__range">Above ${formatCount(largestTierSaverPlan())} active profiles</p>
            <p class="plan__price"><span class="plan__amount">Contact us</span></p>
          </li>`);
  return `<ul class="plans">\n${cards.join("\n")}\n        </ul>`;
}

function planRows(): string {
  const rows = FLAT_PRICE_TIERS.map(
    (plan) => `      <tr><td>${planRange(plan)}</td><td>${formatUsd(plan.monthlyCents)} per month</td></tr>`,
  );
  rows.push(`      <tr><td>Above ${formatCount(largestTierSaverPlan())}</td><td>Contact us</td></tr>`);
  return rows.join("\n");
}

/** "$15" for a list size that has a public price; throws for one that does not. */
function priceFor(activeProfiles: number): string {
  const plan = flatTierFor(activeProfiles);
  if (!plan) throw new Error(`No public price for ${activeProfiles} profiles`);
  return formatUsd(plan.monthlyCents);
}

function source(key: keyof typeof KLAVIYO_SOURCES): string {
  const s: { title: string; url: string; readOn?: string } = KLAVIYO_SOURCES[key];
  return `<li>Klaviyo Help Center, "${s.title}". <a href="${s.url}" rel="noopener noreferrer">${s.url}</a> (read ${longDate(s.readOn ?? SOURCES_READ_ON)})</li>`;
}

/** TierSaver's own prices as schema.org offers, for the landing page's structured data. */
function jsonLdOffers(): string {
  return JSON.stringify(
    FLAT_PRICE_TIERS.map((plan) => ({
      "@type": "Offer",
      name: `${planRange(plan)} active profiles`,
      price: (plan.monthlyCents / 100).toFixed(2),
      priceCurrency: "USD",
      description: "Flat monthly price by list size, charged only when a cleanup suppresses profiles.",
    })),
  );
}

export function siteData(): Record<string, string> {
  const email = CURRENT_PRICE_TABLES.email;
  const marketing = CURRENT_PRICE_TABLES.email_sms;
  if (email.capturedOn !== marketing.capturedOn) throw new Error("Price tables captured on different dates");

  const result = check(DEFAULT_EXAMPLE);
  const view = describe(result);
  const criteria = cleanupCriteria();

  return {
    // Klaviyo price table (plan sizes), from core
    "prices.capturedOn": email.capturedOn,
    "prices.capturedOnLong": longDate(email.capturedOn),
    "prices.source": KLAVIYO_PRICING_PAGE,
    "prices.maxProfiles": formatCount(largestPublishedPlan(email)),

    // TierSaver's own flat prices, from core
    "plans.cards": planCards(),
    "plans.rows": planRows(),
    "plans.maxProfiles": formatCount(largestTierSaverPlan()),
    "plans.smallExample": formatCount(SMALL_LIST_EXAMPLE),
    "plans.smallExamplePrice": priceFor(SMALL_LIST_EXAMPLE),
    "plans.defaultExamplePrice": priceFor(DEFAULT_EXAMPLE.activeProfiles),
    "plans.lowestPrice": formatUsd(FLAT_PRICE_TIERS[0]!.monthlyCents),
    "jsonld.offers": jsonLdOffers(),

    // Charging rules, from core's fee policy and the app
    "fee.minDays": String(DEFAULT_FEE_POLICY.minDaysBetweenCharges),
    "fee.maxPerWindow": formatUsd(DEFAULT_FEE_POLICY.windowCapCents),
    "fee.holdHours": String(CHARGE_HOLD_HOURS),
    "fee.windowDays": String(CHARGE_WINDOW_DAYS),

    // The app's own limits (src/site-config.ts)
    "app.csvPartSize": formatCount(CSV_PART_SIZE),
    "app.maxProtectedGroups": String(MAX_PROTECTED_GROUPS),
    "app.maxLeadDays": String(MAX_LEAD_DAYS),
    "app.groupsListed": String(GROUPS_LISTED_PER_KIND),
    "app.segmentName": CANDIDATE_SEGMENT_NAME,

    // Default example of the list health check, rendered statically
    "ex.before": formatCount(result.profilesBefore),
    "ex.suppressed": formatCount(result.profilesSuppressed),
    "ex.after": formatCount(result.profilesAfter),
    "check.active": formatCount(DEFAULT_EXAMPLE.activeProfiles),
    "check.criteria": formatCount(DEFAULT_EXAMPLE.meetingCriteria),
    "check.figure": view.figure,
    "check.message": view.message,
    "check.keptPercent": String(view.keptPercent),
    "check.staying": view.staying,
    "check.leaving": view.leaving,
    "check.tierSaverPrice": view.tierSaverPrice,
    "check.tierSaverPlan": view.tierSaverPlan,
    "check.klaviyoBefore": view.klaviyoBefore,
    "check.klaviyoAfter": view.klaviyoAfter,

    // Cleanup criteria, from core's rules
    "criteria.ageDays": String(criteria.minProfileAgeDays),
    "criteria.emails": String(criteria.minEmailsReceived),
    "criteria.maxEmails": String(RULE_LIMITS.minEmailsReceived.max),
    "criteria.maxAgeDays": String(RULE_LIMITS.newProfileDays.max),
    "criteria.weeks": String(criteria.emailsReceivedWeeks),
    "criteria.widerEngagementDays": String(criteria.widerMinEngagementDays),
    "criteria.widerPurchaseDays": String(criteria.widerMinPurchaseDays),
    "criteria.widerAgeDays": String(criteria.widerMinProfileAgeDays),
    "criteria.undoLockDays": String(criteria.undoLockDays),
    "klaviyo.resuppressDays": String(KLAVIYO_RESUPPRESS_WAIT_DAYS),

    // Simulation and schedule, from core
    "sim.ttlHours": String(SIMULATION_TTL_MS / (60 * 60 * 1000)),
    "schedule.leadDays": String(DEFAULT_SCHEDULE.leadDays),
    "schedule.minLeadDays": String(DEFAULT_SCHEDULE.minLeadDays),

    // Sources
    "sources.readOn": longDate(SOURCES_READ_ON),
    "url.activeProfileManagement": KLAVIYO_SOURCES.activeProfileManagement.url,
    "src.activeProfileManagement": source("activeProfileManagement"),
    "src.bulkSuppress": source("bulkSuppress"),
    "src.billing": source("billing"),
    "src.upgradePreference": source("upgradePreference"),
    "src.suppressedProfiles": source("suppressedProfiles"),
    "src.mpp": source("mpp"),
  };
}
