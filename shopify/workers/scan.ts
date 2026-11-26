import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { offlineAdminGraphql } from "../app/billing/billing.server";
import { suppressionAllowed } from "../app/runs/gateway.server";
import { runAutomaticMode } from "../app/schedule/automatic";
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
        // Purchase data is refreshed inside the scan, a few pages per step (each page is one Admin API request).
        syncPurchases: async (shop) => (await import("../app/orders/sync.server")).syncShopOrders(db, shop, 4),
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
          return runAutomaticMode(
            {
              db,
              // The cron cannot act as the merchant: Shopify is asked about the plan with the shop's offline token.
              graphql: offlineAdminGraphql(scan.shop),
              suppressionAllowed: (klaviyoAccountId) => suppressionAllowed(this.env, klaviyoAccountId),
              launch: async (runId) => {
                const instance = await this.env.SUPPRESSION_RUN.create({ id: runId, params: { runId } });
                await db.update(schema.runs).set({ workflowInstanceId: instance.id }).where(eq(schema.runs.id, runId));
              },
            },
            { shop: scan.shop, simulationId },
          );
        });
      } catch {
        // The scan itself succeeded; its simulation stays open for the merchant.
      }
    }
    return outcome;
  }
}
