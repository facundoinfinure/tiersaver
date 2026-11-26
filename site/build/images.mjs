/**
 * Renders the raster images derived from the brand SVGs.
 *
 *   node build/images.mjs               write into site/assets/
 *   node build/images.mjs --out <dir>   write somewhere else (to compare first)
 *
 *   favicon-32.png        32 x 32    from site/assets/favicon.svg (transparent corners)
 *   (site/favicon.ico is that same PNG inside an ICO container, for clients that ask for /favicon.ico
 *   without reading the page. It is not regenerated here: rebuild it if favicon-32.png changes.)
 *   apple-touch-icon.png  180 x 180  from brand/logo/final/app-icon.svg (full bleed)
 *   og-image.png          1200 x 630 social card composed here from the logo,
 *                                    the mark, the site fonts and the brand colors
 *
 * It needs a browser: the script uses Playwright's Chromium if a "playwright"
 * package can be resolved (from this workspace or a global install). Playwright
 * is deliberately not a dependency of the site; without it the script explains
 * what is missing and exits with 1.
 *
 * The PNGs are not part of `npm run build` nor of `build --check`, because the
 * output depends on the browser version. Run this by hand when the brand files
 * change, look at the result and commit it. The two icons are plain SVG
 * renders. The social card layout is defined in ogPage() below; it was rebuilt
 * to match the committed og-image.png by eye and by measurement, so a fresh
 * render is visually equivalent to it but not byte-identical.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { SITE_DIR } from "./assets.mjs";

const BRAND_DIR = join(SITE_DIR, "..", "brand", "logo", "final");
const ASSETS_DIR = join(SITE_DIR, "assets");
const FONTS_DIR = join(SITE_DIR, "fonts");

// Brand colors (site/styles/tokens.css).
const COLOR = { bg: "#eeeeec", ink: "#141414", faint: "#7f7c76", muted: "#5f5e59", deep: "#101010", accent: "#e8c9a2" };

const MARK_PATH =
  "M10 10h16a6 6 0 0 1 6 6v11a6 6 0 0 0 6 6h16a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z";

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

/** Markup of an SVG file without its XML prolog, for inlining in an HTML page. */
async function inlineSvg(path) {
  return (await readFile(path, "utf8")).replace(/<\?xml[^>]*\?>/, "").trim();
}

async function fontFace(family, weight, file) {
  const data = (await readFile(join(FONTS_DIR, file))).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format("woff2");}`;
}

/** A page that shows one SVG scaled to fill the viewport. */
function iconPage(svg) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}
</style></head><body>${svg}</body></html>`;
}

async function ogPage() {
  const fonts = await Promise.all([
    fontFace("Inter Tight", 300, "inter-tight-latin-300-normal.woff2"),
    fontFace("Inter Tight", 400, "inter-tight-latin-400-normal.woff2"),
    fontFace("IBM Plex Mono", 400, "ibm-plex-mono-latin-400-normal.woff2"),
  ]);
  const logo = await inlineSvg(join(ASSETS_DIR, "logo.svg"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${fonts.join("\n")}
html,body{margin:0}
body{width:1200px;height:630px;background:${COLOR.bg};color:${COLOR.ink};font-family:"Inter Tight",sans-serif;position:relative;overflow:hidden}
.logo{position:absolute;left:64px;top:64px}
.logo svg{display:block;height:44px;width:auto}
h1{position:absolute;left:64px;top:246px;margin:0;font-weight:300;font-size:75px;line-height:78px;letter-spacing:-0.025em}
h1 span{display:block}
h1 .faint{color:${COLOR.faint}}
.label{position:absolute;left:64px;top:543px;margin:0;font-family:"IBM Plex Mono",monospace;font-size:16px;line-height:20px;letter-spacing:0.116em;text-transform:uppercase;color:${COLOR.muted}}
.panel{position:absolute;left:799px;top:56px;width:380px;height:518px;border-radius:28px;background:${COLOR.deep};display:flex;align-items:center;justify-content:center}
.panel svg{display:block;width:233px;height:233px}
</style></head><body>
<div class="logo">${logo}</div>
<h1><span>Automatic list hygiene</span><span class="faint">for Klaviyo.</span></h1>
<p class="label">For Shopify brands · Simulated first · Nothing deleted</p>
<div class="panel"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><path d="${MARK_PATH}" fill="#ffffff"/><circle cx="46.5" cy="19.5" r="9.5" fill="${COLOR.accent}"/></svg></div>
</body></html>`;
}

async function main(argv) {
  const outFlag = argv.indexOf("--out");
  const outDir = outFlag >= 0 && argv[outFlag + 1] ? resolve(argv[outFlag + 1]) : ASSETS_DIR;

  const playwright = loadPlaywright();
  if (!playwright) {
    console.error(
      'images: the "playwright" package was not found. It is not a dependency of the site on purpose.\n' +
        "Run this where Playwright and its Chromium are installed, or keep the committed PNGs in site/assets/.",
    );
    return 1;
  }

  const jobs = [
    {
      name: "favicon-32.png",
      width: 32,
      height: 32,
      transparent: true,
      html: iconPage(await inlineSvg(join(ASSETS_DIR, "favicon.svg"))),
    },
    {
      name: "apple-touch-icon.png",
      width: 180,
      height: 180,
      transparent: false,
      html: iconPage(await inlineSvg(join(BRAND_DIR, "app-icon.svg"))),
    },
    { name: "og-image.png", width: 1200, height: 630, transparent: false, html: await ogPage() },
  ];

  await mkdir(outDir, { recursive: true });
  const browser = await playwright.chromium.launch();
  try {
    for (const job of jobs) {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
      await page.setContent(job.html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const png = await page.screenshot({ type: "png", omitBackground: job.transparent });
      await page.close();
      await writeFile(join(outDir, job.name), png);
      console.log(`wrote ${join(outDir, job.name)} (${job.width} x ${job.height}, ${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  return 1;
});
