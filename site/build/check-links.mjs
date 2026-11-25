/**
 * Link checker for the built site. Works on the files on disk, offline.
 *
 *   node build/check-links.mjs      exit 1 if any internal reference is broken
 *
 * For every published HTML page it checks that each internal link, asset and
 * anchor resolves the way the deploy would resolve it, and that IDs are unique
 * within a page. For every published stylesheet it checks each url(). External
 * URLs are collected and reported, never requested.
 *
 * `href="#"` is only accepted on links marked with data-todo (the App Store
 * URL, which does not exist yet).
 */
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, publishedFiles, resolveRequest } from "./serve.mjs";

const SITE_ORIGIN = "https://tiersaver.com";

/** Attributes that hold a URL, per element. */
const URL_ATTRIBUTES = /\s(href|src|action|poster)="([^"]*)"/g;

function decodeEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** URL path a published HTML file is served at ("help/index.html" -> "/help/"). */
function urlOfFile(file) {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file.slice(0, -".html".length)}`;
}

function idsOf(html) {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * @returns {Promise<{ errors: string[], external: string[], checked: number }>}
 *   errors: one message per broken reference; external: distinct external URLs, sorted.
 */
export async function checkLinks(siteDir = SITE_DIR) {
  const files = await publishedFiles(siteDir);
  const fileSet = new Set(files);
  const errors = [];
  const external = new Set();
  let checked = 0;

  const htmlByFile = new Map();
  for (const file of files) {
    if (file.endsWith(".html")) htmlByFile.set(file, await readFile(join(siteDir, file), "utf8"));
  }
  const idsByFile = new Map([...htmlByFile].map(([file, html]) => [file, new Set(idsOf(html))]));

  /** Checks one reference found in `from`, which is served at URL path `base`. */
  function checkReference(from, base, raw, context) {
    checked++;
    let ref = decodeEntities(raw);
    if (ref.startsWith(`${SITE_ORIGIN}/`) || ref === SITE_ORIGIN) ref = ref.slice(SITE_ORIGIN.length) || "/";
    if (/^(mailto|tel):/i.test(ref)) return;
    if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(ref)) {
      external.add(ref);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      errors.push(`${from}: unsupported URL scheme in ${context} "${raw}"`);
      return;
    }
    if (ref === "") {
      errors.push(`${from}: empty ${context}`);
      return;
    }

    const hashAt = ref.indexOf("#");
    const fragment = hashAt === -1 ? null : ref.slice(hashAt + 1);
    const pathPart = (hashAt === -1 ? ref : ref.slice(0, hashAt)).replace(/\?.*$/, "");

    let targetFile = from;
    if (pathPart !== "") {
      const urlPath = pathPart.startsWith("/") ? posix.normalize(pathPart) : posix.normalize(posix.join(posix.dirname(base), pathPart));
      if (urlPath.startsWith("/..")) {
        errors.push(`${from}: ${context} "${raw}" points outside the site`);
        return;
      }
      const resolved = resolveRequest(urlPath, fileSet);
      if (resolved.status === 307) {
        errors.push(`${from}: ${context} "${raw}" would redirect to ${resolved.location}; link to that instead`);
        return;
      }
      if (resolved.status === 404) {
        errors.push(`${from}: ${context} "${raw}" does not resolve to a published file`);
        return;
      }
      targetFile = resolved.file;
    }

    if (fragment === null) return;
    if (fragment === "") {
      // A bare "#": only allowed on marked placeholders, which the caller filters out.
      errors.push(`${from}: ${context} "${raw}" has an empty fragment`);
      return;
    }
    const ids = idsByFile.get(targetFile);
    if (!ids) errors.push(`${from}: ${context} "${raw}" has a fragment but ${targetFile} is not a page`);
    else if (!ids.has(decodeURIComponent(fragment))) errors.push(`${from}: ${context} "${raw}": no element with id "${fragment}" in ${targetFile}`);
  }

  for (const [file, html] of htmlByFile) {
    const base = urlOfFile(file);
    const ids = idsOf(html);
    for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) errors.push(`${file}: duplicate id "${id}"`);

    for (const tag of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<[a-zA-Z][^>]*>/g)) {
      for (const [, attribute, value] of tag[0].matchAll(URL_ATTRIBUTES)) {
        if (value === "#" && /\sdata-todo="[^"]+"/.test(tag[0])) continue;
        checkReference(file, base, value, attribute);
      }
      for (const [, , value] of tag[0].matchAll(/\s(content)="((?:https?:)?\/\/[^"]*)"/g)) {
        // Absolute URLs in meta tags (og:url, og:image).
        checkReference(file, base, value, "meta content");
      }
      // IDs referenced by ARIA attributes must exist on the same page.
      for (const [, attribute, value] of tag[0].matchAll(/\s(aria-labelledby|aria-describedby|aria-controls|for)="([^"]*)"/g)) {
        for (const id of value.split(/\s+/).filter(Boolean)) {
          checked++;
          if (!idsByFile.get(file).has(id)) errors.push(`${file}: ${attribute}="${value}": no element with id "${id}"`);
        }
      }
    }
  }

  for (const file of files) {
    if (!file.endsWith(".css")) continue;
    const css = (await readFile(join(siteDir, file), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, value] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      if (value.startsWith("data:")) continue;
      checkReference(file, `/${file}`, value, "url()");
    }
  }

  // The sitemap must list URLs that resolve.
  if (fileSet.has("sitemap.xml")) {
    const sitemap = await readFile(join(siteDir, "sitemap.xml"), "utf8");
    for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) checkReference("sitemap.xml", "/sitemap.xml", loc, "loc");
  }

  return { errors, external: [...external].sort(), checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkLinks();
  for (const error of result.errors) console.error(error);
  if (result.external.length > 0) {
    console.log(`External URLs (not requested):\n${result.external.map((url) => `  ${url}`).join("\n")}`);
  }
  console.log(`links: ${result.checked} references checked, ${result.errors.length} broken`);
  process.exitCode = result.errors.length > 0 ? 1 : 0;
}
