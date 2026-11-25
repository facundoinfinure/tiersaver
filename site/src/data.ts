/**
 * Build-time data for the static pages. build/build.mjs bundles this module,
 * calls siteData() and replaces {{token}} placeholders in src/pages.
 *
 * Klaviyo plan sizes and list prices come from @tiersaver/core's price table.
 * TierSaver's own prices and the cleanup criteria come from src/site-config.ts.
 * No page types one of these numbers by hand.
 */
import { CURRENT_PRICE_TABLES, DEFAULT_SCHEDULE, SIMULATION_TTL_MS } from "@tiersaver/core";
import { check, describe, formatCount, formatUsd, largestPublishedPlan, type CheckInput } from "./check/check.js";
import {
  CLEANUP_CRITERIA,
  KLAVIYO_RESUPPRESS_WAIT_DAYS,
  KLAVIYO_SOURCES,
  SOURCES_READ_ON,
  TIERSAVER_PLANS,
} from "./site-config.js";

/** The example the hero and the list health check show before anyone types. */
export const DEFAULT_EXAMPLE = {
  activeProfiles: 12_500,
  meetingCriteria: 2_500,
  unit: "profiles",
  plan: "email",
} as const satisfies CheckInput;

function planCards(): string {
  const cards = TIERSAVER_PLANS.map((plan, i) => {
    const from = i === 0 ? null : TIERSAVER_PLANS[i - 1]!.maxProfiles + 1;
    const range = from
      ? `${formatCount(from)} to ${formatCount(plan.maxProfiles)} active profiles`
      : `Up to ${formatCount(plan.maxProfiles)} active profiles`;
    return `          <li class="plan">
            <p class="plan__range">${range}</p>
            <p class="plan__price"><span class="plan__amount">${formatUsd(plan.monthlyCents)}</span> <span class="plan__per">per month</span></p>
          </li>`;
  });
  const last = TIERSAVER_PLANS[TIERSAVER_PLANS.length - 1]!;
  cards.push(`          <li class="plan plan--contact">
            <p class="plan__range">Above ${formatCount(last.maxProfiles)} active profiles</p>
            <p class="plan__price"><span class="plan__amount">Contact us</span></p>
          </li>`);
  return `<ul class="plans">\n${cards.join("\n")}\n        </ul>`;
}

function planRows(): string {
  const rows = TIERSAVER_PLANS.map((plan, i) => {
    const from = i === 0 ? null : TIERSAVER_PLANS[i - 1]!.maxProfiles + 1;
    const range = from ? `${formatCount(from)} to ${formatCount(plan.maxProfiles)}` : `Up to ${formatCount(plan.maxProfiles)}`;
    return `      <tr><td>${range}</td><td>${formatUsd(plan.monthlyCents)} per month</td></tr>`;
  });
  const last = TIERSAVER_PLANS[TIERSAVER_PLANS.length - 1]!;
  rows.push(`      <tr><td>Above ${formatCount(last.maxProfiles)}</td><td>Contact us</td></tr>`);
  return rows.join("\n");
}

function source(key: keyof typeof KLAVIYO_SOURCES): string {
  const s = KLAVIYO_SOURCES[key];
  return `<li>Klaviyo Help Center, "${s.title}". <a href="${s.url}" rel="noopener noreferrer">${s.url}</a> (read ${SOURCES_READ_ON})</li>`;
}

export function siteData(): Record<string, string> {
  const email = CURRENT_PRICE_TABLES.email;
  const marketing = CURRENT_PRICE_TABLES.email_sms;
  if (email.capturedOn !== marketing.capturedOn) throw new Error("Price tables captured on different dates");

  const result = check(DEFAULT_EXAMPLE);
  const view = describe(result);
  const firstPlan = TIERSAVER_PLANS[0]!;
  const lastPlan = TIERSAVER_PLANS[TIERSAVER_PLANS.length - 1]!;

  return {
    // Klaviyo price table (plan sizes), from core
    "prices.capturedOn": email.capturedOn,
    "prices.maxProfiles": formatCount(largestPublishedPlan(email)),

    // TierSaver's own flat prices (provisional), from site-config
    "plans.cards": planCards(),
    "plans.rows": planRows(),
    "plans.from": formatUsd(firstPlan.monthlyCents),
    "plans.maxProfiles": formatCount(lastPlan.maxProfiles),

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

    // Cleanup criteria (provisional), from site-config
    "criteria.ageDays": String(CLEANUP_CRITERIA.minProfileAgeDays),
    "criteria.emails": String(CLEANUP_CRITERIA.minEmailsReceived),
    "criteria.weeks": String(CLEANUP_CRITERIA.emailsReceivedWeeks),
    "criteria.widerEngagementDays": String(CLEANUP_CRITERIA.widerMinEngagementDays),
    "criteria.widerPurchaseDays": String(CLEANUP_CRITERIA.widerMinPurchaseDays),
    "criteria.widerAgeDays": String(CLEANUP_CRITERIA.widerMinProfileAgeDays),
    "criteria.undoLockDays": String(CLEANUP_CRITERIA.undoLockDays),
    "klaviyo.resuppressDays": String(KLAVIYO_RESUPPRESS_WAIT_DAYS),

    // Simulation and schedule, from core
    "sim.ttlHours": String(SIMULATION_TTL_MS / (60 * 60 * 1000)),
    "schedule.leadDays": String(DEFAULT_SCHEDULE.leadDays),

    // Sources
    "sources.readOn": SOURCES_READ_ON,
    "url.activeProfileManagement": KLAVIYO_SOURCES.activeProfileManagement.url,
    "src.activeProfileManagement": source("activeProfileManagement"),
    "src.bulkSuppress": source("bulkSuppress"),
    "src.billing": source("billing"),
    "src.upgradePreference": source("upgradePreference"),
    "src.suppressedProfiles": source("suppressedProfiles"),
    "src.mpp": source("mpp"),
  };
}
