import { NonRetryableError } from "cloudflare:workflows";
import { chunk, validateRuleSettings } from "@tiersaver/core";
import { hashShopEmail } from "../email-hash";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import {
  buildCandidateSegmentDefinition,
  findCandidateSegment,
  getAccount,
  getCandidateSegmentMemberStates,
  getProfileStates,
  getSuppressionJob,
  listMetricsPage,
  submitSuppressionJob,
  type KlaviyoMetric,
  type ProfileState,
} from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";
import { LIMITS, SEEDED_METRIC_SPECS } from "../klaviyo/config";
import { createKlaviyoClient, getConnection, type KlaviyoSecrets } from "../klaviyo/connection.server";
import { KlaviyoError } from "../klaviyo/errors";
import { rulesOf } from "../settings/settings";
import { RUN_BATCH_SIZE, markNotSent, type BatchRequest, type BatchResult, type SuppressionGateway } from "./engine";

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
 * Re-validation (suppress batches). A simulation can be up to 24 hours old
 * when its cleanup starts, so every batch is checked again right before it is
 * sent, and whoever is no longer a candidate is skipped with a reason
 * (`SKIP_REASONS`, stored in `run_profiles.error_code`):
 * - locally: the approved email hash is missing (`email_hash_missing`, e.g.
 *   after customers/redact), or an order was recorded for it since the scan
 *   began (`purchased_since_simulation`);
 * - in Klaviyo, with ONE read per 50 profiles that also returns the email:
 *   the profile is no longer a member of TierSaver's managed candidate segment
 *   (`not_in_candidate_segment`: it opened, clicked, visited, ordered, lost
 *   its consent, or no longer exists), has no email (`no_email`), has another
 *   email than the one evaluated (`email_changed`), is already suppressed for
 *   any reason (`already_suppressed`), or its state was not returned
 *   (`state_unknown`).
 * The segment itself must be found, active, not processing and carry exactly
 * the definition the rules produce; otherwise membership is unknown and the
 * batch is refused (`candidate_segment_*`): the run stops, nobody is touched.
 *
 * Undo batches. Restore exists to correct a mistake, so the rule is: RESTORE
 * unless there is positive evidence that the profile's current suppression is
 * not this cleanup's. Klaviyo exposes the reason and the time of each
 * suppression ("The timestamp when the profile was suppressed", spec
 * 2026-10-15), never its author. Its documentation does not say how that time
 * relates to the bulk job (`created_at`, `completed_at`), nor whether
 * suppressing an already suppressed profile moves it. So a profile is left
 * alone only in these cases (see `undoEvidence`), each with a full day of
 * margin (`SUPPRESSION_EVIDENCE_MARGIN_MS`):
 * - `suppressed_before_cleanup`: the USER_SUPPRESSED entry is dated more than
 *   a day before our own request left, so it was there already;
 * - `suppressed_after_cleanup`: it is dated more than a day after BOTH the
 *   completion Klaviyo reports for the job that carried the profile AND the
 *   end of the cleanup on our clock. Needs the job to be readable, `complete`
 *   and consistent with our clock; otherwise there is no upper bound and the
 *   profile is restored.
 * Also skipped: no approved hash (`email_hash_missing`, customers/redact), the
 * profile no longer exists (`profile_gone`) or has no email (`no_email`).
 * In every other case, including "cannot tell" (no timestamp, unreadable
 * job, state not returned, profile not suppressed at all), the profile is
 * sent: unsuppress only removes USER_SUPPRESSED, so unsubscribes and bounces
 * stay as they are and a profile that is not suppressed is not changed.
 *
 * A profile that cannot be confirmed is skipped; "unknown" never suppresses.
 *
 * Calling `submitBatch` twice with the same batch is safe: state is read
 * again and Klaviyo's bulk suppress and unsuppress act per email. Profiles an
 * earlier attempt already sent arrive in `maybeSentProfileIds`; if they are
 * now filtered out, the engine records them as "outcome unknown", not skipped.
 *
 * Cost per suppress batch of 100: 2 segment-member reads + 1 job = 3 Klaviyo
 * requests, plus about 4 (account, metrics, segment lookup) every
 * `SEGMENT_CHECK_TTL_MS`. Undo: 2 profile reads + 1 job; up to
 * `MAX_JOB_LOOKUPS_PER_BATCH` job reads only when a suppression is dated
 * well after the cleanup.
 */

