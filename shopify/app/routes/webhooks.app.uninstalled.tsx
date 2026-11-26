import type { ActionFunctionArgs } from "react-router";
import { env } from "cloudflare:workers";
import { db } from "../db.server";
import { handleUninstall, installedAfter } from "../data/privacy";
import { disconnect } from "../klaviyo/connection.server";
import { verifyShopifyWebhook } from "../shopify-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verified by signature alone: this must work when the shop's token can no longer be renewed.
  const { shop, topic, triggeredAt } = await verifyShopifyWebhook(request);
  console.log(`Received ${topic} webhook`);

  // A late delivery for an installation that has since been replaced by a new one must not tear the new one down.
  if (await installedAfter(db, shop, triggeredAt)) {
    console.log("uninstall webhook ignored: the shop installed again after it was sent");
    return new Response();
  }

  // Webhooks can arrive more than once, and after the session is already gone:
  // every statement here is safe to repeat.
  // Shopify cancels the app's subscription when the app is uninstalled; nothing is charged or recorded here.
  try {
    // Revoke TierSaver's access at Klaviyo before the stored tokens are deleted.
    await disconnect({ db, env }, shop);
  } catch {
    // Revocation is best effort; the tokens are deleted below either way.
    console.warn("klaviyo access could not be revoked on uninstall; stored tokens are deleted");
  }
  await handleUninstall(db, shop);
  return new Response();
};
