import { DEFAULT_RULE_SETTINGS, RULE_LIMITS, SIMULATION_TTL_MS } from "@tiersaver/core";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CHARGE_HOLD_HOURS, runsWithOpenCharges, settleRunCharge, subscriptionTerms, type AdminGraphql } from "../app/billing/billing";
import { KlaviyoClient } from "../app/klaviyo/client";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { saveConnection } from "../app/klaviyo/connection.server";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { chargedWithoutWindow, recordUnpaidCleanups } from "../app/billing/unpaid";
import { deleteShopData } from "../app/data/privacy";
import { advanceChargeConfirmation } from "../app/runs/confirm";
import { createSuppressionRun, createUndoRun, executeRun, renewalSince } from "../app/runs/engine";
import { createSuppressionGateway, type GatewayEnv } from "../app/runs/gateway.server";
import { approveAutomatically, decideAutomatic } from "../app/schedule/automatic";
import { decideSchedule, runScheduleTick } from "../app/schedule/schedule";
import { saveSettings, type SettingsInput } from "../app/settings/settings";
import { approveSimulation, candidatesCsvPart, csvCell, latestSimulation } from "../app/simulations/review";
import { FakeGateway, FakeSteps, db, profileStatuses, schema, seedSimulation, uniqueShop } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

