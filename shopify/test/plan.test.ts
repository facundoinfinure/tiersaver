import { FLAT_PRICE_TIERS } from "@tiersaver/core";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { approveCleanup } from "../app/billing/approval";
import {
  cancelPlanForShop,
  getBillingStatus,
  handleSubscriptionUpdate,
  LARGEST_PLAN_PROFILES,
  planCoversList,
  planForListSize,
  planGate,
  PLANS,
  refreshPlan,
  requestPlanFor,
  storedPlanState,
  syncPlanState,
} from "../app/billing/billing";
import { handleUninstall } from "../app/data/privacy";
import { createUndoRun, executeRun } from "../app/runs/engine";
import { createCleanupWithPlan } from "../app/runs/gated";
import { automaticReview, runAutomaticMode } from "../app/schedule/automatic";
import { fakeShopifyBilling } from "./fake-shopify-billing";
import { FakeGateway, FakeSteps, db, schema, seedSimulation } from "./helpers";

/**
 * The pricing rules decided on 2026-11-26 (docs/04-PRECIO-Y-COBRO.md): a monthly plan by list size that starts
 * when the first cleanup is approved; no cleanup without an adequate active plan; nothing charged per cleanup.
 */

const RETURN_URL = "https://admin.shopify.com/store/test/apps/tiersaver/app/simulation";

/** A simulation with `candidates` profiles for a list of `activeProfiles`, open (not approved) unless told otherwise. */
async function simulationFor(activeProfiles: number, opts: { shop?: string; approved?: boolean; candidates?: number; scheduled?: boolean } = {}) {
  const seeded = await seedSimulation({ shop: opts.shop, candidates: opts.candidates ?? 3, approved: opts.approved ?? false });
  await db
    .update(schema.simulations)
    .set({ activeProfiles, ...(opts.scheduled ? { origin: "scheduled" as const } : {}) })
    .where(eq(schema.simulations.id, seeded.simulationId));
  return seeded;
}
const events = async (shop: string) => (await db.query.eventsLog.findMany({ where: eq(schema.eventsLog.shop, shop) })).map((e) => e.action);
const runsOf = (shop: string) => db.query.runs.findMany({ where: eq(schema.runs.shop, shop) });
const usageCharges = (shop: string) => db.query.usageCharges.findMany({ where: eq(schema.usageCharges.shop, shop) });

describe("plans come from the price table", () => {
  it("one plan per tier, with its name, price and terms built from the table", () => {
    expect(PLANS.map((p) => [p.maxProfiles, p.monthlyCents])).toEqual(FLAT_PRICE_TIERS.map((t) => [t.maxProfiles, t.monthlyCents]));
    expect(planForListSize(8_000)).toEqual({
      monthlyCents: 900,
      maxProfiles: 10_000,
      name: "TierSaver list hygiene: up to 10,000 active profiles",
      price: "US$9/month",
      terms: "US$9/month for lists up to 10,000 active profiles, charged by Shopify every 30 days until you cancel.",
    });
    expect(planForListSize(10_001)?.price).toBe("US$19/month");
    expect(planForListSize(75_000)?.price).toBe("US$39/month");
    expect(planForListSize(150_000)?.price).toBe("US$79/month");
    expect(LARGEST_PLAN_PROFILES).toBe(150_000);
  });
  it("above 150,000 active profiles nothing is sold automatically", () => {
    expect(planForListSize(150_001)).toBeNull();
  });
  it("what Shopify shows the merchant follows the text rules: no savings, no Klaviyo bill", () => {
    for (const plan of PLANS) expect(`${plan.name} ${plan.terms}`.replaceAll("TierSaver", "")).not.toMatch(/sav|lower|reduce|bill|guarant/i);
  });
});

