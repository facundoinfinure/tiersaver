import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { createKlaviyoClient } from "../app/klaviyo/connection.server";
import { executeScan, type ScanOutcome, type StepConfig } from "../app/scans/engine";

/** Only the scan id travels in the payload: Workflow payloads are persisted, so no personal data goes in. */
export interface ScanParams {
  scanId: string;
}

/** Each step makes at most a handful of Klaviyo requests; this keeps one well under the subrequest limit of Workers Free (50). */
const SUBREQUESTS_PER_STEP = 30;

/**
 * Durable execution of one audit + simulation scan. Nothing is suppressed
 * here: the result is an unapproved simulation the merchant reviews.
 */
export class ScanWorkflow extends WorkflowEntrypoint<Env, ScanParams> {
  async run(event: WorkflowEvent<ScanParams>, step: WorkflowStep): Promise<ScanOutcome> {
    const db = drizzle(this.env.DB, { schema });
    return executeScan(
      {
        db,
        step: {
          do: <T>(name: string, config: StepConfig, callback: () => Promise<T>) =>
            step.do(name, config as Parameters<WorkflowStep["do"]>[1], callback as never) as Promise<T>,
          sleep: (name: string, ms: number) => step.sleep(name, ms),
        },
        klaviyo: (shop) => createKlaviyoClient({ db, env: this.env }, shop, { subrequestBudget: SUBREQUESTS_PER_STEP }),
        nonRetryable: (code) => new NonRetryableError(code),
        seededAccountId: this.env.KLAVIYO_SEEDED_ACCOUNT_ID || null,
      },
      event.payload.scanId,
    );
  }
}
