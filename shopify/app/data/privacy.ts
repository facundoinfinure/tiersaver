import { hashEmail } from "@tiersaver/core";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type Db = DrizzleD1Database<typeof schema>;

/** SHA-256 (hex) of a Shopify customer id, scoped to the shop. */
export async function hashCustomerId(shop: string, customerId: string | number): Promise<string> {
  const data = new TextEncoder().encode(`${shop}:${customerId}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * app/uninstalled: tokens go immediately. The rest of the shop's data stays
 * until Shopify sends shop/redact (48 hours later), which removes everything.
 * Profiles stay suppressed in Klaviyo; the app never unsuppresses on uninstall.
 */
export async function handleUninstall(db: Db, shop: string, now = new Date()): Promise<void> {
  await db.batch([
    db.delete(schema.sessionTable).where(eq(schema.sessionTable.shop, shop)),
    db.delete(schema.klaviyoConnections).where(eq(schema.klaviyoConnections.shop, shop)),
    db
      .update(schema.shops)
      .set({ status: "uninstalled", uninstalledAt: now, updatedAt: now })
      .where(eq(schema.shops.shop, shop)),
  ]);
}

/** shop/redact: delete everything stored for the shop. Child tables cascade from `shops`. */
export async function deleteShopData(db: Db, shop: string): Promise<void> {
  await db.batch([
    db.delete(schema.sessionTable).where(eq(schema.sessionTable.shop, shop)),
    db.delete(schema.shops).where(eq(schema.shops.shop, shop)),
  ]);
}

/**
 * customers/redact: remove the hashed purchase row of that customer and
 * detach their hash from past runs and simulations. Run history keeps the
 * Klaviyo profile id (needed to undo), which is not Shopify customer data.
 */
export async function redactCustomer(
  db: Db,
  shop: string,
  customer: { id?: string | number | null; email?: string | null },
): Promise<void> {
  const emailHash = customer.email ? await hashEmail(customer.email) : null;
  const customerIdHash = customer.id != null ? await hashCustomerId(shop, customer.id) : null;
  if (!emailHash && !customerIdHash) return;

  const hashes = new Set<string>();
  if (emailHash) hashes.add(emailHash);
  if (customerIdHash) {
    const rows = await db
      .select({ emailHash: schema.purchaseHashes.emailHash })
      .from(schema.purchaseHashes)
      .where(and(eq(schema.purchaseHashes.shop, shop), eq(schema.purchaseHashes.customerIdHash, customerIdHash)));
    for (const r of rows) hashes.add(r.emailHash);
  }

  const match = [
    emailHash ? eq(schema.purchaseHashes.emailHash, emailHash) : undefined,
    customerIdHash ? eq(schema.purchaseHashes.customerIdHash, customerIdHash) : undefined,
  ].filter((c) => c !== undefined);
  await db.delete(schema.purchaseHashes).where(and(eq(schema.purchaseHashes.shop, shop), or(...match)));

  const list = [...hashes].slice(0, 50);
  if (list.length === 0) return;
  const simulationIds = db
    .select({ id: schema.simulations.id })
    .from(schema.simulations)
    .where(eq(schema.simulations.shop, shop));
  await db.batch([
    db
      .update(schema.runProfiles)
      .set({ emailHash: null })
      .where(and(eq(schema.runProfiles.shop, shop), inArray(schema.runProfiles.emailHash, list))),
    db
      .update(schema.simulationCandidates)
      .set({ emailHash: null })
      .where(
        and(
          inArray(schema.simulationCandidates.simulationId, simulationIds),
          inArray(schema.simulationCandidates.emailHash, list),
        ),
      ),
  ]);
}
