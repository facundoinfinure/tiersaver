import { describe, expect, it } from "vitest";
import { generateDataset } from "../src/generate.js";
import { LIMITS, MACHINE_OPEN_PROPERTY, SEED_PROPERTIES } from "../src/klaviyo-config.js";
import { buildPlan, formatPlan, packBatches, type PlanStep } from "../src/plan.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const of = (steps: PlanStep[], kind: PlanStep["kind"]) => steps.filter((s) => s.kind === kind);
const importProfiles = (step: PlanStep): any[] => (step.body as any).data.attributes.profiles.data;
const eventEntries = (step: PlanStep): any[] => (step.body as any).data.attributes["events-bulk-create"].data;

describe("packBatches", () => {
  it("splits on the item limit", () => {
    expect(packBatches([1, 2, 3, 4, 5], { maxItems: 2, maxBytes: 1000 }).map((b) => b.length)).toEqual([2, 2, 1]);
  });
  it("counts weighted entries and never splits one", () => {
    const entries = [{ n: 3 }, { n: 3 }, { n: 3 }, { n: 1 }];
    const batches = packBatches(entries, { maxItems: 6, maxBytes: 1000, weight: (e) => e.n });
    expect(batches.map((b) => b.reduce((sum, e) => sum + e.n, 0))).toEqual([6, 4]);
  });
  it("splits on the byte budget", () => {
    const entries = Array.from({ length: 10 }, () => "x".repeat(98)); // 100 bytes as JSON, +1 separator
    expect(packBatches(entries, { maxItems: 1000, maxBytes: 303 }).map((b) => b.length)).toEqual([3, 3, 3, 1]);
  });
  it("rejects an entry that can never fit", () => {
    expect(() => packBatches(["x".repeat(500)], { maxItems: 10, maxBytes: 100 })).toThrow(RangeError);
    expect(() => packBatches([{ n: 11 }], { maxItems: 10, maxBytes: 1000, weight: (e) => e.n })).toThrow(RangeError);
  });
});