describe("the plan as Shopify reports it", () => {
  it("no subscription: no plan", async () => {
    expect(await getBillingStatus(fakeShopifyBilling().graphql)).toEqual({ developmentStore: true, plan: null, frozen: false });
  });
  it("the usage subscription of the old per-cleanup model does not count as a plan", async () => {
    const shopify = fakeShopifyBilling({ legacyUsageSubscription: true });
    expect((await getBillingStatus(shopify.graphql)).plan).toBeNull();
    const { shop, simulationId } = await simulationFor(8_000, { approved: true });
    expect(await planGate({ db, graphql: shopify.graphql }, { shop, simulationId })).toEqual({ ok: false, reason: "plan_required", requiredCents: 900 });
  });
  it("an active 30-day subscription in USD is the plan, with its price, test flag and period end", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 1_900 });
    expect((await getBillingStatus(shopify.graphql)).plan).toEqual({ id: "gid://shopify/AppSubscription/1", name: "plan", monthlyCents: 1_900, maxProfiles: 25_000, test: true, currentPeriodEnd: "2026-12-26T12:00:00Z" });
  });
  it("a subscription on hold at Shopify is not a plan", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    shopify.end("FROZEN");
    expect(await getBillingStatus(shopify.graphql)).toMatchObject({ plan: null, frozen: true });
  });
});

describe("no plan, no cleanup", () => {
  it("a cleanup is refused, and nothing is created, while the shop has no plan", async () => {
    const shopify = fakeShopifyBilling();
    const { shop, simulationId } = await simulationFor(8_000, { approved: true });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "plan_required", requiredCents: 900 });
    expect(await runsOf(shop)).toHaveLength(0);
    // The simulation was not consumed: it can still be started once there is a plan.
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.executedAt).toBeNull();
  });
  it("is refused when Shopify cannot be asked: never started on a guess, not even with a plan on record", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await simulationFor(8_000, { approved: true });
    await refreshPlan({ db, graphql: shopify.graphql }, shop);
    expect((await storedPlanState(db, shop))?.status).toBe("active");
    shopify.state.down = true;
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "billing_unavailable", requiredCents: null });
    expect(await runsOf(shop)).toHaveLength(0);
  });
  it("above the largest plan nothing can be approved or started", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 7_900 });
    const { shop, simulationId } = await simulationFor(150_001);
    expect(await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:1", acknowledged: true, returnUrl: RETURN_URL })).toEqual({ ok: false, reason: "above_price_tiers" });
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.approvedAt).toBeNull();
    const approved = await simulationFor(150_001, { approved: true });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop: approved.shop, simulationId: approved.simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "above_price_tiers", requiredCents: null });
  });
  it("connecting, auditing and simulating ask Shopify for nothing: free until the first cleanup", async () => {
    const shopify = fakeShopifyBilling();
    await simulationFor(8_000);
    expect(shopify.state.operations).toEqual([]);
    expect(shopify.state.created).toEqual([]);
  });
});

