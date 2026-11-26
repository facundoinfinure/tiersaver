import {
  CURRENT_PRICE_TABLES,
  estimateSavings,
  evaluateProfile,
  isKnownTierBoundary,
  purchaseDataIsFresh,
  quotePlan,
  validateRuleSettings,
  type CandidateReason,
  type ProtectionReason,
  type RuleSettings,
  type SimulationSummary,
  type SkipReason,
} from "@tiersaver/core";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import {
  buildCandidateSegmentDefinition,
  ensureCandidateSegment,
  getAccount,
  getCandidateSegment,
  getProfilesUsage,
  listCandidateSegmentProfilesPage,
  listGroupMemberIdsPage,
  listMetricsPage,
  listProfilesPage,
  type GroupKind,
  type KlaviyoMetric,
  type KlaviyoProfileRecord,
  type SegmentDefinition,
} from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";
import { SEEDED_METRIC_SPECS, SEED_CREATED_AT_PROPERTY } from "../klaviyo/config";
import { KlaviyoError } from "../klaviyo/errors";
import { candidateSegmentCoverage, toProfileSignals } from "../klaviyo/signals";
import { purchaseCoverage } from "../orders/sync";

/**
 * Scan engine: the audit and the simulation, computed in one pass as a chain
 * of small resumable steps. Like the run engine it has no Cloudflare imports,
 * so the same code runs inside a Workflow and in tests.
 *
 * A scan is read-only on the merchant's data with one exception that the
 * merchant granted a scope for: it keeps TierSaver's one managed segment up to
 * date. Nothing is suppressed here; the output is an unapproved simulation.
 *
 * Steps (each one is at most a handful of Klaviyo requests and D1 queries):
 *   load            settings and shop, fixed for the whole scan
 *   account         the token still belongs to the connected account
 *   segment         make sure the candidate segment has today's definition
 *   segment status  poll until Klaviyo finished computing it
 *   members N       one page (100) of segment members -> scan_profiles
 *   group G page N  protected group members -> flag in scan_profiles
 *   purchases sync  bring Shopify order data up to date (bounded; failure is not fatal)
 *   purchases coverage  how far that data reaches; stale or unknown protects everyone
 *   evaluate N      rules engine over 500 stored members
 *   segment verify  the definition did not change while we were reading
 *   usage / count   active profile count
 *   finalize        one transaction: audit + simulation + candidates, working rows deleted
 *
 * Safe failure everywhere: only members of a verified segment can become
 * candidates, every unknown protects, and a scan that fails for any reason
 * leaves no simulation behind.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: "constant" | "linear" | "exponential" };
  timeout?: string | number;
}

/** The part of Cloudflare's WorkflowStep the scan needs. */
export interface ScanSteps {
  do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

export interface ScanDeps {
  db: Db;
  step: ScanSteps;
  /** A Klaviyo client acting for the shop. Called once per step. */
  klaviyo: (shop: string) => KlaviyoClient;
  /** Builds the error that tells the step runner not to retry (Cloudflare's NonRetryableError). */
  nonRetryable: (code: string) => Error;
  now?: () => Date;
  /**
   * Klaviyo account id of the seeded test account (scripts/seed-klaviyo), from
   * the KLAVIYO_SEEDED_ACCOUNT_ID variable. When the connected account has
   * exactly this id AND Klaviyo flags it as a test account, the scan reads the
   * seeded data: API-owned metrics, the intended profile age from a profile
   * property, and no Shopify order history requirement. Never set for a
   * merchant; both conditions must hold.
   */
  seededAccountId?: string | null;
  /**
   * Brings the shop's Shopify order data up to date, a bounded number of pages
   * per call ("more" = call again). Always set in production (workers/scan.ts).
   * Without it, or when it fails, the scan uses the data as stored: if that is
   * not current, the purchase rule protects everyone.
   */
  syncPurchases?: (shop: string) => Promise<{ status: "fresh" | "more" | "busy" }>;
  limits?: Partial<ScanLimits>;
}

export interface ScanLimits {
  /** Pages of 100 segment members. Beyond this the scan fails instead of running out of Workflow steps. */
  maxMemberPages: number;
  /** Pages of 100 members per protected group. Beyond this, membership counts as unknown (protects everyone). */
  maxGroupPages: number;
  /** Polls while Klaviyo computes the segment. */
  maxSegmentPolls: number;
  /** Pages of 100 profiles for the fallback active-profile count, and how many per step. */
  maxCountPages: number;
  countPagesPerStep: number;
  /** Calls to `syncPurchases` before the scan goes on with the order data it has. */
  maxPurchaseSyncSteps: number;
}

/** Sized for Workers Free (1,024 steps per Workflow instance). Raise with Workers Paid. */
export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxMemberPages: 500,
  maxGroupPages: 150,
  maxSegmentPolls: 40,
  maxCountPages: 1500,
  countPagesPerStep: 10,
  maxPurchaseSyncSteps: 25,
};

