import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDataset } from "../src/generate.js";
import { buildPlan } from "../src/plan.js";
import { SeedRefusal, executeSeed, verifySeed, type RunConfig, type RunDeps } from "../src/run.js";
import { loadState } from "../src/state.js";
import { FakeKlaviyo, TEST_KEY, fakeTime } from "./fake-klaviyo.js";

const NOW = new Date("2026-11-25T12:00:00Z");
let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "ts-seed-test-"));
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seed: 7,
    count: 2000,
    now: null,
    emailDomain: "seed.tiersaver-test.dev",
    runTag: "ts-seed-7",
    accountId: "TsTest",
    expectAccountName: null,
    allowNonTestAccount: false,
    allowReservedDomain: false,
    protectedListId: null,
    skipSms: false,
    stateDir,
    ...overrides,
  };
}

function harness(server = new FakeKlaviyo()) {
  const time = fakeTime(NOW.getTime());
  const logs: string[] = [];
  const deps: RunDeps = {
    env: { KLAVIYO_TEST_PRIVATE_KEY: TEST_KEY },
    fetch: server.fetch,
    sleep: time.sleep,
    clock: time.clock,
    random: () => 0.5,
    log: (m) => logs.push(m),
  };
  return { server, time, logs, deps };
}

const writes = (server: FakeKlaviyo) => server.requests.filter((r) => r.method !== "GET");
const expectedPlan = (overrides: Partial<RunConfig> = {}) => {
  const c = config(overrides);
  return buildPlan(generateDataset({ seed: c.seed, count: c.count, now: NOW, emailDomain: c.emailDomain, runTag: c.runTag }), {
    protectedListId: c.protectedListId ?? undefined,
    skipSms: c.skipSms,
  });
};

describe("executeSeed: refusals (nothing is written)", () => {
  it("refuses without --account-id or --expect-account-name, before any request", async () => {
    const { server, deps } = harness();
    await expect(executeSeed(config({ accountId: null }), deps)).rejects.toBeInstanceOf(SeedRefusal);
    expect(server.requests).toEqual([]);
  });

  it("refuses without the key in the environment, before any request", async () => {
    const { server, deps } = harness();
    await expect(executeSeed(config(), { ...deps, env: {} })).rejects.toThrow(/KLAVIYO_TEST_PRIVATE_KEY is not set/);
    await expect(executeSeed(config(), { ...deps, env: { KLAVIYO_TEST_PRIVATE_KEY: "  " } })).rejects.toBeInstanceOf(SeedRefusal);
    expect(server.requests).toEqual([]);
  });

  it.each(["example.com", "mail.example.com", "test.com", "example.org", "shop.test", "foo.invalid"])(
    "refuses the reserved domain %s, whose events Klaviyo drops, before any request",
    async (emailDomain) => {
      const { server, deps } = harness();
      await expect(executeSeed(config({ emailDomain }), deps)).rejects.toThrow(/silently drops events/);
      expect(server.requests).toEqual([]);
    },
  );

  it("refuses when the key belongs to another account id", async () => {
    const { server, deps } = harness();
    server.account = { id: "MERCH1", organizationName: "A Real Merchant", testAccount: true };
    await expect(executeSeed(config(), deps)).rejects.toThrow(/belongs to account MERCH1/);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/accounts"]);
    expect(readdirSync(stateDir)).toEqual([]);
  });

  it("refuses when the organization name does not match, and requires both when both are given", async () => {
    const { server, deps } = harness();
    await expect(executeSeed(config({ accountId: null, expectAccountName: "Some Other Shop" }), deps)).rejects.toBeInstanceOf(SeedRefusal);
    await expect(executeSeed(config({ expectAccountName: "Some Other Shop" }), deps)).rejects.toBeInstanceOf(SeedRefusal);
    expect(writes(server)).toEqual([]);
  });

  it("accepts a name match regardless of case and surrounding spaces", async () => {
    const { server, deps } = harness();
    await executeSeed(config({ accountId: null, expectAccountName: "  tiersaver TEST " }), deps);
    expect(server.profiles.size).toBe(2000);
  });

  it("refuses an account Klaviyo does not flag as test, unless explicitly allowed", async () => {
    const { server, deps } = harness();
    server.account.testAccount = false;
    await expect(executeSeed(config(), deps)).rejects.toThrow(/not flagged as a test account/);
    expect(writes(server)).toEqual([]);
    await executeSeed(config({ allowNonTestAccount: true }), deps);
    expect(server.profiles.size).toBe(2000);
  });

  it("refuses when the account endpoint returns anything but exactly one account", async () => {
    const { server, deps } = harness();
    server.failNext("GET", /accounts/, { status: 200, body: { data: [] } });
    await expect(executeSeed(config(), deps)).rejects.toBeInstanceOf(SeedRefusal);
    expect(writes(server)).toEqual([]);
  });
});