describe("approving a simulation", () => {
  it("needs the acknowledgement and an identified Shopify user", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 3, approved: false });
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "user:7", acknowledged: false })).toEqual({ ok: false, reason: "not_acknowledged" });
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "system", acknowledged: true })).toEqual({ ok: false, reason: "approver_unknown" });
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "automatic", acknowledged: true })).toEqual({ ok: false, reason: "approver_unknown" });
    expect((await latestSimulation(db, shop))?.state).toBe("open");
  });

  it("records who approved and logs it, once", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 3, approved: false });
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "user:7", acknowledged: true })).toEqual({ ok: true });
    const sim = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) });
    expect(sim?.approvedBy).toBe("user:7");
    expect((await latestSimulation(db, shop))?.state).toBe("approved");
    const log = await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.simulationId, simulationId) });
    expect(log.map((l) => [l.action, l.actor])).toEqual([["simulation.approved", "user:7"]]);
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "user:8", acknowledged: true })).toEqual({ ok: false, reason: "already_approved" });
  });

  it("refuses an expired, superseded, empty or foreign simulation", async () => {
    const old = await seedSimulation({ candidates: 2, approved: false, createdAt: new Date(Date.now() - SIMULATION_TTL_MS - 1000) });
    expect(await approveSimulation(db, { shop: old.shop, simulationId: old.simulationId, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: false, reason: "expired" });

    const changed = await seedSimulation({ candidates: 2, approved: false });
    await db.update(schema.settings).set({ version: 2 }).where(eq(schema.settings.shop, changed.shop));
    expect(await approveSimulation(db, { shop: changed.shop, simulationId: changed.simulationId, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: false, reason: "superseded" });

    const empty = await seedSimulation({ candidates: 0, approved: false });
    expect(await approveSimulation(db, { shop: empty.shop, simulationId: empty.simulationId, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: false, reason: "no_candidates" });

    const mine = await seedSimulation({ candidates: 2, approved: false });
    expect(await approveSimulation(db, { shop: uniqueShop(), simulationId: mine.simulationId, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("candidate CSV", () => {
  const client = (fake: FakeKlaviyo) => new KlaviyoClient({ getAccessToken: async () => fake.issueTokens(KLAVIYO_SCOPES.join(" ")).accessToken, fetch: fake.fetch, sleep: async () => {} });

  it("lists candidates with their current email, only while the simulation is open", async () => {
    const fake = new FakeKlaviyo();
    const { shop, simulationId, profileIds } = await seedSimulation({ candidates: 3, approved: false });
    fake.profiles.set(profileIds[0]!, { id: profileIds[0]!, email: "a@shop-customer.test" });
    fake.profiles.set(profileIds[1]!, { id: profileIds[1]!, email: "=cmd@shop-customer.test" });
    // profileIds[2] no longer exists in Klaviyo.

    const result = await candidatesCsvPart(db, client(fake), { shop, simulationId, part: 1 });
    if (!result.ok) throw new Error(result.reason);
    const lines = result.csv.trim().split("\r\n");
    expect(lines[0]).toBe("klaviyo_profile_id,email,reason,klaviyo_profile_url");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"a@shop-customer.test"');
    expect(lines[2]).toContain(`"'=cmd@shop-customer.test"`); // formula neutralised
    expect(lines[3]).toContain(`"${profileIds[2]}","",`);
    expect((await candidatesCsvPart(db, client(fake), { shop, simulationId, part: 2 })).ok).toBe(false);

    // Nothing of the download is stored.
    const stored = JSON.stringify(await env.DB.prepare("SELECT * FROM simulation_candidates WHERE simulation_id = ?").bind(simulationId).all());
    expect(stored).not.toContain("shop-customer.test");

    // Guardrail 7: once approved it is no longer a review list.
    await approveSimulation(db, { shop, simulationId, approvedBy: "user:1", acknowledged: true });
    expect(await candidatesCsvPart(db, client(fake), { shop, simulationId, part: 1 })).toEqual({ ok: false, reason: "not_reviewable" });
  });

  it("is refused for another shop", async () => {
    const fake = new FakeKlaviyo();
    const { simulationId } = await seedSimulation({ candidates: 1, approved: false });
    expect(await candidatesCsvPart(db, client(fake), { shop: uniqueShop(), simulationId, part: 1 })).toEqual({ ok: false, reason: "not_found" });
  });

  it("quotes cells", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("+1")).toBe(`"'+1"`);
  });
});

async function finishedCleanup(candidates = 5) {
  const { shop, simulationId, profileIds } = await seedSimulation({ candidates });
  const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  const outcome = await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, created.runId);
  expect(outcome.status).toBe("completed");
  return { shop, simulationId, profileIds, runId: created.runId };
}

describe("undo", () => {
  it("asks for confirmation when a renewal cannot be ruled out, then restores exactly what was suppressed", async () => {
    const { shop, runId, profileIds } = await finishedCleanup(5);
    const first = await createUndoRun(db, { shop, runId, createdBy: "user:2" });
    expect(first).toEqual({ ok: false, reason: "needs_renewal_confirmation", renewal: "unknown" });
    expect(await db.query.runs.findMany({ where: eq(schema.runs.undoOfRunId, runId) })).toHaveLength(0);

    const undo = await createUndoRun(db, { shop, runId, createdBy: "user:2", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    expect(undo.totalCount).toBe(5);

    // A second undo cannot start while one is open.
    expect(await createUndoRun(db, { shop, runId, createdBy: "user:2", confirmAfterRenewal: true })).toMatchObject({ ok: false, reason: "undo_in_progress" });

    const gateway = new FakeGateway();
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, undo.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 5 });
    expect(gateway.calls.every((c) => c.kind === "undo")).toBe(true);
    expect(new Set(gateway.calls.flatMap((c) => c.profileIds))).toEqual(new Set(profileIds));

    // The original rows carry the restore stamp the scan uses for the 365-day lock.
    const original = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(original.every((p) => p.reactivatedAt !== null)).toBe(true);
    expect(await createUndoRun(db, { shop, runId, createdBy: "user:2", confirmAfterRenewal: true })).toMatchObject({ ok: false, reason: "nothing_to_restore" });

    const log = await db.query.eventsLog.findFirst({ where: eq(schema.eventsLog.runId, undo.runId) });
    expect(log).toMatchObject({ action: "undo.created", actor: "user:2" });
  });

  it("does not need the confirmation when Klaviyo's billing period has not ended", async () => {
    const { shop, runId } = await finishedCleanup(2);
    await db.insert(schema.audits).values({ id: crypto.randomUUID(), shop, activeProfiles: 10, inactiveProfiles: 2, priceTableId: "t", ruleSettings: {}, periodEnd: new Date(Date.now() + 10 * DAY) });
    const undo = await createUndoRun(db, { shop, runId, createdBy: "user:2" });
    expect(undo.ok).toBe(true);
  });

  it("only restores profiles the cleanup actually sent, and never touches another shop's run", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 4 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error("setup");
    const gateway = new FakeGateway();
    gateway.skip = (request) => request.profileIds.slice(0, 1);
    await executeRun({ db, gateway, step: new FakeSteps() }, created.runId);
    expect(await profileStatuses(created.runId)).toEqual({ submitted: 3, skipped: 1 });

    expect(await createUndoRun(db, { shop: uniqueShop(), runId: created.runId, createdBy: "user:2", confirmAfterRenewal: true })).toEqual({ ok: false, reason: "not_found" });
    const undo = await createUndoRun(db, { shop, runId: created.runId, createdBy: "user:2", confirmAfterRenewal: true });
    expect(undo).toMatchObject({ ok: true, totalCount: 3 });
  });

  it("works with the real gateway while SUPPRESSION_ENABLED is absent", async () => {
    const fake = new FakeKlaviyo();
    const { shop, runId, profileIds } = await finishedCleanup(2);
    for (const id of profileIds) fake.profiles.set(id, { id, email: `${id.toLowerCase()}@shop-customer.test` });
    const gatewayEnv: GatewayEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))), KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret };
    const tokens = fake.issueTokens(KLAVIYO_SCOPES.join(" "));
    await saveConnection({ db, env: gatewayEnv }, { shop, klaviyoAccountId: fake.accountId, tokens: { ...tokens, expiresAt: new Date(Date.now() + 3600_000), scope: KLAVIYO_SCOPES.join(" ") } });
    const undo = await createUndoRun(db, { shop, runId, createdBy: "user:2", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    const outcome = await executeRun({ db, gateway: createSuppressionGateway(gatewayEnv, shop, { fetch: fake.fetch, sleep: async () => {} }), step: new FakeSteps() }, undo.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 2 });
    expect(fake.requests.some((r) => r.url.pathname.includes("profile-suppression-bulk-delete-jobs"))).toBe(true);
    // The cleanup's own jobs may be READ (when did they finish?); nothing is ever suppressed by an undo.
    expect(fake.requests.some((r) => r.method !== "GET" && r.url.pathname.includes("profile-suppression-bulk-create-jobs"))).toBe(false);
  });

  it("renewalSince", () => {
    const finished = new Date("2026-11-10T12:00:00Z");
    expect(renewalSince(finished, new Date("2026-11-20T00:00:00Z"), { periodEnds: [new Date("2026-12-01T05:00:00Z")], billingDay: null })).toBe("no");
    expect(renewalSince(finished, new Date("2026-12-02T00:00:00Z"), { periodEnds: [new Date("2026-12-01T05:00:00Z")], billingDay: null })).toBe("yes");
    expect(renewalSince(finished, new Date("2026-11-14T00:00:00Z"), { periodEnds: [], billingDay: 15 })).toBe("no");
    expect(renewalSince(finished, new Date("2026-11-15T09:00:00Z"), { periodEnds: [], billingDay: 15 })).toBe("yes");
    expect(renewalSince(finished, new Date("2026-11-20T00:00:00Z"), { periodEnds: [new Date("2026-11-01T05:00:00Z")], billingDay: null })).toBe("unknown");
    expect(renewalSince(finished, new Date("2026-12-20T00:00:00Z"), { periodEnds: [], billingDay: null })).toBe("yes");
  });
});

const baseInput = (over: Partial<SettingsInput> = {}): SettingsInput => ({
  ruleMode: "recommended",
  protectedGroupIds: [],
  billingDay: null,
  leadDays: 5,
  scheduleEnabled: false,
  mode: "approval",
  ...over,
});

describe("settings", () => {
  it("keeps the floors, and a rules change supersedes the open simulation", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 2, approved: false });
    const below = await saveSettings(db, { shop, actor: "user:1", input: baseInput({ ruleMode: "wider", clickDays: RULE_LIMITS.clickDays.min - 1, purchaseDays: 100 }) });
    expect(below.ok).toBe(false);
    expect((await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) }))?.version).toBe(1);

    const saved = await saveSettings(db, { shop, actor: "user:1", input: baseInput({ ruleMode: "wider", clickDays: 200, protectedGroupIds: ["list:AbC123", "segment:Xyz9"] }) });
    expect(saved).toMatchObject({ ok: true, versionBumped: true, version: 2 });
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) });
    expect(row).toMatchObject({ clickDays: 200, purchaseDays: null, protectedGroupIds: ["list:AbC123", "segment:Xyz9"], reactivationLockDays: 365 });
    expect((await latestSimulation(db, shop))?.state).toBe("superseded");
    expect(await approveSimulation(db, { shop, simulationId, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: false, reason: "superseded" });

    // Back to the recommended criteria.
    await saveSettings(db, { shop, actor: "user:1", input: baseInput() });
    expect(await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) })).toMatchObject({ clickDays: null, newProfileDays: DEFAULT_RULE_SETTINGS.newProfileDays, version: 3 });
  });

  it("a schedule-only change does not supersede anything", async () => {
    const { shop } = await seedSimulation({ candidates: 2, approved: false });
    expect(await saveSettings(db, { shop, actor: "user:1", input: baseInput({ billingDay: 12, scheduleEnabled: true }) })).toMatchObject({ ok: true, versionBumped: false, version: 1 });
    expect((await latestSimulation(db, shop))?.state).toBe("open");
    expect(await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) })).toMatchObject({ billingDay: 12, billingDaySource: "merchant", scheduleEnabled: true });
  });

  it("automatic mode only with Klaviyo's criteria and the schedule on; bad group ids and days are rejected", async () => {
    const { shop } = await seedSimulation({ candidates: 1 });
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ ruleMode: "wider", openDays: 200, mode: "automatic", scheduleEnabled: true }) })).ok).toBe(false);
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ mode: "automatic", scheduleEnabled: false }) })).ok).toBe(false);
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ protectedGroupIds: ["AbC123"] }) })).ok).toBe(false);
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ billingDay: 32 }) })).ok).toBe(false);
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ leadDays: 3 }) })).ok).toBe(false);
    expect((await saveSettings(db, { shop, actor: "user:1", input: baseInput({ mode: "automatic", scheduleEnabled: true, billingDay: 3 }) })).ok).toBe(true);
  });
});

