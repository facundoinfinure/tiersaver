#!/usr/bin/env node
// "Día D": every value in the repo that changes the day the domain exists, in one place.
// See docs/18-RUNBOOK-LANZAMIENTO.md, sections 4 and 5.
//
//   node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com          dry run: prints the diff
//   node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com --write  applies it
//
// Options:
//   --domain <host>       host of the public site (required)
//   --app-host <host>     host of the embedded app (default: app.<domain>)
//   --write               write the files (default: change nothing, print the diff)
//   --force               run even if the git tree has uncommitted changes
//   --drop-workers-dev    do not keep the *.workers.dev addresses next to the new domains
//   --json                machine-readable result (used by scripts/dia-d.test.mjs)
//   --root <dir>          repository root (default: the parent of this file's folder; used by the test)
//
// It only edits files. It deploys nothing, calls no API and reads no secret; the steps that cannot be
// scripted (dashboards, DNS, deploys) are printed in order at the end. Running it twice changes nothing
// the second time. What the operator reads is in Spanish, like the runbook.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

class DiaDError extends Error {}
const fail = (message) => {
  throw new DiaDError(message);
};

export function parseArgs(argv) {
  const opts = { domain: null, appHost: null, write: false, force: false, dropWorkersDev: false, json: false, root: null };
  const value = (i, flag) => (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fail(`${flag} necesita un valor.`));
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--domain") opts.domain = value(i++, arg);
    else if (arg === "--app-host") opts.appHost = value(i++, arg);
    else if (arg === "--root") opts.root = value(i++, arg);
    else if (arg === "--write") opts.write = true;
    else if (arg === "--force") opts.force = true;
    else if (arg === "--drop-workers-dev") opts.dropWorkersDev = true;
    else if (arg === "--json") opts.json = true;
    else fail(`Opción desconocida: ${arg}`);
  }
  if (!opts.domain) fail("Falta --domain. Uso: node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com [--write]");
  opts.domain = opts.domain.toLowerCase();
  opts.appHost = (opts.appHost ?? `app.${opts.domain}`).toLowerCase();
  for (const host of [opts.domain, opts.appHost]) if (!HOST.test(host)) fail(`"${host}" no es un nombre de host (sin https:// ni barras).`);
  if (opts.domain === opts.appHost) fail("El sitio y la app no pueden usar el mismo host.");
  if (/\.workers\.dev$/.test(opts.domain) || /\.workers\.dev$/.test(opts.appHost)) fail("Los hosts nuevos no pueden ser de workers.dev.");
  return opts;
}

/** JSON with comments and trailing commas, as Wrangler reads it. Strings (URLs with "//") are left alone. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** Replaces the one match of `pattern`; `describe` names what was looked for when it is not there. */
function replaceOnce(file, text, pattern, replacement, describe) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) fail(`${file}: se esperaba una sola línea con ${describe} y hay ${matches.length}. No se cambió nada; revisar a mano.`);
  return text.replace(pattern, replacement);
}

/**
 * The files of the runbook's section 5, in its order. Each `apply` takes the current text and returns the
 * text for launch day; it must return its input unchanged when the change is already in.
 */