const MEMBERS_PER_EVALUATE_STEP_PAGES = 5;
/** Klaviyo can take a while to apply a cleanup; a profile is not "active again" before this much time has passed. */
const RESURFACE_GRACE_MS = 72 * 60 * 60 * 1000;
/** D1 allows at most 100 bound parameters per statement. */
const ID_CHUNK = 90;

const KLAVIYO_STEP: StepConfig = { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" };
const SHOPIFY_STEP: StepConfig = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" };
const DB_STEP: StepConfig = { retries: { limit: 5, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" };

export type ScanOutcome =
  | { status: "completed"; scanId: string; simulationId: string; auditId: string; candidates: number }
  | { status: "failed"; scanId: string; error: string };

/** Why a scan found nobody even before reading members. Stored in the simulation's summary for the UI to explain. */
export type NoCandidatesNote = "received_metric_unresolved" | "open_metric_missing" | "click_metric_missing";

export interface ScanSummary extends SimulationSummary {
  /** Set when no segment could be defined for this account, so nobody was evaluated. */
  note?: NoCandidatesNote;
  /** True when membership of a protected group could not be read; everyone was then protected. */
  protectedGroupsUnknown?: boolean;
  /** True when the scan read the seeded test account (see ScanDeps.seededAccountId). */
  seededTestAccount?: boolean;
  /**
   * True when Shopify order data could not be brought up to date for this scan
   * (never read, or last read too long ago). Everyone evaluated was then
   * protected with insufficient_purchase_history.
   */
  purchaseDataStale?: boolean;
  /**
   * Cycle detector (docs/12-CUMPLIMIENTO-KLAVIYO.md 3.1, guardrail 6): profiles
   * a TierSaver cleanup suppressed that are active again without TierSaver
   * having restored them. They were kept active, are locked out of cleanups
   * like any restored profile, and the monthly schedule was paused.
   */
  resurfaced?: number;
}

interface PageCounts {
  candidates: Partial<Record<CandidateReason, number>>;
  protectedBy: Partial<Record<ProtectionReason, number>>;
  skippedBy: Partial<Record<SkipReason, number>>;
  candidateCount: number;
  protectedCount: number;
  skippedCount: number;
  /** Profiles a TierSaver cleanup suppressed that are active again without TierSaver restoring them (guardrail 6). */
  resurfaced: number;
}

function parseGroupRef(ref: string): { kind: GroupKind | null; id: string } {
  const match = /^(list|segment):(.+)$/.exec(ref);
  return match ? { kind: match[1] as GroupKind, id: match[2]! } : { kind: null, id: ref };
}

function ruleSettingsOf(row: typeof schema.settings.$inferSelect): RuleSettings {
  // Stored settings are already constrained by the table's CHECKs; validating again keeps the floors in one place.
  return validateRuleSettings({
    purchaseDays: row.purchaseDays,
    clickDays: row.clickDays,
    openDays: row.openDays,
    siteActivityDays: row.siteActivityDays,
    newProfileDays: row.newProfileDays,
    minEmailsReceived: row.minEmailsReceived,
    reactivationLockDays: row.reactivationLockDays,
    countMachineOpens: row.countMachineOpens,
  }).settings;
}

/** Records a new scan. The caller then starts the Workflow with the returned id. One scan at a time per shop. */
export async function createScan(
  db: Db,
  args: { shop: string; createdBy: string; origin?: "manual" | "scheduled"; now?: Date },
): Promise<{ ok: true; scanId: string } | { ok: false; reason: "scan_in_progress"; scanId: string }> {
  const now = args.now ?? new Date();
  // A scan that has been "running" for more than a day is dead (its Workflow is gone); it does not block a new one.
  const stale = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const open = await db.query.scans.findFirst({
    where: and(
      eq(schema.scans.shop, args.shop),
      sql`${schema.scans.status} IN ('queued', 'running')`,
      gt(schema.scans.createdAt, stale),
    ),
    orderBy: desc(schema.scans.createdAt),
  });
  if (open) return { ok: false, reason: "scan_in_progress", scanId: open.id };
  const scanId = crypto.randomUUID();
  await db.insert(schema.scans).values({
    id: scanId,
    shop: args.shop,
    origin: args.origin ?? "manual",
    createdBy: args.createdBy,
    createdAt: now,
  });
  return { ok: true, scanId };
}

export async function executeScan(deps: ScanDeps, scanId: string): Promise<ScanOutcome> {
  const { db, step } = deps;
  const limits = { ...DEFAULT_SCAN_LIMITS, ...deps.limits };
  const clock = deps.now ?? (() => new Date());
  const fail = (code: string) => deps.nonRetryable(code);

  /** Klaviyo errors that will not get better by retrying become non-retryable; codes only, never free text. */
  const klaviyoStep = <T>(name: string, work: () => Promise<T>): Promise<T> =>
    step.do(name, KLAVIYO_STEP, async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof KlaviyoError && !error.retryable) throw fail(error.code);
        throw error;
      }
    });

  try {
    // ---- load: everything the scan depends on, read once -----------------
    const plan = await step.do("load", DB_STEP, async () => {
      const scan = await db.query.scans.findFirst({ where: eq(schema.scans.id, scanId) });
      if (!scan) throw fail("scan_not_found");
      if (scan.status === "completed" || scan.status === "failed") throw fail(`scan_already_${scan.status}`);
      const [shop, settings, connection] = await Promise.all([
        db.query.shops.findFirst({ where: eq(schema.shops.shop, scan.shop) }),
        db.query.settings.findFirst({ where: eq(schema.settings.shop, scan.shop) }),
        db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, scan.shop) }),
      ]);
      if (!shop || shop.status !== "installed" || !settings) throw fail("shop_not_installed");
      if (!connection) throw fail("klaviyo_not_connected");
      if (connection.status !== "connected") throw fail(`klaviyo_${connection.status}`);

      const startedAt = scan.startedAt ?? clock();
      await db.update(schema.scans).set({ status: "running", startedAt }).where(eq(schema.scans.id, scanId));
      return {
        shop: scan.shop,
        origin: scan.origin,
        // Every date in the scan is relative to this instant, so a resumed scan decides the same.
        at: startedAt.toISOString(),
        settingsVersion: settings.version,
        rules: ruleSettingsOf(settings),
        protectedGroups: settings.protectedGroupIds,
        klaviyoPlan: settings.klaviyoPlan,
        klaviyoAccountId: connection.klaviyoAccountId,
        hasUsageScope: connection.scopes.split(/\s+/).includes("usage:read"),
        profilesUsageTypeId: connection.profilesUsageTypeId,
      };
    });
    const at = new Date(plan.at);
    const client = () => deps.klaviyo(plan.shop);

    // ---- account: still the account the merchant connected ---------------
    const account = await klaviyoStep("account", async () => {
      const found = await getAccount(client());
      if (found.id !== plan.klaviyoAccountId) throw fail("klaviyo_account_changed");
      return { seeded: Boolean(deps.seededAccountId) && found.id === deps.seededAccountId && found.testAccount === true };
    });
    const overrides = account.seeded ? SEEDED_METRIC_SPECS : {};

    // ---- segment: Klaviyo evaluates its own criteria ----------------------
    const segment = await klaviyoStep("segment", async () => {
      const metrics: KlaviyoMetric[] = [];
      let cursor: string | null = null;
      do {
        const page = await listMetricsPage(client(), { cursor });
        metrics.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && metrics.length < 2000);
      const built = buildCandidateSegmentDefinition(metrics, plan.rules, overrides);
      if (!built.ok) return { ok: false as const, note: built.reason };
      const ensured = await ensureCandidateSegment(client(), built.definition);
      return { ok: true as const, id: ensured.id, definition: built.definition, minEmailsReceived: built.minEmailsReceived };
    });

    let memberPages = 0;
    let memberCount = 0;
    let protectedGroupsUnknown = false;
    const totals: PageCounts = { candidates: {}, protectedBy: {}, skippedBy: {}, candidateCount: 0, protectedCount: 0, skippedCount: 0, resurfaced: 0 };
    let purchases: PurchaseCoverageRead = { since: null, until: null, stale: false };

    if (segment.ok) {
      const definition = segment.definition as SegmentDefinition;

      // ---- wait until Klaviyo has computed membership ---------------------
      let ready = false;
      for (let poll = 0; poll < limits.maxSegmentPolls && !ready; poll++) {
        const state = await klaviyoStep(`segment status ${poll}`, async () => {
          const s = await getCandidateSegment(client(), segment.id, definition);
          return { isProcessing: s.isProcessing, usable: s.isActive && s.definitionMatches };
        });
        if (!state.isProcessing) {
          if (!state.usable) throw fail("candidate_segment_unusable");
          ready = true;
        } else {
          await step.sleep(`segment wait ${poll}`, Math.min(15_000 * (poll + 1), 60_000));
        }
      }
      if (!ready) throw fail("candidate_segment_still_processing");

      // ---- members: one page per step ------------------------------------
      let cursor: string | null = null;
      for (;;) {
        if (memberPages >= limits.maxMemberPages) throw fail("too_many_segment_members");
        const pageIndex = memberPages;
        const pageCursor: string | null = cursor;
        const page = await klaviyoStep(`members ${pageIndex}`, async () => {
          const read = await listCandidateSegmentProfilesPage(client(), segment.id, {
            cursor: pageCursor,
            testCreatedAtProperty: account.seeded ? SEED_CREATED_AT_PROPERTY : undefined,
          });
          await storeMembers(db, scanId, plan.shop, pageIndex, read.items);
          return { count: read.items.length, nextCursor: read.nextCursor };
        });
        memberPages++;
        memberCount += page.count;
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      await step.do("members stored", DB_STEP, async () => {
        await db.update(schema.scans).set({ memberCount }).where(eq(schema.scans.id, scanId));
        return true;
      });

      // ---- protected groups: flag the members that belong to one ----------
      if (memberCount > 0) {
        for (let g = 0; g < plan.protectedGroups.length && !protectedGroupsUnknown; g++) {
          const ref = parseGroupRef(plan.protectedGroups[g]!);
          // An id stored without its kind is tried as a list first, then as a segment.
          const kinds: GroupKind[] = ref.kind ? [ref.kind] : ["list", "segment"];
          let read = false;
          for (const kind of kinds) {
            const result = await readProtectedGroup(deps, limits, scanId, plan.shop, { kind, id: ref.id }, g);
            if (result === "read") {
              read = true;
              break;
            }
            if (result === "too_large") break;
          }
          if (!read) protectedGroupsUnknown = true;
        }
        if (protectedGroupsUnknown) {
          await step.do("protected groups unknown", DB_STEP, async () => {
            // Membership could not be established: every member counts as protected.
            await db.update(schema.scanProfiles).set({ inProtectedGroup: null }).where(eq(schema.scanProfiles.scanId, scanId));
            return true;
          });
        }
      }

      // ---- purchases: refresh Shopify order data, then read how far it reaches ----
      // Done as late as possible, right before the rules run. A buyer must never become a candidate because
      // order data stopped being read: the rules only accept data that is current (purchaseDataIsFresh).
      if (memberCount > 0) purchases = await readPurchaseCoverage(deps, limits, plan.shop, account.seeded, at);

      // ---- evaluate: the rules engine, over stored facts ------------------
      const coverage = {
        ...candidateSegmentCoverage({ shopifyOrdersSince: purchases.since ? new Date(purchases.since) : null }),
        purchasesUntil: purchases.until ? new Date(purchases.until) : null,
      };
      for (let first = 0; first < memberPages; first += MEMBERS_PER_EVALUATE_STEP_PAGES) {
        const counts = await step.do(`evaluate ${first / MEMBERS_PER_EVALUATE_STEP_PAGES}`, DB_STEP, () =>
          evaluatePages(db, scanId, plan.shop, first, Math.min(first + MEMBERS_PER_EVALUATE_STEP_PAGES, memberPages), {
            rules: plan.rules,
            coverage,
            at,
            minEmailsReceived: segment.minEmailsReceived,
            seeded: account.seeded,
          }),
        );
        addCounts(totals, counts);
      }

      // ---- the segment must still be the one we read ----------------------
      await klaviyoStep("segment verify", async () => {
        const s = await getCandidateSegment(client(), segment.id, definition);
        if (s.isProcessing || !s.isActive || !s.definitionMatches) throw fail("candidate_segment_changed");
        return true;
      });
    }

    // ---- active profiles --------------------------------------------------
    const usage = plan.hasUsageScope
      ? await klaviyoStep("usage", async () => {
          const found = await getProfilesUsage(client(), plan.profilesUsageTypeId).catch(() => null);
          const u = found?.usage;
          return u && u.usageUsed !== null
            ? { used: u.usageUsed, max: u.usageMax, periodStart: u.periodStart?.toISOString() ?? null, periodEnd: u.periodEnd?.toISOString() ?? null }
            : null;
        })
      : null;

    const unsuppressedMembers = memberCount - (totals.skippedBy.already_suppressed ?? 0) - (totals.skippedBy.no_email ?? 0);
    let activeProfiles: number;
    let activeSource: "klaviyo_usage" | "counted";
    let suppressedProfiles: number | null = null;
    // Klaviyo refreshes its count about twice a day. A count below what we just read is stale, not usable.
    if (usage && usage.used >= unsuppressedMembers && usage.used > 0) {
      activeProfiles = Math.ceil(usage.used);
      activeSource = "klaviyo_usage";
    } else {
      let cursor: string | null = null;
      let active = 0;
      let suppressed = 0;
      for (let pages = 0; ; ) {
        if (pages >= limits.maxCountPages) throw fail("too_many_profiles_to_count");
        const stepCursor: string | null = cursor;
        const chunk: { active: number; suppressed: number; nextCursor: string | null } = await klaviyoStep(`count ${pages / limits.countPagesPerStep}`, async () => {
          let c: string | null = stepCursor;
          let a = 0;
          let s = 0;
          let read = 0;
          do {
            const page = await listProfilesPage(client(), { cursor: c });
            for (const p of page.items) {
              if (!p.emailHash) continue;
              const isSuppressed = (p.email?.suppressionReasons.length ?? 0) > 0 || p.email?.canReceiveMarketing === false;
              if (isSuppressed) s++;
              else a++;
            }
            c = page.nextCursor;
            read++;
          } while (c && read < limits.countPagesPerStep);
          return { active: a, suppressed: s, nextCursor: c };
        });
        pages += limits.countPagesPerStep;
        active += chunk.active;
        suppressed += chunk.suppressed;
        cursor = chunk.nextCursor;
        if (!cursor) break;
      }
      activeProfiles = Math.max(active, unsuppressedMembers);
      activeSource = "counted";
      suppressedProfiles = suppressed;
    }

    // ---- finalize: all or nothing ----------------------------------------
    const result = await step.do("finalize", DB_STEP, async () => {
      const done = await db.query.scans.findFirst({ where: eq(schema.scans.id, scanId) });
      if (done?.status === "completed" && done.simulationId && done.auditId) {
        return { simulationId: done.simulationId, auditId: done.auditId };
      }
      const finishedAt = clock();
      const table = plan.klaviyoPlan === "marketing" ? CURRENT_PRICE_TABLES.email_sms : CURRENT_PRICE_TABLES.email;
      const onFreePlan = usage?.max != null && usage.max < table.tiers[0]!.maxProfiles;
      const unknownTier = usage?.max != null && !onFreePlan && !isKnownTierBoundary(usage.max, table);
      const savings = estimateSavings({ profilesBefore: activeProfiles, profilesRemoved: totals.candidateCount, table, onFreePlan });
      const savingsCents = unknownTier ? 0 : savings.monthlySavingsCents;
      const savingsReason = unknownTier ? "unknown_tier" : savings.unavailableReason;

      // The monthly plan a list of this size needs (0 above the plans on sale, or when there is nothing to
      // suppress). Informational: what a cleanup may start with is decided at Shopify (billing/billing.ts).
      const planCents = totals.candidateCount > 0 ? quotePlan(activeProfiles).monthlyCents : 0;

      const summary: ScanSummary = {
        evaluated: memberCount,
        candidates: totals.candidateCount,
        protected: totals.protectedCount,
        skipped: totals.skippedCount,
        candidatesByReason: { never_engaged: totals.candidates.never_engaged ?? 0, lapsed: totals.candidates.lapsed ?? 0 },
        protectedByReason: totals.protectedBy,
        skippedByReason: totals.skippedBy,
        ...(segment.ok ? {} : { note: segment.note }),
        ...(protectedGroupsUnknown ? { protectedGroupsUnknown: true } : {}),
        ...(account.seeded ? { seededTestAccount: true } : {}),
        ...(purchases.stale ? { purchaseDataStale: true } : {}),
        ...(totals.resurfaced > 0 ? { resurfaced: totals.resurfaced } : {}),
      };
      const coverageStored = {
        engagementSince: segment.ok ? new Date(0).toISOString() : null,
        purchasesSince: purchases.since,
        purchasesUntil: purchases.until,
        siteActivitySince: segment.ok ? new Date(0).toISOString() : null,
      };

      const current = await db.query.settings.findFirst({ where: eq(schema.settings.shop, plan.shop), columns: { version: true } });
      const superseded = current?.version !== plan.settingsVersion;
      const simulationId = crypto.randomUUID();
      const auditId = crypto.randomUUID();

      await db.batch([
        db.insert(schema.audits).values({
          id: auditId,
          shop: plan.shop,
          createdAt: finishedAt,
          activeProfiles,
          activeProfilesSource: activeSource,
          inactiveProfiles: totals.candidateCount,
          suppressedProfiles,
          usageUsed: usage ? Math.round(usage.used) : null,
          usageMax: usage?.max ?? null,
          periodStart: usage?.periodStart ? new Date(usage.periodStart) : null,
          periodEnd: usage?.periodEnd ? new Date(usage.periodEnd) : null,
          tierCurrentMax: savings.tierBefore?.maxProfiles ?? null,
          tierPossibleMax: savings.tierAfter?.maxProfiles ?? null,
          estimatedMonthlySavingsCents: savingsCents,
          savingsUnavailableReason: savingsReason,
          priceTableId: table.id,
          ruleSettings: plan.rules,
        }),
        // A newer scan replaces any simulation that was not executed: there is one open simulation per shop.
        db
          .update(schema.simulations)
          .set({ supersededAt: finishedAt })
          .where(and(eq(schema.simulations.shop, plan.shop), isNull(schema.simulations.executedAt), isNull(schema.simulations.supersededAt))),
        db.insert(schema.simulations).values({
          id: simulationId,
          shop: plan.shop,
          origin: plan.origin,
          createdAt: finishedAt,
          settingsVersion: plan.settingsVersion,
          ruleSettings: plan.rules,
          coverage: coverageStored,
          summary,
          evaluatedCount: memberCount,
          candidateCount: totals.candidateCount,
          protectedCount: totals.protectedCount,
          skippedCount: totals.skippedCount,
          activeProfiles,
          activeProfilesSource: activeSource,
          tierBeforeMax: savings.tierBefore?.maxProfiles ?? null,
          tierAfterMax: savings.tierAfter?.maxProfiles ?? null,
          estimatedMonthlySavingsCents: savingsCents,
          estimatedFeeCents: planCents,
          priceTableId: table.id,
          // Rules changed while the scan ran: the result is kept for the record but cannot be approved.
          supersededAt: superseded ? finishedAt : null,
        }),
        // INSERT ... SELECT through the query builder: raw `db.run` cannot be part of a D1 batch.
        db.insert(schema.simulationCandidates).select(
          db
            .select({
              simulationId: sql<string>`${simulationId}`.as("simulation_id"),
              profileId: schema.scanProfiles.profileId,
              reason: sql<string>`${schema.scanProfiles.reason}`.as("reason"),
              emailHash: schema.scanProfiles.emailHash,
            })
            .from(schema.scanProfiles)
            .where(and(eq(schema.scanProfiles.scanId, scanId), eq(schema.scanProfiles.decision, "candidate"))),
        ),
        // Cycle detected: stop scheduling cleanups until the merchant has looked (no version bump: rules did not change).
        ...(totals.resurfaced > 0
          ? [
              db.update(schema.settings).set({ scheduleEnabled: false, mode: "approval", updatedAt: finishedAt }).where(eq(schema.settings.shop, plan.shop)),
              db.insert(schema.eventsLog).values({
                id: crypto.randomUUID(),
                shop: plan.shop,
                at: finishedAt,
                actor: "system",
                action: "schedule.paused_cycle_detected",
                simulationId,
                detail: { scanId, resurfaced: totals.resurfaced },
              }),
            ]
          : []),
        db.delete(schema.scanProfiles).where(eq(schema.scanProfiles.scanId, scanId)),
        db
          .update(schema.scans)
          .set({ status: "completed", simulationId, auditId, memberCount, finishedAt, lastError: null })
          .where(eq(schema.scans.id, scanId)),
        db.insert(schema.eventsLog).values({
          id: crypto.randomUUID(),
          shop: plan.shop,
          at: finishedAt,
          actor: "system",
          action: "scan.completed",
          simulationId,
          detail: { scanId, activeProfiles, activeProfilesSource: activeSource, evaluated: memberCount, candidates: totals.candidateCount },
        }),
      ]);
      return { simulationId, auditId };
    });

    return { status: "completed", scanId, simulationId: result.simulationId, auditId: result.auditId, candidates: totals.candidateCount };
  } catch (error) {
    const code = errorCode(error);
    await step.do("fail", DB_STEP, async () => {
      await db.batch([
        db.delete(schema.scanProfiles).where(eq(schema.scanProfiles.scanId, scanId)),
        db
          .update(schema.scans)
          .set({ status: "failed", lastError: code, finishedAt: clock() })
          .where(and(eq(schema.scans.id, scanId), sql`${schema.scans.status} <> 'completed'`)),
      ]);
      return true;
    });
    return { status: "failed", scanId, error: code };
  }
}

