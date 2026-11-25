import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { listRuns } from "../runs/view.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { runs: await listRuns(session.shop) };
};

export const STATUS_LABELS: Record<string, { label: string; tone: "info" | "success" | "warning" | "critical" }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_errors: { label: "Completed with issues", tone: "warning" },
  failed: { label: "Did not run", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

const number = (n: number) => n.toLocaleString("en-US");

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
              <s-table-header format="numeric">Profiles</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {runs.map((run) => (
                <s-table-row key={run.id}>
                  <s-table-cell>{new Date(run.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</s-table-cell>
                  <s-table-cell>
                    {run.kind === "undo" ? "Restore (undo)" : "Cleanup"}
                    {run.origin === "scheduled" ? ", scheduled" : ""}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_LABELS[run.status]?.tone ?? "info"}>{STATUS_LABELS[run.status]?.label ?? run.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {number(run.submitted)} of {number(run.total)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/runs/${run.id}`}>Details</s-link>
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
