import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_TABLES,
  DEFAULT_FEE_POLICY,
  DEFAULT_RULE_SETTINGS,
  DEFAULT_SCHEDULE,
  EMAILS_RECEIVED_WINDOW_DAYS,
  FLAT_PRICE_TIERS,
  RULE_LIMITS,
  SIMULATION_TTL_MS,
} from "@tiersaver/core";
import { cleanupCriteria } from "../src/data.js";
import {
  CANDIDATE_SEGMENT_NAME,
  CSV_PART_SIZE,
  GROUPS_LISTED_PER_KIND,
  KLAVIYO_SCOPES,
  MAX_LEAD_DAYS,
  MAX_PROTECTED_GROUPS,
  SHOPIFY_SCOPES,
  TERMS_EFFECTIVE_DATE,
} from "../src/site-config.js";
import { AUDIT_CTA_LABEL, AUDIT_CTA_URL, LEGAL_DRAFT, SITE_DIR, generate } from "../build/build.mjs";
import { checkLinks } from "../build/check-links.mjs";
import { headersFor, parseHeaders } from "../build/serve.mjs";

let generated: Map<string, string>;
let pages: [string, string][];

/** Legal texts (terms, privacy, DPA): drafts under review, written and reviewed separately from the rest of the copy. */
const LEGAL_PAGES = ["terms.html", "privacy.html", "dpa.html"];
const isLegal = (path: string) => LEGAL_PAGES.includes(path.split("\\").join("/"));
const HELP_ARTICLES = [
  "getting-started",
  "permissions",
  "how-the-audit-works",
  "cleanup-criteria",
  "simulation-and-approval",
  "what-suppress-means",
  "after-a-cleanup",
  "undo",
  "history",
  "monthly-schedule-and-your-klaviyo-plan",
  "settings",
  "pricing",
  "billing",
  "uninstalling",
  "data-and-privacy",
  "troubleshooting",
  "contact",
];
/** A file of the app, read as text: the site states facts that live there and cannot import them. */
const appSource = (path: string) => readFile(join(SITE_DIR, "..", "shopify", path), "utf8");