interface PurchaseCoverageRead {
  /** ISO dates; null = unknown. */
  since: string | null;
  until: string | null;
  /** The data is not current as of the scan: the purchase rule protects everyone evaluated. */
  stale: boolean;
}

/**
 * Brings Shopify order data up to date (when the scan was given the means) and
 * reads how far it reaches. Refreshing is best effort: whatever goes wrong, the
 * scan goes on with what is stored, and data that is not current protects
 * everyone. The seeded test account has no Shopify orders behind it.
 */
async function readPurchaseCoverage(deps: ScanDeps, limits: ScanLimits, shop: string, seeded: boolean, at: Date): Promise<PurchaseCoverageRead> {
  const { db, step } = deps;
  if (seeded) return { since: new Date(0).toISOString(), until: at.toISOString(), stale: false };
  if (deps.syncPurchases) {
    const sync = deps.syncPurchases;
    try {
      for (let i = 0; i < limits.maxPurchaseSyncSteps; i++) {
        const { status } = await step.do(`purchases sync ${i}`, SHOPIFY_STEP, async () => ({ status: (await sync(shop)).status }));
        if (status === "fresh") break;
        // Another runner (the hourly sync) is reading the same orders right now: give it a moment.
        if (status === "busy") await step.sleep(`purchases wait ${i}`, 15_000);
      }
    } catch {
      // Not fatal, and never optimistic: the coverage read below decides.
    }
  }
  return step.do("purchases coverage", DB_STEP, async () => {
    const found = await purchaseCoverage(db, shop);
    return {
      since: found.since?.toISOString() ?? null,
      until: found.until?.toISOString() ?? null,
      stale: !found.since || !purchaseDataIsFresh(found.until, at),
    };
  });
}

