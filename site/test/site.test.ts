import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CURRENT_PRICE_TABLES, DEFAULT_SCHEDULE, SIMULATION_TTL_MS } from "@tiersaver/core";
import { CLEANUP_CRITERIA, TIERSAVER_PLANS } from "../src/site-config.js";
import { SITE_DIR, generate } from "../build/build.mjs";
import { checkLinks } from "../build/check-links.mjs";
import { headersFor, parseHeaders } from "../build/serve.mjs";

let generated: Map<string, string>;
let pages: [string, string][];

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
      "help/how-the-audit-works.html",
      "help/cleanup-criteria.html",
      "help/simulation-and-approval.html",
      "help/what-suppress-means.html",
      "help/undo.html",
      "help/monthly-schedule-and-your-klaviyo-plan.html",
      "help/pricing.html",
      "help/uninstalling.html",
      "help/data-and-privacy.html",
      "guides/klaviyo-list-hygiene.html",
      "guides/how-klaviyo-counts-active-profiles.html",
      "guides/suppress-vs-delete-vs-unsubscribe.html",
      "sitemap.xml",
      "assets/list-check.js",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("lists every page except the 404 in the sitemap", () => {
    const sitemap = generated.get("sitemap.xml")!;
    expect(sitemap).toContain("<loc>https://tiersaver.com/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/help/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/guides/how-klaviyo-counts-active-profiles</loc>");
    expect(sitemap).not.toContain("404");
    expect(sitemap.match(/<loc>/g)).toHaveLength(pages.length - 1);
  });
});

describe("numbers on the pages come from core and site-config", () => {
  const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

  it("pricing: every provisional plan is shown, on the landing page and in the help center", () => {
    for (const path of ["index.html", "help/pricing.html"]) {
      const text = textOf(generated.get(path)!);
      for (const plan of TIERSAVER_PLANS) {
        expect(text, path).toContain(`${plan.maxProfiles.toLocaleString("en-US")}`);
        expect(text, path).toMatch(new RegExp(`\\${usd(plan.monthlyCents)} per month`));
      }
      expect(text, path).toContain("Above 150,000");
      expect(text, path).toContain("Contact us");
    }
    const landing = textOf(generated.get("index.html")!);
    expect(landing).toContain("A month in which no cleanup runs is not charged.");
    expect(landing).toContain("The audit is free.");
  });

  it("list health check: static default equals core's plan sizes, dated", () => {
    const email = CURRENT_PRICE_TABLES.email;
    const text = textOf(generated.get("index.html")!);
    const before = email.tiers.find((t) => t.maxProfiles === 12_500)!;
    const after = email.tiers.find((t) => t.maxProfiles === 10_000)!;
    expect(text).toContain(`Today Up to 12,500 profiles (${usd(before.monthlyCents)}/mo list price)`);
    expect(text).toContain(`After the cleanup Up to 10,000 profiles (${usd(after.monthlyCents)}/mo list price)`);
    expect(text).toContain(`Klaviyo list prices read on ${email.capturedOn}`);
    expect(text).toContain("Suppressed profiles do not count toward your Klaviyo email plan, according to Klaviyo's help center");
    expect(generated.get("index.html")!).toContain('href="https://help.klaviyo.com/hc/en-us/articles/24263920096027"');
  });

  it("cleanup criteria", () => {
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
    expect(textOf(generated.get("help/monthly-schedule-and-your-klaviyo-plan.html")!)).toContain(
      `runs ${DEFAULT_SCHEDULE.leadDays} days before your plan's renewal date`,
    );
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

  it("Klaviyo list prices only appear on the landing page, dated and labelled as list prices", () => {
    const tierSaverPrices = new Set(TIERSAVER_PLANS.map((p) => `$${p.monthlyCents / 100}`));
    for (const [path, html] of pages) {
      const text = textOf(html);
      const other = (text.match(/\$[\d,]+(\.\d\d)?/g) ?? []).filter((m) => !tierSaverPrices.has(m));
      if (path === "index.html") {
        expect(other.sort()).toEqual(["$150", "$275"]);
        expect(text).toContain("/mo list price");
      } else {
        expect(other, path).toEqual([]);
      }
    }
  });

  it("the landing page says Klaviyo and what the product does in the first heading", () => {
    const html = generated.get("index.html")!;
    const h1 = textOf(/<h1[\s\S]*?<\/h1>/.exec(html)![0]).trim();
    expect(h1).toBe("Automatic list hygiene for Klaviyo.");
    expect(html).toContain(">Run my free list audit</a>");
  });

  it("the footer states non-affiliation with Klaviyo and Shopify on every page", () => {
    for (const [path, html] of pages) {
      expect(html, path).toContain("not affiliated with, endorsed by or sponsored by Klaviyo, Inc. or Shopify Inc.");
    }
  });

  it("legal pages carry the draft banner", () => {
    for (const path of ["privacy.html", "terms.html"]) {
      expect(generated.get(path)!).toContain("<strong>Draft, pending review.</strong>");
    }
  });
});

describe("security and privacy of the pages", () => {
  it("no inline scripts, inline styles, event handlers or style attributes (CSP: self only)", () => {
    for (const [path, html] of pages) {
      expect(/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), `${path}: inline script`).toBe(false);
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

  it("no page asks search engines not to index it", () => {
    for (const [path, html] of pages) expect(/name="robots"/i.test(html), path).toBe(false);
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

  it("the only placeholder link is the App Store URL, and it is marked on every CTA", () => {
    for (const [path, html] of pages) {
      const ctas = [...html.matchAll(/<a\b[^>]*>Run my free list audit<\/a>/g)].map((m) => m[0]);
      expect(ctas.length, path).toBeGreaterThan(0);
      for (const cta of ctas) {
        expect(cta, path).toContain('href="#"');
        expect(cta, path).toContain('data-todo="app-store-url"');
      }
      for (const m of html.matchAll(/<a\b[^>]*href="#"[^>]*>/g)) {
        expect(m[0], path).toContain('data-todo="app-store-url"');
      }
    }
  });
});