/** Why a profile was left untouched. Machine-readable; shown through `SKIP_REASON_LABELS` in labels.ts. */
export const SKIP_REASONS = [
  "email_hash_missing",
  "purchased_since_simulation",
  "not_in_candidate_segment",
  "no_email",
  "email_changed",
  "already_suppressed",
  "state_unknown",
  "profile_gone",
  "suppressed_before_cleanup",
  "suppressed_after_cleanup",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** How long one check of the candidate segment (found, active, not processing, definition unchanged) is trusted. */
export const SEGMENT_CHECK_TTL_MS = 5 * 60_000;
/**
 * Suppress retries only: how far before our own request Klaviyo's suppression timestamp may be and still count
 * as the effect of that request (clock skew). Being wrong here re-sends an idempotent suppress, nothing else.
 */
export const SUPPRESSION_CLOCK_SKEW_MS = 5 * 60_000;
/**
 * Undo: how far outside the cleanup's own time span a suppression must be dated before it counts as evidence
 * that it is somebody else's. A whole day, on both sides: it absorbs clock differences, a timestamp reported
 * without its offset or rounded to the day, and a job Klaviyo reports complete before every profile shows it.
 * Being wrong in this direction leaves a profile suppressed after a "successful" restore, which is the one
 * thing Restore must not do; being wrong in the other only removes a manual suppression that happened to be
 * made within a day of the cleanup.
 */
export const SUPPRESSION_EVIDENCE_MARGIN_MS = 24 * 60 * 60_000;
/** Undo: at most this many of the cleanup's jobs are read per batch to learn when they completed. Profiles of a job beyond this are restored. */
export const MAX_JOB_LOOKUPS_PER_BATCH = 4;

export type GatewayEnv = KlaviyoSecrets & {
  DB: D1Database;
  SUPPRESSION_ENABLED?: string;
  /**
   * Optional second lock. When set, suppress batches are refused unless the
   * shop is connected to exactly this Klaviyo account (`suppression_not_allowed_for_account`).
   * Used to try real cleanups on the test account only. Undo is exempt, like above.
   */
  SUPPRESSION_ALLOWED_ACCOUNT_ID?: string;
  /** The seeded test account: its metrics belong to the "API" integration, like in the scan. */
  KLAVIYO_SEEDED_ACCOUNT_ID?: string;
};

/** Whether this deployment may suppress for a shop connected to `klaviyoAccountId`. */
export function suppressionAllowed(env: Pick<GatewayEnv, "SUPPRESSION_ENABLED" | "SUPPRESSION_ALLOWED_ACCOUNT_ID">, klaviyoAccountId: string | null | undefined): boolean {
  if (env.SUPPRESSION_ENABLED !== "true") return false;
  return !env.SUPPRESSION_ALLOWED_ACCOUNT_ID || env.SUPPRESSION_ALLOWED_ACCOUNT_ID === klaviyoAccountId;
}

export interface GatewayDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Recorded as the job id when every profile of a batch was skipped and no job was created. */
export const NO_JOB_ID = "none";

/** Refusals happen before, or instead of, the request that changes Klaviyo: nothing was applied. */
function refuse(code: string): never {
  throw markNotSent(new NonRetryableError(code));
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Finds TierSaver's managed segment and makes sure its membership can be trusted right now. Returns its id. */
async function usableCandidateSegment(db: Db, client: KlaviyoClient, env: GatewayEnv, shop: string, klaviyoAccountId: string | null): Promise<string> {
  const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) });
  if (!settings) refuse("candidate_segment_unavailable");
  const account = await getAccount(client);
  if (account.id !== klaviyoAccountId) refuse("klaviyo_account_changed");
  const seeded = Boolean(env.KLAVIYO_SEEDED_ACCOUNT_ID) && account.id === env.KLAVIYO_SEEDED_ACCOUNT_ID && account.testAccount === true;

  const metrics: KlaviyoMetric[] = [];
  let cursor: string | null = null;
  do {
    const page = await listMetricsPage(client, { cursor });
    metrics.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && metrics.length < 2000);
  // Same inputs as the scan (scans/engine.ts): the rules the simulation was made with are the current ones,
  // because a change of rules supersedes the simulation and stops the run at its start.
  const built = buildCandidateSegmentDefinition(metrics, validateRuleSettings(rulesOf(settings)).settings, seeded ? SEEDED_METRIC_SPECS : {});
  if (!built.ok) refuse("candidate_segment_unavailable");

  const segment = await findCandidateSegment(client, built.definition);
  if (!segment) refuse("candidate_segment_missing");
  if (!segment.isActive || !segment.definitionMatches) refuse("candidate_segment_changed");
  // Klaviyo is recomputing membership: retried with backoff by the step, and the run stops if it does not settle.
  if (segment.isProcessing) throw markNotSent(new Error("candidate_segment_processing"));
  return segment.id;
}

