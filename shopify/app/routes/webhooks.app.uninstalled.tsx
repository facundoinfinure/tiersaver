import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { env } from "cloudflare:workers";
import { handleUninstall } from "../data/privacy";
import { disconnect } from "../klaviyo/connection.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook`);

  // Webhooks can arrive more than once, and after the session is already gone:
  // every statement here is safe to repeat.
  try {
    // Revoke TierSaver's access at Klaviyo before the stored tokens are deleted.
    await disconnect({ db, env }, shop);
  } catch {
    // Revocation is best effort; the tokens are deleted below either way.
  }
  await handleUninstall(db, shop);
  return new Response();
};
