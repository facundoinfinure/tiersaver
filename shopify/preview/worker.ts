// Worker entry of the local preview (see README.md). Adds /__preview/* helpers in front of the real app.
import { createRequestHandler } from "react-router";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { billing, buyerHashes, installPreviewWorld, klaviyo, knobs, PREVIEW_SHOP, resetBilling, seedKlaviyo } from "./world";

installPreviewWorld();

export { SuppressionRunWorkflow } from "../workers/suppression-run";
export { OrdersBackfillWorkflow } from "../workers/orders-backfill";
export { ScanWorkflow } from "../workers/scan";

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

/** Delivers app_subscriptions/update to the real webhook route, signed with the preview's app secret. */
async function planWebhook(env: Env, ctx: ExecutionContext, subscriptionId: string, status: string): Promise<void> {
  const body = JSON.stringify({ app_subscription: { admin_graphql_api_id: subscriptionId, status } });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hmac = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
  await requestHandler(
    new Request("http://localhost:3210/webhooks/app/subscriptions_update", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-shopify-hmac-sha256": hmac, "x-shopify-topic": "app_subscriptions/update", "x-shopify-shop-domain": PREVIEW_SHOP },
    }),
    { cloudflare: { env, ctx } },
  );
}

async function preview(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    // What Shopify's plan approval page does. Approve (default): the pending plan replaces the active one and the
    // merchant is sent to the plan's return URL. ?decline=1: nothing changes and the merchant lands in the app.
    case "/__preview/billing/confirm": {
      const pending = billing.pending;
      billing.pending = null;
      if (!pending) return Response.redirect(new URL("/app", url).toString(), 302);
      if (url.searchParams.get("decline") === "1") {
        await planWebhook(env, ctx, pending.id, "DECLINED");
        return Response.redirect(new URL("/app", url).toString(), 302);
      }
      billing.plan = pending;
      billing.frozen = false;
      // The return URL is the embedded app's address in the Shopify admin: here, the same path on localhost.
      const back = new URL(pending.returnUrl);
      return Response.redirect(new URL(`/${back.pathname.split("/").slice(5).join("/")}${back.search}`, url).toString(), 302);
    }
    // Changes the plan "at Shopify" and delivers the signed app_subscriptions/update webhook, like Shopify would:
    //   ?end=cancelled   the plan is cancelled outside the app      ?end=frozen   on hold for non-payment
    //   ?end=active      a frozen plan is reactivated               ?legacy=1     adds the old usage subscription
    //   ?plan=1900       an active plan of that many cents a month, as if approved earlier (no webhook)
    case "/__preview/billing": {
      const q = url.searchParams;
      if (q.has("legacy")) billing.legacyUsage = q.get("legacy") === "1";
      if (q.has("plan")) {
        billing.plan = { id: `gid://shopify/AppSubscription/${billing.next++}`, name: "preview plan", monthlyCents: Number(q.get("plan")) || 900, test: true, returnUrl: "" };
        billing.frozen = false;
      }
      const end = q.get("end");
      const id = billing.plan?.id ?? "gid://shopify/AppSubscription/0";
      if (end === "cancelled") {
        billing.plan = null;
        await planWebhook(env, ctx, id, "CANCELLED");
      } else if (end === "frozen") {
        billing.frozen = true;
        await planWebhook(env, ctx, id, "FROZEN");
      } else if (end === "active") {
        billing.frozen = false;
        await planWebhook(env, ctx, id, "ACTIVE");
      }
      return Response.json(billing);
    }
    // Start over: empty database for the shop, fresh fake Klaviyo, no subscription.
    case "/__preview/reset": {
      await env.DB.prepare("DELETE FROM shops WHERE shop = ?").bind(PREVIEW_SHOP).run();
      seedKlaviyo();
      resetBilling();
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
    // Makes the fake Klaviyo misbehave, to look at the states that follow:
    //   ?delay=400            every Klaviyo request takes that many ms (a cleanup stays "in progress" for a while)
    //   ?rejectJobsAfter=5    suppression jobs are rejected once 5 exist (a cleanup that stops early; 0: one that does not run)
    //   ?reset=1              back to normal
    case "/__preview/klaviyo": {
      const q = url.searchParams;
      if (q.has("reset")) {
        knobs.delayMs = 0;
        klaviyo.responders = [];
      }
      if (q.has("delay")) knobs.delayMs = Math.max(0, Number(q.get("delay")) || 0);
      const jobPost = (req: { method: string; url: URL }) => req.method === "POST" && req.url.pathname.startsWith("/api/profile-suppression-bulk-create-jobs");
      if (q.has("rejectJobsAfter")) {
        const limit = Number(q.get("rejectJobsAfter")) || 0;
        klaviyo.responders.push((req) => (jobPost(req) && klaviyo.jobs.length >= limit ? FakeKlaviyo.clientError(400, "invalid", "preview: rejected") : null));
      }
      return Response.json({ delayMs: knobs.delayMs, responders: klaviyo.responders.length });
    }
    // Moves a finished cleanup back in time, to look at what its page says after a Klaviyo plan renewal.
    case "/__preview/age": {
      const hours = Number(url.searchParams.get("hours")) || 0;
      const ms = Math.round(hours * 3_600_000);
      const runId = url.searchParams.get("run") ?? "";
      await env.DB.batch([
        env.DB.prepare("UPDATE runs SET created_at = created_at - ?1, started_at = started_at - ?1, finished_at = finished_at - ?1 WHERE id = ?2 AND shop = ?3").bind(ms, runId, PREVIEW_SHOP),
        env.DB.prepare("UPDATE run_profiles SET attempted_at = attempted_at - ?1 WHERE run_id = ?2 AND shop = ?3").bind(ms, runId, PREVIEW_SHOP),
      ]);
      // With ?renewed=1 Klaviyo's billing period is forgotten too, so only elapsed time says whether the plan renewed.
      if (url.searchParams.has("renewed")) await env.DB.prepare("UPDATE audits SET period_end = NULL WHERE shop = ?1").bind(PREVIEW_SHOP).run();
      return new Response(`aged ${hours} h`);
    }
    // Rewrites the first batch of a finished cleanup as "sent, answer lost", to look at how a result that is unknown is shown.
    case "/__preview/unknown": {
      const runId = url.searchParams.get("run") ?? "";
      const changed = await env.DB.prepare("UPDATE run_profiles SET status = 'failed', error_code = 'outcome_unknown' WHERE run_id = ?1 AND shop = ?2 AND batch_index = 0 AND status = 'submitted'").bind(runId, PREVIEW_SHOP).run();
      const n = changed.meta.changes ?? 0;
      await env.DB.prepare("UPDATE runs SET processed_count = processed_count - ?1, unknown_count = unknown_count + ?1, status = 'completed_with_errors' WHERE id = ?2 AND shop = ?3").bind(n, runId, PREVIEW_SHOP).run();
      return new Response(`unknown: ${n}`);
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
    if (new URL(request.url).pathname.startsWith("/__preview/")) return preview(request, env, ctx);
    return localRedirects(requestHandler(request, { cloudflare: { env, ctx } }), new URL(request.url).origin);
  },
} satisfies ExportedHandler<Env>;
