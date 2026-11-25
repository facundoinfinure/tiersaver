/**
 * Local preview server for the static site.
 *
 *   node build/serve.mjs [port]     default port 4173, bound to 127.0.0.1
 *
 * It imitates what the Workers static-assets deploy does with this folder, so
 * that a local pass in a browser exercises the real headers:
 *   - files listed in .assetsignore are not served;
 *   - html_handling "auto-trailing-slash": /privacy serves privacy.html,
 *     /help/ serves help/index.html, and /privacy.html, /help and /index.html
 *     redirect to their canonical form;
 *   - not_found_handling "404-page": unknown paths get 404.html with status 404;
 *   - the response headers in _headers, including the Content-Security-Policy.
 *
 * It is a preview tool: it publishes nothing and is not part of the deploy.
 */
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The site folder (web root). */
export const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

// ---------------------------------------------------------------------------
// .assetsignore
// ---------------------------------------------------------------------------

/**
 * Parses the subset of gitignore syntax that .assetsignore uses: one name per
 * line, "#" comments, a trailing "/" for directories. A name matches a path
 * segment at any depth.
 * @returns {(path: string) => boolean} true when the site-relative path ("help/undo.html") is ignored
 */
export function parseAssetsIgnore(text) {
  const names = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/\/$/, ""));
  for (const name of names) {
    if (/[*?[\]!]/.test(name) || name.includes("/")) {
      throw new Error(`.assetsignore: pattern "${name}" is not supported by the local tools; use plain names`);
    }
  }
  const ignored = new Set(names);
  // _headers configures the deploy and is never served as a file.
  ignored.add("_headers");
  return (path) => path.split("/").some((segment) => ignored.has(segment));
}

/** Site-relative paths ("help/undo.html") of every file a deploy would upload, sorted. */
export async function publishedFiles(siteDir = SITE_DIR) {
  const isIgnored = parseAssetsIgnore(await readFile(join(siteDir, ".assetsignore"), "utf8"));
  const out = [];
  async function walk(rel) {
    for (const entry of await readdir(join(siteDir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (isIgnored(path)) continue;
      if (entry.isDirectory()) await walk(path);
      else out.push(path);
    }
  }
  await walk("");
  return out.sort();
}

// ---------------------------------------------------------------------------
// _headers
// ---------------------------------------------------------------------------

/**
 * Parses a _headers file: a path pattern at the start of a line, followed by
 * indented "Name: value" lines. "#" starts a comment.
 * @returns {{ pattern: string, headers: Record<string, string> }[]}
 */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (!current || colon < 1) throw new Error(`_headers: cannot parse line "${raw}"`);
    current.headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return rules;
}

function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Headers for a URL path: every matching rule applies, later rules override earlier ones. */
export function headersFor(rules, urlPath) {
  const headers = {};
  for (const rule of rules) {
    if (patternToRegExp(rule.pattern).test(urlPath)) Object.assign(headers, rule.headers);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Resolves a URL path the way the deploy does.
 * @param {string} urlPath decoded path, starting with "/"
 * @param {Set<string>} files published site-relative paths
 * @returns {{ status: 200 | 404, file: string } | { status: 307, location: string }}
 */
export function resolveRequest(urlPath, files) {
  const path = urlPath.replace(/^\/+/, "");
  if (path === "" || path.endsWith("/")) {
    if (files.has(`${path}index.html`)) return { status: 200, file: `${path}index.html` };
  } else if (path === "index.html" || path.endsWith("/index.html")) {
    if (files.has(path)) return { status: 307, location: `/${path.slice(0, -"index.html".length)}` };
  } else if (path.endsWith(".html")) {
    if (files.has(path)) return { status: 307, location: `/${path.slice(0, -".html".length)}` };
  } else if (files.has(path)) {
    return { status: 200, file: path };
  } else if (files.has(`${path}.html`)) {
    return { status: 200, file: `${path}.html` };
  } else if (files.has(`${path}/index.html`)) {
    return { status: 307, location: `/${path}/` };
  }
  return { status: 404, file: "404.html" };
}

export async function startServer({ port = 4173, host = "127.0.0.1", siteDir = SITE_DIR } = {}) {
  const server = createServer(async (req, res) => {
    try {
      // Read on every request so edits and rebuilds show up without a restart.
      const files = new Set(await publishedFiles(siteDir));
      const rules = parseHeaders(await readFile(join(siteDir, "_headers"), "utf8"));
      const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const headers = headersFor(rules, urlPath);

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
        return;
      }
      const resolved = resolveRequest(urlPath, files);
      if (resolved.status === 307) {
        res.writeHead(307, { ...headers, Location: resolved.location }).end();
        return;
      }
      const body = await readFile(join(siteDir, resolved.file));
      res.writeHead(resolved.status, {
        "Content-Type": CONTENT_TYPES[extname(resolved.file)] ?? "application/octet-stream",
        "Content-Length": body.length,
        ...headers,
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
  await stat(join(SITE_DIR, "index.html")).catch(() => {
    throw new Error('index.html not found. Run "npm run build" first.');
  });
  const server = await startServer({ port });
  console.log(`Serving site/ at http://127.0.0.1:${server.address().port}/ (local preview, nothing is published)`);
}
