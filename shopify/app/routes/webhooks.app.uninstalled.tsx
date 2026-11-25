import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { handleUninstall } from "../data/privacy";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook`);

  // Webhooks can arrive more than once, and after the session is already gone:
  // every statement here is safe to repeat.
  await handleUninstall(db, shop);
  return new Response();
};
