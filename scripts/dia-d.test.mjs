// Tests of scripts/dia-d.mjs. Run with: node --test scripts/dia-d.test.mjs (also part of `npm test` at the root).
// The script is never run with --write against this repository: writing is tested on a copy in a temp folder.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./dia-d.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "dia-d.mjs");
const ARGS = ["--domain", "tiersaver.com", "--app-host", "app.tiersaver.com"];
/** Every file the script reads. */
const INPUTS = ["shopify/shopify.app.toml", "shopify/wrangler.jsonc", "site/wrangler.jsonc", "site/build/build.mjs", "site/_headers", "shopify/app/legal.ts", "shopify/app/klaviyo/config.ts", "site/src/site-config.ts"];

const diaD = (args, cwd = ROOT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
const read = (root, path) => readFileSync(join(root, path), "utf8");
const snapshot = (root) => Object.fromEntries(INPUTS.map((path) => [path, read(root, path)]));

/** A copy of the files the script reads, outside the repository. */
function copyOfRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dia-d-"));
  for (const path of INPUTS) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(ROOT, path), join(dir, path));
  }
  return dir;
}

/** Files in the first column of the "Día D" table of the runbook's section 5 (the items with their own date are a separate table). */
function runbookFiles() {
  const runbook = read(ROOT, "docs/18-RUNBOOK-LANZAMIENTO.md");
  const start = runbook.indexOf("\n## 5. ");
  const end = runbook.indexOf("Con fecha propia", start);
  assert.ok(start > 0 && end > start, "section 5 of the runbook was not found");
  // The "Archivo:línea" column of each numbered row: | 3 | `shopify/wrangler.jsonc:56` | ...
  const paths = [...runbook.slice(start, end).matchAll(/^\| \d+ \| `([^`:\s]+)(?::[0-9-]+)?`/gm)].map((m) => m[1]);
  return [...new Set(paths)];
}

test("dry run against the repository lists every file of the runbook's section 5 and writes nothing", () => {
  const before = snapshot(ROOT);
  // --force: a working copy with uncommitted changes must not fail the test; nothing is written without --write.
  const result = diaD([...ARGS, "--force", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.write, false);
  assert.deepEqual(snapshot(ROOT), before);

  const listed = out.files.map((f) => f.path);
  const expected = runbookFiles();
  for (const path of ["shopify/shopify.app.toml", "shopify/wrangler.jsonc", "site/wrangler.jsonc", "site/build/build.mjs", "site/_headers"]) {
    assert.ok(expected.includes(path), `the runbook's section 5 no longer names ${path}`);
  }
  for (const path of expected) assert.ok(listed.includes(path), `the runbook's section 5 names ${path}, which the script does not list`);

  // The steps that cannot be scripted are printed, in the runbook's order.
  const manual = out.manual.join("\n");
  const order = ["Cloudflare", "Sitio", "App (C)", "Klaviyo", "Shopify", "Prueba de humo"].map((word) => manual.indexOf(word));
  assert.ok(order.every((at) => at >= 0), "a manual step is missing");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(manual, /https:\/\/app\.tiersaver\.com\/klaviyo\/oauth\/callback/);
  assert.match(manual, /shopify app deploy/);
});

