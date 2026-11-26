import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { number, Time } from "../components/ui";
import { db } from "../db.server";
import { statusLabel } from "../runs/labels";
import { listRuns } from "../runs/view.server";
import { shopTimeZone, stamp } from "../settings/timezone";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [runs, zone] = await Promise.all([listRuns(session.shop), shopTimeZone(db, session.shop)]);
  // Dates are formatted here, in the shop's time zone: the browser never formats one.
  return { runs: runs.map((run) => ({ id: run.id, kind: run.kind, origin: run.origin, submitted: run.submitted, total: run.total, createdAt: stamp(run.createdAt, zone), badge: statusLabel(run) })) };
};

export default function Runs() {
  const { runs } = useLoaderData<typeof loader>();
  return (
    <s-page heading="History">
      <s-section heading="Cleanups and restores">
        {runs.length === 0 ? (
          <s-paragraph>No cleanup has run yet. Every cleanup and every restore is listed here, with who started it and what it changed.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Started</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Profiles sent</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {runs.map((run) => (
                <s-table-row key={run.id}>
                  <s-table-cell>
                    <Time at={run.createdAt} />
                  </s-table-cell>
                  <s-table-cell>
                    {run.kind === "undo" ? "Restore" : "Cleanup"}
                    {run.origin === "scheduled" ? ", scheduled" : ""}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={run.badge.tone}>{run.badge.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {number(run.submitted)} of {number(run.total)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/runs/${run.id}`}>View</s-link>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
