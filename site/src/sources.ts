/**
 * Klaviyo help center articles the site cites as sources. Kept apart from
 * site-config.ts so they are not bundled into the browser script.
 */

/** Date the articles below were read. */
export const SOURCES_READ_ON = "2026-11-25";
export const KLAVIYO_SOURCES = Object.freeze({
  activeProfileManagement: {
    title: "Understanding active profile management in Klaviyo",
    url: "https://help.klaviyo.com/hc/en-us/articles/24263920096027",
  },
  bulkSuppress: {
    title: "How to manage email suppressions and delete profiles in bulk",
    url: "https://help.klaviyo.com/hc/en-us/articles/24312135764251",
  },
  billing: {
    title: "How Klaviyo billing works",
    url: "https://help.klaviyo.com/hc/en-us/articles/115000976672",
  },
  upgradePreference: {
    title: "How to choose your upgrade preference",
    url: "https://help.klaviyo.com/hc/en-us/articles/4405883690651",
  },
  suppressedProfiles: {
    title: "Understanding suppressed email profiles",
    url: "https://help.klaviyo.com/hc/en-us/articles/115005246108",
  },
  mpp: {
    title: "How to identify iOS15 Mail Privacy Protection opens",
    url: "https://help.klaviyo.com/hc/en-us/articles/4416791883163",
  },
});