describe("monthly schedule", () => {
  const row = (over: Partial<Parameters<typeof decideSchedule>[0]> = {}) => ({ shop: "s.myshopify.com", timezone: "UTC", billingDay: 20, leadDays: 5, lastPeriodEnd: null, lastScheduledScanAt: null, ...over });

  it("is due on the preferred day and until the last safe day, once per cycle", () => {
    expect(decideSchedule(row(), new Date("2026-11-14T10:00:00Z"))).toMatchObject({ due: false, reason: "not_today", runOn: "2026-11-15" });
    expect(decideSchedule(row(), new Date("2026-11-15T10:00:00Z"))).toMatchObject({ due: true, billingDate: "2026-11-20" });
    expect(decideSchedule(row(), new Date("2026-11-16T10:00:00Z"))).toMatchObject({ due: true }); // still 4 days ahead
    expect(decideSchedule(row(), new Date("2026-11-17T10:00:00Z"))).toMatchObject({ due: false, reason: "not_today", billingDate: "2026-12-20" });
    expect(decideSchedule(row({ lastScheduledScanAt: new Date("2026-11-15T10:00:00Z") }), new Date("2026-11-16T10:00:00Z"))).toMatchObject({ due: false, reason: "already_scheduled_this_cycle" });
  });

  it("falls back to the renewal day Klaviyo reported, and does nothing without one", () => {
    expect(decideSchedule(row({ billingDay: null }), new Date("2026-11-15T10:00:00Z"))).toMatchObject({ due: false, reason: "no_billing_day" });
    expect(decideSchedule(row({ billingDay: null, lastPeriodEnd: new Date("2026-12-01T05:00:00Z") }), new Date("2026-11-26T10:00:00Z"))).toMatchObject({ due: true, billingDate: "2026-12-01" });
  });

  it("a tick starts scans only for shops that opted in and are connected", async () => {
    const now = new Date("2026-11-15T10:00:00Z");
    const fake = new FakeKlaviyo();
    const secrets = { TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))), KLAVIYO_CLIENT_ID: fake.clientId, KLAVIYO_CLIENT_SECRET: fake.clientSecret };
    const connect = async (shop: string) => {
      const tokens = fake.issueTokens(KLAVIYO_SCOPES.join(" "));
      await saveConnection({ db, env: secrets }, { shop, klaviyoAccountId: fake.accountId, tokens: { ...tokens, expiresAt: new Date(Date.now() + 3600_000), scope: KLAVIYO_SCOPES.join(" ") } });
    };
    const on = (await seedSimulation({ candidates: 1 })).shop;
    const off = (await seedSimulation({ candidates: 1 })).shop;
    const notConnected = (await seedSimulation({ candidates: 1 })).shop;
    await connect(on);
    await connect(off);
    await db.update(schema.settings).set({ scheduleEnabled: true, billingDay: 20 }).where(eq(schema.settings.shop, on));
    await db.update(schema.settings).set({ billingDay: 20 }).where(eq(schema.settings.shop, off));
    await db.update(schema.settings).set({ scheduleEnabled: true, billingDay: 20 }).where(eq(schema.settings.shop, notConnected));

    const started: string[] = [];
    const tick = await runScheduleTick({ db, now, startScan: async (a) => (started.push(a.shop), { scanId: "x", started: true }) });
    expect(started.filter((s) => [on, off, notConnected].includes(s))).toEqual([on]);
    expect(tick.started).toContain(on);
  });
});

