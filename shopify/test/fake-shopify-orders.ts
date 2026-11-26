import type { AdminGraphql } from "../app/orders/sync";

export interface FakeOrder {
  email: string | null;
  /** ISO dates. `updatedAt` defaults to `createdAt`, which defaults to `processedAt`. */
  processedAt: string;
  createdAt?: string;
  updatedAt?: string;
  test?: boolean;
  customer?: { id: string; email?: string | null } | null;
}

/**
 * Stand-in for the Admin GraphQL `orders` query as the orders sync uses it:
 * `processed_at:>=` / `updated_at:>=` filters, the matching sort key, cursor
 * pagination, and the 60-day window (by creation date) of a shop without
 * read_all_orders. Cursors are opaque strings that stay valid as orders are added.
 */
export class FakeShopifyOrders {
  orders: FakeOrder[] = [];
  pageSize = 2;
  readAllOrders = false;
  now: () => number = () => Date.now();
  /** Every request's variables plus the query text. */
  calls: { query: string; variables: Record<string, unknown> }[] = [];
  /** Return an error to throw for this request (1-based), or nothing. */
  failWhen: (callNumber: number, variables: Record<string, unknown>) => Error | void = () => {};
  /** Runs after a request was answered and before the caller sees the answer. */
  afterFetch: (callNumber: number) => Promise<void> = async () => {};
  ianaTimezone: string | null = "America/Argentina/Buenos_Aires";

  graphql: AdminGraphql = async <T>(query: string, variables: Record<string, unknown>) => {
    if (query.includes("ianaTimezone")) return { shop: { ianaTimezone: this.ianaTimezone } } as T;
    this.calls.push({ query, variables });
    const callNumber = this.calls.length;
    const error = this.failWhen(callNumber, variables);
    if (error) throw error;

    const filter = /^(processed_at|updated_at):>='([^']+)'$/.exec(String(variables.query));
    if (!filter) throw new Error(`unsupported query: ${String(variables.query)}`);
    const byUpdated = filter[1] === "updated_at";
    if (byUpdated !== query.includes("sortKey: UPDATED_AT")) throw new Error("sort key does not match the filter");
    const from = Date.parse(filter[2]!);
    const visibleFrom = this.readAllOrders ? 0 : this.now() - 60 * 86_400_000;
    const created = (o: FakeOrder) => Date.parse(o.createdAt ?? o.processedAt);
    const key = (o: FakeOrder) => (byUpdated ? Date.parse(o.updatedAt ?? o.createdAt ?? o.processedAt) : Date.parse(o.processedAt));

    const withCustomer = query.includes("customer {");
    const sorted = this.orders
      .map((o, index) => ({ o, index, sort: key(o) }))
      .filter((x) => x.sort >= from && created(x.o) >= visibleFrom)
      .sort((a, b) => a.sort - b.sort || a.index - b.index);
    const after = variables.after ? (JSON.parse(atob(String(variables.after))) as { sort: number; index: number }) : null;
    const rest = after ? sorted.filter((x) => x.sort > after.sort || (x.sort === after.sort && x.index > after.index)) : sorted;
    const page = rest.slice(0, Math.min(this.pageSize, Number(variables.first)));
    const last = page[page.length - 1];
    const data = {
      orders: {
        nodes: page.map(({ o }) => ({
          email: o.email,
          processedAt: o.processedAt,
          createdAt: o.createdAt ?? o.processedAt,
          test: o.test ?? false,
          ...(withCustomer
            ? { customer: o.customer ? { id: o.customer.id, defaultEmailAddress: o.customer.email ? { emailAddress: o.customer.email } : null } : null }
            : {}),
        })),
        pageInfo: { hasNextPage: rest.length > page.length, endCursor: last ? btoa(JSON.stringify({ sort: last.sort, index: last.index })) : null },
      },
    };
    await this.afterFetch(callNumber);
    return data as T;
  };
}
