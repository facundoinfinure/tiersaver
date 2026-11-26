import { hashShopEmail } from "../app/email-hash";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { saveConnection } from "../app/klaviyo/connection.server";
import { FakeKlaviyo } from "../app/klaviyo/testing/fake-klaviyo";
import { createSuppressionRun, executeRun, type BatchRequest } from "../app/runs/engine";
import { NO_JOB_ID, createSuppressionGateway, type GatewayEnv } from "../app/runs/gateway.server";
import { FakeSteps, db, installCandidateSegment, profileStatuses, schema, seedSimulation } from "./helpers";

const ENCRYPTION_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256)));
const emailOf = (profileId: string) => `${profileId.toLowerCase()}@customers-of-merchant.test`;

/**
 * A shop with an approved simulation, a suppression run created from it, a
 * Klaviyo connection and a fake Klaviyo holding one profile per candidate.
 */
async function setup(opts: { candidates?: number; enabled?: string | null; connect?: boolean } = {}) {
  const fake = new FakeKlaviyo();
  const { shop, simulationId, profileIds } = await seedSimulation({ candidates: opts.candidates ?? 130 });
  for (const id of profileIds) {
    fake.profiles.set(id, { id, email: emailOf(id) });
    // The simulation stored the hash of the email it evaluated.
    await db
      .update(schema.simulationCandidates)
      .set({ emailHash: await hashShopEmail(shop, emailOf(id)) })
      .where(eq(schema.simulationCandidates.profileId, id));
  }
  const created = await createSuppressionRun(db, { shop, simulationId, createdBy: "user:1" });
  if (!created.ok) throw new Error(created.reason);
  // What the scan left in Klaviyo: TierSaver's managed segment, with every candidate as a member.
  const segment = await installCandidateSegment(fake, shop, profileIds);

  const gatewayEnv: GatewayEnv = {
    DB: env.DB,
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    KLAVIYO_CLIENT_ID: fake.clientId,
    KLAVIYO_CLIENT_SECRET: fake.clientSecret,
  };
  if (opts.enabled !== null) gatewayEnv.SUPPRESSION_ENABLED = opts.enabled ?? "true";

  let tokens: { accessToken: string; refreshToken: string } | null = null;
  if (opts.connect !== false) {
    tokens = fake.issueTokens(KLAVIYO_SCOPES.join(" "));
    await saveConnection(
      { db, env: gatewayEnv },
      {
        shop,
        klaviyoAccountId: fake.accountId,
        tokens: { ...tokens, expiresAt: new Date(Date.now() + 3600_000), scope: KLAVIYO_SCOPES.join(" ") },
      },
    );
  }
  const gateway = createSuppressionGateway(gatewayEnv, shop, { fetch: fake.fetch, sleep: async () => {} });
  const batch = (batchIndex: number, kind: BatchRequest["kind"] = "suppress"): BatchRequest => ({
    shop,
    runId: created.runId,
    kind,
    batchIndex,
    profileIds: profileIds.slice(batchIndex * 100, batchIndex * 100 + 100),
  });
  return { fake, shop, simulationId, segment, profileIds, runId: created.runId, gateway, gatewayEnv, batch, tokens };
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(Error);
  return e as Error;
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
  // The gateway never logs: no email or token can reach the console.
  expect(logged.join("\n")).toBe("");
  vi.restoreAllMocks();
});

