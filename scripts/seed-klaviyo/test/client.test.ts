import { describe, expect, it } from "vitest";
import { KlaviyoApiError, KlaviyoClient, redactSecret } from "../src/client.js";
import { FakeKlaviyo, TEST_KEY, fakeTime } from "./fake-klaviyo.js";

function setup(options: { maxAttempts?: number } = {}) {
  const server = new FakeKlaviyo();
  const time = fakeTime();
  const logs: string[] = [];
  const client = new KlaviyoClient({
    apiKey: TEST_KEY,
    fetch: server.fetch,
    sleep: time.sleep,
    clock: time.clock,
    random: () => 0.5,
    log: (m) => logs.push(m),
    ...options,
  });
  return { server, time, logs, client };
}

const error = (status: number, detail = "boom") => ({ status, body: { errors: [{ code: "err", title: "Error", detail }] } });

describe("KlaviyoClient: request shape", () => {
  it("sends the auth, revision and JSON:API headers to the Klaviyo host", async () => {
    const { server, client } = setup();
    const urls: string[] = [];
    const inner = server.fetch;
    server.fetch = (url, init) => (urls.push(url), inner(url, init));
    const viaSpy = new KlaviyoClient({ apiKey: TEST_KEY, fetch: (url, init) => server.fetch(url, init), sleep: async () => {} });
    await viaSpy.request("POST", "eventBulkCreate", "", { body: { data: { attributes: { "events-bulk-create": { data: [] } } } } });
    await client.request("GET", "profileImport", "/job 1", { query: { "page[size]": "20" } }).catch(() => {});
    expect(urls[0]).toBe("https://a.klaviyo.com/api/event-bulk-create-jobs");
    expect(server.requests[1]!.path).toBe("/api/profile-bulk-import-jobs/job%201");
    expect(server.requests[1]!.query.get("page[size]")).toBe("20");
    const headers = server.requests[0]!.headers;
    expect(headers.Authorization).toBe(`Klaviyo-API-Key ${TEST_KEY}`);
    expect(headers.revision).toBe("2026-10-15");
    expect(headers.Accept).toBe("application/vnd.api+json");
    expect(headers["Content-Type"]).toBe("application/vnd.api+json");
    expect(server.requests[1]!.headers["Content-Type"]).toBeUndefined();
  });

  it("returns null json for an empty 202 and parsed json otherwise", async () => {
    const { client } = setup();
    expect((await client.request("POST", "subscribe", "", { body: { data: { attributes: { profiles: { data: [] } } } } })).json).toBeNull();
    expect((await client.request("GET", "accounts")).json).toMatchObject({ data: [{ id: "TsTest" }] });
  });
});