describe("automatic mode", () => {
  async function scheduledSimulation() {
    const { shop, simulationId } = await seedSimulation({ candidates: 2, approved: false });
    await db.update(schema.simulations).set({ origin: "scheduled" }).where(eq(schema.simulations.id, simulationId));
    return { shop, simulationId };
  }

  it("never runs for a shop without an earlier cleanup approved by a person", async () => {
    const { shop, simulationId } = await scheduledSimulation();
    await db.update(schema.settings).set({ mode: "automatic", scheduleEnabled: true }).where(eq(schema.settings.shop, shop));
    expect(await decideAutomatic(db, { shop, simulationId })).toEqual({ run: false, reason: "no_manual_run_yet" });
  });

  it("runs only in automatic mode, with recommended rules, for a scheduled simulation", async () => {
    const { shop } = await finishedCleanup(2); // approved by user:1 and completed
    const simulationId = crypto.randomUUID();
    const base = { id: simulationId, shop, origin: "scheduled" as const, settingsVersion: 1, ruleSettings: {}, coverage: {}, summary: {}, evaluatedCount: 5, candidateCount: 2, protectedCount: 3, skippedCount: 0, activeProfiles: 100, priceTableId: "t" };
    await db.insert(schema.simulations).values(base);

    expect(await decideAutomatic(db, { shop, simulationId })).toEqual({ run: false, reason: "mode_is_approval" });
    await db.update(schema.settings).set({ mode: "automatic", scheduleEnabled: true, clickDays: 200 }).where(eq(schema.settings.shop, shop));
    expect(await decideAutomatic(db, { shop, simulationId })).toEqual({ run: false, reason: "rules_not_recommended" });
    await db.update(schema.settings).set({ clickDays: null }).where(eq(schema.settings.shop, shop));
    expect(await decideAutomatic(db, { shop, simulationId })).toEqual({ run: true, simulationId });

    expect(await approveAutomatically(db, { shop, simulationId })).toBe(true);
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.approvedBy).toBe("automatic");
    expect(await approveAutomatically(db, { shop, simulationId })).toBe(false);

    const manual = await seedSimulation({ shop, candidates: 1, approved: false });
    expect(await decideAutomatic(db, { shop, simulationId: manual.simulationId })).toEqual({ run: false, reason: "not_scheduled" });
    expect(await approveAutomatically(db, { shop, simulationId: manual.simulationId })).toBe(false);
  });
});