/** A short code for `scans.last_error`. Our own errors carry codes as messages; anything else is not copied. */
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : "scan_failed";
}

function addCounts(total: PageCounts, page: PageCounts): void {
  total.candidateCount += page.candidateCount;
  total.protectedCount += page.protectedCount;
  total.skippedCount += page.skippedCount;
  total.resurfaced += page.resurfaced;
  for (const [k, n] of Object.entries(page.candidates)) total.candidates[k as CandidateReason] = (total.candidates[k as CandidateReason] ?? 0) + n;
  for (const [k, n] of Object.entries(page.protectedBy)) total.protectedBy[k as ProtectionReason] = (total.protectedBy[k as ProtectionReason] ?? 0) + n;
  for (const [k, n] of Object.entries(page.skippedBy)) total.skippedBy[k as SkipReason] = (total.skippedBy[k as SkipReason] ?? 0) + n;
}

/** Stores one page of members. Repeating the page (a retried step) changes nothing. */
async function storeMembers(db: Db, scanId: string, shop: string, page: number, members: readonly KlaviyoProfileRecord[]): Promise<void> {
  if (members.length === 0) return;
  const insert = db.$client.prepare(
    "INSERT INTO scan_profiles (scan_id, profile_id, shop, page, email_hash, facts) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (scan_id, profile_id) DO NOTHING",
  );
  await db.$client.batch(members.map((m) => insert.bind(scanId, m.id, shop, page, m.emailHash, JSON.stringify(m))));
}

