import { createRequire } from "node:module";
export const { chromium } = createRequire("/")("playwright");
export const base = "http://localhost:3210";
export async function setup(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
  await context.route("https://cdn.shopify.com/shopifycloud/app-bridge.js", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  for (const host of ["klaviyo.com", "shopify.com", "myshopify.com"]) {
    await context.route(new RegExp(`^https://([a-z0-9-]+\\.)*${host.replace(".", "\\.")}/`), (route) => {
      if (route.request().url().startsWith("https://cdn.shopify.com/")) return route.fallback();
      return route.abort();
    });
  }
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error" && !/app-bridge|net::ERR_FAILED|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  const button = (name) => page.getByRole("button", { name }).first();
  const link = (name) => page.getByRole("link", { name }).first();
  const tick = (name) => page.locator(`s-checkbox[name="${name}"] input`).first().click({ force: true });
  const click = async (l) => { await l.click({ timeout: 15000 }); await page.waitForLoadState("networkidle").catch(() => {}); };
  return { browser, context, page, problems, button, link, tick, click };
}
