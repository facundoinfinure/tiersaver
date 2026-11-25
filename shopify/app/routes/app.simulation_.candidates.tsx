import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { candidatesCsvPart } from "../simulations/review";
import { authenticate } from "../shopify.server";

// Candidate list as CSV, for review BEFORE approval only (see app/simulations/review.ts).
// Fetched by the review page with the session token; never linked directly.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const simulationId = params.get("id") ?? "";
  const part = Number(params.get("part") ?? "1");

  const connection = await getConnection(db, session.shop);
  if (connection?.status !== "connected") return new Response("Klaviyo is not connected.", { status: 409 });

  let result;
  try {
    const client = createKlaviyoClient({ db, env }, session.shop, { subrequestBudget: 40 });
    result = await candidatesCsvPart(db, client, { shop: session.shop, simulationId, part });
  } catch {
    return new Response("The list could not be read from Klaviyo.", { status: 502 });
  }
  if (!result.ok) return new Response("This list is not available.", { status: result.reason === "not_found" ? 404 : 409 });

  // Who downloaded what, without any profile data.
  await logEvent(db, { shop: session.shop, actor: sessionActor(sessionToken), action: "simulation.candidates_downloaded", simulationId, detail: { part: result.part, parts: result.parts, rows: result.rows } });
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tiersaver-candidates-${result.part}-of-${result.parts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
