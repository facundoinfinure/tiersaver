// Records the silent 60-90 s walkthrough against the local preview (see docs/launch/video.md).
// The page is recorded at 1280x640; finish-video.mjs adds the 80 px caption strip below it and exports MP4.
import { setup, base } from "./lib.mjs";
import { mkdirSync, renameSync, readdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? "video"; mkdirSync(out, { recursive: true });
const W = 1280, H = 640;
// 1. Prepare the state off camera: connected, order history read, one finished audit.
{
  const { browser, page, button, link, click } = await setup({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
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
  await browser.close();
}
// 2. Record.
const { browser, context, page, problems, button, tick } = await setup({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: W, height: H } } });
// Captions and the pointer are drawn with a constructed stylesheet (pseudo-elements), so the page's DOM is not touched.
await context.addInitScript(() => {
  if (window.top !== window) return;
  const base = new CSSStyleSheet(), dyn = new CSSStyleSheet();
  const arrow = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M3 2l15 11-6.5 1 3.8 7.6-2.6 1.3-3.8-7.7L4 19z" fill="#101010" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  base.replaceSync(`s-app-nav{display:none!important} html,body{background:#f1f1f1!important}
    html::after{content:"";position:fixed;z-index:2147483647;pointer-events:none;width:24px;height:24px;background:url("${arrow}") no-repeat;transform-origin:3px 2px}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, base, dyn];
  let down = false;
  const draw = () => {
    const [x, y] = (sessionStorage.getItem("__cur") ?? "640,320").split(",");
    dyn.replaceSync(`html::after{left:${x - 3}px;top:${y - 2}px;transform:scale(${down ? 0.85 : 1})}`);
  };
  window.__draw = draw; draw();
  addEventListener("mousemove", (e) => { sessionStorage.setItem("__cur", `${e.clientX},${e.clientY}`); draw(); }, true);
  addEventListener("mousedown", () => { down = true; draw(); }, true);
  addEventListener("mouseup", () => setTimeout(() => { down = false; draw(); }, 180), true);
});
// The sample Klaviyo account id of the preview is replaced by a neutral one, in the server response itself.
await context.route(/^http:\/\/localhost:3210\/app/, async (route) => {
  const res = await route.fetch();
  const type = res.headers()["content-type"] ?? "";
  if (!/html|json|text|turbo/.test(type)) return route.fulfill({ response: res });
  return route.fulfill({ response: res, body: (await res.text()).replaceAll("PREVW1", "Xk4T9a") });
});
const t0 = Date.now(); const marks = [];
const caps = [];
const cap = async (text) => { const t = (Date.now() - t0) / 1000; caps.push({ t, text }); marks.push(`${t.toFixed(1)}s  ${text}`); };
const wait = (ms) => page.waitForTimeout(ms);
const scrollTo = async (y) => { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y); await wait(900); };
async function press(locator, after = 600) {
  await locator.evaluate((el) => { const r = el.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 60) window.scrollTo({ top: scrollY + r.top - innerHeight * 0.45, behavior: "smooth" }); });
  await wait(800);
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, { steps: 28 });
  await wait(350);
  await page.mouse.down(); await wait(90); await page.mouse.up();
  await wait(after);
}
// Custom elements such as s-heading can report an empty box: measure the nearest ancestor that has one.
const yOf = async (text, exact = false) => page.getByText(text, { exact }).first().evaluate((el) => { let e = el; while (e && e.getBoundingClientRect().height === 0) e = e.parentElement ?? e.getRootNode().host; return (e ?? el).getBoundingClientRect().top + window.scrollY; });

try {
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await page.mouse.move(640, 320);
await cap("TierSaver keeps your Klaviyo list clean. You approve every cleanup.");
await wait(3500);
await cap("Step 1: run the audit. It changes no profile.");
await scrollTo((await yOf("Your list", true)) - 80);
await wait(1200);
await press(button("Run the audit again"), 400);
await page.getByText("waiting for your review").first().waitFor({ timeout: 90000 });
await page.waitForLoadState("networkidle").catch(() => {});
await wait(1200);
await scrollTo((await yOf("Your list", true)) - 80);
await cap("The audit counts profiles that never opened, clicked, visited or purchased.");
await wait(4000);
await cap("Buyers, SMS subscribers and new profiles are kept active.");
await wait(3500);
await scrollTo(0);
await cap("Step 2: review the simulation.");
await press(page.getByRole("link", { name: "Review and approve" }).first(), 300);
await page.waitForURL(/\/app\/simulation/, { timeout: 30000 });
await page.waitForLoadState("networkidle").catch(() => {});
await wait(4000);
await cap("Download the candidate list and check it.");
await press(button(/Download file 1/), 2200);
await cap("Read the notices: what suppressing does, how to restore, the plan.");
await scrollTo((await yOf("Before you approve")) - 30);
await wait(3500);
await scrollTo((await yOf("What you pay")) - 60);
await wait(3500);
await cap("Step 3: tick the box and approve. Shopify asks you to confirm the plan.");
await press(page.locator('s-checkbox[name="acknowledged"] input').first(), 900);
await press(button(/Approve and start plan/), 300);
await page.getByText("Included in your plan").first().waitFor({ timeout: 30000 });
await page.waitForLoadState("networkidle").catch(() => {});
await wait(2500);
await page.request.get(`${base}/__preview/klaviyo?delay=${process.env.DELAY ?? 60}`);
await cap("Step 4: start the cleanup. Profiles are suppressed, never deleted.");
await press(button(/Start cleanup/), 300);
await page.waitForURL(/\/app\/runs\//, { timeout: 30000 });
await page.waitForLoadState("networkidle").catch(() => {});
await wait(3000);
await cap("Each profile is checked again right before it is sent to Klaviyo.");
const tRun = Date.now();
await page.getByText("Completed").first().waitFor({ timeout: 240000 });
marks.push(`(cleanup took ${((Date.now() - tRun) / 1000).toFixed(1)}s after the caption)`);
await page.request.get(`${base}/__preview/klaviyo?delay=0`);
await cap("Done. The cleanup is logged: who approved it, which rule, how many profiles.");
await wait(5000);
await cap("Made a mistake? Restore removes the suppression this cleanup added.");
await press(button(/^Restore [\d,]+ profiles?$/), 3500);
await press(page.getByRole("button", { name: /Cancel|Keep/ }).first(), 800).catch(() => page.keyboard.press("Escape"));
await page.goto(`${base}/app/settings`, { waitUntil: "networkidle" });
await cap("Settings: criteria, protected lists, monthly schedule and your plan.");
await wait(2500);
await scrollTo((await yOf("Protected lists and segments")) - 40);
await wait(2500);
await scrollTo((await yOf("Monthly schedule")) - 40);
await wait(2500);
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await cap("TierSaver: list hygiene for Klaviyo.");
await wait(5000);
} catch (e) { console.log("FAILED", e.message.slice(0,300)); await page.screenshot({ path: "fail.png" }); }
const total = (Date.now() - t0) / 1000;
await context.close();
writeFileSync(`${out}/captions.json`, JSON.stringify({ total, caps }, null, 2));
const f = readdirSync(out).find((n) => n.endsWith(".webm")); renameSync(`${out}/${f}`, `${out}/video-draft.webm`);
console.log(marks.join("\n")); console.log("total", total.toFixed(1), "s"); console.log("problems", problems);
await browser.close();
