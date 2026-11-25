import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT, parseArgs, runCli, toRunConfig, type CliDeps } from "../src/cli.js";
import { SeedRefusal } from "../src/run.js";
import { FakeKlaviyo, TEST_KEY, fakeTime } from "./fake-klaviyo.js";

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "ts-seed-cli-"));
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

function harness(env: Record<string, string | undefined> = { KLAVIYO_TEST_PRIVATE_KEY: TEST_KEY }) {
  const server = new FakeKlaviyo();
  const time = fakeTime();
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = { env, out: (l) => out.push(l), err: (l) => err.push(l), fetch: server.fetch, sleep: time.sleep, clock: time.clock, random: () => 0.5 };
  const run = (...argv: string[]) => runCli([...argv, "--state-dir", stateDir], deps);
  return { server, out, err, run, all: () => [...out, ...err].join("\n") };
}

const REAL = ["--execute", "--account-id", "TsTest", "--email-domain", "seed.tiersaver-test.dev", "--count", "2000"];

describe("parseArgs", () => {
  it("parses both --flag value and --flag=value", () => {
    const parsed = parseArgs(["--seed", "5", "--count=2500", "--execute", "--expect-account-name", "TierSaver Test"]);
    expect(parsed.values).toEqual({ seed: "5", count: "2500", "expect-account-name": "TierSaver Test" });
    expect([...parsed.flags]).toEqual(["execute"]);
    expect(toRunConfig(parsed)).toMatchObject({ seed: 5, count: 2500, runTag: "ts-seed-5", expectAccountName: "TierSaver Test", emailDomain: "example.com", now: null });
  });

  it.each([
    [["--api-key", TEST_KEY]],
    [[`--api-key=${TEST_KEY}`]],
    [["--key", TEST_KEY]],
    [["--private-key", TEST_KEY]],
    [["--token", TEST_KEY]],
    [[TEST_KEY]],
    [["--account-id", TEST_KEY]],
    [[`--bogus=${TEST_KEY}`]],
    [["--bogus", TEST_KEY]],
  ])("rejects %j without echoing the value", (argv) => {
    const failure = (() => {
      try {
        parseArgs(argv);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(failure).toBeInstanceOf(SeedRefusal);
    expect(failure!.message).not.toContain(TEST_KEY);
    expect(failure!.message).not.toContain("pk_");
  });

  it("rejects missing values, values on switches and bad numbers", () => {
    expect(() => parseArgs(["--seed"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--seed", "--execute"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--execute=yes"])).toThrow(/does not take a value/);
    expect(() => toRunConfig(parseArgs(["--count", "3e3"]))).toThrow(/whole number/);
    expect(() => toRunConfig(parseArgs(["--now", "yesterday"]))).toThrow(/ISO 8601/);
  });
});

describe("runCli: dry run is the default", () => {
  it("prints the plan and makes no network request, even with a key in the environment", async () => {
    const { server, run, out, all } = harness();
    expect(await run()).toBe(EXIT.ok);
    expect(server.requests).toEqual([]);
    expect(readdirSync(stateDir)).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("Profiles       3000");
    expect(text).toMatch(/recent_purchaser\s+150/);
    expect(text).toMatch(/Total: \d+ requests/);
    expect(text).toMatch(/Estimated duration/);
    expect(text).toContain("DRY RUN: no network request was made");
    expect(text).toContain('silently drops events for "@example.com"');
    expect(all()).not.toContain(TEST_KEY);
  });

  it("is deterministic for a fixed --now", async () => {
    const a = harness();
    const b = harness();
    await a.run("--now", "2026-11-25T12:00:00Z", "--seed", "42");
    await b.run("--now", "2026-11-25T12:00:00Z", "--seed", "42");
    expect(a.out).toEqual(b.out);
  });

  it("does not need the key", async () => {
    const { run, server } = harness({});
    expect(await run("--dry-run", "--count", "5000")).toBe(EXIT.ok);
    expect(server.requests).toEqual([]);
  });

  it.each([["1999"], ["5001"], ["0"]])("refuses --count %s", async (count) => {
    const { run, err, server } = harness();
    expect(await run("--count", count)).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("between 2000 and 5000");
    expect(server.requests).toEqual([]);
  });

  it("refuses contradictory modes", async () => {
    const { run, server } = harness();
    expect(await run("--execute", "--dry-run", "--account-id", "TsTest")).toBe(EXIT.refused);
    expect(server.requests).toEqual([]);
  });

  it("prints help", async () => {
    const { run, out } = harness();
    expect(await run("--help")).toBe(EXIT.ok);
    expect(out.join("\n")).toContain("--expect-account-name");
  });
});

describe("runCli: --execute guards", () => {
  it("refuses without an account expectation, with no request", async () => {
    const { run, server, err } = harness();
    expect(await run("--execute", "--email-domain", "seed.tiersaver-test.dev")).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("--account-id");
    expect(server.requests).toEqual([]);
  });

  it("refuses without the environment variable, with no request", async () => {
    const { run, server, err } = harness({});
    expect(await run(...REAL)).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("KLAVIYO_TEST_PRIVATE_KEY is not set");
    expect(server.requests).toEqual([]);
  });

  it("refuses the default example.com domain, with no request", async () => {
    const { run, server } = harness();
    expect(await run("--execute", "--account-id", "TsTest")).toBe(EXIT.refused);
    expect(server.requests).toEqual([]);
  });

  it("refuses when the account does not match, after only reading the account", async () => {
    const { run, server, err } = harness();
    server.account = { id: "MERCH1", organizationName: "A Real Merchant", testAccount: false };
    expect(await run(...REAL)).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("Nothing was changed");
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/accounts"]);
  });

  it("refuses a key passed as an argument and never prints it", async () => {
    const { run, server, all } = harness({});
    expect(await run(...REAL, "--api-key", TEST_KEY)).toBe(EXIT.refused);
    expect(all()).toContain("never accepted on the command line");
    expect(all()).not.toContain(TEST_KEY);
    expect(server.requests).toEqual([]);
  });
});

describe("runCli: real run against the fake API", () => {
  it("seeds, reports, resumes as a no-op and verifies, without ever printing the key", async () => {
    const { run, server, out, all } = harness();
    expect(await run(...REAL)).toBe(EXIT.ok);
    expect(server.profiles.size).toBe(2000);
    expect(out.join("\n")).toContain('Account confirmed: TsTest ("TierSaver Test"), test account: yes.');
    const posts = server.requests.filter((r) => r.method === "POST").length;

    expect(await run(...REAL)).toBe(EXIT.ok);
    expect(server.requests.filter((r) => r.method === "POST").length).toBe(posts);
    expect(out.join("\n")).toContain("0 steps run");

    expect(await run("--verify", "--account-id", "TsTest")).toBe(EXIT.ok);
    expect(out.at(-1)).toBe("All 39 sampled profiles match.");
    expect(all()).not.toContain(TEST_KEY);
    for (const request of server.requests) expect(request.headers.Authorization).toBe(`Klaviyo-API-Key ${TEST_KEY}`);
  });

  it("exits with the warnings code when a step needs attention", async () => {
    const { run, server, out } = harness();
    server.failNext("POST", /profile-subscription/, { status: 403, body: { errors: [{ code: "permission_denied", title: "Forbidden", detail: "missing scope" }] } });
    expect(await run(...REAL)).toBe(EXIT.warnings);
    expect(out.join("\n")).toContain("WARNING: subscribe_sms:0");
  });

  it("exits with the error code on an API failure and scrubs the message", async () => {
    const { run, server, all } = harness();
    server.failNext("POST", /profile-bulk-import/, { status: 400, body: { errors: [{ code: "invalid", title: "Invalid input", detail: `bad ${TEST_KEY}` }] } });
    expect(await run(...REAL)).toBe(EXIT.error);
    expect(all()).toContain("Klaviyo responded 400");
    expect(all()).not.toContain(TEST_KEY);
  });
});
