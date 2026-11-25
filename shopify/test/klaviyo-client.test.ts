import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAccount,
  getProfileEmails,
  getProfilesUsage,
  getSuppressionJob,
  isMachineOpen,
  listEngagementEventsPage,
  listGroupMemberIdsPage,
  listGroupsPage,
  listMetricsPage,
  listProfilesPage,
  pickProfilesUsage,
  resolveMetrics,
  submitSuppressionJob,
  type BillingUsageRow,
  type KlaviyoProfileRecord,
} from "../app/klaviyo/api";
import { KlaviyoClient, filterString, nextCursor } from "../app/klaviyo/client";
import { KLAVIYO_REVISION, SEEDED_METRIC_SPECS } from "../app/klaviyo/config";
import { KlaviyoApiError } from "../app/klaviyo/errors";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { hashEmail } from "@tiersaver/core";

/** A client on a fake clock: `sleep` advances time instead of waiting. */
function setup(options: { maxAttempts?: number; maxWaitMs?: number; subrequestBudget?: number } = {}) {
  const fake = new FakeKlaviyo();
  let clock = Date.parse("2026-11-25T12:00:00Z");
  fake.now = () => clock;
  let token = fake.issueTokens("all").accessToken;
  const sleeps: number[] = [];
  const tokenCalls: (boolean | undefined)[] = [];
  const client = new KlaviyoClient({
    getAccessToken: async (opts) => {
      tokenCalls.push(opts?.forceRefresh);
      if (opts?.forceRefresh) token = fake.issueTokens("all").accessToken;
      return token;
    },
    fetch: fake.fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...options,
  });
  return { fake, client, sleeps, tokenCalls, currentToken: () => token };
}

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  expect(logged.join("\n")).toBe("");
  vi.restoreAllMocks();
});

