// Drives the local preview (npm run preview:app) through the whole merchant journey in headless Chromium
// and saves a screenshot of every step. See README.md.
//
//   node preview/walk.mjs <output-dir>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const out = process.argv[2] ?? "preview-shots";
const base = process.env.PREVIEW_URL ?? "http://localhost:3210";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error" && !/app-bridge|net::ERR_FAILED|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) problems.push(`${r.status()} ${new URL(r.url()).pathname}`); });

// App Bridge only works inside the Shopify admin: an empty script takes its place.
await context.route("https://cdn.shopify.com/shopifycloud/app-bridge.js", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
// Safety net: the preview server keeps every redirect on localhost; nothing may reach the real services.
for (const host of ["klaviyo.com", "shopify.com", "myshopify.com"]) {
  await context.route(new RegExp(`^https://([a-z0-9-]+\\.)*${host.replace(".", "\\.")}/`), (route) => {
    if (route.request().url().startsWith("https://cdn.shopify.com/")) return route.fallback();
    problems.push(`blocked request to ${new URL(route.request().url()).hostname}`);
    return route.abort();
  });
}

let step = 0;
const log = [];
async function shot(name, note = "") {
  await page.waitForTimeout(700);
  const file = `${String(++step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(out, file), fullPage: true });
  log.push(`${file}  ${page.url().replace(base, "")}  ${note}`);
}
const button = (name) => page.getByRole("button", { name }).first();
const link = (name) => page.getByRole("link", { name }).first();
/** Polaris checkboxes render their input in a shadow root and are "display: contents": click the input itself. */
const tick = (name) => page.locator(`s-checkbox[name="${name}"] input`).first().click({ force: true });
async function click(locator) { await locator.click({ timeout: 15000 }); await page.waitForLoadState("networkidle").catch(() => {}); }

await page.request.get(`${base}/__preview/reset`);
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await shot("home-new");

await click(link("Connect Klaviyo"));
await page.waitForURL(/\/app(\?|$)/, { timeout: 30000 });
await shot("home-connected");

await click(button("Run the free audit"));
await shot("home-audit-running");
await page.getByText("A cleanup would suppress").first().waitFor({ timeout: 90000 });
await shot("home-audited-no-order-history", "without order history nobody can be a candidate");

await page.request.get(`${base}/__preview/orders`);
await click(button("Run the audit again"));
await page.waitForTimeout(1500);
await page.getByText("waiting for your review").first().waitFor({ timeout: 90000 });
await shot("home-audited");

await page.goto(`${base}/app/simulation`, { waitUntil: "networkidle" });
await shot("review-open");
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }).catch(() => null), button(/Download/).click()]);
if (download) { const p = join(out, "candidates.csv"); await download.saveAs(p); log.push(`csv downloaded: ${download.suggestedFilename()}`); } else problems.push("CSV download did not start");
await click(button("Approve this cleanup"));
await shot("review-approve-without-ticking");
await tick("acknowledged");
await click(button("Approve this cleanup"));
await shot("review-approved");
await click(button("Review pricing in Shopify"));
await page.waitForURL(/\/app\/simulation/, { timeout: 30000 });
await shot("review-approved-subscribed");
await click(button(/Start cleanup/));
await page.waitForURL(/\/app\/runs\//, { timeout: 30000 });
await shot("run-started");
await page.getByText("Completed").first().waitFor({ timeout: 90000 });
await shot("run-completed");
await click(button("Check jobs in Klaviyo"));
await shot("run-jobs");
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await shot("home-after-cleanup");
await page.goto(`${base}/app/runs`, { waitUntil: "networkidle" });
await shot("history");
await click(link("Details"));
await click(button(/Restore/));
await shot("undo-result");
if (await page.locator('s-checkbox[name="confirmAfterRenewal"]').count()) {
  await tick("confirmAfterRenewal");
  await click(button(/Restore/));
  await shot("undo-confirmed");
}
await page.getByText("Completed").first().waitFor({ timeout: 90000 }).catch(() => problems.push("undo did not complete"));
await shot("undo-completed");
// A restored profile is left out for 365 days: the next audit finds nothing and says why.
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await click(button("Run the audit again"));
await page.getByText("were restored in the last 365 days").first().waitFor({ timeout: 90000 }).catch(() => problems.push("restore lock was not explained on the home page"));
await shot("home-restore-lock");

await page.goto(`${base}/app/settings`, { waitUntil: "networkidle" });
await shot("settings");
await tick("wider");
await shot("settings-wider-open");
await page.locator('s-number-field[name="clickDays"] input').fill("100");
await click(button("Save settings"));
await shot("settings-below-floor");
await page.goto(`${base}/app/settings`, { waitUntil: "networkidle" });
await tick("protectedGroup");
await tick("scheduleEnabled");
await click(button("Save settings"));
await shot("settings-saved");
await page.goto(`${base}/app/simulation`, { waitUntil: "networkidle" });
await shot("review-after-rules-changed");
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await shot("home-schedule-on");
await button("Disconnect Klaviyo").click();
await page.waitForTimeout(600);
await shot("home-disconnect-confirmation");
await click(page.getByRole("button", { name: "Disconnect", exact: true }));
await page.waitForURL(/klaviyo=disconnected/, { timeout: 15000 }).catch(() => problems.push("disconnect did not go through"));
await shot("home-disconnected");
await page.goto(`${base}/app/not-a-page`, { waitUntil: "networkidle" });
await shot("page-not-found");
problems.splice(0, problems.length, ...problems.filter((p) => p !== "404 /app/not-a-page"));

writeFileSync(join(out, "walk.log"), [...log, "", "problems:", ...(problems.length ? [...new Set(problems)] : ["none"])].join("\n"));
console.log(log.join("\n"));
console.log("\nproblems:\n" + (problems.length ? [...new Set(problems)].join("\n") : "none"));
await browser.close();