describe("KlaviyoClient: retries", () => {
  it("waits for Retry-After on 429, then succeeds", async () => {
    const { server, time, client, logs } = setup();
    server.failNext("GET", /accounts/, { status: 429, headers: { "Retry-After": "7" } }, { status: 429, headers: { "Retry-After": "3" } });
    const response = await client.request("GET", "accounts");
    expect(response.status).toBe(200);
    expect(server.requests).toHaveLength(3);
    expect(time.sleeps.filter((ms) => ms === 7000 || ms === 3000)).toEqual([7000, 3000]);
    expect(logs.join("\n")).toContain("HTTP 429");
  });

  it("backs off exponentially on 5xx, then succeeds", async () => {
    const { server, time, client } = setup();
    server.failNext("POST", /event-bulk/, error(500), error(503), error(502));
    const response = await client.request("POST", "eventBulkCreate", "", { body: { data: { attributes: { "events-bulk-create": { data: [] } } } } });
    expect(response.status).toBe(202);
    expect(server.requests).toHaveLength(4);
    // random() = 0.5 -> half of 1 s, 2 s, 4 s.
    expect(time.sleeps).toEqual([500, 1000, 2000]);
  });

  it("falls back to backoff when a 429 has no usable Retry-After", async () => {
    const { server, time, client } = setup();
    server.failNext("GET", /accounts/, { status: 429 }, { status: 429, headers: { "Retry-After": "soon" } });
    await client.request("GET", "accounts");
    expect(time.sleeps.slice(0, 1)).toEqual([500]);
    expect(server.requests).toHaveLength(3);
  });

  it("retries network errors", async () => {
    const { server, client, logs } = setup();
    server.failNext("GET", /accounts/, "network-error");
    expect((await client.request("GET", "accounts")).status).toBe(200);
    expect(logs[0]).toContain("fetch failed");
  });

  it("gives up after maxAttempts", async () => {
    const { server, client } = setup({ maxAttempts: 3 });
    server.failNext("GET", /accounts/, error(500), error(500), error(500), error(500));
    await expect(client.request("GET", "accounts")).rejects.toMatchObject({ name: "KlaviyoApiError", status: 500 });
    expect(server.requests).toHaveLength(3);
  });

  it.each([400, 401, 403, 404, 409])("does not retry a %i and reports Klaviyo's detail", async (status) => {
    const { server, time, client } = setup();
    server.failNext("POST", /profile-bulk-import/, error(status, "Invalid email address"));
    const failure = await client.request("POST", "profileImport", "", { body: {} }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(KlaviyoApiError);
    expect((failure as KlaviyoApiError).message).toBe(`Klaviyo responded ${status} on POST /api/profile-bulk-import-jobs: err - Error - Invalid email address`);
    expect(server.requests).toHaveLength(1);
    expect(time.sleeps).toEqual([]);
  });
});

describe("KlaviyoClient: pacing", () => {
  it("never exceeds the burst or steady limit of an endpoint in any 1 s / 60 s window", async () => {
    const { server, time } = setup();
    const sentAt: number[] = [];
    const paced = new KlaviyoClient({
      apiKey: TEST_KEY,
      fetch: (url, init) => (sentAt.push(time.clock()), server.fetch(url, init)),
      sleep: time.sleep,
      clock: time.clock,
    });
    // accounts: 1/s burst, 15/min steady.
    for (let i = 0; i < 40; i += 1) await paced.request("GET", "accounts");
    const maxInWindow = (windowMs: number) => Math.max(...sentAt.map((t) => sentAt.filter((u) => u >= t && u < t + windowMs).length));
    expect(maxInWindow(1000)).toBe(1);
    expect(maxInWindow(60_000)).toBeLessThanOrEqual(15);
    expect(sentAt.at(-1)! - sentAt[0]!).toBeGreaterThan(2 * 60_000);
  });

  it("does not slow down a handful of requests on a roomy endpoint", async () => {
    const { time, client } = setup();
    for (let i = 0; i < 5; i += 1) await client.request("POST", "eventBulkCreate", "", { body: { data: { attributes: { "events-bulk-create": { data: [] } } } } });
    expect(time.sleeps).toEqual([]);
  });
});

describe("KlaviyoClient: secrets", () => {
  it("never puts the key in log lines or error messages", async () => {
    const { server, client, logs } = setup({ maxAttempts: 2 });
    server.failNext("GET", /accounts/, error(500, `bad key ${TEST_KEY}`), error(400, `echo ${TEST_KEY}`));
    const failure = (await client.request("GET", "accounts").catch((e: unknown) => e)) as Error;
    expect(failure.message).toContain("[REDACTED]");
    expect(failure.message + logs.join("\n")).not.toContain(TEST_KEY);
  });

  it("redactSecret replaces every occurrence and tolerates an empty secret", () => {
    expect(redactSecret("a KEY b KEY", "KEY")).toBe("a [REDACTED] b [REDACTED]");
    expect(redactSecret("unchanged", "")).toBe("unchanged");
  });

  it("refuses to be built without a key", () => {
    expect(() => new KlaviyoClient({ apiKey: "" })).toThrow();
  });
});