/**
 * The instant from which a recorded order counts as "since the simulation": the start of the scan that
 * produced it. Orders were matched while the scan ran, so anything recorded from its start on was possibly
 * not seen by it.
 */
async function ordersSeenUntil(db: Db, runId: string): Promise<Date> {
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId), columns: { simulationId: true } });
  if (!run?.simulationId) refuse("simulation_missing");
  const [simulation, scan] = await Promise.all([
    db.query.simulations.findFirst({ where: eq(schema.simulations.id, run.simulationId), columns: { createdAt: true } }),
    db.query.scans.findFirst({ where: eq(schema.scans.simulationId, run.simulationId), columns: { startedAt: true, createdAt: true } }),
  ]);
  if (!simulation) refuse("simulation_missing");
  return scan?.startedAt ?? scan?.createdAt ?? simulation.createdAt;
}

/** Suppress: decides, for each profile of the batch, whether it is still exactly what the merchant approved. */
async function revalidateForSuppress(
  db: Db,
  client: KlaviyoClient,
  request: BatchRequest,
  profileIds: string[],
  segmentId: string,
  since: Date,
  skip: (id: string, reason: SkipReason) => void,
  confirm: (id: string) => void,
): Promise<string[]> {
  const rows = await db
    .select({ profileId: schema.runProfiles.profileId, emailHash: schema.runProfiles.emailHash, attemptedAt: schema.runProfiles.attemptedAt })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, request.runId), eq(schema.runProfiles.batchIndex, request.batchIndex)));
  const approvedHash = new Map(rows.map((r) => [r.profileId, r.emailHash]));
  const attemptedAt = new Map(rows.map((r) => [r.profileId, r.attemptedAt]));
  const maybeSent = new Set(request.maybeSentProfileIds ?? []);
  // An earlier attempt of this batch sent the profile and never heard back. If Klaviyo now shows it suppressed
  // since that request, that attempt was applied: it is done, not "no longer a candidate".
  const appliedByEarlierAttempt = (id: string, state: ProfileState | undefined): boolean => {
    const sentAt = attemptedAt.get(id);
    const ours = state?.suppressions?.find((x) => x.reason === "USER_SUPPRESSED");
    return Boolean(maybeSent.has(id) && sentAt && ours?.at && ours.at.getTime() >= sentAt.getTime() - SUPPRESSION_CLOCK_SKEW_MS);
  };

  // (a) Local checks: no Klaviyo request is spent on a profile that is already out.
  const hashes = [...new Set(profileIds.flatMap((id) => approvedHash.get(id) ?? []))];
  const bought = new Set<string>();
  for (const part of chunk(hashes, 90)) {
    const found = await db
      .select({ emailHash: schema.purchaseHashes.emailHash })
      .from(schema.purchaseHashes)
      .where(
        and(
          eq(schema.purchaseHashes.shop, request.shop),
          inArray(schema.purchaseHashes.emailHash, part),
          or(gte(schema.purchaseHashes.lastOrderAt, since), gte(schema.purchaseHashes.updatedAt, since)),
        ),
      );
    for (const row of found) bought.add(row.emailHash);
  }
  const remaining: string[] = [];
  for (const id of profileIds) {
    const hash = approvedHash.get(id);
    // No approved address on record (never had one, or customers/redact removed it): the approval covers nothing.
    if (!hash) skip(id, "email_hash_missing");
    else if (bought.has(hash)) skip(id, "purchased_since_simulation");
    else remaining.push(id);
  }

  // (b) Current state in Klaviyo: still in the candidate segment, same address, not suppressed.
  const states = new Map<string, ProfileState>();
  for (const ids of chunk(remaining, LIMITS.segmentMemberIdsPerLookup)) {
    for (const [id, state] of await getCandidateSegmentMemberStates(client, segmentId, ids)) states.set(id, state);
  }
  // A suppressed profile leaves the segment, so the ones we sent before are looked up directly.
  const leftAfterSend = remaining.filter((id) => maybeSent.has(id) && !states.has(id));
  const direct = new Map<string, ProfileState>();
  for (const ids of chunk(leftAfterSend, LIMITS.profileIdsPerLookup)) {
    for (const [id, state] of await getProfileStates(client, ids)) direct.set(id, state);
  }
  const emails: string[] = [];
  for (const id of remaining) {
    const state = states.get(id);
    if (appliedByEarlierAttempt(id, state ?? direct.get(id))) confirm(id);
    else if (!state) skip(id, "not_in_candidate_segment");
    else if (!state.email) skip(id, "no_email");
    else if (approvedHash.get(id) !== (await hashShopEmail(request.shop, state.email))) skip(id, "email_changed");
    else if (state.suppressions === null) skip(id, "state_unknown");
    else if (state.suppressions.length > 0) skip(id, "already_suppressed");
    // Sent exactly as Klaviyo holds it: an altered spelling could make Klaviyo create a new, suppressed profile.
    else emails.push(state.email);
  }
  return emails;
}