describe("buildPlan: batching under the verified Klaviyo limits", () => {
  it.each([2000, 3000, 5000])("respects every per-request limit for %i profiles", (count) => {
    const ds = generateDataset({ now: NOW, count });
    const plan = buildPlan(ds);
    for (const step of plan.steps) {
      expect(step.bytes, step.id).toBeLessThanOrEqual(LIMITS.payloadBudgetBytes + 1024);
      expect(step.bytes, step.id).toBe(Buffer.byteLength(JSON.stringify(step.body)));
    }
    for (const step of of(plan.steps, "import")) expect(step.items).toBeLessThanOrEqual(10_000);
    for (const step of of(plan.steps, "events")) expect(step.items).toBeLessThanOrEqual(1_000);
    for (const step of [...of(plan.steps, "suppress"), ...of(plan.steps, "unsuppress")]) expect(step.items).toBeLessThanOrEqual(100);
    for (const step of of(plan.steps, "subscribe_sms")) expect(step.items).toBeLessThanOrEqual(1_000);
    expect(of(plan.steps, "events").length).toBeGreaterThan(1);
  });

  it("sends every profile and every event exactly once", () => {
    const ds = generateDataset({ now: NOW });
    const plan = buildPlan(ds);
    const emails = of(plan.steps, "import").flatMap((s) => importProfiles(s).map((p) => p.attributes.email));
    expect(emails.sort()).toEqual(ds.profiles.map((p) => p.email).sort());

    const sent = of(plan.steps, "events").flatMap((s) => eventEntries(s).flatMap((e) => e.attributes.events.data.map((ev: any) => ev.attributes.unique_id)));
    const generated = ds.profiles.flatMap((p) => p.events.map((e) => e.uniqueId));
    expect(sent.sort()).toEqual(generated.sort());
    expect(plan.totals.events).toBe(generated.length);
    for (const step of of(plan.steps, "events")) {
      const ids = eventEntries(step).flatMap((e) => e.attributes.events.data.map((ev: any) => ev.attributes.unique_id));
      // Klaviyo rejects the whole request (400) on a repeated unique_id.
      expect(new Set(ids).size).toBe(ids.length);
      expect(step.items).toBe(ids.length);
    }
  });

  it("orders steps so that later ones never undo earlier ones", () => {
    const kinds = buildPlan(generateDataset({ now: NOW })).steps.map((s) => s.kind);
    const order = ["import", "events", "suppress", "unsuppress", "subscribe_sms"];
    expect(kinds.map((k) => order.indexOf(k))).toEqual([...kinds.map((k) => order.indexOf(k))].sort((a, b) => a - b));
    expect([...new Set(kinds)]).toEqual(order);
  });

  it("builds payloads in the documented shape", () => {
    const ds = generateDataset({ now: NOW });
    const plan = buildPlan(ds);

    const importStep = of(plan.steps, "import")[0]!;
    expect((importStep.body as any).data.type).toBe("profile-bulk-import-job");
    const first = importProfiles(importStep)[0];
    expect(first).toMatchObject({ type: "profile", attributes: { email: ds.profiles[0]!.email } });
    expect(first.attributes.properties).toMatchObject({
      [SEED_PROPERTIES.run]: ds.runTag,
      [SEED_PROPERTIES.cohort]: "recent_purchaser",
      [SEED_PROPERTIES.now]: "2026-11-25T12:00:00.000Z",
      [SEED_PROPERTIES.expected]: "protected:recent_purchase",
    });
    // A phone number Klaviyo dislikes would fail the whole import; it only travels in the SMS step.
    expect(JSON.stringify(importStep.body)).not.toContain("phone_number");

    const eventStep = of(plan.steps, "events")[0]!;
    expect((eventStep.body as any).data.type).toBe("event-bulk-create-job");
    for (const entry of eventEntries(eventStep)) {
      expect(entry.type).toBe("event-bulk-create");
      expect(entry.attributes.backfill).toBe(true);
      for (const event of entry.attributes.events.data) {
        expect(event.attributes.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
        expect(event.attributes.metric.data).toEqual({ type: "metric", attributes: { name: expect.any(String) } });
      }
    }
    const allEvents = of(plan.steps, "events").flatMap((s) => eventEntries(s).flatMap((e) => e.attributes.events.data));
    const opens = allEvents.filter((e) => e.attributes.metric.data.attributes.name === "Opened Email");
    expect(opens.some((e) => e.attributes.properties[MACHINE_OPEN_PROPERTY] === true)).toBe(true);
    expect(opens.every((e) => typeof e.attributes.properties[MACHINE_OPEN_PROPERTY] === "boolean")).toBe(true);
    const orders = allEvents.filter((e) => e.attributes.metric.data.attributes.name === "Placed Order");
    expect(orders.every((e) => e.attributes.value > 0 && e.attributes.value_currency === "USD")).toBe(true);

    const suppress = of(plan.steps, "suppress")[0]!;
    expect((suppress.body as any).data.type).toBe("profile-suppression-bulk-create-job");
    expect(of(plan.steps, "unsuppress")[0]!.body).toMatchObject({ data: { type: "profile-suppression-bulk-delete-job" } });

    const sms = of(plan.steps, "subscribe_sms")[0]!.body as any;
    expect(sms.data.type).toBe("profile-subscription-bulk-create-job");
    expect(sms.data.attributes.historical_import).toBe(true);
    for (const p of sms.data.attributes.profiles.data) {
      expect(p.attributes.phone_number).toMatch(/^\+1\d{10}$/);
      expect(p.attributes.subscriptions).toEqual({ sms: { marketing: { consent: "SUBSCRIBED", consented_at: expect.any(String) } } });
      // historical_import requires consented_at in the past.
      expect(Date.parse(p.attributes.subscriptions.sms.marketing.consented_at)).toBeLessThan(NOW.getTime());
    }
  });

  it("suppresses exactly the suppressed and reactivated cohorts, and unsuppresses only the latter", () => {
    const ds = generateDataset({ now: NOW });
    const plan = buildPlan(ds);
    const emailsOf = (kind: PlanStep["kind"]) => of(plan.steps, kind).flatMap((s) => importProfiles(s).map((p) => p.attributes.email)).sort();
    const cohort = (id: string) => ds.profiles.filter((p) => p.cohort === id).map((p) => p.email);
    expect(emailsOf("suppress")).toEqual([...cohort("already_suppressed"), ...cohort("reactivated")].sort());
    expect(emailsOf("unsuppress")).toEqual(cohort("reactivated").sort());
    // Bulk subscribe lifts USER_SUPPRESSED, so the SMS cohort must not overlap the suppressed one.
    const sms = new Set(ds.profiles.filter((p) => p.smsConsent).map((p) => p.email));
    expect(emailsOf("suppress").some((e) => sms.has(e))).toBe(false);
  });

  it("puts the protected cohort in its own import job when a list is given", () => {
    const ds = generateDataset({ now: NOW });
    const imports = of(buildPlan(ds, { protectedListId: "LiSt01" }).steps, "import");
    expect(imports).toHaveLength(2);
    expect((imports[0]!.body as any).data.relationships).toBeUndefined();
    expect((imports[1]!.body as any).data.relationships).toEqual({ lists: { data: [{ type: "list", id: "LiSt01" }] } });
    expect(importProfiles(imports[1]!).every((p) => p.attributes.properties[SEED_PROPERTIES.cohort] === "protected_group")).toBe(true);
    expect(imports[0]!.items + imports[1]!.items).toBe(ds.count);
  });

  it("drops the SMS step with skipSms and says what that means", () => {
    const plan = buildPlan(generateDataset({ now: NOW }), { skipSms: true });
    expect(of(plan.steps, "subscribe_sms")).toEqual([]);
    expect(plan.notes.join(" ")).toContain("--skip-sms");
  });

  it("is stable: same options give the same step ids and payloads", () => {
    const a = buildPlan(generateDataset({ now: NOW }));
    const b = buildPlan(generateDataset({ now: NOW }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(new Set(a.steps.map((s) => s.id)).size).toBe(a.steps.length);
  });

  it("prints counts per cohort, request counts and an estimated duration", () => {
    const ds = generateDataset({ now: NOW });
    const text = formatPlan(ds, buildPlan(ds));
    expect(text).toMatch(/lapsed\s+378/);
    expect(text).toMatch(/Total: \d+ requests/);
    expect(text).toMatch(/Estimated duration: about \d+ min/);
  });
});