describe("first approval: the plan starts with the first cleanup", () => {
  it("approving sends the merchant to Shopify for the plan of their list size, and the cleanup starts after they approve it", async () => {
    const shopify = fakeShopifyBilling();
    const { shop, simulationId } = await simulationFor(12_400);

    // Not without the acknowledgement: nothing is approved and Shopify is not asked for anything.
    expect(await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: false, returnUrl: RETURN_URL })).toEqual({ ok: false, reason: "not_acknowledged" });
    expect(shopify.state.created).toHaveLength(0);

    const approved = await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, termsVersion: "2026-11-27", returnUrl: RETURN_URL });
    expect(approved).toMatchObject({ ok: true, next: "approve_in_shopify", confirmationUrl: "https://admin.shopify.com/confirm/1", plan: { monthlyCents: 1_900, maxProfiles: 25_000 } });
    // What Shopify was asked to show: the plan of the price table, every 30 days, coming back to the review screen.
    expect(shopify.state.created).toEqual([
      {
        name: "TierSaver list hygiene: up to 25,000 active profiles",
        returnUrl: RETURN_URL,
        test: true,
        lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: 19, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } }],
      },
    ]);
    // The approval of the cleanup is on record, with who and which terms; the plan is only requested so far.
    const sim = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) });
    expect(sim?.approvedBy).toBe("user:7");
    expect(await events(shop)).toEqual(expect.arrayContaining(["simulation.approved", "plan.requested"]));
    const requested = await db.query.eventsLog.findFirst({ where: and(eq(schema.eventsLog.shop, shop), eq(schema.eventsLog.action, "plan.requested")) });
    expect(requested).toMatchObject({ actor: "user:7", simulationId, detail: { monthlyCents: 1_900, tierMaxProfiles: 25_000, termsVersion: "2026-11-27", previousMonthlyCents: null, test: true } });

    // Until the merchant approves on Shopify's page there is no plan, so no cleanup.
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:7" })).toMatchObject({ ok: false, reason: "plan_required" });
    expect(await storedPlanState(db, shop)).toBeNull();

    // The merchant approves at Shopify and comes back to the review screen.
    shopify.approve();
    const status = await refreshPlan({ db, graphql: shopify.graphql, actor: "user:7" }, shop);
    expect(status.plan).toMatchObject({ monthlyCents: 1_900, test: true });
    expect(await storedPlanState(db, shop)).toEqual({ status: "active", monthlyCents: 1_900, tierMaxProfiles: 25_000 });
    expect(await events(shop)).toContain("plan.started");

    const started = await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:7" });
    expect(started.ok).toBe(true);
    expect(await runsOf(shop)).toHaveLength(1);
    // Coming back twice does not start the plan twice in the trail.
    await refreshPlan({ db, graphql: shopify.graphql, actor: "user:7" }, shop);
    expect((await events(shop)).filter((a) => a === "plan.started")).toHaveLength(1);
  });

  it("declining at Shopify leaves the cleanup approved but unable to start, and the plan can be asked for again", async () => {
    const shopify = fakeShopifyBilling();
    const { shop, simulationId } = await simulationFor(8_000);
    await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, returnUrl: RETURN_URL });
    shopify.decline();
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:7" })).toMatchObject({ ok: false, reason: "plan_required" });
    expect(await runsOf(shop)).toHaveLength(0);
    const again = await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 8_000, returnUrl: RETURN_URL, actor: "user:7", keepLargerPlan: true });
    expect(again).toMatchObject({ ok: true, next: "approve_in_shopify" });
    expect(shopify.state.created).toHaveLength(2);
  });

  it("with an adequate plan already active, approving asks Shopify for nothing new", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await simulationFor(9_999);
    expect(await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, returnUrl: RETURN_URL })).toEqual({ ok: true, next: "ready" });
    expect(shopify.state.created).toHaveLength(0);
    expect((await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:7" })).ok).toBe(true);
  });

  it("if Shopify cannot be asked while approving, the cleanup is approved and waits for the plan", async () => {
    const shopify = fakeShopifyBilling();
    shopify.state.down = true;
    const { shop, simulationId } = await simulationFor(8_000);
    expect(await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:7", acknowledged: true, returnUrl: RETURN_URL })).toEqual({ ok: true, next: "plan_pending" });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:7" })).toMatchObject({ ok: false, reason: "billing_unavailable" });
  });
});

describe("development stores use test charges", () => {
  it("a development store gets a test subscription; any other store a real one", async () => {
    const dev = fakeShopifyBilling({ developmentStore: true });
    const a = await simulationFor(8_000);
    await approveCleanup({ db, graphql: dev.graphql }, { shop: a.shop, simulationId: a.simulationId, approvedBy: "user:1", acknowledged: true, returnUrl: RETURN_URL });
    expect(dev.state.created[0]?.test).toBe(true);

    const live = fakeShopifyBilling({ developmentStore: false });
    const b = await simulationFor(8_000);
    await approveCleanup({ db, graphql: live.graphql }, { shop: b.shop, simulationId: b.simulationId, approvedBy: "user:1", acknowledged: true, returnUrl: RETURN_URL });
    expect(live.state.created[0]?.test).toBe(false);
  });
});