/**
 * The only two findings that keep a profile out of a restore. Pure, so the rule can be read and tested on its own.
 * All times in ms. `suppressedAt`: Klaviyo's timestamp of the profile's USER_SUPPRESSED entry. `requestedAt`: when
 * our request carrying the profile left (our clock). `jobCompletedAt`: Klaviyo's `completed_at` of the job that
 * carried it, when it could be read and is `complete`. `cleanupFinishedAt`: when the cleanup closed (our clock).
 */
export function undoEvidence(t: {
  suppressedAt: number | null | undefined;
  requestedAt: number | null | undefined;
  jobCompletedAt: number | null | undefined;
  cleanupFinishedAt: number | null | undefined;
}): "suppressed_before_cleanup" | "suppressed_after_cleanup" | null {
  const { suppressedAt, requestedAt, jobCompletedAt, cleanupFinishedAt } = t;
  if (typeof suppressedAt !== "number" || !Number.isFinite(suppressedAt)) return null;
  if (typeof requestedAt !== "number" || !Number.isFinite(requestedAt)) return null;
  if (suppressedAt < requestedAt - SUPPRESSION_EVIDENCE_MARGIN_MS) return "suppressed_before_cleanup";
  if (typeof jobCompletedAt !== "number" || !Number.isFinite(jobCompletedAt)) return null;
  if (typeof cleanupFinishedAt !== "number" || !Number.isFinite(cleanupFinishedAt)) return null;
  // A job cannot be complete before it was requested: if Klaviyo's time says so, the two clocks (or the job we
  // read) cannot be compared, and there is no upper bound.
  if (jobCompletedAt < requestedAt - SUPPRESSION_CLOCK_SKEW_MS) return null;
  if (suppressedAt > Math.max(jobCompletedAt, cleanupFinishedAt) + SUPPRESSION_EVIDENCE_MARGIN_MS) return "suppressed_after_cleanup";
  return null;
}