function plan(ctx) {
  const appUrl = `https://${ctx.appHost}`;
  const siteUrl = `https://${ctx.domain}`;
  // With "routes" present Wrangler stops publishing the workers.dev address unless workers_dev is set
  // (developers.cloudflare.com/workers/wrangler/configuration, "workers_dev", read 2026-11-26). The runbook counts
  // on the old addresses still answering (Klaviyo's first redirect URI, the noindex staging site), so it is kept.
  const keepNote = ctx.dropWorkersDev ? "" : ` workers_dev keeps the workers.dev address answering:\n$1// with "routes" present Wrangler turns it off unless it is set.`;
  const domainLines = (host) => `$1${route(host)}${ctx.dropWorkersDev ? "" : `,\n$1"workers_dev": true`}`;
  const route = (host) => `"routes": [{ "pattern": "${host}", "custom_domain": true }]`;

  /** Adds the custom domain to a wrangler.jsonc, or checks the one that is there. Returns null when it has to be inserted. */
  const routesState = (file, text, host) => {
    const config = parseJsonc(text);
    if (config.routes === undefined) return null;
    const ok = Array.isArray(config.routes) && config.routes.length === 1 && config.routes[0]?.pattern === host && config.routes[0]?.custom_domain === true;
    if (!ok) fail(`${file}: ya tiene "routes" con otro valor (${JSON.stringify(config.routes)}). No se cambió nada; revisar a mano.`);
    return text;
  };

  return [
    {
      path: "shopify/shopify.app.toml",
      what: `application_url y redirect_urls pasan a ${appUrl}`,
      apply(text) {
        let next = replaceOnce(this.path, text, /^application_url\s*=\s*"[^"\n]*"/m, `application_url = "${appUrl}"`, "application_url");
        next = replaceOnce(this.path, next, /^redirect_urls\s*=\s*\[[^\]\n]*\]/m, `redirect_urls = ["${appUrl}/auth/callback"]`, "redirect_urls");
        return next;
      },
    },
    {
      path: "shopify/wrangler.jsonc",
      what: `SHOPIFY_APP_URL pasa a ${appUrl}; SITE_URL ${ctx.siteIsDefault ? "se borra (la app ya usa " + siteUrl + " por defecto)" : "pasa a " + siteUrl}; dominio propio ${ctx.appHost}`,
      apply(text) {
        let next = replaceOnce(this.path, text, /"SHOPIFY_APP_URL"\s*:\s*"[^"\n]*"/, `"SHOPIFY_APP_URL": "${appUrl}"`, '"SHOPIFY_APP_URL"');
        const siteVar = /^[ \t]*"SITE_URL"\s*:\s*"[^"\n]*",?[ \t]*\n/m;
        if (ctx.siteIsDefault) {
          // The variable and the comment that explains it go together; without it the app links to the default site.
          next = next.replace(/^[ \t]*\/\/[^\n]*Remove once[^\n]*serves the site\.[^\n]*\n(?=[ \t]*"SITE_URL")/m, "").replace(siteVar, "");
        } else if (siteVar.test(next)) {
          next = replaceOnce(this.path, next, /"SITE_URL"\s*:\s*"[^"\n]*"/, `"SITE_URL": "${siteUrl}"`, '"SITE_URL"');
        } else {
          next = replaceOnce(this.path, next, /^([ \t]*)"SHOPIFY_APP_URL"/m, `$1"SITE_URL": "${siteUrl}",\n$1"SHOPIFY_APP_URL"`, '"SHOPIFY_APP_URL"');
        }
        if (routesState(this.path, next, ctx.appHost) === null) {
          next = replaceOnce(
            this.path,
            next,
            /^([ \t]*)("compatibility_date"\s*:\s*"[^"\n]*",)[ \t]*\n/m,
            `$1$2\n$1// The app's own domain (docs/18-RUNBOOK-LANZAMIENTO.md, section 5).${keepNote}\n${domainLines(ctx.appHost)},\n`,
            '"compatibility_date"',
          );
        }
        const vars = parseJsonc(next).vars ?? {};
        if (vars.SHOPIFY_APP_URL !== appUrl || (ctx.siteIsDefault ? "SITE_URL" in vars : vars.SITE_URL !== siteUrl)) fail(`${this.path}: el resultado no quedó como se esperaba. No se cambió nada; revisar a mano.`);
        return next;
      },
    },
    {
      path: "site/wrangler.jsonc",
      what: `dominio propio ${ctx.domain}`,
      apply(text) {
        if (routesState(this.path, text, ctx.domain) !== null) return text;
        // The property goes after "assets", the last one; the "No routes yet" comment, if it is still there, is replaced.
        const tail = /\n([ \t]*)\}\n(?:[ \t]*\/\/[^\n]*\n)*(?=\}\s*$)/;
        const next = replaceOnce(this.path, text, tail, `\n$1},\n$1// The site's own domain. Response headers, including the CSP, are in _headers.${keepNote}\n${domainLines(ctx.domain)}\n`, 'el cierre de "assets"');
        if (routesState(this.path, next, ctx.domain) === null) fail(`${this.path}: no se pudo agregar "routes". No se cambió nada; revisar a mano.`);
        return next;
      },
    },
    {
      path: "site/build/build.mjs",
      what: `ORIGIN (canónicas, sitemap.xml, robots.txt, verificador de links) es ${siteUrl}`,
      apply(text) {
        return replaceOnce(this.path, text, /^const ORIGIN = "[^"\n]*";/m, `const ORIGIN = "${siteUrl}";`, "const ORIGIN");
      },
    },
    {
      path: "site/_headers",
      what: "la regla noindex vale solo para *.workers.dev: no cambia, solo se comprueba que esté",
      apply(text) {
        if (!/^https:\/\/:project\.:account\.workers\.dev\/\*\n[ \t]+X-Robots-Tag: noindex/m.test(text)) fail(`${this.path}: falta la regla "X-Robots-Tag: noindex" para *.workers.dev. Revisar antes de desplegar el sitio.`);
        return text;
      },
    },
  ];
}

