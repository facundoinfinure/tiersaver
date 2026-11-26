import { setup, base } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(`${out}/raw`, { recursive: true }); mkdirSync(`${out}/crops`, { recursive: true });
const { browser, page, problems, button, link, tick, click } = await setup({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
// Cosmetic only: hide the nav links that live in the Shopify admin sidebar, admin-grey background, neutral account id.
async function tidy() {
  await page.addStyleTag({ content: "s-app-nav{display:none!important} html,body{background:#f1f1f1!important}" });
  await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.includes("PREVW1")) n.nodeValue = n.nodeValue.replaceAll("PREVW1", "Xk4T9a");
  });
  await page.waitForTimeout(600);
}
const box = async (sel) => {
  const h = await page.locator(sel).first().elementHandle();
  return h.evaluate((el) => {
    let r = el.getBoundingClientRect();
    if (!r.width && el.shadowRoot) for (const c of el.shadowRoot.querySelectorAll("*")) { const cr = c.getBoundingClientRect(); if (cr.width && cr.height) { r = cr; break; } }
    return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
  });
};
const view = (name, y) => page.screenshot({ path: `${out}/raw/${name}.png`, fullPage: true, clip: { x: 0, y, width: 1600, height: 900 } });
const full = (name) => page.screenshot({ path: `${out}/raw/${name}-full.png`, fullPage: true });
const crop = async (name, c) => {
  const st = await page.addStyleTag({ content: "html,body{background:#fff!important}" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/crops/${name}.png`, fullPage: true, clip: { x: c.x - 2, y: c.y - 2, width: c.width + 4, height: c.height + 6 } });
  await st.evaluate((n) => n.remove());
};
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }; };
const sec = (h) => `s-section[heading="${h}"]`;

await page.request.get(`${base}/__preview/reset`);
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await click(link("Connect Klaviyo"));
await page.waitForURL(/\/app(\?|$)/, { timeout: 30000 });
await click(button("Run the free audit"));
await page.getByText("A cleanup would suppress").first().waitFor({ timeout: 90000 });
await page.request.get(`${base}/__preview/orders`);
await click(button("Run the audit again"));
await page.waitForTimeout(1500);
await page.getByText("waiting for your review").first().waitFor({ timeout: 90000 });
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await tidy();
const list = await box(sec("Your list"));
console.log("home list", list);
await full("01-home-audit");
const gs = await box(sec("Get started")); console.log("gs", gs);
await view("01-home-audit", Math.round(gs.y - 14));
await crop("01-home-audit", list);

await page.goto(`${base}/app/simulation`, { waitUntil: "networkidle" });
await tidy();
const bya = await box(sec("Before you approve"));
const cand = await box(sec("Check the candidates"));
const sim = await box(sec("Simulation"));
const pay = await box('text="What you pay"');
console.log({ bya, cand, sim, pay });
await full("02-review-before-you-approve");
await view("02-review-before-you-approve", (await page.evaluate(() => document.documentElement.scrollHeight)) - 900);
await view("02b-review-simulation", 0);
await crop("02-review", { x: cand.x, y: cand.y, width: cand.width, height: pay.y - 14 - cand.y });

await tick("acknowledged");
await click(button(/Approve and start plan/));
await page.waitForURL(/\/app\/simulation/, { timeout: 30000 });
await page.getByText("Included in your plan").first().waitFor({ timeout: 30000 });
await page.request.get(`${base}/__preview/klaviyo?delay=${process.env.DELAY ?? 400}`);
await click(button(/Start cleanup/));
await page.waitForURL(/\/app\/runs\//, { timeout: 30000 });
// wait for visible progress
for (let i = 0; i < 60; i++) {
  const t = await page.locator("body").innerText();
  const m = t.match(/([\d,]+) of 2,234 profiles sent/);
  if (m && m[1] !== "0") break;
  if (/Completed/.test(t)) { problems.push("cleanup completed before a progress shot"); break; }
  await page.waitForTimeout(1500);
  if (i % 3 === 2) await page.reload({ waitUntil: "networkidle" });
}
await tidy();
await full("03-cleanup-running");
await view("03-cleanup-running", 0);
await crop("03-cleanup-running", await box(sec("Summary")));
await page.request.get(`${base}/__preview/klaviyo?delay=0`);
await page.getByText("Completed").first().waitFor({ timeout: 240000 });
await page.waitForTimeout(3500);
await page.reload({ waitUntil: "networkidle" });
await tidy();
await full("04-cleanup-completed");
await view("04-cleanup-completed", 0);
await crop("04-cleanup-completed", union(await box(sec("Summary")), await box(sec("Restore this cleanup"))));

await page.goto(`${base}/app/settings`, { waitUntil: "networkidle" });
await tick("protectedGroup");
await tick("scheduleEnabled");
await click(button("Save settings"));
await page.waitForTimeout(1200);
await tidy();
await page.evaluate(() => window.scrollTo(0, 0));
const who = await box(sec("Who counts as inactive")), prot = await box(sec("Protected lists and segments")), sched = await box(sec("Monthly schedule")), plan = await box(sec("Plan"));
console.log({ who, prot, sched, plan }, await page.evaluate(() => document.documentElement.scrollHeight));
await full("05-settings");
await view("05a-settings-criteria-lists-schedule", Math.max(0, Math.round(sched.y + sched.height + 16 - 900)));
const h = await page.evaluate(() => document.documentElement.scrollHeight);
await view("05b-settings-plan", Math.min(h - 900, Math.round(plan.y + plan.height / 2 - 450)));
await crop("05-settings-left", union(who, prot));
await crop("05-settings-right", sched);
console.log("problems", problems);
await browser.close();
