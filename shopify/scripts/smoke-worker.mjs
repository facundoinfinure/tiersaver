// Smoke test for the app running in workerd (`vite preview`).
// Usage: node scripts/smoke-worker.mjs [baseUrl] [apiSecret]
import { createHmac } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8787";
const secret = process.argv[3] ?? "spike-test-secret";
const shop = "tiersaver-spike.myshopify.com";
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}

function expectStatus(res, ...codes) {
  if (!codes.includes(res.status)) throw new Error(`status ${res.status}, expected ${codes.join("/")}`);
}

function webhook(path, topic, body, sign = true) {
  const raw = JSON.stringify(body);
  const hmac = createHmac("sha256", sign ? secret : "wrong-secret").update(raw).digest("base64");
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-api-version": "2026-10",
      "x-shopify-webhook-id": crypto.randomUUID(),
      "x-shopify-event-id": crypto.randomUUID(),
      "x-shopify-triggered-at": new Date().toISOString(),
    },
    body: raw,
  });
}

await check("SSR landing page renders", async () => {
  const res = await fetch(`${base}/`);
  expectStatus(res, 200);
  const html = await res.text();
  if (!html.includes("<html")) throw new Error("no html");
  return `${html.length} bytes`;
});

await check("login page renders", async () => {
  const res = await fetch(`${base}/auth/login`);
  expectStatus(res, 200);
});

await check("login with shop starts OAuth (redirect)", async () => {
  const res = await fetch(`${base}/auth/login?shop=${shop}`, { redirect: "manual" });
  expectStatus(res, 302, 303);
  return res.headers.get("location")?.slice(0, 60);
});

await check("embedded app without session is not served", async () => {
  const res = await fetch(`${base}/app?shop=${shop}&embedded=1`, { redirect: "manual" });
  if (res.status === 200 && (await res.text()).includes("Klaviyo list hygiene")) throw new Error("served app without auth");
  return `status ${res.status}`;
});

await check("compliance webhook with valid HMAC -> 200", async () => {
  const res = await webhook("/webhooks/compliance", "shop/redact", { shop_id: 1, shop_domain: shop });
  expectStatus(res, 200);
});

await check("compliance webhook with invalid HMAC -> 401", async () => {
  const res = await webhook("/webhooks/compliance", "customers/redact", { shop_domain: shop }, false);
  expectStatus(res, 401);
});

await check("uninstall webhook with valid HMAC -> 200", async () => {
  const res = await webhook("/webhooks/app/uninstalled", "app/uninstalled", { id: 1 });
  expectStatus(res, 200);
});

await check("static assets are served", async () => {
  const html = await (await fetch(`${base}/auth/login`)).text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  if (!asset) throw new Error("no asset link found");
  const res = await fetch(`${base}${asset}`);
  expectStatus(res, 200);
  return asset;
});

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
