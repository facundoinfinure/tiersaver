import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../app/db/schema";
import { backfillOrdersPage, backfillSince, markPurchasesCovered, type AdminGraphql } from "../app/orders/purchases";

export interface OrdersBackfillParams {
  shop: string;
}

/** Workers Free allows 1,024 steps per instance; stay under it (about 250,000 orders). */
const MAX_PAGES = 1000;

const STEP = { retries: { limit: 5, delay: "15 seconds", backoff: "exponential" }, timeout: "2 minutes" } as const;

/**
 * Reads the shop's order history once, one page per durable step, storing only
 * hashed buyers. Purchase coverage is marked complete only if every page was
 * read; otherwise the purchase rule keeps protecting everyone.
 */
export class OrdersBackfillWorkflow extends WorkflowEntrypoint<Env, OrdersBackfillParams> {
  async run(event: WorkflowEvent<OrdersBackfillParams>, step: WorkflowStep) {
    const { shop } = event.payload;
    const db = drizzle(this.env.DB, { schema });

    const plan = await step.do("plan", STEP, async () => {
      // Imported lazily: the Shopify app object reads secrets when the module loads.
      const { unauthenticated } = await import("../app/shopify.server");
      const { session } = await unauthenticated.admin(shop);
      const readAllOrders = (session.scope ?? "").split(",").map((s) => s.trim()).includes("read_all_orders");
      return { readAllOrders, since: backfillSince(readAllOrders).toISOString() };
    });
    const since = new Date(plan.since);

    const graphql: AdminGraphql = async <T>(query: string, variables: Record<string, unknown>) => {
      const { unauthenticated } = await import("../app/shopify.server");
      const { admin } = await unauthenticated.admin(shop);
      const response = await admin.graphql(query, { variables });
      const body = (await response.json()) as { data?: T; errors?: unknown };
      if (body.errors || !body.data) throw new Error("shopify_graphql_error");
      return body.data;
    };

    let cursor: string | null = null;
    let done = false;
    let orders = 0;
    for (let page = 0; page < MAX_PAGES && !done; page++) {
      const result: Awaited<ReturnType<typeof backfillOrdersPage>> = await step.do(`orders page ${page}`, STEP, () =>
        backfillOrdersPage(db, graphql, { shop, since, cursor }),
      );
      cursor = result.cursor;
      done = result.done;
      orders += result.orders;
    }

    if (done) {
      await step.do("mark coverage", STEP, async () => {
        await markPurchasesCovered(db, shop, since, plan.readAllOrders);
        return true;
      });
    }
    return { shop, done, orders, since: plan.since, readAllOrders: plan.readAllOrders };
  }
}
