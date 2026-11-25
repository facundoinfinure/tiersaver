// Local relay for the live integration test (test/live-klaviyo.test.ts).
// Tests run inside workerd, which cannot use the session's HTTPS proxy nor hold the key.
// This process forwards http://127.0.0.1:<port>/api/... to https://a.klaviyo.com/api/...
// with the TEST account's private key, and refuses to start unless the key belongs to
// the expected account and Klaviyo flags it as a test account.
//
//   KLAVIYO_TEST_PRIVATE_KEY=... NODE_USE_ENV_PROXY=1 node scripts/klaviyo-relay.mjs <account-id> [port]
//
// The key is never printed. Only /api/ paths are forwarded.
import http from "node:http";

const key = process.env.KLAVIYO_TEST_PRIVATE_KEY;
const expected = process.argv[2];
const port = Number(process.argv[3] ?? 8799);
if (!key || !expected) {
  console.error("Needs KLAVIYO_TEST_PRIVATE_KEY and <account-id>.");
  process.exit(2);
}
const base = "https://a.klaviyo.com";
const auth = { Authorization: `Klaviyo-API-Key ${key}` };

const check = await fetch(`${base}/api/accounts`, { headers: { ...auth, revision: "2026-10-15", accept: "application/vnd.api+json" } });
const account = (await check.json())?.data?.[0];
if (account?.id !== expected || account?.attributes?.test_account !== true) {
  console.error(`Refusing to start: account ${account?.id}, test account: ${account?.attributes?.test_account}.`);
  process.exit(2);
}

let count = 0;
http
  .createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith("/api/")) {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { ...auth };
      for (const h of ["revision", "accept", "content-type"]) if (req.headers[h]) headers[h] = req.headers[h];
      const upstream = await fetch(base + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      // Pagination links must come back through the relay too.
      const text = (await upstream.text()).split(base).join(`http://127.0.0.1:${port}`);
      const out = { "content-type": upstream.headers.get("content-type") ?? "application/json" };
      if (upstream.headers.get("retry-after")) out["retry-after"] = upstream.headers.get("retry-after");
      res.writeHead(upstream.status, out).end(text);
      count++;
      if (req.method !== "GET" || upstream.status >= 400) console.log(`${req.method} ${req.url.split("?")[0]} -> ${upstream.status}`);
    } catch (error) {
      res.writeHead(502).end();
      console.log(`relay error: ${error instanceof Error ? error.name : "error"}`);
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`relay for account ${account.id} (test account) on 127.0.0.1:${port}`));
process.on("SIGTERM", () => {
  console.log(`${count} requests relayed`);
  process.exit(0);
});
