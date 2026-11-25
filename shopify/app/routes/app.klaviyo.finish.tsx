import { env } from "cloudflare:workers";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { finishKlaviyoAuthorization } from "../klaviyo/flow.server";
import { ensureShop } from "../orders/purchases";
import { authenticate } from "../shopify.server";

// Last step of connecting Klaviyo, inside the embedded app: the only one
// authenticated by Shopify, and the only one that stores anything.
// Shopify's admin loads this URL more than once and cancels the first load;
// see finishKlaviyoAuthorization for how the single-use code survives that.
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const actor = sessionActor(sessionToken);

  await ensureShop(db, session.shop);
  const result = await finishKlaviyoAuthorization(
    {
      db,
      env,
      waitUntil: (work) => context.cloudflare.ctx.waitUntil(work),
      // Logged once, by the load that did the exchange, even if its request was cancelled.
      onSettled: (settled) =>
        logEvent(db, {
          shop: session.shop,
          actor,
          action: settled.ok ? "klaviyo.connected" : "klaviyo.connect_failed",
          detail: settled.ok ? { klaviyoAccountId: settled.connection.klaviyoAccountId } : { code: settled.code },
        }),
    },
    { shop: session.shop, code: params.get("code"), state: params.get("state") },
  );
  if (result.ok) return redirect("/app?klaviyo=connected");
  // Still being finished by another load: the home page shows the outcome.
  if (result.code === "klaviyo_oauth_in_progress") return redirect("/app");
  return redirect(`/app?klaviyo=failed&reason=${encodeURIComponent(result.code)}`);
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
