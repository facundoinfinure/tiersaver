/**
 * Renders the site's raster images from the brand SVGs and fonts with headless
 * Chromium (Playwright):
 *
 *   assets/favicon-32.png        32 × 32, transparent corners, from assets/favicon.svg
 *   assets/apple-touch-icon.png  180 × 180, opaque, from brand/logo/final/app-icon.svg
 *   assets/og-image.png          1200 × 630 social preview
 *
 *   node build/images.mjs            render into .wrangler/images/ for review
 *   node build/images.mjs --write    replace the committed files in assets/
 *
 * PNG bytes depend on the Chromium version, so this is not part of
 * `npm run build` and its output is not covered by `build --check`. Render,
 * look at the result, then use --write.
 *
 * Playwright is not a dependency of this package: the script uses whichever
 * installation Node can resolve (for example a global one on NODE_PATH).
 * Chromium is kept offline: every request is answered from the site folder.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR } from "./serve.mjs";

const PREVIEW_DIR = join(SITE_DIR, ".wrangler", "images");
/** Fake origin: nothing is requested from the network, see route() below. */
const ORIGIN = "http://site.invalid";

/** The Shopify app icon lives with the brand files, outside the site folder. */
const APP_ICON_FILE = join(SITE_DIR, "..", "brand", "logo", "final", "app-icon.svg");
const APP_ICON_URL = "/brand/app-icon.svg";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const ICON_PAGE = (src, size) => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  img { display: block; width: ${size}px; height: ${size}px; }
</style></head>
<body><img src="${src}" alt=""></body></html>`;

const OG_PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/base.css">
<style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; background: var(--bg); position: relative; overflow: hidden; }
  .logo { position: absolute; left: 64px; top: 64px; height: 44px; width: auto; }
  h1 { position: absolute; left: 64px; top: 248px; margin: 0; font-family: var(--font-sans);
       font-weight: var(--weight-light); font-size: 76px; line-height: 77px; letter-spacing: -0.03em; color: var(--ink); }
  h1 span { display: block; color: var(--faint); }
  .label { position: absolute; left: 64px; bottom: 64px; margin: 0; font-size: 17px; letter-spacing: 0.08em; }
  .art { position: absolute; left: 799px; top: 56px; width: 380px; height: 518px;
           border-radius: var(--radius-panel); background: var(--surface-deep); }
  .art img { position: absolute; left: 74px; top: 143px; width: 232px; height: 232px; }
</style></head>
<body>
  <img class="logo" src="/assets/logo.svg" alt="">
  <h1>Automatic list hygiene <span>for Klaviyo.</span></h1>
  <p class="label"><span>For Shopify brands</span><span>Simulated first</span><span>Nothing deleted</span></p>
  <div class="art"><img src="/assets/mark-dark.svg" alt=""></div>
</body></html>`;

const IMAGES = [
  { file: "favicon-32.png", width: 32, height: 32, html: ICON_PAGE("/assets/favicon.svg", 32), transparent: true },
  // iOS rounds the corners itself: the full-bleed app icon, scaled down.
  { file: "apple-touch-icon.png", width: 180, height: 180, html: ICON_PAGE(APP_ICON_URL, 180) },
  { file: "og-image.png", width: 1200, height: 630, html: OG_PAGE },
];

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    throw new Error("Playwright was not found. Install it (or put a global install on NODE_PATH) to render the images.");
  }
}

/** Renders every image and returns file name -> PNG bytes. */
export async function renderImages() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const out = new Map();
  try {
    for (const image of IMAGES) {
      const context = await browser.newContext({
        viewport: { width: image.width, height: image.height },
        deviceScaleFactor: 1,
      });
      // Offline by construction: the page and its assets come from the site folder; anything else is refused.
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        if (url.pathname === "/") return route.fulfill({ contentType: CONTENT_TYPES[".html"], body: image.html });
        const type = CONTENT_TYPES[extname(url.pathname)];
        const file = url.pathname === APP_ICON_URL ? APP_ICON_FILE : join(SITE_DIR, url.pathname);
        const body = type && !url.pathname.includes("..") ? await readFile(file).catch(() => null) : null;
        return body ? route.fulfill({ contentType: type, body }) : route.abort();
      });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      out.set(image.file, await page.screenshot({ type: "png", omitBackground: Boolean(image.transparent) }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes("--write");
  const dir = write ? join(SITE_DIR, "assets") : PREVIEW_DIR;
  await mkdir(dir, { recursive: true });
  for (const [file, bytes] of await renderImages()) {
    await writeFile(join(dir, file), bytes);
    console.log(`rendered ${join(dir, file)}`);
  }
  if (!write) console.log("Preview only. Compare with assets/ and run again with --write to replace the committed images.");
}
