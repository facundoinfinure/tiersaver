import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { executeRun, type RunOutcome, type StepConfig } from "../app/runs/engine";
import { settleRunCharge } from "../app/billing/billing";
import { offlineAdminGraphql } from "../app/billing/billing.server";
import { createSuppressionGateway } from "../app/runs/gateway.server";

/** Only the run id travels in the payload: Workflow payloads are persisted, so no personal data goes in. */
export interface SuppressionRunParams {
  runId: string;
}

/**
 * Durable execution of one run. Each batch of up to 100 profiles is its own
 * step: a finished step is never executed again, a failed one is retried with
 * backoff, and an interrupted instance resumes at the first unfinished step.
 *
 * Step budget: batches + 3. Workers Free allows 1,024 steps per instance
 * (about 100,000 profiles); Workers Paid allows 10,000 by default.
 */
export class SuppressionRunWorkflow extends WorkflowEntrypoint<Env, SuppressionRunParams> {
  async run(event: WorkflowEvent<SuppressionRunParams>, step: WorkflowStep): Promise<RunOutcome> {
    const { runId } = event.payload;
    const db = drizzle(this.env.DB, { schema });

    const run = await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.id, runId), columns: { shop: true } });
    const gateway = createSuppressionGateway(this.env, run?.shop ?? "");

    const outcome = await executeRun(
      {
        db,
        gateway,
        step: {
          do: <T>(name: string, config: StepConfig, callback: () => Promise<T>) =>
            step.do(name, config as Parameters<WorkflowStep["do"]>[1], callback as never) as Promise<T>,
        },
      },
      runId,
    );

    // TierSaver's own charge: only for a cleanup that suppressed profiles. A failure here never changes the
    // outcome of the run; the charge stays open and the hourly cron tries again.
    if (run?.shop && outcome.submitted > 0 && outcome.status !== "not_found") {
      const shop = run.shop;
      try {
        await step.do("settle charge", { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "1 minute" }, async () => {
          const result = await settleRunCharge({ db, graphql: offlineAdminGraphql(shop) }, runId);
          return result.status;
        });
      } catch {
        // See above.
      }
    }
    return outcome;
  }
}
