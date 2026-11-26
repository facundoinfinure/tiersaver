import { env } from "cloudflare:workers";

export interface VerifiedWebhook {
  /** As Shopify sends it, e.g. "app/uninstalled", "shop/redact". */
  topic: string;
  shop: string;
  payload: Record<string, unknown>;
  /** When Shopify generated the event; null if the header is missing or unreadable. */
  triggeredAt: Date | null;
}

/**
 * Verifies a Shopify webhook by its HMAC alone, without loading the shop's session.
 *
 * The uninstall and privacy webhooks must work when the shop's offline token can no longer be renewed (the app
 * is already uninstalled, or was not opened for months). The library's `authenticate.webhook` renews that token
 * before handing over control, and fails the request if it cannot. These handlers need no Admin API, so they
 * check the signature themselves: HMAC-SHA256 of the raw body with the app secret, base64, compared in
 * constant time. Throws a 401 Response on a bad signature, like the library does.
 */
export async function verifyShopifyWebhook(request: Request, secret: string = env.SHOPIFY_API_SECRET): Promise<VerifiedWebhook> {
  if (request.method !== "POST") throw new Response("Method not allowed", { status: 405 });
  const body = await request.arrayBuffer();
  const given = request.headers.get("x-shopify-hmac-sha256") ?? "";
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = Uint8Array.from(atob(given), (c) => c.charCodeAt(0));
  } catch {
    throw new Response("Unauthorized", { status: 401 });
  }
  if (!secret || signature.length === 0) throw new Response("Unauthorized", { status: 401 });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, signature, body))) throw new Response("Unauthorized", { status: 401 });

  const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
  const shop = (request.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  if (!topic || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Response("Bad request", { status: 400 });
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    throw new Response("Bad request", { status: 400 });
  }
  const at = Date.parse(request.headers.get("x-shopify-triggered-at") ?? "");
  return { topic, shop, payload, triggeredAt: Number.isFinite(at) ? new Date(at) : null };
}