describe("the plan has to cover the list size of the simulation", () => {
  it("the list moved to a higher tier: refused until the merchant approves the new price in Shopify", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await simulationFor(10_001, { approved: true });
    expect(planCoversList({ monthlyCents: 900 }, 10_001)).toMatchObject({ covered: false, reason: "plan_price_too_low" });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" })).toEqual({ ok: false, reason: "plan_price_too_low", requiredCents: 1_900 });
    expect(await runsOf(shop)).toHaveLength(0);

    const request = await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 10_001, returnUrl: RETURN_URL, actor: "user:1", keepLargerPlan: true });
    expect(request).toMatchObject({ ok: true, next: "approve_in_shopify", plan: { monthlyCents: 1_900 } });
    shopify.approve(); // Shopify replaces the US$9 plan with the US$19 one
    expect((await getBillingStatus(shopify.graphql)).plan?.monthlyCents).toBe(1_900);
    expect((await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" })).ok).toBe(true);
    const started = await db.query.eventsLog.findMany({ where: and(eq(schema.eventsLog.shop, shop), eq(schema.eventsLog.action, "plan.started")) });
    expect(started.map((e) => (e.detail as { monthlyCents: number }).monthlyCents)).toContain(1_900);
  });

  it("approving a cleanup of a list that grew asks for the larger plan, never silently", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await simulationFor(30_000);
    const approved = await approveCleanup({ db, graphql: shopify.graphql }, { shop, simulationId, approvedBy: "user:1", acknowledged: true, returnUrl: RETURN_URL });
    expect(approved).toMatchObject({ ok: true, next: "approve_in_shopify", plan: { monthlyCents: 3_900 } });
    expect((await getBillingStatus(shopify.graphql)).plan?.monthlyCents).toBe(900); // unchanged until approved at Shopify
  });

  it("the list moved to a lower tier: the cleanup may start, the merchant is told, and switching asks for the lower plan", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 1_900 });
    const { shop, simulationId } = await simulationFor(9_000, { approved: true });
    expect(await planGate({ db, graphql: shopify.graphql }, { shop, simulationId })).toMatchObject({ ok: true, overpaying: true, requiredCents: 900 });
    // Approving a cleanup leaves a plan that is enough alone...
    expect(await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 9_000, returnUrl: RETURN_URL, actor: "user:1", keepLargerPlan: true })).toEqual({ ok: true, next: "ready" });
    // ...and "switch to the lower plan" asks Shopify for it.
    const lower = await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 9_000, returnUrl: RETURN_URL, actor: "user:1" });
    expect(lower).toMatchObject({ ok: true, next: "approve_in_shopify", plan: { monthlyCents: 900 } });
    shopify.approve();
    expect(await planGate({ db, graphql: shopify.graphql }, { shop, simulationId })).toMatchObject({ ok: true, overpaying: false });
  });
});

/** A shop whose owner approved and ran one cleanup with a plan, then turned automatic cleanups on; plus a new scheduled simulation. */
async function automaticShop(activeProfiles: number, planCents: number) {
  const shopify = fakeShopifyBilling({ monthlyCents: planCents });
  const first = await simulationFor(activeProfiles, { approved: true, candidates: 300 });
  const created = await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop: first.shop, simulationId: first.simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, created.runId);
  await db.update(schema.settings).set({ mode: "automatic", scheduleEnabled: true }).where(eq(schema.settings.shop, first.shop));
  const launched: string[] = [];
  const deps = { db, graphql: shopify.graphql, suppressionAllowed: () => true, launch: async (runId: string) => void launched.push(runId) };
  const next = (size: number) => simulationFor(size, { shop: first.shop, candidates: 20, scheduled: true });
  return { shop: first.shop, shopify, deps, launched, next, firstRunId: created.runId };
}

