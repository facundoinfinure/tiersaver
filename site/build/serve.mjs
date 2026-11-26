/**
 * Local server for the static site.
 *
 *   node build/serve.mjs [port]    default port 8788, or the PORT variable
 *
 * It serves what would be published (files not excluded by .assetsignore),
 * resolves URLs like the deployed site (build/assets.mjs) and applies the
 * response headers of site/_headers, so the Content-Security-Policy can be
 * tested locally. Files are read on every request: no restart after a build.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, publishedFiles, resolvePath } from "./assets.mjs";

const DEFAULT_PORT = 8788;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Parses a _headers file (Cloudflare Pages / Workers static assets syntax):
 * a URL pattern on its own line, followed by indented "Name: value" lines.
 * "! Name" removes a header set by an earlier rule. "#" starts a comment.
 * @param {string} text
 * @returns {{ pattern: string, set: [string, string][], unset: string[] }[]}
 */
export function parseHeaders(text) {
  /** @type {{ pattern: string, set: [string, string][], unset: string[] }[]} */
  const rules = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), set: [], unset: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`_headers: header line before any path: "${raw.trim()}"`);
    const line = raw.trim();
    if (line.startsWith("!")) {
      current.unset.push(line.slice(1).trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`_headers: expected "Name: value", got "${line}"`);
    current.set.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Turns a _headers pattern into a RegExp: "*" matches anything, ":name" one path segment. */
function patternToRegExp(pattern) {
  const path = pattern.replace(/^https?:\/\/[^/]+/, "");
  const source = path
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => {
      if (part === "*") return ".*";
      if (/^:[A-Za-z]\w*$/.test(part)) return "[^/]+";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`);
}

/**
 * Headers that apply to a URL path. Every matching rule contributes, in file
 * order; a header set twice is joined with ", " as Cloudflare does.
 * @param {ReturnType<typeof parseHeaders>} rules
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersFor(rules, pathname) {
  /** @type {Record<string, string>} */
  const headers = {};
  const find = (name) => Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(pathname)) continue;
    for (const name of rule.unset) {
      const existing = find(name);
      if (existing) delete headers[existing];
    }
    for (const [name, value] of rule.set) {
      const existing = find(name);
      if (existing) headers[existing] = `${headers[existing]}, ${value}`;
      else headers[name] = value;
    }
  }
  return headers;
}

/**
 * Answers one request. Exported for tests of the routing; does not listen.
 * @param {string} method
 * @param {string} requestUrl path and query as received
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer | null }>}
 */
export async function respond(method, requestUrl) {
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, headers: { Allow: "GET, HEAD" }, body: null };
  }
  const url = new URL(requestUrl, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { status: 400, headers: {}, body: null };
  }
  const files = new Set(await publishedFiles());
  const rules = parseHeaders(await readFile(join(SITE_DIR, "_headers"), "utf8").catch(() => ""));
  // upgrade-insecure-requests and HSTS only make sense over HTTPS; over plain
  // http://localhost they are ignored by browsers, so they are left as they are.
  const headers = headersFor(rules, url.pathname);

  const target = resolvePath(pathname, files);
  if (target && "redirect" in target) {
    return { status: 307, headers: { ...headers, Location: `${target.redirect}${url.search}` }, body: null };
  }
  const file = target ? target.file : files.has("404.html") ? "404.html" : null;
  if (!file) return { status: 404, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" }, body: Buffer.from("Not found\n") };
  const body = await readFile(join(SITE_DIR, file));
  return {
    status: target ? 200 : 404,
    headers: {
      ...headers,
      "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(body.length),
    },
    body: method === "HEAD" ? null : body,
  };
}

/** Starts the server and resolves with it once it is listening. */
export function serve(port = DEFAULT_PORT, host = "127.0.0.1") {
  const server = createServer((req, res) => {
    respond(req.method ?? "GET", req.url ?? "/")
      .then(({ status, headers, body }) => {
        res.writeHead(status, headers);
        res.end(body ?? undefined);
        console.log(`${status} ${req.method} ${req.url}`);
      })
      .catch((error) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error\n");
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port "${process.argv[2] ?? process.env.PORT}"`);
    process.exit(1);
  }
  const server = await serve(port);
  const address = server.address();
  console.log(`TierSaver site on http://localhost:${typeof address === "object" && address ? address.port : port}/ (headers from _headers). Ctrl+C to stop.`);
}
