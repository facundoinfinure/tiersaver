import { chromium } from "./lib.mjs";
import { readFileSync } from "node:fs";
const [shots, out, repo] = process.argv.slice(2);
const tokens = readFileSync(`${repo}/brand/tokens.css`, "utf8");
const logo = readFileSync(`${repo}/brand/logo/final/logo.svg`, "utf8").replace(/<\?xml[^>]*>/, "");
const img = `data:image/png;base64,${readFileSync(`${shots}/crops/01-home-audit.png`).toString("base64")}`;
const html = `<!doctype html><meta charset="utf-8"><style>${tokens}
*{box-sizing:border-box;margin:0}
body{width:1600px;height:900px;background:var(--bg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);display:flex;align-items:center;gap:64px;padding:0 88px;overflow:hidden}
.l{width:560px;flex:none}.l svg{height:44px;width:auto;display:block;margin-bottom:56px}
h1{font-size:64px;line-height:1.06;font-weight:400;letter-spacing:-0.025em}h1 span{color:var(--faint)}
p{margin-top:28px;font-size:24px;line-height:1.4;color:var(--ink-2)}
.card{flex:1;background:var(--surface-1);border:1px solid var(--line);border-radius:var(--radius-card);padding:18px}
.card img{display:block;width:100%;border-radius:10px}
</style><body><div class="l">${logo}<h1>Suppress profiles that never engaged. <span>After you approve.</span></h1><p>Audit, simulation, approval, log and restore.</p></div><div class="card"><img src="${img}"></div></body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" }); await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
