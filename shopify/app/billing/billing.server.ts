import type { AdminGraphql } from "./billing";

/** Admin API access for a shop outside a request (Workflow, cron), from the stored offline session. */
export function offlineAdminGraphql(shop: string): AdminGraphql {
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(query, { variables });
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (body.errors || !body.data) throw new Error("shopify_graphql_error");
    return body.data;
  };
}

/** Admin API access inside an embedded request. */
export function requestAdminGraphql(admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> }): AdminGraphql {
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const response = await admin.graphql(query, { variables });
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (body.errors || !body.data) throw new Error("shopify_graphql_error");
    return body.data;
  };
}