/**
 * Flags the scan's members that belong to one protected group, page by page.
 * "read" = the whole group was read; "missing" = it does not exist as this
 * kind (404); "too_large" = more pages than the limit. Anything but "read"
 * leaves membership unknown.
 */
async function readProtectedGroup(
  deps: ScanDeps,
  limits: ScanLimits,
  scanId: string,
  shop: string,
  group: { kind: GroupKind; id: string },
  index: number,
): Promise<"read" | "missing" | "too_large"> {
  let cursor: string | null = null;
  for (let page = 0; page < limits.maxGroupPages; page++) {
    const pageCursor: string | null = cursor;
    const result = await deps.step.do(`group ${index} ${group.kind} page ${page}`, KLAVIYO_STEP, async () => {
      let read;
      try {
        read = await listGroupMemberIdsPage(deps.klaviyo(shop), group, { cursor: pageCursor });
      } catch (error) {
        if (error instanceof KlaviyoError && !error.retryable) {
          // Gone, not this kind of group, or not readable: the caller treats membership as unknown.
          if (error.status === 404 || error.status === 400) return { missing: true as const, nextCursor: null };
          throw deps.nonRetryable(error.code);
        }
        throw error;
      }
      for (let i = 0; i < read.items.length; i += ID_CHUNK) {
        const ids = read.items.slice(i, i + ID_CHUNK);
        await deps.db.run(sql`
          UPDATE scan_profiles SET in_protected_group = 1
          WHERE scan_id = ${scanId} AND profile_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
      }
      return { missing: false as const, nextCursor: read.nextCursor };
    });
    if (result.missing) return "missing";
    cursor = result.nextCursor;
    if (!cursor) return "read";
  }
  return "too_large";
}

interface StoredRow {
  profile_id: string;
  facts: string;
  in_protected_group: number | null;
  last_order_at: number | null;
  reactivated_at: number | null;
}

function reviveRecord(json: string): KlaviyoProfileRecord {
  const raw = JSON.parse(json) as Record<string, unknown> & { email?: Record<string, unknown> | null };
  const date = (v: unknown) => (typeof v === "string" ? new Date(v) : null);
  return {
    ...(raw as unknown as KlaviyoProfileRecord),
    createdAt: date(raw.createdAt),
    lastEventAt: date(raw.lastEventAt),
    email: raw.email ? ({ ...raw.email, consentAt: date(raw.email.consentAt) } as KlaviyoProfileRecord["email"]) : null,
    ...("testCreatedAt" in raw ? { testCreatedAt: date(raw.testCreatedAt) } : {}),
  };
}

/** Runs the rules engine over the members stored in pages [firstPage, endPage) and writes each decision. */
async function evaluatePages(
  db: Db,
  scanId: string,
  shop: string,
  firstPage: number,
  endPage: number,
  ctx: { rules: RuleSettings; coverage: ReturnType<typeof candidateSegmentCoverage>; at: Date; minEmailsReceived: number; seeded: boolean },
): Promise<PageCounts> {
  const counts: PageCounts = { candidates: {}, protectedBy: {}, skippedBy: {}, candidateCount: 0, protectedCount: 0, skippedCount: 0, resurfaced: 0 };
  const update = db.$client.prepare("UPDATE scan_profiles SET decision = ?, reason = ? WHERE scan_id = ? AND profile_id = ?");

  const atMs = ctx.at.getTime();
  for (let page = firstPage; page < endPage; page++) {
    // Cycle detector. A member of the segment is not suppressed. If our own history says a cleanup suppressed
    // this email and we never restored it, someone unsuppressed it outside TierSaver. Stamp it as restored now:
    // from here on it is locked out of every cleanup like any restored profile. The grace period covers Klaviyo
    // still processing a recent cleanup's jobs. The stamp is the scan's own instant, so a retried step finds
    // (and counts) the same rows again.
    await db.$client
      .prepare(
        `UPDATE run_profiles SET reactivated_at = ?1
         WHERE shop = ?2 AND status = 'submitted' AND reactivated_at IS NULL AND updated_at < ?3
           AND run_id IN (SELECT id FROM runs WHERE shop = ?2 AND kind = 'suppress')
           AND email_hash IN (SELECT email_hash FROM scan_profiles WHERE scan_id = ?4 AND page = ?5 AND email_hash IS NOT NULL)`,
      )
      .bind(atMs, shop, atMs - RESURFACE_GRACE_MS, scanId, page)
      .run();

    // Shopify buyers are matched by email hash; a restore is found in our own run history, also by hash.
    const { results } = await db.$client
      .prepare(
        `SELECT sp.profile_id, sp.facts, sp.in_protected_group, ph.last_order_at,
                (SELECT MAX(rp.reactivated_at) FROM run_profiles rp WHERE rp.shop = sp.shop AND rp.email_hash = sp.email_hash) AS reactivated_at
         FROM scan_profiles sp
         LEFT JOIN purchase_hashes ph ON ph.shop = sp.shop AND ph.email_hash = sp.email_hash
         WHERE sp.scan_id = ? AND sp.page = ? AND sp.shop = ?`,
      )
      .bind(scanId, page, shop)
      .all<StoredRow>();
    if (results.length === 0) continue;

    const writes: D1PreparedStatement[] = [];
    for (const row of results) {
      const { signals } = toProfileSignals(reviveRecord(row.facts), {
        candidateSegment: { minEmailsReceived: ctx.minEmailsReceived },
        shopifyLastPurchaseAt: row.last_order_at !== null ? new Date(row.last_order_at) : null,
        inProtectedGroup: row.in_protected_group === null ? null : row.in_protected_group === 1,
        reactivatedAt: row.reactivated_at !== null ? new Date(row.reactivated_at) : null,
        useTestCreatedAt: ctx.seeded,
      });
      if (row.reactivated_at === atMs) counts.resurfaced++;
      const decision = evaluateProfile(signals, ctx.rules, ctx.coverage, ctx.at);
      if (decision.kind === "candidate") {
        counts.candidateCount++;
        counts.candidates[decision.reason] = (counts.candidates[decision.reason] ?? 0) + 1;
        writes.push(update.bind("candidate", decision.reason, scanId, row.profile_id));
      } else if (decision.kind === "protected") {
        counts.protectedCount++;
        for (const r of decision.reasons) counts.protectedBy[r] = (counts.protectedBy[r] ?? 0) + 1;
        writes.push(update.bind("protected", decision.reasons.join("+"), scanId, row.profile_id));
      } else {
        counts.skippedCount++;
        counts.skippedBy[decision.reason] = (counts.skippedBy[decision.reason] ?? 0) + 1;
        writes.push(update.bind("skipped", decision.reason, scanId, row.profile_id));
      }
    }
    await db.$client.batch(writes);
  }
  return counts;
}
