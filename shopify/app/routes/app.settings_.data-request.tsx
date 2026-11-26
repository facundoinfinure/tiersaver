import type { LoaderFunctionArgs } from "react-router";
import { db } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { exportCustomerData } from "../data/privacy";
import { authenticate } from "../shopify.server";

// What TierSaver holds about the customer of one data request (Shopify's customers/data_request webhook),
// as a JSON file the merchant passes on to that customer. Only requests of the session's shop are served.
// Fetched by the settings page with the session token; never linked directly.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(id)) return new Response("This request is not available.", { status: 404 });

  const data = await exportCustomerData(db, session.shop, id);
  if (!data) return new Response("This request is not available.", { status: 404 });

  // Who downloaded which request, without any customer data.
  await logEvent(db, { shop: session.shop, actor: sessionActor(sessionToken), action: "privacy.data_request_downloaded", detail: { requestId: id } });
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataRequestFilename(id)}"`,
      "Cache-Control": "no-store",
    },
  });
};

export function dataRequestFilename(id: string): string {
  return `tiersaver-customer-data-${id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)}.json`;
}
