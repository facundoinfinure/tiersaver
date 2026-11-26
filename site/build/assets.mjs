/**
 * What the published site consists of and how a URL path maps to a file.
 * Shared by serve.mjs (local server) and check-links.mjs so both follow the
 * same rules as the deployed Workers static-assets site (wrangler.jsonc:
 * html_handling "auto-trailing-slash", not_found_handling "404-page").
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the site folder (the web root). */
export const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads .assetsignore and returns a predicate for paths relative to SITE_DIR.
 * Supports what the file uses: comments, plain names and "dir/" entries,
 * matched against any path segment. Dotfiles and the platform's own files
 * (_headers, _redirects) are never published.
 * @returns {Promise<(path: string) => boolean>}
 */
export async function loadIgnore() {
  const text = await readFile(join(SITE_DIR, ".assetsignore"), "utf8").catch(() => "");
  // Read by the platform, never served as files.
  const names = new Set(["_headers", "_redirects"]);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    names.add(line.replace(/^\/+|\/+$/g, ""));
  }
  return (path) => {
    const segments = path.split(sep).join("/").split("/");
    return segments.some((segment) => names.has(segment) || segment.startsWith("."));
  };
}

/**
 * Lists every published file, as sorted posix paths relative to SITE_DIR.
 * @returns {Promise<string[]>}
 */
export async function publishedFiles() {
  const ignored = await loadIgnore();
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = relative(SITE_DIR, full).split(sep).join("/");
      if (ignored(path)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(path);
    }
  }
  await walk(SITE_DIR);
  return out.sort();
}

/**
 * Maps a URL path to a published file, the way the deployed site does.
 *   /            index.html
 *   /privacy     privacy.html
 *   /help/       help/index.html
 *   /help        redirect to /help/
 *   /privacy/    redirect to /privacy
 *   /x.html      redirect to /x (or to the folder URL for an index page)
 * @param {string} pathname decoded URL path, starting with "/"
 * @param {ReadonlySet<string>} files result of publishedFiles()
 * @returns {{ file: string } | { redirect: string } | null}
 */
export function resolvePath(pathname, files) {
  if (!pathname.startsWith("/") || pathname.split("/").includes("..")) return null;
  const path = pathname.slice(1);
  if (path === "") return files.has("index.html") ? { file: "index.html" } : null;
  if (path === "index.html") return files.has(path) ? { redirect: "/" } : null;
  if (path.endsWith("/index.html")) return files.has(path) ? { redirect: `/${path.slice(0, -"index.html".length)}` } : null;
  if (path.endsWith(".html")) return files.has(path) ? { redirect: `/${path.slice(0, -".html".length)}` } : null;
  if (path.endsWith("/")) {
    if (files.has(`${path}index.html`)) return { file: `${path}index.html` };
    return files.has(`${path.slice(0, -1)}.html`) ? { redirect: `/${path.slice(0, -1)}` } : null;
  }
  if (files.has(path)) return { file: path };
  if (files.has(`${path}.html`)) return { file: `${path}.html` };
  if (files.has(`${path}/index.html`)) return { redirect: `/${path}/` };
  return null;
}

/** True when the path exists and is a regular file. */
export async function isFile(path) {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}
