import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

// Workflow classes must be exported from the Worker entry.
export { SuppressionRunWorkflow } from "./suppression-run";
export { OrdersBackfillWorkflow } from "./orders-backfill";
export { ScanWorkflow } from "./scan";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
