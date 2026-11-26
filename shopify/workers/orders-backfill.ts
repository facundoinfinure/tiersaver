import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { advanceOrdersSync, refreshShopTimeZone, type OrdersSyncResult } from "../app/orders/sync";

export interface OrdersBackfillParams {
  shop: string;
}

/**
 * Pages per instance, one durable step each. Workers Free allows 1,024 steps
 * per instance; stay under it (about 200,000 orders). This is not a ceiling on
 * the store: the cursor is saved in D1 after every page, and the instance the
 * cron starts in the next hour continues from it.
 */
export const MAX_PAGES_PER_INSTANCE = 800;

const STEP = { retries: { limit: 5, delay: "15 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;

/**
 * Brings a shop's hashed buyers up to date: the history backfill on install,
 * then incremental reads (started hourly by the cron). All the state is in D1
 * (app/orders/sync.ts), so instances are interchangeable: any of them resumes
 * the read in progress, and two at once cannot harm it. Until a read completes
 * and stays current, the purchase rule protects everyone.
 */
export class OrdersBackfillWorkflow extends WorkflowEntrypoint<Env, OrdersBackfillParams> {
  async run(event: WorkflowEvent<OrdersBackfillParams>, step: WorkflowStep) {
    const { shop } = event.payload;
    const db = drizzle(this.env.DB, { schema });
    // Imported lazily: the Shopify app object reads secrets when the module loads.
    const access = async () => (await import("../app/orders/sync.server")).offlineOrdersAccess(shop);

    try {
      await step.do("shop time zone", { retries: { limit: 1, delay: "10 seconds" }, timeout: "1 minute" }, async () => {
        return (await refreshShopTimeZone(db, (await access()).graphql, shop)) ?? "unknown";
      });
    } catch {
      // Scheduling falls back to UTC; the orders read does not depend on it.
    }

    let status: OrdersSyncResult["status"] = "more";
    let pages = 0;
    let orders = 0;
    for (let i = 0; i < MAX_PAGES_PER_INSTANCE && status === "more"; i++) {
      const result: OrdersSyncResult = await step.do(`orders page ${i}`, STEP, async () => advanceOrdersSync(db, await access(), { shop, maxPages: 1 }));
      status = result.status;
      pages += result.pages;
      orders += result.orders;
    }
    // "more": the next hourly instance continues from the saved cursor. Counts only; no order data leaves the step.
    return { shop, status, pages, orders };
  }
}
