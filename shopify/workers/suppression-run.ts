import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { executeRun, type RunOutcome, type StepConfig } from "../app/runs/engine";
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

    // Nothing is charged here: TierSaver's price is a monthly plan (app/billing/billing.ts), checked before the
    // run was created. Klaviyo's jobs are read on request from the cleanup's page (app/runs/confirm.ts).
    return outcome;
  }
}
