import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { authenticate } from "../shopify.server";
import { db, schema } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook`);

  const current = payload.current as string[];
  if (session) {
    await db
      .update(schema.sessionTable)
      .set({ scope: current.toString() })
      .where(eq(schema.sessionTable.id, session.id));
  }
  return new Response();
};