/** Lines removed and added, with their line numbers. Enough for files this small. */
export function diffLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    if (i < a.length && j < b.length && a[i] === b[j]) i++, j++;
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`- ${String(i + 1).padStart(3)}  ${a[i++]}`);
    else out.push(`+ ${String(j + 1).padStart(3)}  ${b[j++]}`);
  }
  return out;
}

function gitDirty(root) {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    return null; // not a git checkout
  }
}

/** Where a constant is today, as "file:line", for the reminders. Never fails. */
function locate(root, path, pattern) {
  try {
    const text = readFileSync(join(root, path), "utf8");
    const match = pattern.exec(text);
    return match ? `${path}:${lineOf(text, match.index)}` : path;
  } catch {
    return path;
  }
}

function manualSteps(ctx) {
  const appUrl = `https://${ctx.appHost}`;
  const siteUrl = `https://${ctx.domain}`;
  const klaviyoPath = /KLAVIYO_OAUTH_CALLBACK_PATH\s*=\s*"([^"]+)"/.exec(ctx.read("shopify/app/klaviyo/config.ts") ?? "")?.[1] ?? "/klaviyo/oauth/callback";
  return [
    `Cloudflare (F): mover ${ctx.domain} a la cuenta TierSaver y esperar a que la zona figure activa (runbook, sección 4, 0:00 y 0:10). Sin la zona activa los dominios propios no se pueden crear.`,
    `Revisar el diff de este script, correr los tests (npm test) y commitear en una rama. Nadie debe estar usando la app durante el despliegue.`,
    `Sitio (C): npm run build -w @tiersaver/site && npx wrangler deploy (en site/). Wrangler crea el dominio propio ${ctx.domain}. Agregar en Cloudflare la regla de redirección de www.${ctx.domain} a ${siteUrl}. Comprobar que ${siteUrl}/terms abre antes de seguir.`,
    `App (C): npm run deploy:worker (en shopify/). Wrangler crea el dominio propio ${ctx.appHost}. Los secretos del Worker no cambian.`,
    `Klaviyo (F): manage-apps → TierSaver → agregar ${appUrl}${klaviyoPath} a la lista de redirect, SIN borrar la anterior. Tiene que coincidir exacto.`,
    `Shopify (C, con OK de F): npm run deploy (en shopify/; es "shopify app deploy"). Publica application_url = ${appUrl} y redirect_urls = ["${appUrl}/auth/callback"]. Después comprobar en el Dev Dashboard / Partner Dashboard que la versión activa muestra esas dos URLs.`,
    `Casilla (F carga, C dicta): MX, SPF, DKIM y DMARC del proveedor elegido en el DNS de ${ctx.domain}; crear hello@ con alias support@; mandar y recibir un mail de prueba.`,
    `Prueba de humo (C y F): npm run smoke:worker -- ${appUrl} (en shopify/); abrir la app en la tienda de desarrollo; desconectar y reconectar Klaviyo (prueba el redirect nuevo); abrir términos y privacidad desde la app.`,
    `Verificar desde afuera (F): ${siteUrl} sin "X-Robots-Tag: noindex"; ${ctx.dropWorkersDev ? "las direcciones *.workers.dev ya no responden" : "tiersaver-site.<cuenta>.workers.dev con noindex"}; ${siteUrl}/sitemap.xml y ${siteUrl}/robots.txt.`,
    `Listing y formularios (F): cargar ${siteUrl}, ${siteUrl}/privacy y soporte en Klaviyo (docs/14-PASOS-DASHBOARD.md, paso 4) y en el listing de Shopify. No apretar "Review submission".`,
  ];
}

function reminders(ctx) {
  const at = (path, pattern) => locate(ctx.root, path, pattern);
  return [
    `${at("site/build/build.mjs", /^const LEGAL_DRAFT\b/m)} LEGAL_DRAFT ya está en false desde el 2026-11-26 (textos adoptados por el dueño sin revisión externa, docs/16-LEGALES.md); si cambia el texto, ${at("shopify/app/legal.ts", /^export const TERMS_VERSION\b/m)} TERMS_VERSION y ${at("site/src/site-config.ts", /^export const TERMS_EFFECTIVE_DATE\b/m)} TERMS_EFFECTIVE_DATE (un test exige que coincidan). Si cambian términos o precios para tiendas ya instaladas: publicar antes el aviso en shopify/app/notices.ts.`,
    `${at("site/build/build.mjs", /^const AUDIT_CTA_URL\b/m)} AUDIT_CTA_URL y ${at("site/build/build.mjs", /^const AUDIT_CTA_NOTE\b/m)} AUDIT_CTA_NOTE, cuando la app esté Published: "https://apps.shopify.com/<handle>" y "".`,
    `${at("shopify/shopify.app.toml", /^scopes\s*=/m)} y ${at("shopify/wrangler.jsonc", /"SCOPES"/)} (SCOPES), ${at("site/src/site-config.ts", /^export const SHOPIFY_SCOPES\b/m)} (SHOPIFY_SCOPES): cuando Shopify apruebe read_all_orders.`,
    `${at("shopify/shopify.app.toml", /^\s*# \[\[webhooks\.subscriptions\]\]/m)} webhook orders/create comentado: con el pedido de datos protegidos guardado.`,
    `${at("shopify/wrangler.jsonc", /"KLAVIYO_SEEDED_ACCOUNT_ID"/)} KLAVIYO_SEEDED_ACCOUNT_ID: solo en el entorno de prueba, al separar ambientes.`,
    `SUPPRESSION_ENABLED y SUPPRESSION_ALLOWED_ACCOUNT_ID (variables o secretos del Worker, no están en el repo): decisión de Facundo para la revisión y al publicar.`,
  ];
}

