import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { authenticate } from "../shopify.server";
import { db, schema } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook`);

  // Webhooks can arrive more than once, and after the session is already gone.
  if (session) {
    await db.delete(schema.sessionTable).where(eq(schema.sessionTable.shop, shop));
  }
  return new Response();
};
