import type { PriceTable } from "../src/pricing.js";
import type { DataCoverage, ProfileSignals } from "../src/rules.js";

/** Synthetic table for tests. Not real Klaviyo prices. */
export const TEST_TABLE: PriceTable = {
  id: "test-table",
  plan: "email",
  currency: "USD",
  capturedOn: "2026-11-25",
  source: "test fixture",
  tiers: [
    { maxProfiles: 500, monthlyCents: 2_000, verified: true },
    { maxProfiles: 5_000, monthlyCents: 10_000, verified: true },
    { maxProfiles: 10_000, monthlyCents: 15_000, verified: true },
    { maxProfiles: 12_500, monthlyCents: 27_500, verified: true },
    { maxProfiles: 20_000, monthlyCents: 37_500, verified: true },
    { maxProfiles: 50_000, monthlyCents: 72_000, verified: true },
  ],
};

export const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

export const FULL_COVERAGE: DataCoverage = {
  engagementSince: daysAgo(2000),
  purchasesSince: daysAgo(2000),
  purchasesUntil: NOW,
  siteActivitySince: daysAgo(2000),
};

/** An old, never-engaged profile: a suppression candidate under default rules. */
export function inactiveProfile(overrides: Partial<ProfileSignals> = {}): ProfileSignals {
  return {
    id: "p_inactive",
    hasEmail: true,
    emailSuppressed: false,
    createdAt: daysAgo(800),
    lastOpenAt: null,
    lastClickAt: null,
    lastPurchaseAt: null,
    lastSiteActivityAt: null,
    emailsReceived: 12,
    smsConsent: false,
    inProtectedGroup: false,
    reactivatedAt: null,
    ...overrides,
  };
}
