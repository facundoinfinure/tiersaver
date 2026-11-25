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
  // Hourly Cron Trigger: the monthly schedule and open charges. Never suppresses anything by itself.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const [{ drizzle }, schema, { runScheduleTick }, { startScan }, { runsWithOpenCharges, settleRunCharge }, { offlineAdminGraphql }] = await Promise.all([
          import("drizzle-orm/d1"),
          import("../app/db/schema"),
          import("../app/schedule/schedule"),
          import("../app/scans/start.server"),
          import("../app/billing/billing"),
          import("../app/billing/billing.server"),
        ]);
        const db = drizzle(env.DB, { schema });
        try {
          const tick = await runScheduleTick({ db, startScan });
          if (tick.due > 0) console.log(`schedule: ${tick.started.length} of ${tick.due} scans started`);
        } catch (error) {
          console.error(`schedule tick failed: ${error instanceof Error ? error.name : "error"}`);
        }
        try {
          const [{ confirmRunJobs }, { createKlaviyoClient }] = await Promise.all([import("../app/runs/confirm"), import("../app/klaviyo/connection.server")]);
          // A few per tick: each one reads its jobs from Klaviyo. Runs with more jobs than one invocation can read
          // are confirmed by their own Workflow.
          for (const open of (await runsWithOpenCharges(db)).slice(0, 3)) {
            const confirmation = await confirmRunJobs(db, createKlaviyoClient({ db, env }, open.shop, { subrequestBudget: 12 }), open.runId, 10).catch(() => null);
            await settleRunCharge({ db, graphql: offlineAdminGraphql(open.shop) }, open.runId, confirmation);
          }
        } catch (error) {
          console.error(`charge retry failed: ${error instanceof Error ? error.name : "error"}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