describe("KlaviyoClient", () => {
  it("sends the bearer token, the pinned revision and JSON:API media types", async () => {
    const { fake, client, currentToken } = setup();
    const account = await getAccount(client);
    expect(account).toEqual({ id: "ACC001", testAccount: true, organizationName: "Fake Org", timezone: "US/Eastern" });
    const sent = fake.requests[0]!;
    expect(sent.url.origin).toBe("https://a.klaviyo.com");
    expect(sent.headers.get("Authorization")).toBe(`Bearer ${currentToken()}`);
    expect(sent.headers.get("revision")).toBe(KLAVIYO_REVISION);
    expect(sent.headers.get("revision")).toBe("2026-10-15");
    expect(sent.headers.get("Accept")).toBe("application/vnd.api+json");
    expect(sent.url.searchParams.get("fields[account]")).toBe("test_account,timezone,contact_information.organization_name");
  });

  it("waits for Retry-After on a 429 and then succeeds", async () => {
    const { fake, client, sleeps } = setup();
    fake.failNext(/^\/api\/metrics/, () => FakeKlaviyo.rateLimited(3), 2);
    const page = await listMetricsPage(client);
    expect(page.items).toEqual([]);
    expect(sleeps).toEqual([3000, 3000]);
    expect(fake.requestsTo(/^\/api\/metrics/)).toHaveLength(3);
  });

  it("gives up with a retryable error when Klaviyo asks for a longer wait than the budget", async () => {
    const { fake, client, sleeps } = setup({ maxWaitMs: 10_000 });
    fake.failNext(/^\/api\/metrics/, () => FakeKlaviyo.rateLimited(45));
    const err = await listMetricsPage(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KlaviyoApiError);
    expect(err).toMatchObject({ code: "klaviyo_429_throttled", status: 429, retryable: true, retryAfterMs: 45_000 });
    expect(sleeps).toEqual([]);
    expect(fake.requestsTo(/^\/api\/metrics/)).toHaveLength(1);
  });

  it("retries 5xx with exponential backoff and a bounded number of attempts", async () => {
    const { fake, client, sleeps } = setup({ maxAttempts: 4 });
    fake.failNext(/^\/api\/metrics/, () => FakeKlaviyo.serverError(503), 2);
    await listMetricsPage(client);
    // random() = 0.5: half of 500 ms, then half of 1,000 ms.
    expect(sleeps).toEqual([250, 500]);

    fake.failNext(/^\/api\/metrics/, () => FakeKlaviyo.serverError(500), 10);
    const before = fake.requestsTo(/^\/api\/metrics/).length;
    const err = await listMetricsPage(client).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "klaviyo_500_server_error", retryable: true });
    expect(fake.requestsTo(/^\/api\/metrics/).length - before).toBe(4);
  });

  it("retries a transport failure and reports it without the cause", async () => {
    const fake = new FakeKlaviyo();
    const token = fake.issueTokens("all").accessToken;
    let calls = 0;
    let clock = 0;
    const client = new KlaviyoClient({
      getAccessToken: async () => token,
      fetch: async () => {
        calls++;
        throw new TypeError(`connect failed https://a.klaviyo.com/api/profiles?filter=equals(email,"jane@shop.test") ${token}`);
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      maxAttempts: 3,
    });
    const err = (await listMetricsPage(client).catch((e: unknown) => e)) as KlaviyoApiError;
    expect(calls).toBe(3);
    expect(err).toMatchObject({ code: "klaviyo_network_error", retryable: true });
    expect(`${String(err)} ${JSON.stringify(err)} ${err.stack}`).not.toMatch(/jane@shop\.test|access-/);
  });

  it("does not retry a 4xx and keeps only the error code", async () => {
    const { fake, client, currentToken } = setup();
    fake.failNext(/^\/api\/profiles/, () =>
      FakeKlaviyo.clientError(400, "invalid", "Invalid email address: jane.doe@merchant-customer.test"),
    );
    const err = (await listProfilesPage(client).catch((e: unknown) => e)) as KlaviyoApiError;
    expect(err).toBeInstanceOf(KlaviyoApiError);
    expect(err).toMatchObject({ code: "klaviyo_400_invalid", status: 400, retryable: false });
    expect(err.message).toBe("klaviyo_400_invalid");
    const text = `${String(err)} ${JSON.stringify(err)} ${err.stack}`;
    expect(text).not.toContain("jane.doe");
    expect(text).not.toContain(currentToken());
    expect(fake.requestsTo(/^\/api\/profiles/)).toHaveLength(1);
  });

  it("replaces an error code that is not a plain identifier", async () => {
    const { fake, client } = setup();
    fake.failNext(/^\/api\/accounts/, () => FakeKlaviyo.clientError(409, "Conflict for jane@shop.test"));
    const err = (await getAccount(client).catch((e: unknown) => e)) as KlaviyoApiError;
    expect(err.code).toBe("klaviyo_409_error");
  });

  it("asks for a refreshed token once after a 401, then gives up", async () => {
    const { fake, client, tokenCalls } = setup();
    fake.expireAccessTokens();
    await getAccount(client);
    expect(tokenCalls).toEqual([undefined, true]);
    expect(fake.requestsTo(/^\/api\/accounts/)).toHaveLength(2);

    // A token that stays rejected: one forced refresh, then the 401 surfaces.
    const stubborn = new FakeKlaviyo();
    const forced: (boolean | undefined)[] = [];
    const bad = new KlaviyoClient({
      getAccessToken: async (opts) => {
        forced.push(opts?.forceRefresh);
        return "not-a-token";
      },
      fetch: stubborn.fetch,
    });
    const err = await listMetricsPage(bad).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "klaviyo_401_authentication_failed", retryable: false });
    expect(forced).toEqual([undefined, true]);
  });

  it("paces an endpoint at half its published limit", async () => {
    const { client, sleeps } = setup({ maxWaitMs: 60_000 });
    // GET /api/accounts: 1/s burst, 15/m steady -> one token, refilled every 8 seconds.
    await getAccount(client);
    await getAccount(client);
    expect(sleeps).toEqual([8000]);
  });

  it("stops before exceeding its subrequest budget", async () => {
    const { fake, client } = setup({ subrequestBudget: 3 });
    for (let i = 0; i < 3; i++) await listMetricsPage(client);
    const err = await listMetricsPage(client).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "klaviyo_subrequest_budget_exhausted", retryable: true });
    expect(client.requestCount).toBe(3);
    expect(fake.requests).toHaveLength(3);
  });

  it("reads cursors from links.next and escapes filter strings", () => {
    expect(nextCursor({ next: "https://a.klaviyo.com/api/profiles/?page%5Bcursor%5D=bmV4dDo6aWQ6Ok43dW1iVw" })).toBe(
      "bmV4dDo6aWQ6Ok43dW1iVw",
    );
    expect(nextCursor({ next: null })).toBeNull();
    expect(nextCursor(undefined)).toBeNull();
    expect(nextCursor({ next: "https://a.klaviyo.com/api/profiles/" })).toBeNull();
    expect(filterString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("API functions", () => {
  it("lists profiles page by page, resumable from any cursor, without exposing emails", async () => {
    const { fake, client } = setup({ maxWaitMs: 600_000 });
    for (let i = 0; i < 250; i++) {
      const id = `01PROFILE${String(i).padStart(5, "0")}`;
      fake.profiles.set(id, { id, email: `person${i}@buyers.test`, created: "2025-01-15T10:00:00+00:00" });
    }
    const seen: KlaviyoProfileRecord[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      // A new call per page: nothing but the cursor carries over, as across Worker invocations.
      const page = await listProfilesPage(client, { cursor });
      seen.push(...page.items);
      cursor = page.nextCursor;
      cursors.push(cursor);
    } while (cursor);
    expect(seen).toHaveLength(250);
    expect(new Set(seen.map((p) => p.id)).size).toBe(250);
    expect(cursors).toHaveLength(3);
    expect(cursors[2]).toBeNull();

    const sent = fake.requestsTo(/^\/api\/profiles/)[0]!;
    expect(sent.url.searchParams.get("page[size]")).toBe("100");
    expect(sent.url.searchParams.get("additional-fields[profile]")).toBe("subscriptions");
    expect(sent.url.searchParams.get("sort")).toBe("created");
    expect(sent.url.searchParams.get("fields[profile]")).toBe(
      [
        "email",
        "created",
        "last_event_date",
        "subscriptions.email.marketing.can_receive_email_marketing",
        "subscriptions.email.marketing.consent",
        "subscriptions.email.marketing.consent_timestamp",
        "subscriptions.email.marketing.suppression",
        "subscriptions.sms.marketing.can_receive_sms_marketing",
        "subscriptions.sms.marketing.consent",
      ].join(","),
    );

    expect(seen[0]!.emailHash).toBe(await hashEmail("person0@buyers.test"));
    expect(JSON.stringify(seen)).not.toContain("@buyers.test");
  });

  it("maps consent, suppression and missing data of a profile", async () => {
    const { fake, client } = setup();
    fake.profiles.set("A", {
      id: "A",
      email: "A@Buyers.test ",
      created: "2025-03-01T00:00:00+00:00",
      lastEventDate: "2026-10-01T00:00:00+00:00",
      suppression: ["USER_SUPPRESSED"],
      emailConsentTimestamp: "2025-04-01T00:00:00+00:00",
      smsConsent: "SUBSCRIBED",
      canReceiveSms: true,
    });
    fake.profiles.set("B", { id: "B", email: null, created: null, omitSubscriptions: true });
    fake.profiles.set("C", { id: "C", email: "", omitSms: true });
    const { items } = await listProfilesPage(client);
    const [a, b, c] = items as [KlaviyoProfileRecord, KlaviyoProfileRecord, KlaviyoProfileRecord];
    expect(a).toEqual({
      id: "A",
      emailHash: await hashEmail("a@buyers.test"),
      createdAt: new Date("2025-03-01T00:00:00Z"),
      lastEventAt: new Date("2026-10-01T00:00:00Z"),
      email: {
        canReceiveMarketing: false,
        consent: "SUBSCRIBED",
        consentAt: new Date("2025-04-01T00:00:00Z"),
        suppressionReasons: ["USER_SUPPRESSED"],
      },
      sms: { canReceiveMarketing: true, consent: "SUBSCRIBED" },
    });
    expect(b).toMatchObject({ id: "B", emailHash: null, createdAt: null, email: null, sms: null });
    expect(c).toMatchObject({ id: "C", emailHash: null, sms: null });
    expect(c.email).not.toBeNull();
  });

  it("reads the seeded creation date only when asked to", async () => {
    const { fake, client } = setup();
    fake.profiles.set("S", { id: "S", email: "s@buyers.test", properties: { ts_seed_created_at: "2024-06-01T00:00:00Z", other: "x" } });
    const plain = await listProfilesPage(client);
    expect(plain.items[0]).not.toHaveProperty("testCreatedAt");
    expect(fake.requests.at(-1)!.url.searchParams.get("fields[profile]")).not.toContain("properties");
    const seeded = await listProfilesPage(client, { testCreatedAtProperty: "ts_seed_created_at" });
    expect(seeded.items[0]!.testCreatedAt).toEqual(new Date("2024-06-01T00:00:00Z"));
  });

  it("looks up current emails by id and refuses more ids than one request should carry", async () => {
    const { fake, client } = setup();
    fake.profiles.set("P1", { id: "P1", email: "one@buyers.test" });
    fake.profiles.set("P2", { id: "P2", email: null });
    fake.profiles.set("P4", { id: "P4", email: "four@buyers.test" });
    const emails = await getProfileEmails(client, ["P1", "P2", "P3"]);
    expect([...emails]).toEqual([
      ["P1", "one@buyers.test"],
      ["P2", null],
    ]);
    const sent = fake.requests.at(-1)!;
    expect(sent.url.searchParams.get("filter")).toBe('any(id,["P1","P2","P3"])');
    expect(sent.url.searchParams.get("fields[profile]")).toBe("email");
    expect(sent.url.searchParams.has("additional-fields[profile]")).toBe(false);

    const tooMany = Array.from({ length: 51 }, (_, i) => `X${i}`);
    await expect(getProfileEmails(client, tooMany)).rejects.toMatchObject({ code: "klaviyo_too_many_profile_ids" });
    expect(await getProfileEmails(client, [])).toEqual(new Map());
  });

  it("identifies the active-profiles usage type and never guesses", async () => {
    const { fake, client } = setup();
    fake.billingUsage = [
      { id: "email_sends", usage_used: 84210, usage_max: 250000, unit: "messages" },
      { id: "customer_hub_active_profiles", usage_used: 100, usage_max: 500, unit: "profiles" },
      { id: "active_profiles", usage_used: 12450, usage_max: 15000, unit: "profiles" },
    ];
    const found = await getProfilesUsage(client);
    expect(found.usage).toMatchObject({
      usageTypeId: "active_profiles",
      usageUsed: 12450,
      usageMax: 15000,
      unit: "profiles",
      periodStart: new Date("2026-11-08T05:00:00Z"),
      periodEnd: new Date("2026-12-08T05:00:00Z"),
    });
    expect(found.candidates).toEqual(["customer_hub_active_profiles", "active_profiles"]);
    expect(fake.requests.at(-1)!.url.search).toBe("");

    const row = (usageTypeId: string, unit = "profiles"): BillingUsageRow => ({
      usageTypeId,
      unit,
      usageUsed: 1,
      usageMax: 2,
      periodStart: null,
      periodEnd: null,
      asOf: null,
    });
    // Free plan: no rows at all.
    expect(pickProfilesUsage([])).toEqual({ usage: null, candidates: [] });
    // Only another product's profile count: not ours.
    expect(pickProfilesUsage([row("customer_hub_active_profiles"), row("total_profiles")]).usage).toBeNull();
    // An undocumented single profile row is accepted; two are ambiguous.
    expect(pickProfilesUsage([row("email_active_profiles"), row("email_sends", "messages")]).usage?.usageTypeId).toBe("email_active_profiles");
    expect(pickProfilesUsage([row("new_a"), row("new_b")]).usage).toBeNull();
    // A stored id wins, and a stored id that vanished is "unknown", not a fallback.
    expect(pickProfilesUsage([row("active_profiles"), row("legacy_profiles")], "legacy_profiles").usage?.usageTypeId).toBe("legacy_profiles");
    expect(pickProfilesUsage([row("active_profiles")], "legacy_profiles").usage).toBeNull();
  });

  it("resolves metrics by name and integration, with an override for the seeded test account", async () => {
    const { fake, client } = setup();
    fake.metrics = [
      { id: "NATIVE_OPEN", name: "Opened Email", integration: { name: "Klaviyo", category: "Internal" } },
      { id: "API_OPEN", name: "Opened Email", integration: { name: "API", category: "API" } },
      { id: "NATIVE_CLICK", name: "Clicked Email", integration: { name: "Klaviyo", category: "Internal" } },
      { id: "SHOPIFY_ORDER", name: "Placed Order", integration: { name: "Shopify", category: "eCommerce" } },
      { id: "API_ORDER", name: "Placed Order", integration: { name: "API", category: "API" } },
      { id: "SHOPIFY_CHECKOUT", name: "Checkout Started", integration: { name: "Shopify", category: "eCommerce" } },
      { id: "OTHER", name: "Opened Push", integration: { name: "Klaviyo", category: "Internal" } },
    ];
    const { items } = await listMetricsPage(client);
    expect(fake.requests.at(-1)!.url.searchParams.get("fields[metric]")).toBe("name,integration");

    expect(resolveMetrics(items)).toEqual({
      open: ["NATIVE_OPEN"],
      click: ["NATIVE_CLICK"],
      purchase: ["SHOPIFY_ORDER"],
      checkout: ["SHOPIFY_CHECKOUT"],
      activeOnSite: [],
    });
    expect(resolveMetrics(items, SEEDED_METRIC_SPECS)).toEqual({
      open: ["API_OPEN"],
      click: [],
      purchase: ["API_ORDER"],
      checkout: [],
      activeOnSite: [],
    });
    expect(resolveMetrics(items, { open: { names: ["Opened Email"], integrations: ["Klaviyo", "API"] } }).open).toEqual([
      "NATIVE_OPEN",
      "API_OPEN",
    ]);
  });

  it("reads engagement events of one metric page by page and counts what it cannot attribute", async () => {
    const { fake, client } = setup();
    const since = new Date("2026-08-27T12:00:00Z");
    fake.events = [
      { metricId: "OPEN", profileId: "P1", datetime: "2026-08-01T00:00:00+00:00" }, // before the window
      { metricId: "OPEN", profileId: "P1", datetime: "2026-09-01T00:00:00+00:00", properties: { "Apple Privacy Open": true } },
      { metricId: "OPEN", profileId: "P2", datetime: "2026-09-02T00:00:00+00:00", properties: { "Machine Open": "True" } },
      { metricId: "OPEN", profileId: "P3", datetime: "2026-09-03T00:00:00+00:00", properties: { "Apple Privacy Open": false } },
      { metricId: "OPEN", profileId: null, datetime: "2026-09-04T00:00:00+00:00" },
      { metricId: "CLICK", profileId: "P9", datetime: "2026-09-05T00:00:00+00:00" },
    ];
    const first = await listEngagementEventsPage(client, { metricId: "OPEN", since, withProperties: true, pageSize: 2 });
    const sent = fake.requests.at(-1)!;
    expect(sent.url.searchParams.get("filter")).toBe('equals(metric_id,"OPEN"),greater-or-equal(datetime,2026-08-27T12:00:00Z)');
    expect(sent.url.searchParams.get("fields[event]")).toBe("datetime,event_properties");
    expect(sent.url.searchParams.get("sort")).toBe("datetime");
    expect(first.items).toEqual([
      { profileId: "P1", at: new Date("2026-09-01T00:00:00Z"), machineOpen: true },
      { profileId: "P2", at: new Date("2026-09-02T00:00:00Z"), machineOpen: true },
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listEngagementEventsPage(client, {
      metricId: "OPEN",
      since,
      withProperties: true,
      pageSize: 2,
      cursor: first.nextCursor,
    });
    expect(second.items).toEqual([{ profileId: "P3", at: new Date("2026-09-03T00:00:00Z"), machineOpen: false }]);
    expect(second.unattributed).toBe(1);
    expect(second.nextCursor).toBeNull();

    // Without properties every open counts as a person's, and the default page is the maximum.
    const light = await listEngagementEventsPage(client, { metricId: "OPEN", since });
    expect(fake.requests.at(-1)!.url.searchParams.get("fields[event]")).toBe("datetime");
    expect(fake.requests.at(-1)!.url.searchParams.get("page[size]")).toBe("1000");
    expect(light.items.every((e) => e.machineOpen === false)).toBe(true);
  });

  it("treats a machine-open flag as set only when it is clearly true", () => {
    expect(isMachineOpen({ "Apple Privacy Open": true })).toBe(true);
    expect(isMachineOpen({ "Machine Open": true })).toBe(true);
    expect(isMachineOpen({ "Machine Open": "true" })).toBe(true);
    for (const props of [
      {},
      null,
      undefined,
      "x",
      { "Apple Privacy Open": false },
      { "Apple Privacy Open": "maybe" },
      { "Apple Privacy Open": 1 },
      { "Apple Privacy Open": null },
      { "apple privacy open": true },
      { "Bot Open": true },
    ]) {
      expect(isMachineOpen(props)).toBe(false);
    }
  });

  it("lists lists and segments 10 at a time and their member ids 100 at a time", async () => {
    const { fake, client } = setup();
    fake.lists = Array.from({ length: 12 }, (_, i) => ({ id: `L${i}`, name: `List ${i}`, members: [] }));
    fake.segments = [{ id: "S1", name: "VIP", isActive: true, members: Array.from({ length: 150 }, (_, i) => `M${i}`) }];
    const lists = await listGroupsPage(client, "list");
    expect(lists.items).toHaveLength(10);
    expect(fake.requests.at(-1)!.url.searchParams.get("page[size]")).toBe("10");
    const rest = await listGroupsPage(client, "list", { cursor: lists.nextCursor });
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();

    const segments = await listGroupsPage(client, "segment");
    expect(segments.items).toEqual([{ kind: "segment", id: "S1", name: "VIP", isActive: true }]);

    const members = await listGroupMemberIdsPage(client, { kind: "segment", id: "S1" });
    expect(fake.requests.at(-1)!.url.pathname).toBe("/api/segments/S1/relationships/profiles");
    expect(members.items).toHaveLength(100);
    const more = await listGroupMemberIdsPage(client, { kind: "segment", id: "S1" }, { cursor: members.nextCursor });
    expect(more.items).toHaveLength(50);
    expect(more.nextCursor).toBeNull();

    await expect(listGroupMemberIdsPage(client, { kind: "list", id: "GONE" })).rejects.toMatchObject({ code: "klaviyo_404_not_found" });
    await expect(listGroupMemberIdsPage(client, { kind: "list", id: "../accounts" })).rejects.toMatchObject({ code: "klaviyo_invalid_id" });
  });

  it("submits suppress and unsuppress jobs of at most 100 emails and reads their status", async () => {
    const { fake, client } = setup();
    const emails = Array.from({ length: 100 }, (_, i) => `p${i}@buyers.test`);
    const job = await submitSuppressionJob(client, "suppress", emails);
    expect(job).toMatchObject({ id: "JOB0001", status: "queued", totalCount: 100 });
    const sent = fake.requests.at(-1)!;
    expect(sent.method).toBe("POST");
    expect(sent.url.pathname).toBe("/api/profile-suppression-bulk-create-jobs");
    expect(sent.headers.get("Content-Type")).toBe("application/vnd.api+json");
    const body = JSON.parse(sent.body);
    expect(body.data.type).toBe("profile-suppression-bulk-create-job");
    expect(body.data.attributes.profiles.data[0]).toEqual({ type: "profile", attributes: { email: "p0@buyers.test" } });
    expect(body.data.relationships).toBeUndefined();

    expect(await getSuppressionJob(client, "suppress", job.id)).toMatchObject({ status: "complete", completedCount: 100, skippedCount: 0 });

    const undo = await submitSuppressionJob(client, "unsuppress", emails.slice(0, 3));
    expect(fake.requests.at(-1)!.url.pathname).toBe("/api/profile-suppression-bulk-delete-jobs");
    expect(JSON.parse(fake.requests.at(-1)!.body).data.type).toBe("profile-suppression-bulk-delete-job");
    expect(fake.suppressed.size).toBe(97);
    expect(await getSuppressionJob(client, "unsuppress", undo.id)).toMatchObject({ status: "complete" });

    const before = fake.requests.length;
    await expect(submitSuppressionJob(client, "suppress", [...emails, "one-more@buyers.test"])).rejects.toMatchObject({
      code: "klaviyo_suppression_batch_too_large",
    });
    await expect(submitSuppressionJob(client, "suppress", [])).rejects.toMatchObject({ code: "klaviyo_suppression_batch_empty" });
    expect(fake.requests.length).toBe(before);
  });
});
