import { hashShopEmail } from "../email-hash";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type Db = DrizzleD1Database<typeof schema>;

/** Keyed hash of a Shopify customer id, with the same per-store key as emails (never a plain SHA-256). */
export async function hashCustomerId(shop: string, customerId: string | number): Promise<string> {
  return hashShopEmail(shop, `shopify-customer:${customerId}`);
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

/** Marks a fresh installation (OAuth just completed), so late webhooks of a previous one can be told apart. */
export async function markInstalled(db: Db, shop: string, now = new Date()): Promise<void> {
  await db.update(schema.shops).set({ status: "installed", installedAt: now, uninstalledAt: null, updatedAt: now }).where(eq(schema.shops.shop, shop));
}

/**
 * True when the shop is installed now and that installation began after `since`.
 * Used to ignore an uninstall or shop/redact webhook that belongs to an earlier installation.
 * Unknown time, unknown shop or an uninstalled shop: false, so the webhook is processed.
 */
export async function installedAfter(db: Db, shop: string, since: Date | null): Promise<boolean> {
  if (!since) return false;
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { status: true, installedAt: true } });
  return row?.status === "installed" && row.installedAt.getTime() > since.getTime();
}

/** shop/redact: delete everything stored for the shop. Child tables cascade from `shops`. */
export async function deleteShopData(db: Db, shop: string): Promise<void> {
  await db.batch([
    db.delete(schema.sessionTable).where(eq(schema.sessionTable.shop, shop)),
    db.delete(schema.shops).where(eq(schema.shops.shop, shop)),
  ]);
}

/**
 * customers/redact: remove the hashed purchase row of that customer, their
 * rows in simulations, and the link between past cleanups and their Klaviyo
 * profile: the cleanup keeps its counts, but the row no longer names the
 * profile, so a later undo cannot restore someone who asked to be erased.
 */
export async function redactCustomer(
  db: Db,
  shop: string,
  customer: { id?: string | number | null; email?: string | null },
): Promise<void> {
  const emailHash = customer.email ? await hashShopEmail(shop, customer.email) : null;
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
      .set({ emailHash: null, profileId: sql`'redacted:' || lower(hex(randomblob(12)))` })
      .where(and(eq(schema.runProfiles.shop, shop), inArray(schema.runProfiles.emailHash, list))),
    db
      .delete(schema.privacyRequests)
      .where(and(eq(schema.privacyRequests.shop, shop), inArray(schema.privacyRequests.emailHash, list))),
    db
      .delete(schema.simulationCandidates)
      .where(
        and(
          inArray(schema.simulationCandidates.simulationId, simulationIds),
          inArray(schema.simulationCandidates.emailHash, list),
        ),
      ),
  ]);
}

/** customers/data_request: record it so the merchant can download the customer's data from the app. Idempotent per Shopify request id. */
export async function recordDataRequest(
  db: Db,
  shop: string,
  request: { id?: string | number | null; email?: string | null; requestId?: string | number | null },
  now = new Date(),
): Promise<void> {
  const known = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { shop: true } });
  if (!known) return; // nothing is stored for a shop the app does not know
  const id = request.requestId != null ? `${shop}:${request.requestId}` : crypto.randomUUID();
  await db
    .insert(schema.privacyRequests)
    .values({
      id,
      shop,
      shopifyRequestId: request.requestId != null ? String(request.requestId) : null,
      shopifyCustomerId: request.id != null ? String(request.id) : null,
      emailHash: request.email ? await hashShopEmail(shop, request.email) : null,
      receivedAt: now,
    })
    .onConflictDoNothing();
}

export interface DataRequestItem {
  id: string;
  shopifyCustomerId: string | null;
  receivedAt: string;
  downloadedAt: string | null;
}

/** Requests of the last 90 days, newest first (Settings). */
export async function listDataRequests(db: Db, shop: string, now = new Date()): Promise<DataRequestItem[]> {
  const rows = await db.query.privacyRequests.findMany({ where: eq(schema.privacyRequests.shop, shop), orderBy: desc(schema.privacyRequests.receivedAt), limit: 50 });
  const since = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => r.receivedAt.getTime() >= since)
    .map((r) => ({ id: r.id, shopifyCustomerId: r.shopifyCustomerId, receivedAt: r.receivedAt.toISOString(), downloadedAt: r.downloadedAt?.toISOString() ?? null }));
}

/**
 * Everything the app holds about the customer of one request: whether a purchase is on record (and its date),
 * and each cleanup that included their Klaviyo profile. Returns null when the request is not this shop's.
 */
export async function exportCustomerData(db: Db, shop: string, requestId: string, now = new Date()) {
  const request = await db.query.privacyRequests.findFirst({ where: and(eq(schema.privacyRequests.id, requestId), eq(schema.privacyRequests.shop, shop)) });
  if (!request) return null;
  const hash = request.emailHash;
  const [purchase, cleanups] = hash
    ? await Promise.all([
        db.query.purchaseHashes.findFirst({ where: and(eq(schema.purchaseHashes.shop, shop), eq(schema.purchaseHashes.emailHash, hash)) }),
        db
          .select({
            runId: schema.runProfiles.runId,
            klaviyoProfileId: schema.runProfiles.profileId,
            reason: schema.runProfiles.reason,
            status: schema.runProfiles.status,
            updatedAt: schema.runProfiles.updatedAt,
            restoredAt: schema.runProfiles.reactivatedAt,
          })
          .from(schema.runProfiles)
          .where(and(eq(schema.runProfiles.shop, shop), eq(schema.runProfiles.emailHash, hash)))
          .limit(200),
      ])
    : [undefined, []];
  await db.update(schema.privacyRequests).set({ downloadedAt: now }).where(and(eq(schema.privacyRequests.id, request.id), isNull(schema.privacyRequests.downloadedAt)));
  return {
    generatedAt: now.toISOString(),
    shop,
    shopifyCustomerId: request.shopifyCustomerId,
    shopifyRequestId: request.shopifyRequestId,
    note: "TierSaver stores no email address in clear. This is everything it holds that is linked to this customer's email.",
    lastOrderOnRecord: purchase?.lastOrderAt.toISOString() ?? null,
    cleanups: cleanups.map((c) => ({
      cleanupId: c.runId,
      klaviyoProfileId: c.klaviyoProfileId,
      rule: c.reason,
      status: c.status,
      updatedAt: c.updatedAt.toISOString(),
      restoredAt: c.restoredAt?.toISOString() ?? null,
    })),
  };
}