describe("executeSeed: full run", () => {
  it("runs every step of the plan in order and leaves the account in the expected shape", async () => {
    const { server, deps } = harness();
    const plan = expectedPlan();
    const result = await executeSeed(config(), deps);

    expect(writes(server).map((r) => r.path)).toEqual(plan.steps.map((s) => `/api/${{ import: "profile-bulk-import-jobs", events: "event-bulk-create-jobs", suppress: "profile-suppression-bulk-create-jobs", unsuppress: "profile-suppression-bulk-delete-jobs", subscribe_sms: "profile-subscription-bulk-create-jobs" }[s.kind]}`));
    expect(server.requests[0]).toMatchObject({ method: "GET", path: "/api/accounts" });
    expect(server.profiles.size).toBe(2000);
    expect(server.events.size).toBe(plan.totals.events);
    expect(server.suppressed.size).toBe(plan.totals.suppressed);
    expect(server.smsConsent.size).toBe(plan.totals.sms);
    expect(result).toMatchObject({ accountId: "TsTest", stepsRun: plan.steps.length, stepsSkipped: 0, warnings: [] });
    expect(result.now.toISOString()).toBe(NOW.toISOString());

    const state = loadState(stateDir, "ts-seed-7")!;
    expect(Object.keys(state.steps)).toEqual(plan.steps.map((s) => s.id));
    expect(Object.values(state.steps).every((s) => s.status === "done")).toBe(true);
    expect(state.fingerprint).toEqual({ seed: 7, count: 2000, emailDomain: "seed.tiersaver-test.dev", now: NOW.toISOString(), accountId: "TsTest", protectedListId: null });
  });

  it("waits for each job to complete before the next step", async () => {
    const { server, deps } = harness();
    server.pollsUntilComplete = 3;
    await executeSeed(config(), deps);
    const sequence = server.requests.map((r) => `${r.method} ${r.path.replace(/job-\d+/, "JOB")}`);
    const firstEvents = sequence.indexOf("POST /api/event-bulk-create-jobs");
    expect(sequence.slice(1, firstEvents)).toEqual([
      "POST /api/profile-bulk-import-jobs",
      ...Array.from({ length: 4 }, () => "GET /api/profile-bulk-import-jobs/JOB"),
    ]);
    const unsuppress = sequence.indexOf("POST /api/profile-suppression-bulk-delete-jobs");
    expect(sequence.slice(unsuppress - 4, unsuppress).every((s) => s === "GET /api/profile-suppression-bulk-create-jobs/JOB")).toBe(true);
  });

  it("reports failed imports and skipped suppressions as warnings", async () => {
    const { server, deps } = harness();
    server.failNext("GET", /profile-bulk-import-jobs\/job-1$/, { status: 200, body: { data: { id: "job-1", attributes: { status: "complete", total_count: 2000, completed_count: 1998, failed_count: 2 } } } });
    server.failNext("GET", /import-errors/, { status: 200, body: { data: [{ attributes: { code: "invalid", detail: "Invalid email" } }] } });
    server.failNext("GET", /suppression-bulk-create-jobs\/job-2$/, { status: 200, body: { data: { id: "job-2", attributes: { status: "complete", total_count: 100, completed_count: 95, skipped_count: 5 } } } });
    const result = await executeSeed(config(), deps);
    expect(result.warnings).toEqual([
      "import:0: 2 profiles failed to import (invalid: Invalid email).",
      "suppress:0: Klaviyo skipped 5 of 100 emails.",
    ]);
  });

  it("keeps the rest of the run when SMS consent is rejected, and retries it next time", async () => {
    const { server, deps } = harness();
    server.failNext("POST", /profile-subscription/, { status: 400, body: { errors: [{ code: "invalid", title: "Invalid input", detail: "SMS is not enabled" }] } });
    const result = await executeSeed(config(), deps);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("SMS is not enabled");
    expect(server.suppressed.size).toBeGreaterThan(0);
    expect(loadState(stateDir, "ts-seed-7")!.steps["subscribe_sms:0"]!.status).toBe("failed");

    const again = await executeSeed(config(), deps);
    expect(again).toMatchObject({ stepsRun: 1, warnings: [] });
    expect(server.smsConsent.size).toBe(80);
  });

  it("flags a partial failure header on the SMS step", async () => {
    const { server, deps } = harness();
    server.failNext("POST", /profile-subscription/, { status: 202, headers: { "X-Klaviyo-Partial-Failure": "phone_number" } });
    expect((await executeSeed(config(), deps)).warnings[0]).toContain("phone_number");
  });

  it("stops on a cancelled job", async () => {
    const { server, deps } = harness();
    server.failNext("GET", /profile-bulk-import-jobs\/job-1$/, { status: 200, body: { data: { id: "job-1", attributes: { status: "cancelled" } } } });
    await expect(executeSeed(config(), deps)).rejects.toThrow(/cancelled job job-1/);
    expect(server.posts("event-bulk")).toEqual([]);
  });
});

