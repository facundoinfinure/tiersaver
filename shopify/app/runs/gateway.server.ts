import { NonRetryableError } from "cloudflare:workflows";
import { chunk, hashEmail } from "@tiersaver/core";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { getProfileEmails, submitSuppressionJob } from "../klaviyo/api";
import { LIMITS } from "../klaviyo/config";
import { createKlaviyoClient, getConnection, type KlaviyoSecrets } from "../klaviyo/connection.server";
import { KlaviyoError } from "../klaviyo/errors";
import { RUN_BATCH_SIZE, type BatchRequest, type BatchResult, type SuppressionGateway } from "./engine";

/**
 * Gateway used by deployed runs: turns one batch of Klaviyo profile ids into
 * one bulk suppress ("suppress" runs) or unsuppress ("undo" runs) job.
 *
 * Safety switches, checked in this order before anything touches the network:
 * 1. `SUPPRESSION_ENABLED` must be exactly "true" for suppress batches. It is
 *    absent by default, so a deployment cannot suppress anyone until the owner
 *    turns it on. Refusal: `suppression_disabled`. Undo batches are exempt:
 *    they only exist for runs that already happened, and reversal must not
 *    depend on the switch (product rule 3).
 * 2. The shop must have a Klaviyo connection in status `connected`. Refusals:
 *    `klaviyo_not_connected`, `klaviyo_needs_reauth`, `klaviyo_disconnected`.
 * Both are non-retryable: the run stops and every remaining profile stays untouched.
 *
 * Emails. Runs store profile ids only. The current email of each id is read
 * from Klaviyo here, used for the one request, and dropped: it is never
 * written to the database, a log line or an error.
 *
 * Skips (returned in `skippedProfileIds`, never sent to Klaviyo):
 * - the profile no longer exists;
 * - the profile has no email;
 * - suppress runs only: the profile's email is not the one the simulation
 *   evaluated (its stored hash differs). The purchase check was made for the
 *   old address, so the approval does not cover the new one.
 * A profile that cannot be confirmed is skipped; "unknown" never suppresses.
 *
 * Calling `submitBatch` twice with the same batch is safe: ids are resolved
 * again and the same emails are sent again. Klaviyo's bulk suppress and
 * unsuppress act per email, so repeating one changes nothing; it only creates
 * a second job, whose id is the one recorded.
 *
 * Cost per batch of 100: 2 profile lookups + 1 job = 3 Klaviyo requests.
 */

export type GatewayEnv = KlaviyoSecrets & {
  DB: D1Database;
  SUPPRESSION_ENABLED?: string;
};

export interface GatewayDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Recorded as the job id when every profile of a batch was skipped and no job was created. */
export const NO_JOB_ID = "none";

function refuse(code: string): never {
  throw new NonRetryableError(code);
}

export function createSuppressionGateway(env: GatewayEnv, shop: string, deps: GatewayDeps = {}): SuppressionGateway {
  return {
    async submitBatch(request: BatchRequest): Promise<BatchResult> {
      // Undo is never blocked by the switch: anything the app suppressed must stay reversible.
      if (request.kind !== "undo" && env.SUPPRESSION_ENABLED !== "true") refuse("suppression_disabled");
      if (!shop || request.shop !== shop) refuse("gateway_shop_mismatch");
      const profileIds = [...new Set(request.profileIds)];
      if (profileIds.length === 0 || profileIds.length > RUN_BATCH_SIZE) refuse("batch_invalid_size");

      const db = drizzle(env.DB, { schema });
      const connectionDeps = { db, env, fetch: deps.fetch, sleep: deps.sleep, now: deps.now };

      try {
        const connection = await getConnection(db, shop);
        if (!connection) refuse("klaviyo_not_connected");
        if (connection.status !== "connected") refuse(`klaviyo_${connection.status}`);

        const client = createKlaviyoClient(connectionDeps, shop);

        // Resolve ids to their current emails, right now.
        const emails = new Map<string, string | null>();
        for (const ids of chunk(profileIds, LIMITS.profileIdsPerLookup)) {
          for (const [id, email] of await getProfileEmails(client, ids)) emails.set(id, email);
        }

        // For a suppression, the email must still be the one that was simulated and approved.
        const approvedHash = new Map<string, string | null>();
        if (request.kind === "suppress") {
          const rows = await db
            .select({ profileId: schema.runProfiles.profileId, emailHash: schema.runProfiles.emailHash })
            .from(schema.runProfiles)
            .where(and(eq(schema.runProfiles.runId, request.runId), eq(schema.runProfiles.batchIndex, request.batchIndex)));
          for (const row of rows) approvedHash.set(row.profileId, row.emailHash);
        }

        const skipped: string[] = [];
        const toSend = new Set<string>();
        for (const id of profileIds) {
          const email = emails.get(id);
          if (!email) {
            skipped.push(id); // gone, or no email
            continue;
          }
          const expected = approvedHash.get(id);
          if (expected && expected !== (await hashEmail(email))) {
            skipped.push(id); // email changed since the simulation
            continue;
          }
          // Sent exactly as Klaviyo holds it: an altered spelling could make Klaviyo create a new, suppressed profile.
          toSend.add(email);
        }

        if (toSend.size === 0) return { jobId: NO_JOB_ID, skippedProfileIds: skipped };
        const job = await submitSuppressionJob(client, request.kind === "undo" ? "unsuppress" : "suppress", [...toSend]);
        return { jobId: job.id, skippedProfileIds: skipped };
      } catch (err) {
        if (err instanceof KlaviyoError) {
          // Codes only: these errors never carry tokens, emails or URLs.
          if (err.retryable) throw new Error(err.code);
          refuse(err.code);
        }
        if (err instanceof NonRetryableError) throw err;
        // Anything unexpected is reduced to a fixed code, so no detail of the batch can leak through a message.
        throw new Error("gateway_internal_error");
      }
    },
  };
}
