import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getBillingStatus } from "../app/billing/billing";
import { offlineAdminGraphql } from "../app/billing/billing.server";
import { createSuppressionRun } from "../app/runs/engine";
import { approveAutomatically, decideAutomatic } from "../app/schedule/automatic";
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
    const outcome = await executeScan(
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

    // Automatic mode (opt-in, scheduled scans only). Any "no" leaves the simulation waiting for the merchant.
    if (outcome.status === "completed") {
      const simulationId = outcome.simulationId;
      try {
        await step.do("automatic mode", { retries: { limit: 1, delay: "30 seconds" }, timeout: "1 minute" }, async () => {
          const scan = await db.query.scans.findFirst({ where: (s, { eq }) => eq(s.id, event.payload.scanId), columns: { shop: true, origin: true } });
          if (!scan || scan.origin !== "scheduled") return "not_scheduled";
          const decision = await decideAutomatic(db, { shop: scan.shop, simulationId });
          if (!decision.run) return decision.reason;
          if (this.env.SUPPRESSION_ENABLED !== "true") return "suppression_disabled";
          const billing = await getBillingStatus(offlineAdminGraphql(scan.shop));
          if (!billing.subscription) return "billing_required";
          if (!(await approveAutomatically(db, { shop: scan.shop, simulationId }))) return "not_open";
          const created = await createSuppressionRun(db, { shop: scan.shop, simulationId, createdBy: "schedule", origin: "scheduled" });
          if (!created.ok) return created.reason;
          const instance = await this.env.SUPPRESSION_RUN.create({ id: created.runId, params: { runId: created.runId } });
          await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, created.runId));
          return "started";
        });
      } catch {
        // The scan itself succeeded; its simulation stays open for the merchant.
      }
    }
    return outcome;
  }
}
