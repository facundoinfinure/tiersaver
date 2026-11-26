/**
 * Checks every link, asset reference and anchor of the published site.
 *
 *   node build/check-links.mjs     exit 1 if anything does not resolve
 *
 * It reads the files on disk (run `npm run build` first) and resolves URLs the
 * way the deployed site does (build/assets.mjs). Nothing is requested over the
 * network: external URLs are only collected and listed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, publishedFiles, resolvePath } from "./assets.mjs";

const ORIGIN = "https://tiersaver.com";

/** URL path a published HTML file is served at. */
function urlOf(file) {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file.slice(0, -".html".length)}`;
}

function decodeEntities(text) {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** References found in an HTML document: links, assets and absolute URLs in meta tags. */
function htmlReferences(html) {
  const refs = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of text.matchAll(/<[a-z][^>]*>/gi)) {
    for (const attr of tag[0].matchAll(/\s(href|src|action|poster)="([^"]*)"/gi)) {
      refs.push({ url: decodeEntities(attr[2]), tag: tag[0] });
    }
    for (const attr of tag[0].matchAll(/\ssrcset="([^"]*)"/gi)) {
      for (const candidate of attr[1].split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) refs.push({ url: decodeEntities(url), tag: tag[0] });
      }
    }
    if (/^<meta\b/i.test(tag[0])) {
      const content = /\scontent="(https?:\/\/[^"]*)"/i.exec(tag[0]);
      if (content) refs.push({ url: decodeEntities(content[1]), tag: tag[0] });
    }
  }
  return refs;
}

function cssReferences(css) {
  const refs = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (!m[1].startsWith("data:")) refs.push({ url: m[1], tag: m[0] });
  }
  return refs;
}

function idsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/**
 * @returns {Promise<{ errors: string[], external: string[], pages: number, links: number }>}
 *   errors: one message per reference that does not resolve;
 *   external: every distinct URL that points to another origin, sorted.
 */
export async function checkLinks() {
  const fileList = await publishedFiles();
  const files = new Set(fileList);
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<string>} */
  const external = new Set();
  /** @type {Map<string, Set<string>>} */
  const idCache = new Map();
  let links = 0;

  async function ids(file) {
    let known = idCache.get(file);
    if (!known) {
      known = idsOf(await readFile(join(SITE_DIR, file), "utf8"));
      idCache.set(file, known);
    }
    return known;
  }

  async function check(from, base, ref) {
    const raw = ref.url.trim();
    links++;
    if (raw === "") return void errors.push(`${from}: empty URL in ${ref.tag}`);
    // Placeholder links (the App Store URL) are marked in the HTML and covered by the tests.
    if (raw === "#") return;
    if (/^(mailto|tel):/i.test(raw)) return;
    let url;
    try {
      url = new URL(raw, base);
    } catch {
      return void errors.push(`${from}: invalid URL "${raw}"`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return void errors.push(`${from}: unsupported URL scheme in "${raw}"`);
    }
    if (url.origin !== ORIGIN) return void external.add(url.href);

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return void errors.push(`${from}: badly encoded URL "${raw}"`);
    }
    const target = resolvePath(pathname, files);
    if (!target) return void errors.push(`${from}: "${raw}" does not resolve to a file`);
    if ("redirect" in target) {
      return void errors.push(`${from}: "${raw}" would redirect to ${target.redirect}; link to that instead`);
    }
    if (url.hash.length > 1) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (!target.file.endsWith(".html") || !(await ids(target.file)).has(id)) {
        errors.push(`${from}: "${raw}" points to a missing anchor #${id} in ${target.file}`);
      }
    }
  }

  const pages = fileList.filter((f) => f.endsWith(".html"));
  for (const file of pages) {
    const html = await readFile(join(SITE_DIR, file), "utf8");
    for (const ref of htmlReferences(html)) await check(file, `${ORIGIN}${urlOf(file)}`, ref);
  }
  for (const file of fileList.filter((f) => f.endsWith(".css"))) {
    const css = await readFile(join(SITE_DIR, file), "utf8");
    for (const ref of cssReferences(css)) await check(file, `${ORIGIN}/${file}`, ref);
  }

  // The 404 page is served for any path, so it must not use relative URLs.
  if (files.has("404.html")) {
    const html = await readFile(join(SITE_DIR, "404.html"), "utf8");
    for (const ref of htmlReferences(html)) {
      if (!/^(\/|#|https?:|mailto:|tel:)/i.test(ref.url)) errors.push(`404.html: relative URL "${ref.url}"`);
    }
  }

  return { errors, external: [...external].sort(), pages: pages.length, links };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkLinks();
  for (const error of result.errors) console.error(error);
  console.log(`${result.pages} pages, ${result.links} references checked, ${result.errors.length} broken.`);
  if (result.external.length > 0) {
    console.log(`External URLs (not requested):\n${result.external.map((u) => `  ${u}`).join("\n")}`);
  }
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