test("the human-readable dry run shows a diff and says nothing is written", () => {
  const result = diaD([...ARGS, "--force"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Simulación: no se escribe nada/);
  assert.match(result.stdout, /Pasos manuales, en orden/);
  assert.match(result.stdout, /Con fecha propia/);
});

test("--write on a copy applies the launch-day values, and a second run changes nothing", () => {
  const dir = copyOfRepo();
  try {
    const first = JSON.parse(diaD([...ARGS, "--root", dir, "--force", "--write", "--json"]).stdout);
    assert.deepEqual(first.files.filter((f) => f.changed).map((f) => f.path), ["shopify/shopify.app.toml", "shopify/wrangler.jsonc", "site/wrangler.jsonc"]);

    const toml = read(dir, "shopify/shopify.app.toml");
    assert.match(toml, /^application_url = "https:\/\/app\.tiersaver\.com"$/m);
    assert.match(toml, /^redirect_urls = \["https:\/\/app\.tiersaver\.com\/auth\/callback"\]$/m);
    assert.doesNotMatch(toml, /workers\.dev/);

    const app = parseJsonc(read(dir, "shopify/wrangler.jsonc"));
    const original = parseJsonc(read(ROOT, "shopify/wrangler.jsonc"));
    assert.equal(app.vars.SHOPIFY_APP_URL, "https://app.tiersaver.com");
    assert.equal("SITE_URL" in app.vars, false);
    assert.deepEqual(app.routes, [{ pattern: "app.tiersaver.com", custom_domain: true }]);
    assert.equal(app.workers_dev, true);
    // Nothing else moved: same config once the launch-day keys are put back.
    assert.deepEqual({ ...app, routes: undefined, workers_dev: undefined, vars: { ...app.vars, SITE_URL: original.vars.SITE_URL, SHOPIFY_APP_URL: original.vars.SHOPIFY_APP_URL } }, { ...original, routes: undefined, workers_dev: undefined });

    const site = parseJsonc(read(dir, "site/wrangler.jsonc"));
    assert.deepEqual(site.routes, [{ pattern: "tiersaver.com", custom_domain: true }]);
    assert.deepEqual({ ...site, routes: undefined, workers_dev: undefined }, { ...parseJsonc(read(ROOT, "site/wrangler.jsonc")), routes: undefined, workers_dev: undefined });
    assert.equal(read(dir, "site/build/build.mjs"), read(ROOT, "site/build/build.mjs"));

    const after = snapshot(dir);
    const second = JSON.parse(diaD([...ARGS, "--root", dir, "--force", "--write", "--json"]).stdout);
    assert.deepEqual(second.files.filter((f) => f.changed), []);
    assert.deepEqual(snapshot(dir), after);
    assert.match(diaD([...ARGS, "--root", dir, "--force"]).stdout, /No hay nada para cambiar/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("another domain keeps SITE_URL pointing at it and moves ORIGIN; --drop-workers-dev leaves workers_dev out", () => {
  const dir = copyOfRepo();
  try {
    const out = JSON.parse(diaD(["--domain", "example.org", "--root", dir, "--force", "--write", "--drop-workers-dev", "--json"]).stdout);
    assert.equal(out.appHost, "app.example.org");
    const app = parseJsonc(read(dir, "shopify/wrangler.jsonc"));
    assert.equal(app.vars.SITE_URL, "https://example.org");
    assert.equal("workers_dev" in app, false);
    assert.match(read(dir, "site/build/build.mjs"), /^const ORIGIN = "https:\/\/example\.org";$/m);
    assert.ok(out.warnings.length >= 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a dirty git tree unless --force, also in a dry run", () => {
  const dir = copyOfRepo();
  const git = (...args) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
  try {
    // Not a git checkout at all: the tree cannot be checked.
    assert.equal(diaD([...ARGS, "--root", dir]).status, 1);

    git("init", "-q");
    const dirty = diaD([...ARGS, "--root", dir, "--write"]);
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /cambios sin commitear/);
    assert.deepEqual(snapshot(dir), snapshot(ROOT));

    git("add", "-A");
    git("commit", "-q", "-m", "clean");
    assert.equal(diaD([...ARGS, "--root", dir]).status, 0);
    assert.deepEqual(snapshot(dir), snapshot(ROOT));
    assert.equal(diaD([...ARGS, "--root", dir, "--write"]).status, 0);
    // Its own changes now make the tree dirty: the second run needs --force, and then changes nothing.
    assert.equal(diaD([...ARGS, "--root", dir, "--write"]).status, 1);
    assert.match(diaD([...ARGS, "--root", dir, "--write", "--force"]).stdout, /No hay nada para cambiar/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stops without writing when a file is not in the expected state, and rejects bad arguments", () => {
  const dir = copyOfRepo();
  try {
    // A second application_url: the script cannot know which one is real.
    execFileSync(process.execPath, ["-e", `const fs=require("fs");const p=${JSON.stringify(join(dir, "shopify/shopify.app.toml"))};fs.appendFileSync(p,'\\napplication_url = "https://other.example"\\n')`]);
    const before = snapshot(dir);
    const result = diaD([...ARGS, "--root", dir, "--force", "--write"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /shopify\/shopify\.app\.toml/);
    assert.deepEqual(snapshot(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(diaD(["--force"]).status, 1);
  assert.equal(diaD(["--domain", "https://tiersaver.com", "--force"]).status, 1);
  assert.equal(diaD(["--domain", "tiersaver.com", "--app-host", "tiersaver.com", "--force"]).status, 1);
  assert.equal(diaD([...ARGS, "--force", "--deploy"]).status, 1);
});
