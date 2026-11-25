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
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;

  await ensureShop(db, session.shop);
  const result = await finishKlaviyoAuthorization(
    { db, env },
    { shop: session.shop, code: params.get("code"), state: params.get("state") },
  );
  await logEvent(db, {
    shop: session.shop,
    actor: sessionActor(sessionToken),
    action: result.ok ? "klaviyo.connected" : "klaviyo.connect_failed",
    detail: result.ok ? { klaviyoAccountId: result.connection.klaviyoAccountId } : { code: result.code },
  });
  return redirect(result.ok ? "/app?klaviyo=connected" : `/app?klaviyo=failed&code=${encodeURIComponent(result.code)}`);
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
