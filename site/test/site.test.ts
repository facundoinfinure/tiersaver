import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_PRICE_TABLES,
  DEFAULT_FEE_POLICY,
  DEFAULT_RULE_SETTINGS,
  DEFAULT_SCHEDULE,
  estimateSavings,
  formatUsd,
  quoteCharge,
} from "@tiersaver/core";
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
      "help/protection-rules.html",
      "help/simulation-and-approval.html",
      "help/what-suppress-means.html",
      "help/undo-and-the-90-day-rule.html",
      "help/billing-date-and-auto-downgrade.html",
      "help/how-the-fee-works.html",
      "help/uninstalling.html",
      "help/data-and-privacy.html",
      "guides/klaviyo-bill-calculator.html",
      "guides/reduce-klaviyo-bill.html",
      "guides/klaviyo-active-profiles.html",
      "sitemap.xml",
      "assets/calculator.js",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("lists every page except the 404 in the sitemap", () => {
    const sitemap = generated.get("sitemap.xml")!;
    expect(sitemap).toContain("<loc>https://tiersaver.com/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/help/</loc>");
    expect(sitemap).toContain("<loc>https://tiersaver.com/guides/klaviyo-active-profiles</loc>");
    expect(sitemap).not.toContain("404");
    expect(sitemap.match(/<loc>/g)).toHaveLength(pages.length - 1);
  });
});

describe("numbers on the pages come from core", () => {
  const email = CURRENT_PRICE_TABLES.email;
  const ex1 = estimateSavings({ profilesBefore: 12_500, profilesRemoved: 2_500, table: email });
  const ex2 = estimateSavings({ profilesBefore: 50_000, profilesRemoved: 30_000, table: email });
  const fee1 = quoteCharge({ monthlySavingsCents: ex1.monthlySavingsCents });
  const fee2 = quoteCharge({ monthlySavingsCents: ex2.monthlySavingsCents });

  it("landing page worked example", () => {
    const text = textOf(generated.get("index.html")!);
    expect(formatUsd(ex1.monthlySavingsCents)).toBe("$125");
    expect(formatUsd(fee1.feeCents)).toBe("$25");
    expect(text).toContain(`Estimated saving ${formatUsd(ex1.monthlySavingsCents)}/mo`);
    expect(text).toContain(`TierSaver fee 20% of ${formatUsd(ex1.monthlySavingsCents)} ${formatUsd(fee1.feeCents)}`);
    expect(text).toContain(
      `You keep that month, estimated ${formatUsd(ex1.monthlySavingsCents - fee1.feeCents)}`,
    );
    expect(text).toContain(
      `50,000 to 20,000 profiles ${formatUsd(ex2.monthlySavingsCents)}/mo ${formatUsd(fee2.feeCents)}`,
    );
    expect(text).toContain(`capped at US${formatUsd(DEFAULT_FEE_POLICY.windowCapCents)} per month`);
    expect(text).toContain(`Klaviyo list prices as read on ${email.capturedOn}`);
  });

  it("protection rule defaults", () => {
    const text = textOf(generated.get("help/protection-rules.html")!);
    for (const days of [
      DEFAULT_RULE_SETTINGS.purchaseDays,
      DEFAULT_RULE_SETTINGS.clickDays,
      DEFAULT_RULE_SETTINGS.openDays,
      DEFAULT_RULE_SETTINGS.newProfileDays,
      DEFAULT_RULE_SETTINGS.siteActivityDays,
      DEFAULT_RULE_SETTINGS.reactivationLockDays,
    ]) {
      expect(text).toContain(`last ${days} days`);
    }
    expect(textOf(generated.get("index.html")!)).toContain(
      `Bought in the last ${DEFAULT_RULE_SETTINGS.purchaseDays} days`,
    );
  });

  it("schedule lead time", () => {
    expect(textOf(generated.get("help/billing-date-and-auto-downgrade.html")!)).toContain(
      `runs ${DEFAULT_SCHEDULE.leadDays} days before your billing date`,
    );
  });

  it("the tier table lists every tier of both plans", () => {
    const html = generated.get(join("guides", "klaviyo-bill-calculator.html"))!;
    for (const table of [CURRENT_PRICE_TABLES.email, CURRENT_PRICE_TABLES.email_sms]) {
      for (const tier of table.tiers) {
        expect(html).toContain(
          `<td>Up to ${tier.maxProfiles.toLocaleString("en-US")}</td><td>${formatUsd(tier.monthlyCents)}</td>`,
        );
      }
    }
  });
});

describe("copy rules (brand/messaging.md)", () => {
  const forbidden: [string, RegExp][] = [
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
    ["pay Klaviyo less", /pay klaviyo less/i],
    ["exclamation mark", /!/],
    ["other brands", /infinure|dnuvi|alupont/i],
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

  it("every page that shows a dollar figure says it is estimated", () => {
    for (const [path, html] of pages) {
      const text = textOf(html);
      if (/\$\d/.test(text)) expect(/estimate/i.test(text), `${path} shows $ without "estimate"`).toBe(true);
    }
  });

  it("the landing page says Klaviyo and what the product does in the first heading", () => {
    const html = generated.get("index.html")!;
    const h1 = textOf(/<h1[\s\S]*?<\/h1>/.exec(html)![0]).trim();
    expect(h1).toBe("Klaviyo list hygiene that pays for itself.");
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

  it("the calculator bundle makes no network calls and sets no cookies", () => {
    const js = generated.get(join("assets", "calculator.js"))!;
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
    expect(result.external).toEqual([]);
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
