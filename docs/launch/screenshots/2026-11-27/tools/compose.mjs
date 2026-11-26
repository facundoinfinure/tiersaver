// Composes each app crop on the brand background with a caption. No third-party assets or fonts.
import { chromium } from "./lib.mjs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const [shots, out, repo] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const tokens = readFileSync(`${repo}/brand/tokens.css`, "utf8");
const mark = readFileSync(`${repo}/brand/logo/final/mark.svg`, "utf8").replace(/<\?xml[^>]*>/, "");
const b64 = (f) => `data:image/png;base64,${readFileSync(`${shots}/crops/${f}.png`).toString("base64")}`;
const items = JSON.parse(readFileSync(new URL("./items.json", import.meta.url)));
const html = (it) => `<!doctype html><meta charset="utf-8"><style>${tokens}
*{box-sizing:border-box;margin:0}
body{width:1600px;height:900px;background:var(--bg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);overflow:hidden;display:flex;flex-direction:column}
header{height:164px;padding:0 72px;display:flex;align-items:center;gap:28px;flex:none}
header svg{width:52px;height:52px;flex:none}
h1{font-size:46px;line-height:1.1;font-weight:400;letter-spacing:-0.02em;flex:1}
.label{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line-strong);border-radius:var(--radius-pill);padding:8px 16px;flex:none}
main{flex:1;display:flex;gap:28px;align-items:flex-start;justify-content:center;padding:0 72px 60px;min-height:0}
.card{background:var(--surface-1);border:1px solid var(--line);border-radius:var(--radius-card);padding:16px;max-height:100%;display:flex;min-height:0;min-width:0;position:relative;overflow:hidden}
.card img{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:10px}
.fade::after{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(rgba(255,255,255,0),#fff 85%)}
</style><body><header>${mark}<h1>${it.caption}</h1><span class="label">Example data</span></header>
<main>${it.crops.map((c) => `<div class="card ${it.fade ? "fade" : ""}" style="${it.crops.length > 1 ? "flex:1;justify-content:center" : ""}"><img src="${b64(c)}" style="max-height:${it.crops.length > 1 ? 644 : 646}px"></div>`).join("")}</main></body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
for (const it of items) {
  await page.setContent(html(it), { waitUntil: "load" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${it.name}.png` });
  console.log(it.name, it.caption.split(/\s+/).length, "words");
}
// downscale helper: raw @2x -> 1600x900
for (const f of (process.env.DOWN ?? "").split(",").filter(Boolean)) {
  await page.setContent(`<body style="margin:0"><img src="data:image/png;base64,${readFileSync(f).toString("base64")}" style="width:1600px;height:900px;display:block">`);
  await page.screenshot({ path: f.replace(/\.png$/, "-1600x900.png") });
}
await browser.close();