/** Undo: restores everything the cleanup may have suppressed, except what is provably not the cleanup's doing. */
async function selectForUndo(db: Db, client: KlaviyoClient, request: BatchRequest, profileIds: string[], skip: (id: string, reason: SkipReason) => void): Promise<string[]> {
  const undoRun = await db.query.runs.findFirst({ where: eq(schema.runs.id, request.runId), columns: { undoOfRunId: true } });
  const original = undoRun?.undoOfRunId
    ? await db.query.runs.findFirst({ where: eq(schema.runs.id, undoRun.undoOfRunId), columns: { id: true, startedAt: true, createdAt: true, finishedAt: true } })
    : null;

  const [undoRows, originalRows] = await Promise.all([
    db
      .select({ profileId: schema.runProfiles.profileId, emailHash: schema.runProfiles.emailHash })
      .from(schema.runProfiles)
      .where(and(eq(schema.runProfiles.runId, request.runId), eq(schema.runProfiles.batchIndex, request.batchIndex))),
    original
      ? Promise.all(
          chunk(profileIds, 50).map((part) =>
            db
              .select({ profileId: schema.runProfiles.profileId, attemptedAt: schema.runProfiles.attemptedAt, jobId: schema.runProfiles.klaviyoJobId, status: schema.runProfiles.status })
              .from(schema.runProfiles)
              .where(and(eq(schema.runProfiles.runId, original.id), inArray(schema.runProfiles.profileId, part))),
          ),
        ).then((parts) => parts.flat())
      : Promise.resolve([]),
  ]);
  const hashOf = new Map(undoRows.map((r) => [r.profileId, r.emailHash]));
  const sentBy = new Map(originalRows.map((r) => [r.profileId, r]));

  const remaining: string[] = [];
  for (const id of profileIds) {
    // customers/redact removed this customer's hash: nothing of theirs is processed again.
    if (!hashOf.get(id)) skip(id, "email_hash_missing");
    else remaining.push(id);
  }
  const states = new Map<string, ProfileState>();
  for (const ids of chunk(remaining, LIMITS.profileIdsPerLookup)) {
    for (const [id, state] of await getProfileStates(client, ids)) states.set(id, state);
  }

  // When did the cleanup's jobs finish? Only one half of the "suppressed again later" evidence, so a job is read
  // only for a profile whose suppression is dated well after the cleanup closed (normally none). Read-only and
  // best effort: a job that cannot be read, for whatever reason, gives no upper bound and its profiles are
  // restored. A failing read never holds a restore back.
  const cleanupFinishedAt = original?.finishedAt?.getTime();
  const userSuppressedAt = (id: string) => states.get(id)?.suppressions?.find((x) => x.reason === "USER_SUPPRESSED")?.at?.getTime();
  const completedAt = new Map<string, number>();
  const jobIds = new Set<string>();
  for (const id of remaining) {
    const sent = sentBy.get(id);
    const at = userSuppressedAt(id);
    if (!sent || sent.status !== "submitted" || !sent.jobId || sent.jobId === NO_JOB_ID) continue;
    if (at === undefined || cleanupFinishedAt === undefined || at <= cleanupFinishedAt + SUPPRESSION_EVIDENCE_MARGIN_MS) continue;
    jobIds.add(sent.jobId);
  }
  for (const jobId of [...jobIds].slice(0, MAX_JOB_LOOKUPS_PER_BATCH)) {
    try {
      const job = await getSuppressionJob(client, "suppress", jobId);
      if (job.status === "complete" && job.completedAt) completedAt.set(jobId, job.completedAt.getTime());
    } catch {
      // No upper bound for this job's profiles.
    }
  }

  const emails: string[] = [];
  for (const id of remaining) {
    const state = states.get(id);
    if (!state) {
      skip(id, "profile_gone");
      continue;
    }
    if (!state.email) {
      skip(id, "no_email");
      continue;
    }
    const sent = sentBy.get(id);
    const evidence = sent
      ? undoEvidence({
          suppressedAt: userSuppressedAt(id),
          // The earliest moment the request can have left: never later than the real one.
          requestedAt: (sent.attemptedAt ?? original?.startedAt ?? original?.createdAt)?.getTime(),
          jobCompletedAt: sent.status === "submitted" && sent.jobId ? completedAt.get(sent.jobId) : undefined,
          cleanupFinishedAt,
        })
      : null;
    if (evidence) skip(id, evidence);
    else emails.push(state.email);
  }
  return emails;
}