describe("automatic mode and the plan", () => {
  it("starts the scheduled cleanup when the plan covers the list", async () => {
    const { shop, deps, launched, next } = await automaticShop(8_000, 900);
    const { simulationId } = await next(8_100);
    expect(await runAutomaticMode(deps, { shop, simulationId })).toBe("started");
    expect(launched).toHaveLength(1);
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.approvedBy).toBe("automatic");
  });

  it("the list moved to a higher tier: it waits for the merchant, with the reason, and approves nothing", async () => {
    const { shop, shopify, deps, launched, next } = await automaticShop(8_000, 900);
    const { simulationId } = await next(10_500);
    expect(await runAutomaticMode(deps, { shop, simulationId })).toBe("plan_price_too_low");
    expect(launched).toHaveLength(0);
    const sim = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) });
    expect(sim).toMatchObject({ approvedAt: null, executedAt: null });
    const review = await automaticReview(db, { shop, simulationId });
    expect(review?.reason).toBe("plan_price_too_low");
    expect(review?.label).toMatch(/approve the new monthly price in Shopify/);
    // An automatic cleanup never asks Shopify for a new price by itself.
    expect(shopify.state.created).toEqual([]);
  });

  it("the plan ended at Shopify (uninstall, cancelled there, declined payment): it waits with the reason", async () => {
    const { shop, shopify, deps, launched, next } = await automaticShop(8_000, 900);
    shopify.end("CANCELLED");
    const cancelled = await next(8_100);
    expect(await runAutomaticMode(deps, { shop, simulationId: cancelled.simulationId })).toBe("plan_required");
    expect((await automaticReview(db, { shop, simulationId: cancelled.simulationId }))?.reason).toBe("plan_required");
    expect(launched).toHaveLength(0);
    expect((await storedPlanState(db, shop))?.status).toBe("cancelled");

    const other = await automaticShop(8_000, 900);
    other.shopify.end("FROZEN");
    const frozen = await other.next(8_100);
    expect(await runAutomaticMode(other.deps, { shop: other.shop, simulationId: frozen.simulationId })).toBe("plan_frozen");
    expect((await storedPlanState(db, other.shop))?.status).toBe("frozen");
    expect(other.launched).toHaveLength(0);
  });

  it("when Shopify cannot be asked the step fails so it is retried, and nothing is approved", async () => {
    const { shop, shopify, deps, next } = await automaticShop(8_000, 900);
    const { simulationId } = await next(8_100);
    shopify.state.down = true;
    await expect(runAutomaticMode(deps, { shop, simulationId })).rejects.toThrow("billing_unavailable");
    expect((await db.query.simulations.findFirst({ where: eq(schema.simulations.id, simulationId) }))?.approvedAt).toBeNull();
  });
});