/** Visible text of a page: tags, comments and attribute values removed. */
function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!doctype[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

beforeAll(async () => {
  generated = (await generate()) as Map<string, string>;
  pages = [...generated].filter(([path]) => path.endsWith(".html"));
}, 60_000);

describe("build output", () => {
  it("is committed up to date (run `npm run build` in site/ if this fails)", async () => {
    for (const [path, content] of generated) {
      const onDisk = await readFile(join(SITE_DIR, path), "utf8").catch(() => null);
      expect(onDisk === content, `${path} is out of date`).toBe(true);
    }
  });

  it("produces the landing page, legal drafts, help center, guides and 404", () => {
    const paths = [...generated.keys()].map((p) => p.split("\\").join("/"));
    for (const expected of [
      "index.html",
      "privacy.html",
      "terms.html",
      "404.html",
      "help/index.html",
      ...HELP_ARTICLES.map((name) => `help/${name}.html`),
      "guides/klaviyo-list-hygiene.html",
      "guides/how-klaviyo-counts-active-profiles.html",
      "guides/suppress-vs-delete-vs-unsubscribe.html",
      "sitemap.xml",
      "assets/list-check.js",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("lists every page in the sitemap except the 404 and, while they are drafts, the legal pages", () => {
    const sitemap = generated.get("sitemap.xml")!;
    expect(sitemap).toContain("<loc>https://tiersaver.com/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/help/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/guides/how-klaviyo-counts-active-profiles</loc>");
    for (const name of HELP_ARTICLES) expect(sitemap).toContain(`<loc>https://tiersaver.com/help/${name}</loc>`);
    expect(sitemap).not.toContain("404");
    const legal = pages.filter(([path]) => isLegal(path)).length;
    expect(legal).toBeGreaterThanOrEqual(2);
    expect(sitemap.match(/<loc>/g)).toHaveLength(pages.length - 1 - (LEGAL_DRAFT ? legal : 0));
  });

  it("every help article is linked from the help index and from the other articles' sidebar", () => {
    const index = generated.get("help/index.html")!;
    const article = generated.get("help/undo.html")!;
    for (const name of HELP_ARTICLES) {
      expect(index, name).toContain(`<a class="link-card" href="/help/${name}">`);
      expect(article, name).toContain(`<li><a href="/help/${name}"`);
    }
  });

  it("every page has its own title and a description that fits a search result", () => {
    const titles = new Set<string>();
    for (const [path, html] of pages) {
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      const description = /<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? "";
      expect(title.length, `${path}: title`).toBeGreaterThan(10);
      expect(titles.has(title), `${path}: duplicate title "${title}"`).toBe(false);
      titles.add(title);
      expect(description.length, `${path}: description`).toBeGreaterThan(40);
      // The legal texts and the privacy help article are edited separately; their lengths are not checked here.
      if (isLegal(path) || path.endsWith("data-and-privacy.html")) continue;
      expect(title.length, `${path}: title "${title}"`).toBeLessThanOrEqual(65);
      expect(description.length, `${path}: description is ${description.length} characters`).toBeLessThanOrEqual(160);
    }
  });

  it("structured data: organization and app on the landing page, breadcrumbs on articles, nothing invented", () => {
    const blocks = (html: string) =>
      [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
    const landing = blocks(generated.get("index.html")!);
    expect(landing).toHaveLength(1);
    const graph = landing[0]["@graph"] as Record<string, unknown>[];
    expect(graph.map((node) => node["@type"])).toEqual(["Organization", "SoftwareApplication"]);
    const offers = graph[1]!.offers as { price: string; priceCurrency: string }[];
    expect(offers.map((o) => o.price)).toEqual(FLAT_PRICE_TIERS.map((t) => (t.monthlyCents / 100).toFixed(2)));
    expect(offers.every((o) => o.priceCurrency === "USD")).toBe(true);
    const crumbs = blocks(generated.get("help/undo.html")!);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]["@type"]).toBe("BreadcrumbList");
    for (const [path, html] of pages) {
      expect(/aggregateRating|"review"|ratingValue|reviewCount/i.test(html), `${path}: rating or review data`).toBe(false);
    }
  });
});

describe("numbers on the pages come from core", () => {
  const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

  it("pricing: core's four tiers plus 'contact us' are shown, on the landing page and in the help center", () => {
    expect(FLAT_PRICE_TIERS).toHaveLength(4);
    const n = (count: number) => count.toLocaleString("en-US");
    const expected = FLAT_PRICE_TIERS.map((tier, i) => ({
      range: i === 0 ? `Up to ${n(tier.maxProfiles)}` : `${n(FLAT_PRICE_TIERS[i - 1]!.maxProfiles + 1)} to ${n(tier.maxProfiles)}`,
      price: `${usd(tier.monthlyCents)} per month`,
    }));
    const top = n(FLAT_PRICE_TIERS[FLAT_PRICE_TIERS.length - 1]!.maxProfiles);

    // Landing page: five cards, in core's order.
    const landing = generated.get("index.html")!;
    const cards = [...landing.matchAll(/<li class="plan(?: plan--contact)?">[\s\S]*?<\/li>/g)].map((m) => textOf(m[0]).trim());
    expect(cards).toEqual([
      ...expected.map((e) => `${e.range} active profiles ${e.price}`),
      `Above ${top} active profiles Contact us`,
    ]);

    // Help article: five table rows, same order.
    const help = generated.get("help/pricing.html")!;
    const rows = [...help.matchAll(/<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([...expected.map((e) => [e.range, e.price]), [`Above ${top}`, "Contact us"]]);

    // Copy that names a price for an example list.
    expect(textOf(help)).toContain("a list of 8,000 active profiles is $9 per month, and a list of 12,500 is $19 per month");
    expect(textOf(landing)).toContain("$19/month");
    expect(textOf(landing)).toContain("Monthly plan for lists of 10,001 to 25,000 active profiles");
    expect(textOf(landing)).toContain("Free until your first cleanup. Installing, connecting Klaviyo, the audit and the simulation cost nothing and need no plan.");
  });

  it("the monthly plan: its terms come from core's fee policy and the app, and are stated together wherever a price is shown", async () => {
    const days = DEFAULT_FEE_POLICY.billingIntervalDays;
    expect(Object.keys(DEFAULT_FEE_POLICY).sort()).toEqual(["billingIntervalDays", "tiers"]);
    expect(DEFAULT_FEE_POLICY.tiers).toBe(FLAT_PRICE_TIERS);
    const top = FLAT_PRICE_TIERS[FLAT_PRICE_TIERS.length - 1]!.maxProfiles.toLocaleString("en-US");

    // What the site says about the plan is what the app does; fail if the app changes it.
    const billing = await appSource("app/billing/billing.ts");
    expect(billing).toContain('export const PLAN_INTERVAL = "EVERY_30_DAYS";');
    expect(days).toBe(30);
    expect(billing).toContain("export const PLAN_INTERVAL_DAYS = DEFAULT_FEE_POLICY.billingIntervalDays;");
    // Cancelling does not credit the days left; development stores get test subscriptions.
    expect(billing).toContain("appSubscriptionCancel(id: $id, prorate: false)");
    expect(billing).toContain("test: status.developmentStore");
    // Cancelling switches automatic mode off; a frozen plan and a plan that is too small refuse a cleanup.
    expect(billing).toContain('set({ mode: "approval", updatedAt: now })');
    for (const refusal of ["plan_required", "plan_frozen", "plan_price_too_low", "above_price_tiers"]) expect(billing).toContain(`"${refusal}"`);
    const automatic = await appSource("app/schedule/automatic.ts");
    expect(automatic).toContain('const PLAN_REFUSALS: readonly PlanGateRefusal[] = ["plan_required", "plan_frozen", "plan_price_too_low", "above_price_tiers"];');
    // The plan is asked for when a cleanup is approved, never before.
    expect(await appSource("app/billing/approval.ts")).toContain("const plan = await requestPlanFor(deps, {");
    const settings = await appSource("app/routes/app.settings.tsx");
    expect(settings).toContain('<s-section heading="Plan">');
    expect(settings).toContain("No plan yet. It starts when you approve your first cleanup.");
    expect(settings).toContain("Your plan is on hold in Shopify.");
    expect(settings).toContain("The period you already paid for is not refunded.");
    expect(settings).toContain("Your list now fits a smaller plan");
    const review = await appSource("app/routes/app.simulation.tsx");
    expect(review).toContain("restoring a cleanup does not refund the month");
    expect(review).toContain("Your list has grown into a larger plan. Approve the new monthly price in Shopify before starting this cleanup.");
    expect(await appSource("app/legal.ts")).toContain('export const SALES_EMAIL = "hello@tiersaver.com";');

    const renews = `Shopify charges the plan every ${days} days, whether or not a cleanup runs that month, until you cancel.`;
    const starts = "When you approve your first cleanup, on Shopify's approval screen. Nothing is charged before that.";

    const help = textOf(generated.get("help/pricing.html")!);
    expect(help).toContain("Installing the app, connecting Klaviyo, the audit and the simulation are free and need no plan.");
    expect(help).toContain("There is no charge per cleanup, and the price is the same whether a cleanup suppresses a few profiles or many.");
    expect(help).toContain(starts);
    expect(help).toContain(renews);
    expect(help).toContain("In the app, under Settings, then Plan, or by uninstalling the app. The period already paid is not refunded.");
    expect(help).toContain("A higher price only applies after you approve it in Shopify.");
    expect(help).toContain("Restoring a cleanup does not refund the month.");
    expect(help).toContain("only starts while your store has an active plan that covers the list size shown in its simulation");
    expect(help).toContain("it never charges more without your approval. Shopify prorates the change.");
    expect(help).toContain("The app tells you and offers the smaller plan. The change is not automatic");
    expect(help).toContain(`Lists above ${top} active profiles are not sold automatically.`);
    expect(help).toContain("Development stores get a test plan, which Shopify does not bill.");

    const landing = textOf(generated.get("index.html")!);
    expect(landing).toContain("The plan starts when you approve your first cleanup, on Shopify's approval screen. Nothing is charged before that.");
    expect(landing).toContain(renews);
    expect(landing).toContain("In the app, under Settings, then Plan, or by uninstalling. The period already paid is not refunded.");
    expect(landing).toContain("A higher price only applies after you approve it in Shopify. There is no charge per cleanup, and restoring a cleanup does not refund the month.");
    expect(landing).toContain(`Lists above ${top} active profiles are not sold automatically`);

    const billingHelp = textOf(generated.get("help/billing.html")!);
    expect(billingHelp).toContain(renews);
    expect(billingHelp).toContain("No cleanup can start, and automatic mode is switched off.");
    expect(billingHelp).toContain("Audits stay free");
    expect(billingHelp).toContain("Profiles already suppressed stay suppressed in Klaviyo, and you can still restore them from History.");
    expect(billingHelp).toContain("cleanups stop until Shopify makes the plan active again");
    for (const path of ["help/undo.html", "help/billing.html", "help/history.html"]) {
      expect(textOf(generated.get(path)!), path).toMatch(/does not refund the month/);
    }
    expect(textOf(generated.get("help/uninstalling.html")!)).toContain("Uninstalling cancels your TierSaver plan");
  });

  it("the terms state the auto-renewing plan in one place, with the app's terms version as their date", async () => {
    const days = DEFAULT_FEE_POLICY.billingIntervalDays;
    expect(await appSource("app/legal.ts")).toContain(`export const TERMS_VERSION = "${TERMS_EFFECTIVE_DATE}";`);
    const html = generated.get("terms.html")!;
    const terms = textOf(html);
    const [year, month, day] = TERMS_EFFECTIVE_DATE.split("-").map(Number);
    const effective = new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
    expect(terms).toContain(`Effective date: ${effective}`);

    // Price, renewal, cancelling, refunds and price changes: five consecutive items of one list.
    const list = /<h3>Your plan is a subscription that renews automatically<\/h3>[\s\S]*?<ul>([\s\S]*?)<\/ul>/.exec(html)![1]!;
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]!).trim());
    expect(items.map((item) => item.slice(0, item.indexOf(".") + 1))).toEqual([
      "Price.",
      "Start and renewal.",
      "How to cancel.",
      "No refunds for the current period.",
      "Price changes only with your approval.",
    ]);
    expect(items[1]).toContain(`the plan renews automatically: Shopify charges its price every ${days} days, whether or not a cleanup runs in that period, until you cancel.`);
    expect(items[2]).toContain("under Settings, then Plan, or by uninstalling the app");
    expect(items[3]).toContain("except where the law requires a refund");
    expect(items[4]).toContain("unless you have first approved that price on Shopify's approval screen");
    const rows = [...html.matchAll(/<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((m) => m[2]);
    expect(rows).toEqual([...FLAT_PRICE_TIERS.map((tier) => `${usd(tier.monthlyCents)} per month`), "Contact us"]);
    expect(terms).toContain("Only one installed store can be connected to a given Klaviyo account at a time");
  });

  it("nothing of the per-cleanup model is left on any page", () => {
    const old: [string, RegExp][] = [
      ["charged only when a cleanup suppresses", /only when a cleanup suppresses|charged only when/i],
      ["no cleanup, no charge", /no cleanup,? no charge|is not charged|not charged automatically|nothing to charge/i],
      ["72-hour hold", /72[- ]hours?/i],
      ["28-day rule", /28[- ]days?/i],
      ["charge window", /30-day period|monthly maximum|never more than/i],
      ["old prices", /\$15\b|\$29\b|\$149\b/],
      ["unpaid-cleanup record", /uncharged cleanup|unpaid (cleanup|amount)|400 days|outlasts/i],
      ["charge per cleanup", /estimated charge|review pricing in shopify|charge is created|charge was created/i],
    ];
    for (const [path, html] of pages) {
      const text = textOf(html);
      for (const [name, re] of old) expect(re.test(text), `${path} still states "${name}"`).toBe(false);
    }
  });

  it("Klaviyo's count: no update time is stated, and the Advanced KDP exception is worded as Klaviyo words it", () => {
    for (const [path, html] of pages) {
      const text = textOf(html);
      expect(/can still count/i.test(text), `${path}: old Advanced KDP wording`).toBe(false);
      expect(/up to \d+ hours to (update|refresh)/i.test(text), `${path}: a time for Klaviyo's count`).toBe(false);
    }
    for (const path of ["help/after-a-cleanup.html", "help/monthly-schedule-and-your-klaviyo-plan.html", "guides/klaviyo-list-hygiene.html"]) {
      expect(textOf(generated.get(path)!), path).toMatch(/updates (its|the) count on its own schedule and checks it shortly before your billing cycle renews/);
      expect(generated.get(path)!, path).toContain('href="https://help.klaviyo.com/hc/en-us/articles/4405883690651"');
    }
    for (const path of ["index.html", "help/after-a-cleanup.html", "help/monthly-schedule-and-your-klaviyo-plan.html", "guides/how-klaviyo-counts-active-profiles.html"]) {
      expect(textOf(generated.get(path)!), path).toMatch(/lower active profile count does not necessarily lower your bill/);
    }
    // The age in the default criteria is core's, and the guide that shows Klaviyo's two articles attributes each number.
    expect(DEFAULT_RULE_SETTINGS.newProfileDays).toBe(365);
    const guide = textOf(generated.get("guides/klaviyo-list-hygiene.html")!);
    expect(guide).toContain("The two articles use different ages: 180 days in the segment above, 365 days here.");
  });

  it("list health check: the static default shows core's plan sizes, as a dated estimate, and no Klaviyo price", () => {
    const email = CURRENT_PRICE_TABLES.email;
    const text = textOf(generated.get("index.html")!);
    expect(email.tiers.some((t) => t.maxProfiles === 12_500)).toBe(true);
    expect(email.tiers.some((t) => t.maxProfiles === 10_000)).toBe(true);
    expect(text).toContain("For reference Estimated Klaviyo plan size");
    expect(text).toContain("Today Up to 12,500 profiles After the cleanup Up to 10,000 profiles");
    const [year, month, day] = email.capturedOn.split("-").map(Number);
    const read = new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
    expect(text).toContain(`An estimate from the numbers you typed and the plan sizes on Klaviyo's price list (klaviyo.com/pricing), read on ${read}.`);
    expect(text).toContain("Suppressed profiles do not count toward your Klaviyo email plan, according to Klaviyo's help center");
    expect(text).toContain("on Klaviyo's Advanced KDP plan they still count toward its total");
    expect(text).toContain("TierSaver makes no promise about your Klaviyo plan or invoice.");
    expect(text).not.toMatch(/list price/i);
    expect(generated.get("index.html")!).toContain('href="https://help.klaviyo.com/hc/en-us/articles/24263920096027"');
  });

  it("cleanup criteria are derived from core's rules", () => {
    const CLEANUP_CRITERIA = cleanupCriteria();
    expect(CLEANUP_CRITERIA).toEqual({
      minProfileAgeDays: DEFAULT_RULE_SETTINGS.newProfileDays,
      minEmailsReceived: DEFAULT_RULE_SETTINGS.minEmailsReceived,
      emailsReceivedWeeks: EMAILS_RECEIVED_WINDOW_DAYS / 7,
      widerMinEngagementDays: RULE_LIMITS.clickDays.min,
      widerMinPurchaseDays: RULE_LIMITS.purchaseDays.min,
      widerMinProfileAgeDays: RULE_LIMITS.newProfileDays.min,
      undoLockDays: DEFAULT_RULE_SETTINGS.reactivationLockDays,
    });
    expect(RULE_LIMITS.openDays.min).toBe(RULE_LIMITS.clickDays.min);
    expect(RULE_LIMITS.siteActivityDays.min).toBe(RULE_LIMITS.clickDays.min);
    expect(Number.isInteger(CLEANUP_CRITERIA.emailsReceivedWeeks)).toBe(true);
    const text = textOf(generated.get("help/cleanup-criteria.html")!);
    expect(text).toContain(`created at least ${CLEANUP_CRITERIA.minProfileAgeDays} days ago`);
    expect(text).toContain(
      `at least ${CLEANUP_CRITERIA.minEmailsReceived} emails in roughly the last ${CLEANUP_CRITERIA.emailsReceivedWeeks} weeks`,
    );
    expect(text).toContain(`No opens, clicks or site activity ${CLEANUP_CRITERIA.widerMinEngagementDays} days`);
    expect(text).toContain(`No purchases ${CLEANUP_CRITERIA.widerMinPurchaseDays} days`);
    expect(text).toContain(`Profile age ${CLEANUP_CRITERIA.widerMinProfileAgeDays} days`);
    expect(textOf(generated.get("help/undo.html")!)).toContain(
      `leaves them alone for ${CLEANUP_CRITERIA.undoLockDays} days`,
    );
  });

  it("simulation window and schedule lead time come from core", () => {
    expect(textOf(generated.get("help/simulation-and-approval.html")!)).toContain(
      `expires after ${SIMULATION_TTL_MS / 3_600_000} hours`,
    );
    const schedule = textOf(generated.get("help/monthly-schedule-and-your-klaviyo-plan.html")!);
    expect(schedule).toContain(`By default the audit runs ${DEFAULT_SCHEDULE.leadDays} days before your plan's renewal date`);
    expect(schedule).toContain(`You can set between ${DEFAULT_SCHEDULE.minLeadDays} and ${MAX_LEAD_DAYS} days.`);
  });

  it("facts repeated from the app match the app's source", async () => {
    const settings = await appSource("app/settings/settings.ts");
    expect(settings).toContain(`export const MAX_PROTECTED_GROUPS = ${MAX_PROTECTED_GROUPS};`);
    expect(settings).toContain(`max: ${MAX_LEAD_DAYS} }`);
    expect(await appSource("app/simulations/review.ts")).toContain(`export const CSV_PART_SIZE = ${CSV_PART_SIZE};`);
    expect(await appSource("app/routes/app.settings.tsx")).toContain(
      `Only the first ${GROUPS_LISTED_PER_KIND} lists and the first ${GROUPS_LISTED_PER_KIND} segments are shown`,
    );
    const config = await appSource("app/klaviyo/config.ts");
    expect(config).toContain(`export const CANDIDATE_SEGMENT_NAME = "${CANDIDATE_SEGMENT_NAME}";`);
    // Every scope the consent screen asks for, and no other, is explained on the permissions page.
    const requested = [...config.matchAll(/^\s*"([a-z-]+:(?:read|write))",?$/gm)].map((m) => m[1]!);
    const optional = /KLAVIYO_OPTIONAL_SCOPES = \[([^\]]*)\]/.exec(config)?.[1]?.match(/[a-z-]+:(?:read|write)/g) ?? [];
    expect([...requested, ...optional].sort()).toEqual([...KLAVIYO_SCOPES].sort());
    const toml = await appSource("shopify.app.toml");
    expect(/^scopes = "([^"]*)"$/m.exec(toml)?.[1]?.split(",").map((scope) => scope.trim())).toEqual([...SHOPIFY_SCOPES]);
    const permissions = generated.get("help/permissions.html")!;
    const explained = [...permissions.matchAll(/<th scope="row"><code>([^<]+)<\/code><\/th>/g)].map((m) => m[1]!);
    expect(explained.sort()).toEqual([...SHOPIFY_SCOPES, ...KLAVIYO_SCOPES].sort());

    expect(textOf(generated.get("help/simulation-and-approval.html")!)).toContain(
      `A long list comes in parts of up to ${CSV_PART_SIZE.toLocaleString("en-US")} profiles.`,
    );
    for (const path of ["index.html", "help/how-the-audit-works.html", "help/permissions.html"]) {
      expect(textOf(generated.get(path)!), path).toContain(`"${CANDIDATE_SEGMENT_NAME}"`);
    }
  });

  it("numbers the pages type by hand about cleanups, automatic mode and deletion match the app's source", async () => {
    // These pages state the numbers in words; fail if the app changes them.
    const automatic = await appSource("app/schedule/automatic.ts");
    expect(automatic).toContain("export const AUTO_MAX_CANDIDATE_SHARE = 0.1;");
    expect(automatic).toContain("export const AUTO_MAX_GROWTH_FACTOR = 3;");
    expect(automatic).toContain("export const AUTO_GROWTH_FLOOR = 200;");
    expect(await appSource("app/runs/engine.ts")).toContain("export const RUN_BATCH_SIZE = 100;");
    const housekeeping = await appSource("app/data/housekeeping.ts");
    expect(housekeeping).toContain("export const UNINSTALLED_SHOP_RETENTION_DAYS = 10;");
    expect(housekeeping).toContain("export const PRIVACY_REQUEST_RETENTION_DAYS = 90;");
    expect(await appSource("app/routes/app.settings.tsx")).toContain('<s-section heading="Customer data requests">');

    for (const path of ["help/simulation-and-approval.html", "help/settings.html", "help/troubleshooting.html"]) {
      const text = textOf(generated.get(path)!);
      expect(text, path).toContain("more than 10% of your active profiles");
      expect(text, path).toMatch(/more than three times as many profiles as the last (cleanup|one) you approved/);
    }
    expect(textOf(generated.get("help/simulation-and-approval.html")!)).toContain("applies above 200 profiles");
    for (const path of ["help/simulation-and-approval.html", "help/history.html", "help/troubleshooting.html", "terms.html"]) {
      expect(textOf(generated.get(path)!), path).toContain("up to 100 profiles");
    }
    // Deletion happens at uninstall (shopify/app/data/privacy.ts handleUninstall); no page may promise a later date.
    for (const path of ["index.html", "help/uninstalling.html", "help/data-and-privacy.html", "privacy.html", "dpa.html"]) {
      expect(textOf(generated.get(path)!), path).not.toMatch(/10 days after (the|you) uninstall|48 hours after (an app is |you )?uninstall/);
    }
    expect(await appSource("app/data/privacy.ts")).toMatch(/db\.delete\(schema\.shops\)/);
    for (const path of ["help/settings.html", "help/data-and-privacy.html", "privacy.html", "dpa.html", "terms.html"]) {
      expect(textOf(generated.get(path)!), path).toContain("for 90 days");
    }
  });
});

describe("where TierSaver is offered (owner's decision of 2026-11-27, docs/16-LEGALES.md)", () => {
  const statement = "located outside the European Union, the rest of the European Economic Area, the United Kingdom and Switzerland";

  it("the availability statement is on the terms, privacy policy, DPA, pricing help, getting started and the landing page's pricing and FAQ", () => {
    for (const path of ["terms.html", "privacy.html", "dpa.html", "help/pricing.html", "help/getting-started.html", "index.html"]) {
      expect(textOf(generated.get(path)!), path).toContain(statement);
    }
    const landing = generated.get("index.html")!;
    const faq = /<div class="faq">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/.exec(landing)?.[0] ?? "";
    expect(textOf(faq)).toContain("Where is TierSaver available?");
    expect(textOf(/class="text-muted small pricing-note"[\s\S]*?<\/p>/.exec(landing)?.[0] ?? "")).toContain(statement);
  });

  it("no page promises a representative in the EU or the UK, or claims to serve merchants there", () => {
    for (const [path, html] of pages) {
      const text = textOf(html);
      expect(text, path).not.toMatch(/we will name that representative|where the law requires us to have a representative/i);
      expect(text, path).not.toMatch(/where the (UK )?GDPR applies to (a merchant|you)\b/i);
    }
  });

  it("the app enforces it: the excluded countries live in one module, and every blocked path checks it", async () => {
    const markets = await appSource("app/markets.ts");
    for (const code of ["DE", "FR", "IE", "IS", "LI", "NO", "GB", "CH", "GI", "GG", "JE", "IM"]) expect(markets).toContain(`"${code}"`);
    for (const file of ["app/scans/engine.ts", "app/simulations/review.ts", "app/billing/billing.ts", "app/runs/gated.ts", "app/runs/gateway.server.ts", "app/klaviyo/flow.server.ts"]) {
      expect(await appSource(file), file).toContain("isShopExcluded");
    }
  });
});

describe("copy rules (brand/messaging.md)", () => {
  const forbidden: [string, RegExp][] = [
    // brand/messaging.md
    ["avoid", /\bavoid/i],
    ["dodge", /\bdodg/i],
    ["beat", /\bbeat/i],
    ["circumvent", /circumvent/i],
    ["get around", /\bget(s|ting)? around\b/i],
    ["game", /\bgam(e|ing)\b/i],
    ["outsmart", /outsmart/i],
    ["guarantee", /guarant/i],
    ["hack", /\bhack/i],
    ["10x", /\b10x\b/i],
    ["skyrocket", /skyrocket/i],
    ["supercharge", /supercharg/i],
    ["act now", /\bact now\b/i],
    ["last chance", /\blast chance\b/i],
    ["deliverability tool", /deliverability tool/i],
    ["email marketing tool", /email marketing tool/i],
    ["exclamation mark", /!/],
    ["other brands", /infinure|dnuvi|alupont/i],
    // docs/12-CUMPLIMIENTO-KLAVIYO.md, section 3.2
    ["pays for itself", /pays? for itself/i],
    ["stop paying Klaviyo", /stop paying/i],
    ["pay Klaviyo less", /pay(ing)? klaviyo less|pay less/i],
    ["lower/reduce/cut your Klaviyo bill", /(lower|reduce|cut|shrink|slash)\w*\s+(your\s+|the\s+|a\s+)?klaviyo\s+(bill|invoice|cost)/i],
    ["Klaviyo bill", /klaviyo bill\b/i],
    ["billing date", /billing date/i],
    ["before Klaviyo counts", /before klaviyo counts/i],
    ["savings", /\bsav(e|es|ed|ing|ings)\b/i],
    ["lower tier", /lower tier|drop a tier|down a tier/i],
    ["percentage of savings", /\b20%|percent(age)? of (the |your )?sav/i],
    ["fee", /\bfees?\b/i],
    ["cap", /\bcapped\b|\bcap\b/i],
    ["reactivation", /reactivat/i],
    ["endorsement words", /\bofficial|\bcertified|recommended by|\bpartners?\b/i],
    // Review of 2026-11-26: the criteria are the ones Klaviyo publishes; nothing is "recommended" by Klaviyo here.
    ["Klaviyo recommends", /recommend/i],
    // The wider mode suppresses more profiles; "stricter" can be read as the opposite.
    ["stricter", /stricter/i],
    // The audit creates a segment in the merchant's Klaviyo account, so it is not read-only.
    ["read-only audit", /read-only/i],
    // The app sends no email.
    ["promise of an email", /emails you\b|(will|we) email you|sends? you (an |a )?(email|summary)|receive (an? |the |that )(email|summary)\b(?! marketing)/i],
    ["absolute promises", /no one who buys|every run can be undone|there is no path past/i],
    ["old examples", /\$125\b|\$25\b|\$345\b|\$69\b/],
  ];

  it("no forbidden word or framing appears on any page", () => {
    for (const [path, html] of pages) {
      const text = textOf(html);
      for (const [name, re] of forbidden) {
        expect(re.test(text), `${path} contains "${name}"`).toBe(false);
      }
    }
  });

  it('"delete" is only ever used to say what TierSaver does not do, or for Klaviyo\'s and our own data deletion', () => {
    // The app suppresses; it never deletes profiles. Any sentence that pairs
    // TierSaver with deleting profiles must be a denial.
    for (const [path, html] of pages) {
      for (const sentence of textOf(html).split(/(?<=[.?:])\s/)) {
        if (!/\bTierSaver\b[^.]*\bdelet\w* (a |the |your |any )?profiles?\b/i.test(sentence)) continue;
        expect(/never|does not|not delete|no\b/i.test(sentence), `${path}: "${sentence.trim()}"`).toBe(true);
      }
    }
  });

  it("the only money amounts on any page are TierSaver's own prices: no Klaviyo price is shown", () => {
    const tierSaverPrices = new Set(FLAT_PRICE_TIERS.map((p) => `$${p.monthlyCents / 100}`));
    for (const [path, html] of pages) {
      const text = textOf(html);
      // The legal texts state their own amounts (for example a limit of liability); they are reviewed separately.
      if (isLegal(path)) continue;
      const other = (text.match(/(\$|USD\s?)[\d,]+(\.\d\d)?/g) ?? []).filter((m) => !tierSaverPrices.has(m.replace(/^USD\s?/, "$")));
      expect(other, path).toEqual([]);
    }
  });

  it("the audit is described as changing no profile, with the segment it creates", () => {
    const landing = textOf(generated.get("index.html")!);
    expect(landing).toContain("The audit is free and changes no profile.");
    expect(landing).toContain("it adds one segment to your Klaviyo account");
    const help = textOf(generated.get("help/how-the-audit-works.html")!);
    expect(help).toContain("It makes one change in your Klaviyo account: it creates a segment");
  });

  it("the monthly schedule is described as off by default, and the help says the app sends no email", () => {
    for (const path of ["index.html", "help/simulation-and-approval.html", "help/monthly-schedule-and-your-klaviyo-plan.html", "help/settings.html"]) {
      expect(textOf(generated.get(path)!), path).toMatch(/schedule is off by default|Off by default/);
    }
    expect(textOf(generated.get("help/simulation-and-approval.html")!)).toContain("The app does not send email");
  });

  it("what suppression does is stated with its exceptions", () => {
    for (const path of ["index.html", "help/what-suppress-means.html", "help/after-a-cleanup.html"]) {
      const text = textOf(generated.get(path)!);
      expect(text, path).toMatch(/most flow emails/);
      expect(text, path).toMatch(/approved as transactional/);
      expect(text, path).toMatch(/Advanced KDP/);
    }
  });

  it("the landing page says Klaviyo and what the product does in the first heading", () => {
    const html = generated.get("index.html")!;
    const h1 = textOf(/<h1[\s\S]*?<\/h1>/.exec(html)![0]).trim();
    expect(h1).toBe("Automatic list hygiene for Klaviyo.");
    expect(html).toContain(`>${AUDIT_CTA_LABEL}</a>`);
  });

  it("the footer states non-affiliation with Klaviyo and Shopify on every page", () => {
    for (const [path, html] of pages) {
      expect(html, path).toContain("not affiliated with, endorsed by or sponsored by Klaviyo, Inc. or Shopify Inc.");
    }
  });

  it("legal pages are published as final: no draft banner, indexable, in the sitemap with a canonical URL (one switch)", () => {
    expect(LEGAL_DRAFT).toBe(false);
    const sitemap = generated.get("sitemap.xml")!;
    for (const [path, html] of pages) {
      expect(html.includes("Draft under legal review"), `${path}: banner`).toBe(false);
      expect(/<meta name="robots" content="noindex">/.test(html), `${path}: noindex`).toBe(false);
      if (!isLegal(path)) continue;
      expect(html, path).not.toMatch(/BRACKETS|is not in effect|\(draft\)|Legal · Draft/);
      expect(html, path).toContain('rel="canonical"');
      expect(sitemap, path).toContain(`/${path.replace(/\.html$/, "")}<`);
    }
  });

  it("the footer links to every legal page, to data and privacy and to support", () => {
    const legal = pages.filter(([p]) => isLegal(p)).map(([p]) => p.replace(/\.html$/, ""));
    for (const [path, html] of pages) {
      const footer = html.slice(html.indexOf('<footer class="site-footer">'));
      for (const name of legal) expect(footer, `${path}: /${name}`).toContain(`<a href="/${name}">`);
      expect(footer, path).toContain('<a href="/help/data-and-privacy">');
      expect(footer, path).toContain('<a href="/help/contact">');
      expect(footer, path).toContain('href="mailto:support@tiersaver.com"');
    }
  });
});

describe("security and privacy of the pages", () => {
  it("no inline scripts, inline styles, event handlers or style attributes (CSP: self only)", () => {
    for (const [path, html] of pages) {
      // A JSON-LD block is data: the browser does not run it, so the policy does not apply to it.
      expect(/<script(?![^>]*\ssrc=)(?![^>]*\stype="application\/ld\+json")[^>]*>/i.test(html), `${path}: inline script`).toBe(false);
      expect(/<style[\s>]/i.test(html), `${path}: style element`).toBe(false);
      expect(/\sstyle\s*=/i.test(html), `${path}: style attribute`).toBe(false);
      expect(/\son[a-z]+\s*=/i.test(html), `${path}: inline event handler`).toBe(false);
    }
  });

  it("no page loads anything from another origin", () => {
    for (const [path, html] of pages) {
      for (const m of html.matchAll(/<(script|link|img|iframe|source|video|audio|form)\b[^>]*>/gi)) {
        const tag = m[0];
        if (/rel="canonical"/.test(tag)) continue;
        if (/^<link/i.test(tag) === false && /^<(script|img|iframe|source|video|audio|form)/i.test(tag) === false) continue;
        expect(/(src|href|action)="(https?:)?\/\//i.test(tag), `${path}: ${tag}`).toBe(false);
      }
    }
    const css = ["tokens.css", "base.css", "site.css"];
    return Promise.all(
      css.map(async (name) => {
        const text = await readFile(join(SITE_DIR, "styles", name), "utf8");
        expect(/url\(\s*["']?(https?:)?\/\//i.test(text), name).toBe(false);
        expect(/@import/i.test(text), name).toBe(false);
      }),
    );
  });

  it("the list check bundle makes no network calls and sets no cookies", () => {
    const js = generated.get(join("assets", "list-check.js"))!;
    expect(js).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|document\.cookie|localStorage|sessionStorage/);
    // The only URL in the bundle is the price table's "source" string from core (data, never requested).
    expect((js.match(/https?:\/\/[^\s"')]+/g) ?? []).every((u) => u === "https://www.klaviyo.com/pricing")).toBe(true);
  });

  it("only the legal drafts ask search engines not to index them", () => {
    for (const [path, html] of pages) expect(/name="robots"/i.test(html), path).toBe(LEGAL_DRAFT && isLegal(path));
  });

  it("the Content-Security-Policy allows same-origin resources only", async () => {
    const rules = parseHeaders(await readFile(join(SITE_DIR, "_headers"), "utf8"));
    const csp = (headersFor(rules, "/") as Record<string, string>)["Content-Security-Policy"]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
  });
});

describe("links and placeholders", () => {
  it("every internal link, asset and anchor resolves", async () => {
    const result = await checkLinks();
    expect(result.errors).toEqual([]);
    // The only external URLs are plain links to the Klaviyo help center articles cited as sources.
    for (const url of result.external) expect(url).toMatch(/^https:\/\/help\.klaviyo\.com\/hc\/en-us\/articles\/\d+$/);
  });

  it("every audit button goes to the one place set in build.mjs, and no link is a placeholder", () => {
    // Until the Shopify App Store listing exists the button opens an email (AUDIT_CTA_URL in build/build.mjs).
    expect(AUDIT_CTA_URL).toBe("mailto:hello@tiersaver.com?subject=Free%20list%20audit");
    for (const [path, html] of pages) {
      const ctas = [...html.matchAll(new RegExp(`<a\\b[^>]*>${AUDIT_CTA_LABEL}</a>`, "g"))].map((m) => m[0]);
      expect(ctas.length, path).toBeGreaterThan(0);
      for (const cta of ctas) expect(cta, path).toContain(`href="${AUDIT_CTA_URL}"`);
      expect(/<a\b[^>]*href="#?"/.test(html), `${path}: placeholder link`).toBe(false);
      expect(html, path).not.toContain("data-todo");
    }
    expect(textOf(generated.get("index.html")!)).toContain("TierSaver is not on the Shopify App Store yet, so the button opens an email to hello@tiersaver.com.");
  });
});