describe("executeSeed: resumable and idempotent", () => {
  it("does nothing on a second run with the same seed", async () => {
    const { server, deps } = harness();
    await executeSeed(config(), deps);
    const before = writes(server).length;
    const again = await executeSeed(config(), deps);
    expect(writes(server).length).toBe(before);
    expect(again).toMatchObject({ stepsRun: 0, stepsSkipped: expectedPlan().steps.length, requests: 1 });
    expect(server.profiles.size).toBe(2000);
    expect(server.duplicateEventPosts).toBe(0);
  });

  it("resumes after a failure without re-sending completed steps", async () => {
    const { server, deps, time } = harness();
    const plan = expectedPlan();
    server.failNext("POST", /event-bulk-create-jobs/, { status: 202 }, { status: 202 }, { status: 400, body: { errors: [{ code: "invalid", title: "Invalid input", detail: "nope" }] } });
    await expect(executeSeed(config(), deps)).rejects.toThrow(/400/);
    expect(server.posts("profile-bulk-import-jobs")).toHaveLength(1);
    expect(server.posts("event-bulk-create-jobs")).toHaveLength(3);
    expect(server.posts("suppression")).toEqual([]);

    // Days later: the clock moved, but the dataset must not.
    time.advance(3 * 24 * 60 * 60 * 1000);
    const result = await executeSeed(config(), deps);
    expect(result.now.toISOString()).toBe(NOW.toISOString());
    expect(result.stepsSkipped).toBe(3);
    expect(server.posts("profile-bulk-import-jobs")).toHaveLength(1);
    const eventSteps = plan.steps.filter((s) => s.kind === "events");
    // Steps 0 and 1 were canned (accepted, not stored); 2 failed; the resume sends 2..n once each.
    expect(server.posts("event-bulk-create-jobs")).toHaveLength(3 + eventSteps.length - 2);
    expect(server.posts("event-bulk-create-jobs").slice(3).map((r) => JSON.stringify(r.body))).toEqual(eventSteps.slice(2).map((s) => JSON.stringify(s.body)));
    expect(server.duplicateEventPosts).toBe(0);
    expect(server.profiles.size).toBe(2000);
  });

  it("polls a job submitted by an interrupted run instead of submitting it again", async () => {
    const { server, deps } = harness();
    server.pollsUntilComplete = 1000;
    await expect(executeSeed(config(), { ...deps, pollTimeoutMs: 20_000 })).rejects.toThrow(/Run the same command again/);
    expect(loadState(stateDir, "ts-seed-7")!.steps["import:0"]).toMatchObject({ status: "submitted", jobId: "job-1" });

    server.jobs.get("job-1")!.pollsLeft = 0;
    server.pollsUntilComplete = 0;
    const { logs, deps: deps2 } = harness(server);
    await executeSeed(config(), deps2);
    expect(server.posts("profile-bulk-import-jobs")).toHaveLength(1);
    expect(logs.join("\n")).toContain("already submitted as job job-1");
    expect(server.profiles.size).toBe(2000);
  });

  it("stays safe even if the progress file is lost: identical payloads, upserts and deduped events", async () => {
    const { server, deps } = harness();
    await executeSeed(config({ now: NOW }), deps);
    const first = writes(server).map((r) => JSON.stringify(r.body));
    rmSync(join(stateDir, "ts-seed-7.json"));
    await executeSeed(config({ now: NOW }), deps);
    expect(writes(server).map((r) => JSON.stringify(r.body)).slice(first.length)).toEqual(first);
    expect(server.profiles.size).toBe(2000);
    expect(server.events.size).toBe(expectedPlan().totals.events);
  });

  it.each([
    ["count", { count: 2500 }],
    ["emailDomain", { emailDomain: "other.tiersaver-test.dev" }],
    ["now", { now: new Date("2026-12-01T00:00:00Z") }],
    ["protectedListId", { protectedListId: "LiSt01" }],
  ] as const)("refuses to resume a run with a different %s", async (field, overrides) => {
    const { server, deps } = harness();
    await executeSeed(config(), deps);
    const before = writes(server).length;
    await expect(executeSeed(config(overrides), deps)).rejects.toThrow(new RegExp(`different options \\(${field}\\)`));
    expect(writes(server).length).toBe(before);
  });

  it("refuses to resume against another account", async () => {
    const { server, deps } = harness();
    await executeSeed(config(), deps);
    server.account = { id: "TsTwo", organizationName: "TierSaver Test 2", testAccount: true };
    await expect(executeSeed(config({ accountId: "TsTwo" }), deps)).rejects.toThrow(/different options \(accountId\)/);
  });
});