export function run(argv, io = { log: console.log }) {
  const opts = parseArgs(argv);
  const root = resolve(opts.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const read = (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);

  const dirty = gitDirty(root);
  if (dirty === null && !opts.force) fail(`${root} no es un repositorio git: no se puede comprobar que esté limpio. Usar --force para seguir igual.`);
  if (dirty?.length && !opts.force) {
    fail(`El árbol de git tiene cambios sin commitear (${dirty.length}):\n${dirty.slice(0, 10).map((l) => `  ${l}`).join("\n")}${dirty.length > 10 ? "\n  ..." : ""}\nCommitear o guardar esos cambios primero, o usar --force.`);
  }

  // Without SITE_URL the app links to this address (shopify/app/legal.ts): the variable is only removed when the new domain is that one.
  const legalDefault = /env\.SITE_URL \|\| "([^"]+)"/.exec(read("shopify/app/legal.ts") ?? "")?.[1] ?? null;
  const ctx = { ...opts, root, read, siteIsDefault: legalDefault === `https://${opts.domain}` };

  // Everything is computed before anything is written: one file in an unexpected state stops the run with nothing changed.
  const files = plan(ctx).map((step) => {
    const before = read(step.path);
    if (before === null) fail(`${step.path}: no existe. No se cambió nada.`);
    const after = step.apply(before);
    if (step.apply(after) !== after) fail(`${step.path}: el cambio no es idempotente. No se cambió nada; avisar.`);
    return { path: step.path, what: step.what, changed: after !== before, before, after };
  });
  const changed = files.filter((f) => f.changed);
  if (opts.write) for (const file of changed) writeFileSync(join(root, file.path), file.after);

  const manual = manualSteps(ctx);
  const later = reminders(ctx);
  const warnings = [];
  if (!ctx.siteIsDefault) warnings.push(`${opts.domain} no es el dominio que la app y los textos traen escrito (${legalDefault ?? "desconocido"}). Este script no toca los mails, los textos legales ni shopify/app/legal.ts: revisarlos a mano y reconstruir el sitio.`);
  if (files.find((f) => f.path === "site/build/build.mjs")?.changed) warnings.push("Cambió ORIGIN: reconstruir el sitio (npm run build -w @tiersaver/site) y commitear los archivos generados.");

  if (opts.json) {
    io.log(JSON.stringify({ domain: opts.domain, appHost: opts.appHost, write: opts.write, files: files.map(({ path, what, changed }) => ({ path, what, changed })), manual, later, warnings }, null, 2));
    return { files, manual };
  }

  io.log(`Día D: sitio https://${opts.domain}, app https://${opts.appHost}. ${opts.write ? "Modo --write: se escriben los archivos." : "Simulación: no se escribe nada (agregar --write para aplicar)."}\n`);
  io.log("Archivos de la sección 5 del runbook:");
  for (const file of files) io.log(`  ${file.changed ? (opts.write ? "ESCRITO   " : "CAMBIARÍA ") : "sin cambio"}  ${file.path}: ${file.what}`);
  for (const file of changed) {
    io.log(`\n--- ${file.path}`);
    for (const line of diffLines(file.before, file.after)) io.log(line);
  }
  if (changed.length === 0) io.log("\nNo hay nada para cambiar: el repo ya está en el estado del Día D.");
  for (const warning of warnings) io.log(`\nATENCIÓN: ${warning}`);
  io.log("\nPasos manuales, en orden (este script no los hace; los que gastan, publican o tocan cuentas llevan OK de Facundo):");
  manual.forEach((step, i) => io.log(`  ${i + 1}. ${step}`));
  io.log("\nCon fecha propia (no son del Día D; este script no los toca):");
  for (const item of later) io.log(`  - ${item}`);
  return { files, manual };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof DiaDError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