/** A Shopify Admin API stand-in for billing: one optional active usage subscription, and recorded usage records. */
function fakeAdmin(opts: { subscribed?: boolean; reject?: boolean } = {}) {
  const records: { price: { amount: number }; idempotencyKey: string; description: string }[] = [];
  const graphql: AdminGraphql = async <T>(query: string, variables: Record<string, unknown>) => {
    if (query.includes("TierSaverBillingStatus")) {
      return {
        shop: { plan: { partnerDevelopment: true } },
        currentAppInstallation: {
          activeSubscriptions: opts.subscribed === false ? [] : [{ id: "gid://shopify/AppSubscription/1", status: "ACTIVE", test: true, lineItems: [{ id: "gid://shopify/AppSubscriptionLineItem/1", plan: { pricingDetails: { __typename: "AppUsagePricing", cappedAmount: { amount: "149.0", currencyCode: "USD" }, balanceUsed: { amount: "0.0" } } } }] }],
        },
      } as T;
    }
    if (query.includes("appUsageRecordCreate")) {
      if (opts.reject) return { appUsageRecordCreate: { appUsageRecord: null, userErrors: [{ message: "nope" }] } } as T;
      if (!records.some((r) => r.idempotencyKey === variables.idempotencyKey)) records.push(variables as never);
      return { appUsageRecordCreate: { appUsageRecord: { id: `gid://shopify/AppUsageRecord/${records.length}` }, userErrors: [] } } as T;
    }
    throw new Error("unexpected query");
  };
  return { graphql, records };
}

/** Klaviyo confirmed every job, with more than enough profiles processed. */
const CONFIRMED = { done: true, suppressed: 1_000_000 };
/** A clock past the undo window, when a confirmed charge is allowed to go out. */
const AFTER_HOLD = () => new Date(Date.now() + (CHARGE_HOLD_HOURS + 1) * 60 * 60 * 1000);

