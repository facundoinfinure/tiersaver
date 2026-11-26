import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { db } from "../db.server";
import { sessionActor } from "../data/events-log";
import { dismissNotice } from "../notices";
import { ensureShop } from "../orders/purchases";
import { authenticate } from "../shopify.server";

/**
 * "Got it" on a notice (app/notices.ts). Posted from the home page and the cleanup review with a fetcher, so the
 * merchant stays where they are; the page's loader then runs again and the banner is gone for this shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const form = await request.formData();
  const noticeId = String(form.get("noticeId") ?? "");
  try {
    await ensureShop(db, session.shop);
    return { ok: await dismissNotice(db, { shop: session.shop, actor: sessionActor(sessionToken), noticeId }) };
  } catch {
    // Not recorded: the banner stays and can be dismissed again. A notice never breaks the page.
    return { ok: false };
  }
};

/** Nothing to show here. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app");
};