export function createSuppressionGateway(env: GatewayEnv, shop: string, deps: GatewayDeps = {}): SuppressionGateway {
  const clock = deps.now ?? (() => new Date());
  let segmentCheck: { id: string; at: number } | null = null;
  const seenUntil = new Map<string, Date>();

  return {
    async submitBatch(request: BatchRequest): Promise<BatchResult> {
      // Undo is never blocked by the switch: anything the app suppressed must stay reversible.
      if (request.kind !== "undo" && env.SUPPRESSION_ENABLED !== "true") refuse("suppression_disabled");
      if (!shop || request.shop !== shop) refuse("gateway_shop_mismatch");
      const profileIds = [...new Set(request.profileIds)];
      if (profileIds.length === 0 || profileIds.length > RUN_BATCH_SIZE) refuse("batch_invalid_size");

      const db = drizzle(env.DB, { schema });
      const connectionDeps = { db, env, fetch: deps.fetch, sleep: deps.sleep, now: deps.now };
      // True from the moment the request that changes Klaviyo is on its way: a failure after that is "outcome unknown".
      let sending = false;

      try {
        const connection = await getConnection(db, shop);
        if (!connection) refuse("klaviyo_not_connected");
        if (connection.status !== "connected") refuse(`klaviyo_${connection.status}`);
        if (request.kind !== "undo" && !suppressionAllowed(env, connection.klaviyoAccountId)) refuse("suppression_not_allowed_for_account");

        const client = createKlaviyoClient(connectionDeps, shop);
        const skipReasons: Record<string, string> = {};
        const skip = (id: string, reason: SkipReason) => void (skipReasons[id] = reason);
        const confirmed: string[] = [];

        let emails: string[];
        if (request.kind === "undo") {
          emails = await selectForUndo(db, client, request, profileIds, skip);
        } else {
          if (!segmentCheck || clock().getTime() - segmentCheck.at >= SEGMENT_CHECK_TTL_MS) {
            segmentCheck = { id: await usableCandidateSegment(db, client, env, shop, connection.klaviyoAccountId), at: clock().getTime() };
          }
          const since = seenUntil.get(request.runId) ?? (await ordersSeenUntil(db, request.runId));
          seenUntil.set(request.runId, since);
          emails = await revalidateForSuppress(db, client, request, profileIds, segmentCheck.id, since, skip, (id) => void confirmed.push(id));
        }

        const skipped = Object.keys(skipReasons);
        const toSend = [...new Set(emails)];
        const result = (jobId: string): BatchResult => ({ jobId, skippedProfileIds: skipped, skipReasons, ...(confirmed.length > 0 ? { confirmedProfileIds: confirmed } : {}) });
        if (toSend.length === 0) return result(NO_JOB_ID);
        await request.beforeSend?.(profileIds.filter((id) => !(id in skipReasons) && !confirmed.includes(id)));
        sending = true;
        const job = await submitSuppressionJob(client, request.kind === "undo" ? "unsuppress" : "suppress", toSend);
        return result(job.id);
      } catch (err) {
        // Before the write, or a definite rejection by Klaviyo (4xx): certainly not applied.
        const notSent = <E extends Error>(e: E): E => (!sending || (err instanceof KlaviyoError && !err.retryable) ? markNotSent(e) : e);
        if (err instanceof KlaviyoError) {
          // Codes only: these errors never carry tokens, emails or URLs.
          if (err.retryable) throw notSent(new Error(err.code));
          throw notSent(new NonRetryableError(err.code));
        }
        if (err instanceof NonRetryableError) throw err;
        if (err instanceof Error && err.message === "candidate_segment_processing") throw err;
        // Anything unexpected is reduced to a fixed code, so no detail of the batch can leak through a message.
        throw notSent(new Error("gateway_internal_error"));
      }
    },
  };
}