describe("cancelling the plan", () => {
  it("cancels at Shopify without proration, stops cleanups and turns automatic cleanups off, on record", async () => {
    const { shop, shopify, deps, launched, next } = await automaticShop(8_000, 900);
    expect(await cancelPlanForShop({ db, graphql: shopify.graphql }, { shop, actor: "user:9" })).toEqual({ ok: true, hadPlan: true, automaticTurnedOff: true });
    expect(shopify.state.cancelled).toEqual(["gid://shopify/AppSubscription/1"]);
    expect((await getBillingStatus(shopify.graphql)).plan).toBeNull();
    expect(await storedPlanState(db, shop)).toMatchObject({ status: "cancelled" });
    expect((await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) }))?.mode).toBe("approval");
    expect(await events(shop)).toEqual(expect.arrayContaining(["plan.ended", "automatic_mode.disabled"]));
    const ended = await db.query.eventsLog.findFirst({ where: and(eq(schema.eventsLog.shop, shop), eq(schema.eventsLog.action, "plan.ended")) });
    expect(ended).toMatchObject({ actor: "user:9", detail: { endedAs: "cancelled", monthlyCents: 900 } });

    // No cleanup starts any more: neither a scheduled one nor one a person approves.
    const scheduled = await next(8_100);
    expect(await runAutomaticMode(deps, { shop, simulationId: scheduled.simulationId })).toBe("mode_is_approval");
    await db.update(schema.simulations).set({ supersededAt: new Date() }).where(eq(schema.simulations.id, scheduled.simulationId));
    const manual = await simulationFor(8_100, { shop, approved: true });
    expect(await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId: manual.simulationId, createdBy: "user:9" })).toMatchObject({ ok: false, reason: "plan_required" });
    expect(launched).toHaveLength(0);
  });

  it("restoring still works without a plan, and cancelling twice is harmless", async () => {
    const { shop, shopify, firstRunId } = await automaticShop(8_000, 900);
    await cancelPlanForShop({ db, graphql: shopify.graphql }, { shop, actor: "user:9" });
    expect(await cancelPlanForShop({ db, graphql: shopify.graphql }, { shop, actor: "user:9" })).toEqual({ ok: true, hadPlan: false, automaticTurnedOff: false });
    const undo = await createUndoRun(db, { shop, runId: firstRunId, createdBy: "user:9", confirmAfterRenewal: true });
    expect(undo.ok).toBe(true);
  });

  it("nothing is cancelled or switched off when Shopify refuses or cannot be reached", async () => {
    const { shop, shopify } = await automaticShop(8_000, 900);
    shopify.state.down = true;
    expect(await cancelPlanForShop({ db, graphql: shopify.graphql }, { shop, actor: "user:9" })).toEqual({ ok: false, reason: "billing_unavailable" });
    expect((await storedPlanState(db, shop))?.status).toBe("active");
    expect((await db.query.settings.findFirst({ where: eq(schema.settings.shop, shop) }))?.mode).toBe("automatic");
  });

  it("uninstalling removes the stored plan: a later reinstall starts with no plan", async () => {
    const { shop } = await automaticShop(8_000, 900);
    await handleUninstall(db, shop);
    expect(await storedPlanState(db, shop)).toBeNull();
  });

  it("a merchant who said no on Shopify's page and never had a plan is recorded as declined", async () => {
    const { shop } = await simulationFor(8_000);
    await syncPlanState(db, shop, { developmentStore: true, plan: null, frozen: false }, { endedAs: "declined" });
    expect((await storedPlanState(db, shop))?.status).toBe("declined");
  });
});