describe("secrets", () => {
  it("never writes the key to logs, results or the progress file", async () => {
    const { server, deps, logs } = harness();
    server.failNext("POST", /event-bulk-create-jobs/, { status: 500, body: { errors: [{ code: "x", title: "x", detail: `echo ${TEST_KEY}` }] } });
    server.failNext("POST", /profile-subscription/, { status: 400, body: { errors: [{ code: "x", title: "x", detail: `echo ${TEST_KEY}` }] } });
    const result = await executeSeed(config(), deps);
    const stateText = readdirSync(stateDir).map((f) => readFileSync(join(stateDir, f), "utf8")).join("\n");
    expect(stateText).toContain("[REDACTED]");
    expect(logs.join("\n")).toContain("HTTP 500");
    for (const text of [stateText, logs.join("\n"), JSON.stringify(result)]) expect(text).not.toContain(TEST_KEY);
    expect(stateText).not.toMatch(/pk_/);
  });
});

describe("verifySeed", () => {
  it("passes after a complete run and only reads", async () => {
    const { server, deps } = harness();
    await executeSeed(config(), deps);
    const before = writes(server).length;
    const rows = await verifySeed(config(), deps);
    expect(rows).toHaveLength(39);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(writes(server).length).toBe(before);
  });

  it("detects dropped events, a missing profile and a missing suppression", async () => {
    const { server, deps } = harness();
    await executeSeed(config(), deps);
    server.events.clear();
    server.suppressed.clear();
    server.profiles.delete("ts-seed-7-00001@seed.tiersaver-test.dev");
    const rows = await verifySeed(config(), deps);
    const problems = Object.fromEntries(rows.map((r) => [r.cohort, r.problems.join("; ")]));
    expect(problems.never_engaged).toBe("profile not found");
    expect(problems.opened_long_ago).toMatch(/0 events stored, \d+ sent/);
    // Received emails are events too: a candidate with none stored is a broken seed.
    expect(problems.boundary_emails_received_5).toBe("0 events stored, 5 sent");
    expect(problems.already_suppressed).toContain("email suppression is false, expected true");
    expect(problems.no_emails_received).toBe("");
  });

  it("applies the same account guard and needs a previous run", async () => {
    const { server, deps } = harness();
    await expect(verifySeed(config(), deps)).rejects.toThrow(/nothing to verify/);
    server.account.id = "MERCH1";
    await expect(verifySeed(config(), deps)).rejects.toThrow(/belongs to account MERCH1/);
  });
});
