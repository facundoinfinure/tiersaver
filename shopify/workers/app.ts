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
        const [{ drizzle }, schema, { runScheduleTick }, { startScan }, { CHARGE_ATTEMPTS_BEFORE_ALERT, runsWithOpenCharges, settleRunCharge }, { offlineAdminGraphql }] = await Promise.all([
          import("drizzle-orm/d1"),
          import("../app/db/schema"),
          import("../app/schedule/schedule"),
          import("../app/scans/start.server"),
          import("../app/billing/billing"),
          import("../app/billing/billing.server"),
        ]);
        const db = drizzle(env.DB, { schema });
        try {
          const { purgeStaleData } = await import("../app/data/housekeeping");
          await purgeStaleData(db);
        } catch (error) {
          console.error(`housekeeping failed: ${error instanceof Error ? error.name : "error"}`);
        }
        // ---- run recovery: runs whose Workflow died are started again (queued) or closed honestly -----------
        // Never sends anything to Klaviyo itself. See app/runs/recovery.ts.
        try {
          const { instanceStateOf, recoverStalledRuns } = await import("../app/runs/recovery");
          const recovered = await recoverStalledRuns({
            db,
            instanceState: async (runId) => {
              try {
                return instanceStateOf((await (await env.SUPPRESSION_RUN.get(runId)).status()).status);
              } catch (error) {
                // Only a clear "no such instance" counts as missing; anything else is asked again next tick.
                return error instanceof Error && /not[_ .]?found|does not exist/i.test(error.message) ? "missing" : "unknown";
              }
            },
            launch: async (runId) => {
              try {
                const instance = await env.SUPPRESSION_RUN.create({ id: runId, params: { runId } });
                await env.DB.prepare("UPDATE runs SET workflow_instance_id = ?1 WHERE id = ?2").bind(instance.id, runId).run();
                return true;
              } catch {
                return false;
              }
            },
            terminate: async (runId) => (await env.SUPPRESSION_RUN.get(runId)).terminate(),
          });
          if (recovered.checked > 0) console.log(`run recovery: ${recovered.relaunched.length} restarted, ${recovered.closed.length} closed of ${recovered.checked} stalled`);
        } catch (error) {
          console.error(`run recovery failed: ${error instanceof Error ? error.name : "error"}`);
        }
        // ---- end run recovery -----------------------------------------------------------------------------
        // ---- purchase freshness: start (or resume) the orders read of every shop that is due --------------
        // The reading itself happens in the orders Workflow, page by page; here it is one `create` per shop.
        try {
          const { claimShopsForOrdersSync, ordersSyncInstanceId } = await import("../app/orders/sync");
          const now = new Date();
          let started = 0;
          for (const shop of await claimShopsForOrdersSync(db, { now, limit: 40 })) {
            try {
              await env.ORDERS_BACKFILL.create({ id: ordersSyncInstanceId(shop, now), params: { shop } });
              started++;
            } catch {
              // Already started this hour (the id repeats) or Workflows is unavailable: the next tick tries again.
            }
          }
          if (started > 0) console.log(`orders sync: ${started} started`);
        } catch (error) {
          console.error(`orders sync dispatch failed: ${error instanceof Error ? error.name : "error"}`);
        }
        // ---- end purchase freshness -------------------------------------------------------------------
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
          // A charge Klaviyo already confirmed needs no read of Klaviyo, whatever the size of the run.
          for (const open of (await runsWithOpenCharges(db)).slice(0, 5)) {
            try {
              const confirmation = open.confirmed
                ? null
                : await confirmRunJobs(db, createKlaviyoClient({ db, env }, open.shop, { subrequestBudget: 12 }), open.runId, 10).catch(() => null);
              const result = await settleRunCharge({ db, graphql: offlineAdminGraphql(open.shop) }, open.runId, confirmation);
              if (result.status === "failed") {
                const message = `charge of run ${open.runId} failed (${result.error}), attempt ${open.attempts + 1}`;
                if (open.attempts + 1 >= CHARGE_ATTEMPTS_BEFORE_ALERT) console.error(`NEEDS ATTENTION: ${message}`);
                else console.warn(message);
              }
            } catch (error) {
              console.error(`charge retry of run ${open.runId} threw: ${error instanceof Error ? error.name : "error"}`);
            }
          }
        } catch (error) {
          console.error(`charge retry failed: ${error instanceof Error ? error.name : "error"}`);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