describe("Shopify's subscription webhook", () => {
  const PLAN_ID = "gid://shopify/AppSubscription/1";
  it("a plan cancelled at Shopify is seen: the stored plan ends and cleanups stop", async () => {
    const { shop, shopify, deps, next } = await automaticShop(8_000, 900);
    shopify.end("CANCELLED");
    expect(await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: PLAN_ID, status: "CANCELLED" })).toBe("synced");
    expect((await storedPlanState(db, shop))?.status).toBe("cancelled");
    const ended = await db.query.eventsLog.findFirst({ where: and(eq(schema.eventsLog.shop, shop), eq(schema.eventsLog.action, "plan.ended")) });
    expect(ended?.actor).toBe("webhook");
    const { simulationId } = await next(8_100);
    expect(await runAutomaticMode(deps, { shop, simulationId })).toBe("plan_required");
  });
  it("frozen and reactivated", async () => {
    const { shop, shopify } = await automaticShop(8_000, 900);
    shopify.end("FROZEN");
    await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: PLAN_ID, status: "FROZEN" });
    expect((await storedPlanState(db, shop))?.status).toBe("frozen");
    shopify.state.subscriptions[0]!.status = "ACTIVE";
    await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: PLAN_ID, status: "ACTIVE" });
    expect((await storedPlanState(db, shop))?.status).toBe("active");
  });
  it("the old plan being replaced, or a larger plan being declined, does not end the plan that is active", async () => {
    const { shop, shopify } = await automaticShop(8_000, 900);
    await requestPlanFor({ db, graphql: shopify.graphql }, { shop, activeProfiles: 20_000, returnUrl: RETURN_URL, actor: "user:1" });
    shopify.decline();
    expect(await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: "gid://shopify/AppSubscription/2", status: "DECLINED" })).toBe("synced");
    expect(await storedPlanState(db, shop)).toMatchObject({ status: "active", monthlyCents: 900 });
    // Shopify unreachable: a payload about another subscription is not believed.
    shopify.state.down = true;
    expect(await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: "gid://shopify/AppSubscription/2", status: "CANCELLED" })).toBe("ignored");
    expect((await storedPlanState(db, shop))?.status).toBe("active");
    // ...but one about the plan on record is.
    expect(await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: PLAN_ID, status: "CANCELLED" })).toBe("from_payload");
    expect((await storedPlanState(db, shop))?.status).toBe("cancelled");
  });
  it("a first plan declined on Shopify's page is recorded; an uninstalled or unknown shop is ignored", async () => {
    const shopify = fakeShopifyBilling();
    const { shop } = await simulationFor(8_000);
    await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop, subscriptionId: "gid://shopify/AppSubscription/9", status: "DECLINED" });
    expect((await storedPlanState(db, shop))?.status).toBe("declined");
    const gone = await automaticShop(8_000, 900);
    await handleUninstall(db, gone.shop);
    expect(await handleSubscriptionUpdate({ db, graphql: gone.shopify.graphql }, { shop: gone.shop, subscriptionId: PLAN_ID, status: "CANCELLED" })).toBe("ignored");
    expect(await handleSubscriptionUpdate({ db, graphql: shopify.graphql }, { shop: "nobody.myshopify.com", subscriptionId: PLAN_ID, status: "CANCELLED" })).toBe("ignored");
  });
});

describe("nothing is charged per cleanup", () => {
  it("a cleanup and its restore ask Shopify only about the plan: no usage record, no charge row, no hold", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const { shop, simulationId } = await simulationFor(8_000, { approved: true, candidates: 250 });
    const created = await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop, simulationId, createdBy: "user:1" });
    if (!created.ok) throw new Error(created.reason);
    const outcome = await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, created.runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 250 });
    const undo = await createUndoRun(db, { shop, runId: created.runId, createdBy: "user:1", confirmAfterRenewal: true });
    if (!undo.ok) throw new Error(undo.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, undo.runId);

    expect(new Set(shopify.state.operations)).toEqual(new Set(["TierSaverBillingStatus"]));
    expect(await usageCharges(shop)).toHaveLength(0);
    expect((await events(shop)).filter((a) => a.startsWith("charge."))).toEqual([]);
    // Restoring refunds nothing: the plan is untouched.
    expect((await getBillingStatus(shopify.graphql)).plan?.monthlyCents).toBe(900);
    expect(shopify.state.cancelled).toEqual([]);
  });

  it("two cleanups in the same month need nothing more than the plan", async () => {
    const shopify = fakeShopifyBilling({ monthlyCents: 900 });
    const first = await simulationFor(8_000, { approved: true });
    const a = await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop: first.shop, simulationId: first.simulationId, createdBy: "user:1" });
    if (!a.ok) throw new Error(a.reason);
    await executeRun({ db, gateway: new FakeGateway(), step: new FakeSteps() }, a.runId);
    const second = await simulationFor(7_990, { shop: first.shop, approved: true });
    const b = await createCleanupWithPlan({ db, graphql: shopify.graphql }, { shop: first.shop, simulationId: second.simulationId, createdBy: "user:1" });
    expect(b.ok).toBe(true);
    expect(shopify.state.created).toEqual([]);
  });
});