describe("safety switches", () => {
  it.each([[null], [""], ["false"], ["1"], ["TRUE"], ["yes"]])("refuses to suppress unless SUPPRESSION_ENABLED is exactly \"true\" (%j)", async (value) => {
    const { fake, gateway, batch } = await setup({ candidates: 5, enabled: value });
    const err = await rejection(gateway.submitBatch(batch(0, "suppress")));
    expect(err.name).toBe("NonRetryableError");
    expect(err.message).toBe("suppression_disabled");
    expect(fake.requests).toHaveLength(0);
    expect(fake.suppressed.size).toBe(0);
  });

  it("undo works with the switch off: what was suppressed stays reversible", async () => {
    const { fake, gateway, batch } = await setup({ candidates: 5, enabled: null });
    const result = await gateway.submitBatch(batch(0, "undo"));
    expect(result.jobId).toBeTruthy();
    expect(fake.suppressed.size).toBe(0);
  });

  it("refuses when the shop has no Klaviyo connection", async () => {
    const { fake, gateway, batch } = await setup({ candidates: 5, connect: false });
    const err = await rejection(gateway.submitBatch(batch(0)));
    expect(err).toMatchObject({ name: "NonRetryableError", message: "klaviyo_not_connected" });
    expect(fake.requests).toHaveLength(0);
  });

  it.each([["needs_reauth"], ["disconnected"]] as const)("refuses when the connection is %s", async (status) => {
    const { fake, shop, gateway, batch } = await setup({ candidates: 5 });
    await db.update(schema.klaviyoConnections).set({ status }).where(eq(schema.klaviyoConnections.shop, shop));
    const err = await rejection(gateway.submitBatch(batch(0)));
    expect(err).toMatchObject({ name: "NonRetryableError", message: `klaviyo_${status}` });
    expect(fake.requests).toHaveLength(0);
  });

  it("stops for good when Klaviyo revoked the app: needs_reauth, no retries", async () => {
    const { fake, shop, gateway, batch } = await setup({ candidates: 5 });
    await db
      .update(schema.klaviyoConnections)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.klaviyoConnections.shop, shop));
    fake.revokeEverything();
    const err = await rejection(gateway.submitBatch(batch(0)));
    expect(err).toMatchObject({ name: "NonRetryableError", message: "klaviyo_needs_reauth" });
    const row = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop) });
    expect(row?.status).toBe("needs_reauth");
    expect(fake.suppressed.size).toBe(0);
    // The next batch does not even reach Klaviyo.
    const before = fake.requests.length;
    await rejection(gateway.submitBatch(batch(0)));
    expect(fake.requests.length).toBe(before);
  });

  it("refuses a batch for another shop or of an impossible size", async () => {
    const { fake, gateway, batch, profileIds } = await setup({ candidates: 5 });
    expect(await rejection(gateway.submitBatch({ ...batch(0), shop: "other.myshopify.com" }))).toMatchObject({
      name: "NonRetryableError",
      message: "gateway_shop_mismatch",
    });
    expect(await rejection(gateway.submitBatch({ ...batch(0), profileIds: [] }))).toMatchObject({ message: "batch_invalid_size" });
    const tooMany = Array.from({ length: 101 }, (_, i) => `X${i}`);
    expect(await rejection(gateway.submitBatch({ ...batch(0), profileIds: tooMany }))).toMatchObject({ message: "batch_invalid_size" });
    expect(profileIds).toHaveLength(5);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("submitting batches", () => {
  it("resolves ids to emails at call time and suppresses exactly the batch, 100 emails in one job", async () => {
    const { fake, gateway, batch, profileIds } = await setup();
    const result = await gateway.submitBatch(batch(0));
    expect(result).toEqual({ jobId: "JOB0001", skippedProfileIds: [], skipReasons: {} });

    // Membership of the candidate segment, the email and the suppression state come from the same read.
    const lookups = fake.requestsTo(/^\/api\/segments\/SEGCAND\/profiles$/);
    expect(lookups).toHaveLength(5); // 20 ids per lookup: the real API accepts no more
    expect(lookups.every((r) => r.url.searchParams.get("filter")?.startsWith("any(id,["))).toBe(true);
    expect(fake.requestsTo(/^\/api\/profiles$/)).toHaveLength(0);
    const posts = fake.requestsTo(/^\/api\/profile-suppression-bulk-create-jobs$/, "POST");
    expect(posts).toHaveLength(1);
    expect(fake.jobs[0]).toMatchObject({ kind: "suppress" });
    expect([...fake.jobs[0]!.emails].sort()).toEqual(profileIds.slice(0, 100).map(emailOf).sort());
    // Nobody outside the batch was touched.
    expect(fake.suppressed.size).toBe(100);
    expect(fake.suppressed.has(emailOf(profileIds[100]!))).toBe(false);
    expect(fake.requests.filter((r) => r.method !== "GET")).toHaveLength(1);
  });

  it("undo batches go to the unsuppress endpoint", async () => {
    const { fake, gateway, batch, profileIds } = await setup({ candidates: 10 });
    await gateway.submitBatch(batch(0));
    expect(fake.suppressed.size).toBe(10);
    const result = await gateway.submitBatch(batch(0, "undo"));
    expect(result.jobId).toBe("JOB0002");
    expect(fake.requestsTo(/^\/api\/profile-suppression-bulk-delete-jobs$/, "POST")).toHaveLength(1);
    expect(fake.jobs[1]).toMatchObject({ kind: "unsuppress" });
    expect(fake.jobs[1]!.emails).toHaveLength(profileIds.length);
    expect(fake.suppressed.size).toBe(0);
  });

  it("skips profiles that are gone, have no email, or whose email changed since the simulation", async () => {
    const { fake, gateway, batch, profileIds } = await setup({ candidates: 6 });
    const [gone, noEmail, changed, ...rest] = profileIds as [string, string, string, ...string[]];
    fake.profiles.delete(gone);
    fake.profiles.get(noEmail)!.email = null;
    fake.profiles.get(changed)!.email = "someone-else@customers-of-merchant.test";

    const result = await gateway.submitBatch(batch(0));
    expect([...(result.skippedProfileIds ?? [])].sort()).toEqual([gone, noEmail, changed].sort());
    expect(result.skipReasons).toEqual({ [gone]: "not_in_candidate_segment", [noEmail]: "no_email", [changed]: "email_changed" });
    expect([...fake.jobs[0]!.emails].sort()).toEqual(rest.map(emailOf).sort());
    expect(fake.suppressed.has("someone-else@customers-of-merchant.test")).toBe(false);

    // An undo still reaches a profile whose email changed: it is the same profile we suppressed.
    const undo = await gateway.submitBatch(batch(0, "undo"));
    expect([...(undo.skippedProfileIds ?? [])].sort()).toEqual([gone, noEmail].sort());
    expect(fake.jobs[1]!.emails).toContain("someone-else@customers-of-merchant.test");
  });

  it("sends the email exactly as Klaviyo holds it", async () => {
    const { fake, gateway, batch, profileIds } = await setup({ candidates: 1 });
    fake.profiles.get(profileIds[0]!)!.email = emailOf(profileIds[0]!).toUpperCase();
    await gateway.submitBatch(batch(0));
    expect(fake.jobs[0]!.emails).toEqual([emailOf(profileIds[0]!).toUpperCase()]);
  });

  it("creates no job when every profile of the batch is skipped", async () => {
    const { fake, gateway, batch } = await setup({ candidates: 3 });
    fake.profiles.clear();
    const result = await gateway.submitBatch(batch(0));
    expect(result.jobId).toBe(NO_JOB_ID);
    expect(result.skippedProfileIds).toHaveLength(3);
    expect(fake.requests.filter((r) => r.method !== "GET")).toHaveLength(0);
  });

  it("is safe to call twice with the same batch: what Klaviyo already applied is not sent again", async () => {
    const { fake, gateway, batch, profileIds, runId } = await setup({ candidates: 40 });
    // The engine stamps the rows right before the request leaves.
    const beforeSend = async () => void (await db.update(schema.runProfiles).set({ attemptedAt: new Date() }).where(eq(schema.runProfiles.runId, runId)));
    const first = await gateway.submitBatch({ ...batch(0), beforeSend });
    expect(first.skippedProfileIds).toEqual([]);
    const state = [...fake.suppressed].sort();

    // The answer was lost and the batch is tried again. Klaviyo shows every profile suppressed since our request.
    const second = await gateway.submitBatch({ ...batch(0), maybeSentProfileIds: profileIds });
    expect(second.skippedProfileIds).toEqual([]);
    expect([...(second.confirmedProfileIds ?? [])].sort()).toEqual([...profileIds].sort());
    expect(second.jobId).toBe(NO_JOB_ID);
    expect(fake.jobs).toHaveLength(1);
    expect([...fake.suppressed].sort()).toEqual(state);

    // Without that knowledge the same profiles are simply "already suppressed": nobody is sent twice either way.
    const third = await gateway.submitBatch(batch(0));
    expect(Object.values(third.skipReasons ?? {})).toEqual(Array(40).fill("already_suppressed"));
    expect(fake.jobs).toHaveLength(1);
  });

  it("turns rate limits and outages into retryable errors, and a rejected request into a final one", async () => {
    const { fake, gateway, batch } = await setup({ candidates: 5 });
    fake.failNext(/bulk-create-jobs$/, () => FakeKlaviyo.rateLimited(120));
    const limited = await rejection(gateway.submitBatch(batch(0)));
    expect(limited.name).toBe("Error");
    expect(limited.message).toBe("klaviyo_429_throttled");

    fake.failNext(/bulk-create-jobs$/, () => FakeKlaviyo.clientError(400, "invalid", `Invalid email address: ${emailOf("P000000")}`));
    const rejected = await rejection(gateway.submitBatch(batch(0)));
    expect(rejected).toMatchObject({ name: "NonRetryableError", message: "klaviyo_400_invalid" });

    fake.failNext(/^\/api\/segments\/[^/]+\/profiles$/, () => FakeKlaviyo.clientError(403, "permission_denied"));
    expect(await rejection(gateway.submitBatch(batch(0)))).toMatchObject({ name: "NonRetryableError", message: "klaviyo_403_permission_denied" });
    expect(fake.suppressed.size).toBe(0);

    // After the failures the same batch goes through.
    await expect(gateway.submitBatch(batch(0))).resolves.toMatchObject({ jobId: "JOB0001" });
  });
});

describe("a whole run through the real engine", () => {
  it("suppresses every candidate once, records job ids and skips, and stores no email anywhere", async () => {
    const { fake, shop, gateway, runId, profileIds, tokens } = await setup({ candidates: 130 });
    const gone = profileIds[7]!;
    fake.profiles.delete(gone);

    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 129, skipped: 1, failed: 0, untouched: 0, error: null });
    expect(await profileStatuses(runId)).toEqual({ submitted: 129, skipped: 1 });
    expect(fake.jobs.map((j) => j.emails.length)).toEqual([99, 30]);
    expect(fake.suppressed.size).toBe(129);

    const rows = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, runId) });
    expect(new Set(rows.map((r) => r.klaviyoJobId))).toEqual(new Set(["JOB0001", "JOB0002"]));
    expect(rows.find((r) => r.profileId === gone)).toMatchObject({ status: "skipped" });

    // Nothing personal and nothing secret is left in the database.
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>();
    let dump = "";
    for (const { name } of tables.results) {
      const all = await env.DB.prepare(`SELECT * FROM "${name}" WHERE shop = ?`).bind(shop).all().catch(() => null);
      if (all) dump += JSON.stringify(all.results);
    }
    expect(dump).toContain(runId);
    expect(dump).not.toContain("@customers-of-merchant.test");
    expect(dump).not.toContain(tokens!.accessToken);
    expect(dump).not.toContain(tokens!.refreshToken);
  });

  it("a run that hits the safety switch fails with every profile untouched", async () => {
    const { fake, gateway, runId } = await setup({ candidates: 130, enabled: null });
    const outcome = await executeRun({ db, gateway, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "failed", submitted: 0, error: "suppression_disabled" });
    expect(await profileStatuses(runId)).toEqual({ failed: 100, pending: 30 });
    expect(fake.requests).toHaveLength(0);
  });

  it("a batch that died after reaching Klaviyo is sent again without suppressing anyone new", async () => {
    const { fake, gateway, runId } = await setup({ candidates: 130 });
    // First attempt of batch 0 reaches Klaviyo, then the response is lost.
    let dropped = false;
    const flaky = {
      async submitBatch(request: BatchRequest) {
        const result = await gateway.submitBatch(request);
        if (!dropped && request.batchIndex === 0) {
          dropped = true;
          throw new Error("response_lost");
        }
        return result;
      },
    };
    const outcome = await executeRun({ db, gateway: flaky, step: new FakeSteps() }, runId);
    expect(outcome).toMatchObject({ status: "completed", submitted: 130, unknown: 0 });
    // The retry found batch 0 applied (suppressed since our request) and did not create a second job for it.
    expect(fake.jobs).toHaveLength(2);
    expect(fake.suppressed.size).toBe(130);
    expect(await profileStatuses(runId)).toEqual({ submitted: 130 });
  });

  it("with an allowed account set, refuses to suppress for any other Klaviyo account but still undoes", async () => {
    const { gateway, gatewayEnv, batch, fake, shop } = await setup({ candidates: 2 });
    gatewayEnv.SUPPRESSION_ALLOWED_ACCOUNT_ID = "OTHER1";
    await expect(gateway.submitBatch(batch(0))).rejects.toThrow("suppression_not_allowed_for_account");
    expect(fake.jobs).toHaveLength(0);
    await expect(gateway.submitBatch(batch(0, "undo"))).resolves.toMatchObject({ skippedProfileIds: [] });
    gatewayEnv.SUPPRESSION_ALLOWED_ACCOUNT_ID = fake.accountId;
    await expect(gateway.submitBatch(batch(0))).resolves.toMatchObject({ skippedProfileIds: [] });
    void shop;
  });
});
