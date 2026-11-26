// Records a silent draft of the 60-90 s walkthrough against the local preview. See docs/launch/video.md.
import { setup, base } from "./lib.mjs";
import { mkdirSync, renameSync, readdirSync } from "node:fs";
const out = process.argv[2] ?? "video"; mkdirSync(out, { recursive: true });
const W = 1280, H = 720;
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
  base.replaceSync(`s-app-nav{display:none!important} html,body{background:#f1f1f1!important}
    body::after{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;background:#101010;color:#fff;font:400 22px/1.3 system-ui,sans-serif;padding:12px 26px;border-radius:999px;width:max-content;max-width:1080px;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25)}
    html::after{content:"";position:fixed;z-index:2147483647;border-radius:50%;background:rgba(232,201,162,.6);border:2px solid #101010;pointer-events:none;transform:translate(-50%,-50%)}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, base, dyn];
  let down = false;
  const draw = () => {
    const cap = sessionStorage.getItem("__cap") ?? "";
    const [x, y] = (sessionStorage.getItem("__cur") ?? "640,360").split(",");
    dyn.replaceSync(`body::after{content:${JSON.stringify(cap)};display:${cap ? "block" : "none"}} html::after{left:${x}px;top:${y}px;width:${down ? 32 : 20}px;height:${down ? 32 : 20}px}`);
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
const cap = async (text) => { marks.push(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${text}`); await page.evaluate((t) => { sessionStorage.setItem("__cap", t); window.__draw?.(); }, text); };
const wait = (ms) => page.waitForTimeout(ms);
const scrollTo = async (y) => { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y); await wait(900); };
async function press(locator, after = 600) {
  await locator.evaluate((el) => { const r = el.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 170) window.scrollTo({ top: scrollY + r.top - innerHeight * 0.45, behavior: "smooth" }); });
  await wait(800);
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2, { steps: 28 });
  await wait(350);
  await page.mouse.down(); await wait(90); await page.mouse.up();
  await wait(after);
}
const yOf = async (text) => page.getByText(text, { exact: false }).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

try {
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await page.mouse.move(640, 360);
await cap("TierSaver keeps your Klaviyo list clean. You approve every cleanup.");
await wait(3500);
await cap("Step 1: run the audit. It changes no profile.");
await scrollTo((await yOf("Your list")) - 80);
await wait(1200);
await press(button("Run the audit again"), 400);
await page.getByText("waiting for your review").first().waitFor({ timeout: 90000 });
await wait(600);
await scrollTo((await yOf("Your list")) - 80);
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
await wait(3500);
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
await cap("Settings: criteria, protected lists, monthly schedule and your plan.");
await page.goto(`${base}/app/settings`, { waitUntil: "networkidle" });
await wait(2500);
await scrollTo((await yOf("Protected lists and segments")) - 40);
await wait(2500);
await scrollTo((await yOf("Monthly schedule")) - 40);
await wait(2500);
await cap("TierSaver: list hygiene for Klaviyo.");
await page.goto(`${base}/app`, { waitUntil: "networkidle" });
await wait(5000);
} catch (e) { console.log("FAILED", e.message.slice(0,300)); await page.screenshot({ path: "fail.png" }); }
const total = (Date.now() - t0) / 1000;
await context.close();
const f = readdirSync(out).find((n) => n.endsWith(".webm")); renameSync(`${out}/${f}`, `${out}/video-draft.webm`);
console.log(marks.join("\n")); console.log("total", total.toFixed(1), "s"); console.log("problems", problems);
await browser.close();
