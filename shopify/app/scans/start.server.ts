import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { db, schema } from "../db.server";
import { logEvent } from "../data/events-log";
import { createScan } from "./engine";

/**
 * Records a scan and hands it to the Workflow. The Workflow instance id is the
 * scan id, so the same scan cannot be executed twice. Returns the id of the
 * scan already in progress when there is one.
 */
export async function startScan(args: {
  shop: string;
  createdBy: string;
  origin?: "manual" | "scheduled";
}): Promise<{ scanId: string; started: boolean }> {
  const created = await createScan(db, args);
  if (!created.ok) return { scanId: created.scanId, started: false };

  const instance = await env.SCAN.create({ id: created.scanId, params: { scanId: created.scanId } });
  await db.update(schema.scans).set({ workflowInstanceId: instance.id }).where(eq(schema.scans.id, created.scanId));
  await logEvent(db, { shop: args.shop, actor: args.createdBy, action: "scan.started", detail: { scanId: created.scanId, origin: args.origin ?? "manual" } });
  return { scanId: created.scanId, started: true };
}
