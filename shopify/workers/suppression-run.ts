import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { executeRun, type RunOutcome, type StepConfig } from "../app/runs/engine";
import { settleRunCharge } from "../app/billing/billing";
import { offlineAdminGraphql } from "../app/billing/billing.server";
import { createKlaviyoClient } from "../app/klaviyo/connection.server";
import { confirmJobsPage } from "../app/runs/confirm";
import { createSuppressionGateway } from "../app/runs/gateway.server";

/** Klaviyo jobs read per step, and how many times the run waits for them (30 s, 1, 2, 4, 8, then 15 minutes each: about 2 hours). */
const JOBS_PER_CONFIRM_STEP = 25;
const CONFIRM_ATTEMPTS = 12;

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

    // TierSaver's own charge. First an estimate from what the run sent; the real charge only once Klaviyo's
    // jobs confirm what they processed. A failure here never changes the outcome of the run: the charge stays
    // open and the hourly cron tries again.
    if (run?.shop && outcome.submitted > 0 && outcome.status !== "not_found") {
      const shop = run.shop;
      const stepConfig = { retries: { limit: 2, delay: "30 seconds" as const, backoff: "exponential" as const }, timeout: "2 minutes" as const };
      try {
        await step.do("estimate charge", stepConfig, async () => (await settleRunCharge({ db, graphql: null }, runId)).status);
        const kind = await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.id, runId), columns: { kind: true } });
        if (kind?.kind === "suppress") {
          const client = () => createKlaviyoClient({ db, env: this.env }, shop, { subrequestBudget: 30 });
          for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
            await step.sleep(`wait for klaviyo jobs ${attempt}`, Math.min(30_000 * 2 ** attempt, 15 * 60_000));
            let offset = 0;
            let complete = true;
            let suppressed = 0;
            for (;;) {
              const pageOffset = offset;
              const page = await step.do(`confirm jobs ${attempt} at ${pageOffset}`, stepConfig, () =>
                confirmJobsPage(db, client(), { runId, offset: pageOffset, limit: JOBS_PER_CONFIRM_STEP }),
              );
              complete = complete && page.complete;
              suppressed += page.suppressed;
              offset += page.checked;
              if (!complete || page.checked === 0 || offset >= page.jobs) break;
            }
            if (!complete) continue;
            await step.do(`settle charge ${attempt}`, stepConfig, async () => (await settleRunCharge({ db, graphql: offlineAdminGraphql(shop) }, runId, { done: true, suppressed })).status);
            break;
          }
        }
      } catch {
        // See above.
      }
    }
    return outcome;
  }
}
