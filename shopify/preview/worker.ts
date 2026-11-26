// Worker entry of the local preview (see README.md). Adds /__preview/* helpers in front of the real app.
import { createRequestHandler } from "react-router";
import { billing, buyerHashes, installPreviewWorld, klaviyo, PREVIEW_SHOP, seedKlaviyo } from "./world";

installPreviewWorld();

export { SuppressionRunWorkflow } from "../workers/suppression-run";
export { OrdersBackfillWorkflow } from "../workers/orders-backfill";
export { ScanWorkflow } from "../workers/scan";

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

async function preview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  switch (url.pathname) {
    // What Klaviyo's consent screen does when the merchant approves.
    case "/__preview/klaviyo/authorize": {
      const code = klaviyo.authorize({ codeChallenge: url.searchParams.get("code_challenge") ?? "", redirectUri: url.searchParams.get("redirect_uri") ?? "", scope: url.searchParams.get("scope") ?? "" });
      const back = new URL(url.searchParams.get("redirect_uri") ?? "/");
      if (url.searchParams.get("decline") === "1") back.searchParams.set("error", "access_denied");
      else back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      return Response.redirect(back.toString(), 302);
    }
    // What Shopify's pricing approval page does when the merchant accepts.
    case "/__preview/billing/confirm":
      billing.subscribed = true;
      return Response.redirect(new URL("/app/simulation", url).toString(), 302);
    // Start over: empty database for the shop, fresh fake Klaviyo, no subscription.
    case "/__preview/reset": {
      await env.DB.prepare("DELETE FROM shops WHERE shop = ?").bind(PREVIEW_SHOP).run();
      seedKlaviyo();
      billing.subscribed = false;
      billing.usageRecords = [];
      return new Response("reset");
    }
    // Complete order history with a few buyers among the inactive profiles (what read_all_orders would give).
    case "/__preview/orders": {
      const now = Date.now();
      await env.DB.prepare("UPDATE shops SET purchases_covered_since = ?, read_all_orders_granted = 1 WHERE shop = ?").bind(Date.parse("2004-01-01"), PREVIEW_SHOP).run();
      const insert = env.DB.prepare("INSERT OR REPLACE INTO purchase_hashes (shop, email_hash, last_order_at, updated_at) VALUES (?, ?, ?, ?)");
      const hashes = await buyerHashes();
      for (let i = 0; i < hashes.length; i += 50) await env.DB.batch(hashes.slice(i, i + 50).map((h) => insert.bind(PREVIEW_SHOP, h, now - 400 * 86_400_000, now)));
      return new Response(`orders: ${hashes.length} buyers`);
    }
    case "/__preview/state":
      return Response.json({ billing, jobs: klaviyo.jobs.length, suppressed: klaviyo.suppressed.size, segments: klaviyo.segments.map((s) => ({ id: s.id, members: s.members.length, processing: s.isProcessing })) });
  }
  return new Response("unknown preview helper", { status: 404 });
}

/**
 * The app redirects the browser to two places that do not exist locally: Klaviyo's consent screen and the
 * Shopify admin URL of the embedded app. In the preview both come back to this server, so the browser
 * never leaves localhost (a browser-side interception would miss them: they are redirect targets).
 */
async function localRedirects(pending: Response | Promise<Response>, origin: string): Promise<Response> {
  const response = await pending;
  const location = response.headers.get("Location");
  if (!location) return response;
  let target: string | null = null;
  if (location.startsWith("https://www.klaviyo.com/oauth/authorize")) {
    target = `${origin}/__preview/klaviyo/authorize${new URL(location).search}`;
  } else if (location.startsWith("https://admin.shopify.com/store/")) {
    const url = new URL(location);
    target = `${origin}/${url.pathname.split("/").slice(5).join("/")}${url.search}`;
  }
  if (!target) return response;
  const headers = new Headers(response.headers);
  headers.set("Location", target);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/__preview/")) return preview(request, env);
    return localRedirects(requestHandler(request, { cloudflare: { env, ctx } }), new URL(request.url).origin);
  },
} satisfies ExportedHandler<Env>;