describe("charging a cleanup", () => {
  it("is only an estimate until Klaviyo's jobs confirm; nothing reaches Shopify before that", async () => {
    const { runId } = await finishedCleanup(4);
    const admin = fakeAdmin();
    expect(await settleRunCharge({ db, graphql: admin.graphql }, runId)).toEqual({ status: "estimated", feeCents: 1500 });
    expect(await settleRunCharge({ db, graphql: admin.graphql }, runId, { done: false, suppressed: 4 })).toEqual({ status: "estimated", feeCents: 1500 });
    expect(admin.records).toHaveLength(0);
    expect((await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) }))?.status).toBe("pending");

    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId, { done: true, suppressed: 3 })).toEqual({ status: "charged", feeCents: 1500 });
    expect(admin.records).toHaveLength(1);
    expect(await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) })).toMatchObject({ status: "charged", profilesSuppressed: 3 });
  });

  it("is not charged when Klaviyo confirms that no profile was suppressed", async () => {
    const { runId } = await finishedCleanup(4);
    const admin = fakeAdmin();
    await settleRunCharge({ db, graphql: admin.graphql }, runId);
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId, { done: true, suppressed: 0 })).toEqual({ status: "not_charged", reason: "no_cleanup" });
    expect(admin.records).toHaveLength(0);
    expect(await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) })).toMatchObject({ status: "not_charged", feeCents: 0 });
  });

  it("charges the flat price of the simulated list size, once", async () => {
    const { shop, runId, simulationId } = await finishedCleanup(4);
    await db.update(schema.simulations).set({ activeProfiles: 12_000 }).where(eq(schema.simulations.id, simulationId));
    const admin = fakeAdmin();
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId, CONFIRMED)).toEqual({ status: "charged", feeCents: 2900 });
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId, CONFIRMED)).toEqual({ status: "charged", feeCents: 2900 });
    expect(admin.records).toHaveLength(1);
    expect(admin.records[0]).toMatchObject({ price: { amount: 29, currencyCode: "USD" }, idempotencyKey: `tiersaver:${shop}:run:${runId}` });
    expect(admin.records[0]!.description).not.toMatch(/sav|bill/i);
    const row = await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) });
    expect(row).toMatchObject({ status: "charged", feeCents: 2900, priceTierMax: 25_000, profilesSuppressed: 4 });
  });

  it("does not charge a cleanup that suppressed nobody, a second cleanup inside 28 days, or an undo", async () => {
    const { shop, simulationId } = await seedSimulation({ candidates: 2 });
    const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error("setup");
    const gateway = new FakeGateway();
    gateway.skip = (r) => r.profileIds; // nobody could be suppressed
    await executeRun({ db, gateway, step: new FakeSteps() }, created.runId);
    const admin = fakeAdmin();
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, created.runId, CONFIRMED)).toEqual({ status: "not_charged", reason: "no_cleanup" });

    const first = await finishedCleanup(2);
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, first.runId, CONFIRMED)).status).toBe("charged");
    const second = await seedSimulation({ shop: first.shop, candidates: 2 });
    const run2 = await createSuppressionRun(db, { shop: first.shop, simulationId: second.simulationId, createdBy: "user:1" });
    if (!run2.ok) throw new Error(run2.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, run2.runId);
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, run2.runId, CONFIRMED)).toEqual({ status: "not_charged", reason: "already_charged_this_cycle" });

    const undo = await createUndoRun(db, { shop: first.shop, runId: first.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, undo.runId, CONFIRMED)).toEqual({ status: "skipped", reason: "not_a_cleanup" });
    expect(admin.records).toHaveLength(1);
  });

  it("is not charged when the whole cleanup was undone before the charge went out; an undo after the charge changes nothing", async () => {
    const early = await finishedCleanup(3);
    const admin = fakeAdmin();
    expect((await settleRunCharge({ db, graphql: admin.graphql }, early.runId)).status).toBe("estimated");
    const undo = await createUndoRun(db, { shop: early.shop, runId: early.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undo.runId);
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, early.runId, CONFIRMED)).toEqual({ status: "not_charged", reason: "cleanup_undone" });
    expect(admin.records).toHaveLength(0);

    const late = await finishedCleanup(3);
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, late.runId, CONFIRMED)).status).toBe("charged");
    const undoLate = await createUndoRun(db, { shop: late.shop, runId: late.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undoLate.ok) throw new Error(undoLate.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undoLate.runId);
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, late.runId, CONFIRMED)).status).toBe("charged");
    expect(admin.records).toHaveLength(1);
  });

  it("holds a confirmed charge for the undo window; a full undo inside it is free", async () => {
    const kept = await finishedCleanup(3);
    const admin = fakeAdmin();
    const held = await settleRunCharge({ db, graphql: admin.graphql }, kept.runId, CONFIRMED);
    expect(held).toMatchObject({ status: "held", feeCents: 1500 });
    expect(admin.records).toHaveLength(0);
    expect((await runsWithOpenCharges(db, new Date(), 500)).map((r) => r.runId)).not.toContain(kept.runId);
    expect((await runsWithOpenCharges(db, AFTER_HOLD(), 500)).map((r) => r.runId)).toContain(kept.runId);
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, kept.runId, CONFIRMED)).status).toBe("charged");
    expect(admin.records).toHaveLength(1);

    const undone = await finishedCleanup(3);
    expect((await settleRunCharge({ db, graphql: admin.graphql }, undone.runId, CONFIRMED)).status).toBe("held");
    const undo = await createUndoRun(db, { shop: undone.shop, runId: undone.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undo.runId);
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, undone.runId, CONFIRMED)).toEqual({ status: "not_charged", reason: "cleanup_undone" });
    expect(admin.records).toHaveLength(1);
  });

  it("a charge that never reached Shopify does not make the next cleanup free, and two cleanups never pay twice", async () => {
    const first = await finishedCleanup(2);
    // Rejected by Shopify: stays failed.
    expect((await settleRunCharge({ db, graphql: fakeAdmin({ reject: true }).graphql, now: AFTER_HOLD }, first.runId, CONFIRMED)).status).toBe("failed");
    const next = await seedSimulation({ shop: first.shop, candidates: 2 });
    const second = await createSuppressionRun(db, { shop: first.shop, simulationId: next.simulationId, createdBy: "user:1" });
    if (!second.ok) throw new Error(second.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, second.runId);
    const admin = fakeAdmin();
    expect(await settleRunCharge({ db, graphql: admin.graphql }, second.runId)).toEqual({ status: "estimated", feeCents: 1500 });
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, second.runId, CONFIRMED)).status).toBe("charged");
    // The first one is retried later: by then the shop was charged in this period.
    expect(await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, first.runId, CONFIRMED)).toEqual({ status: "not_charged", reason: "already_charged_this_cycle" });
    expect(admin.records).toHaveLength(1);
  });

  it("keeps Klaviyo's confirmation, so the charge can be finished later without reading Klaviyo; a restore in progress holds it", async () => {
    const { shop, runId } = await finishedCleanup(3);
    const admin = fakeAdmin();
    expect((await settleRunCharge({ db, graphql: admin.graphql }, runId, { done: true, suppressed: 2 })).status).toBe("held");
    expect((await runsWithOpenCharges(db, AFTER_HOLD(), 500)).find((r) => r.runId === runId)).toMatchObject({ confirmed: true });

    const undo = await createUndoRun(db, { shop, runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId)).status).toBe("held"); // restore still queued
    await db.update(schema.runs).set({ status: "cancelled" }).where(eq(schema.runs.id, undo.runId));
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId)).status).toBe("charged");
    expect(admin.records[0]!.description).toContain("2 profiles");
  });

  it("the cron confirms a cleanup of any size a page of jobs at a time, keeping its place between ticks", async () => {
    const { runId } = await finishedCleanup(5);
    // Five jobs, one per profile.
    const rows = await db.select({ profileId: schema.runProfiles.profileId }).from(schema.runProfiles).where(eq(schema.runProfiles.runId, runId));
    for (const [i, row] of rows.entries()) {
      await db.update(schema.runProfiles).set({ klaviyoJobId: `JOB${i}` }).where(and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.profileId, row.profileId)));
    }
    const pendingJobs = new Set(["JOB3"]);
    let reads = 0;
    const jobsClient = new KlaviyoClient({
      getAccessToken: async () => "token",
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL) => {
        reads += 1;
        const id = new URL(String(input instanceof Request ? input.url : input)).pathname.split("/").filter(Boolean).pop()!;
        const attributes = pendingJobs.has(id) ? { status: "processing", total_count: 1, completed_count: 0 } : { status: "complete", total_count: 1, completed_count: 1, skipped_count: 0 };
        return new Response(JSON.stringify({ data: { type: "profile-suppression-bulk-create-job", id, attributes } }), { headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    expect(await advanceChargeConfirmation(db, jobsClient, runId, 2)).toBeNull(); // no charge row yet
    await settleRunCharge({ db, graphql: null }, runId);
    expect(await advanceChargeConfirmation(db, jobsClient, runId, 2)).toEqual({ done: false, suppressed: 0 }); // JOB0, JOB1
    expect(await advanceChargeConfirmation(db, jobsClient, runId, 2)).toEqual({ done: false, suppressed: 0 }); // JOB3 not complete: page not counted
    expect(await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) })).toMatchObject({ confirmOffset: 2, confirmSuppressed: 2 });
    pendingJobs.clear();
    expect(await advanceChargeConfirmation(db, jobsClient, runId, 2)).toEqual({ done: false, suppressed: 0 }); // JOB2, JOB3
    const done = await advanceChargeConfirmation(db, jobsClient, runId, 2); // JOB4
    expect(done).toEqual({ done: true, suppressed: 5 });
    expect(reads).toBe(7);
    expect((await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) }))?.lastAttemptAt).not.toBeNull();
    expect((await settleRunCharge({ db, graphql: fakeAdmin().graphql, now: AFTER_HOLD }, runId, done)).status).toBe("charged");
  });

  it("uninstalling inside the undo window leaves a record for the Klaviyo account: its next cleanup is charged without the window", async () => {
    const secrets = { TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))), KLAVIYO_CLIENT_ID: "id", KLAVIYO_CLIENT_SECRET: "secret" };
    const account = `ACC-${crypto.randomUUID()}`;
    const connect = (shop: string) =>
      saveConnection({ db, env: secrets }, { shop, klaviyoAccountId: account, tokens: { accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() + 3600_000), scope: KLAVIYO_SCOPES.join(" ") } });

    const first = await finishedCleanup(3);
    await connect(first.shop);
    const admin = fakeAdmin();
    expect((await settleRunCharge({ db, graphql: admin.graphql }, first.runId, CONFIRMED)).status).toBe("held");
    expect(await chargedWithoutWindow(db, first.shop)).toBe(false);
    // Uninstall with the charge still waiting.
    expect(await recordUnpaidCleanups(db, first.shop)).toBe(true);
    await deleteShopData(db, first.shop);
    expect(await db.select().from(schema.unpaidCleanups).where(eq(schema.unpaidCleanups.feeCents, 1500))).not.toHaveLength(0);

    // The same Klaviyo account comes back under another store.
    const second = await finishedCleanup(3);
    await connect(second.shop);
    expect(await chargedWithoutWindow(db, second.shop)).toBe(true);
    expect((await settleRunCharge({ db, graphql: admin.graphql }, second.runId, CONFIRMED)).status).toBe("charged"); // no window
    expect(admin.records).toHaveLength(1);
    expect(await chargedWithoutWindow(db, second.shop)).toBe(false); // paid: the window is back

    // A cleanup restored in full before the uninstall owes nothing.
    const third = await finishedCleanup(2);
    await saveConnection({ db, env: secrets }, { shop: third.shop, klaviyoAccountId: `ACC-${crypto.randomUUID()}`, tokens: { accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() + 3600_000), scope: "x" } });
    await settleRunCharge({ db, graphql: admin.graphql }, third.runId, CONFIRMED);
    const undo = await createUndoRun(db, { shop: third.shop, runId: third.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undo.runId);
    expect(await recordUnpaidCleanups(db, third.shop)).toBe(false);
  });

  it("stays open and can be retried when Shopify has no subscription or rejects the record", async () => {
    const { runId } = await finishedCleanup(2);
    expect(await settleRunCharge({ db, graphql: fakeAdmin({ subscribed: false }).graphql, now: AFTER_HOLD }, runId, CONFIRMED)).toEqual({ status: "failed", error: "no_active_subscription" });
    expect(await settleRunCharge({ db, graphql: fakeAdmin({ reject: true }).graphql, now: AFTER_HOLD }, runId, CONFIRMED)).toEqual({ status: "failed", error: "usage_record_rejected" });
    expect((await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) }))?.status).toBe("failed");
    const admin = fakeAdmin();
    expect((await settleRunCharge({ db, graphql: admin.graphql, now: AFTER_HOLD }, runId, CONFIRMED)).status).toBe("charged");
    expect(admin.records).toHaveLength(1);
  });

  it("the terms shown by Shopify follow the text rules", () => {
    const terms = subscriptionTerms();
    expect(terms).toContain("$15 up to 10,000");
    expect(terms).not.toMatch(/sav|lower|reduce|bill/i);
  });
});

