import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { settleRunCharge } from "../app/billing/billing";
import { getSuppressionJob, listProfilesPage } from "../app/klaviyo/api";
import { KLAVIYO_SCOPES } from "../app/klaviyo/config";
import { createKlaviyoClient, saveConnection } from "../app/klaviyo/connection.server";
import { confirmJobsPage } from "../app/runs/confirm";
import { createSuppressionRun, createUndoRun, executeRun, type StepConfig } from "../app/runs/engine";
import { createSuppressionGateway, type GatewayEnv } from "../app/runs/gateway.server";
import { executeScan, type ScanSummary } from "../app/scans/engine";
import { createScan } from "../app/scans/engine";
import { approveSimulation, candidatesCsvPart } from "../app/simulations/review";
import { db, schema, uniqueShop } from "./helpers";

/**
 * LIVE end-to-end run of the app's own engines against the seeded Klaviyo TEST
 * account: audit + simulation, approval, a real suppression run, Klaviyo's job
 * results, and the undo that restores every profile. Skipped unless
 * LIVE_KLAVIYO_RELAY points at scripts/klaviyo-relay.mjs, which holds the test
 * key and refuses any account that is not the expected test account.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/klaviyo-relay.mjs SGKvLG &
 *   LIVE_KLAVIYO_RELAY=http://127.0.0.1:8799 LIVE_KLAVIYO_ACCOUNT=SGKvLG npx vitest run test/live-klaviyo.test.ts
 *
 * It CHANGES the test account (suppresses, then unsuppresses, the candidates).
 * Run it only with the owner's go-ahead.
 */
const relay = (env as unknown as { LIVE_KLAVIYO_RELAY?: string }).LIVE_KLAVIYO_RELAY || "";
const ACCOUNT = "SGKvLG";

const relayFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const target = new URL(url.pathname + url.search, relay);
  const headers = new Headers(init?.headers);
  headers.delete("authorization"); // the relay adds the test key; the fake OAuth token never leaves this process
  return fetch(target, { ...init, headers });
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const steps = {
  async do<T>(_name: string, config: StepConfig, callback: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i <= (config.retries?.limit ?? 0); i++) {
      try {
        return await callback();
      } catch (error) {
        last = error;
        if ((error as Error).name === "NonRetryableError") break;
        await sleep(2000);
      }
    }
    throw last;
  },
  sleep: (_name: string, ms: number) => sleep(Math.min(ms, 15_000)),
};

describe.skipIf(!relay)("live: audit, cleanup, jobs and undo on the Klaviyo test account", () => {
  it(
    "runs end to end and leaves the account as it found it",
    async () => {
      const shop = uniqueShop();
      const secrets: GatewayEnv = {
        DB: env.DB,
        TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256))),
        KLAVIYO_CLIENT_ID: "unused",
        KLAVIYO_CLIENT_SECRET: "unused",
        SUPPRESSION_ENABLED: "true",
        SUPPRESSION_ALLOWED_ACCOUNT_ID: ACCOUNT,
      };
      await db.insert(schema.shops).values({ shop });
      await db.insert(schema.settings).values({ shop });
      await saveConnection(
        { db, env: secrets },
        { shop, klaviyoAccountId: ACCOUNT, tokens: { accessToken: "relay", refreshToken: "relay", expiresAt: new Date(Date.now() + 6 * 3600_000), scope: KLAVIYO_SCOPES.join(" ") } },
      );
      const client = () => createKlaviyoClient({ db, env: secrets, fetch: relayFetch }, shop);
      const report: Record<string, unknown> = {};

      const suppressedNow = async () => {
        let cursor: string | null = null;
        let suppressed = 0;
        let total = 0;
        do {
          const page = await listProfilesPage(client(), { cursor });
          for (const p of page.items) {
            total++;
            if ((p.email?.suppressionReasons.length ?? 0) > 0) suppressed++;
          }
          cursor = page.nextCursor;
        } while (cursor);
        return { total, suppressed };
      };
      const before = await suppressedNow();
      report.before = before;

      // ---- audit + simulation -------------------------------------------------
      const scan = await createScan(db, { shop, createdBy: "user:1" });
      if (!scan.ok) throw new Error("scan not created");
      const outcome = await executeScan({ db, step: steps, klaviyo: client, nonRetryable: (code) => Object.assign(new Error(code), { name: "NonRetryableError" }), seededAccountId: ACCOUNT }, scan.scanId);
      report.scan = outcome;
      if (outcome.status !== "completed") throw new Error(`scan failed: ${JSON.stringify(report)}`);
      const simulation = (await db.query.simulations.findFirst({ where: eq(schema.simulations.id, outcome.simulationId) }))!;
      const summary = simulation.summary as ScanSummary;
      report.simulation = { activeProfiles: simulation.activeProfiles, source: simulation.activeProfilesSource, evaluated: simulation.evaluatedCount, candidates: simulation.candidateCount, protectedByReason: summary.protectedByReason, skippedByReason: summary.skippedByReason, seeded: summary.seededTestAccount };
      console.log("LIVE", JSON.stringify(report));
      expect(simulation.evaluatedCount).toBe(984);
      expect(simulation.candidateCount).toBe(696);

      // ---- review + approval --------------------------------------------------
      const csv = await candidatesCsvPart(db, client(), { shop, simulationId: simulation.id, part: 1 });
      if (!csv.ok) throw new Error(csv.reason);
      const withEmail = csv.csv.trim().split("\r\n").slice(1).filter((line) => /","[^"]+@[^"]+",/.test(line)).length;
      report.csv = { rows: csv.rows, parts: csv.parts, withEmail };
      expect(withEmail).toBe(csv.rows);
      expect(await approveSimulation(db, { shop, simulationId: simulation.id, approvedBy: "user:1", acknowledged: true })).toEqual({ ok: true });

      // ---- cleanup -------------------------------------------------------------
      const created = await createSuppressionRun(db, { shop, simulationId: simulation.id, createdBy: "user:1" });
      if (!created.ok) throw new Error(created.reason);
      const gateway = createSuppressionGateway(secrets, shop, { fetch: relayFetch });
      const run = await executeRun({ db, gateway, step: steps }, created.runId);
      report.run = run;
      console.log("LIVE", JSON.stringify({ run }));

      let restored = false;
      try {
        expect(run).toMatchObject({ status: "completed", submitted: 696, failed: 0, untouched: 0 });

        // ---- Klaviyo's own account of the jobs --------------------------------
        let jobs = await confirmJobsPage(db, client(), { runId: created.runId, offset: 0, limit: 40 });
        const started = Date.now();
        while (!jobs.complete && Date.now() - started < 8 * 60_000) {
          await sleep(10_000);
          jobs = await confirmJobsPage(db, client(), { runId: created.runId, offset: 0, limit: 40 });
        }
        const jobIds = await db.selectDistinct({ id: schema.runProfiles.klaviyoJobId }).from(schema.runProfiles).where(eq(schema.runProfiles.runId, created.runId));
        const raw = [];
        for (const j of jobIds) if (j.id) raw.push(await getSuppressionJob(client(), "suppress", j.id).then((x) => ({ status: x.status, total: x.totalCount, completed: x.completedCount, skipped: x.skippedCount })));
        report.jobs = { ...jobs, secondsToComplete: Math.round((Date.now() - started) / 1000), raw };
        const afterCleanup = await suppressedNow();
        report.afterCleanup = afterCleanup;
        console.log("LIVE", JSON.stringify({ jobs: report.jobs, afterCleanup }));
        expect(jobs.complete).toBe(true);
        expect(afterCleanup.suppressed).toBe(before.suppressed + 696);

        // The charge: estimated first, settled on what Klaviyo confirmed (no Shopify here: it must stay open, not vanish).
        report.chargeEstimate = await settleRunCharge({ db, graphql: null }, created.runId);
        report.chargeAfterConfirmation = await settleRunCharge({ db, graphql: null }, created.runId, { done: jobs.complete, suppressed: jobs.suppressed });
      } finally {
        // ---- undo: always, so the account is left as it was --------------------
        const undo = await createUndoRun(db, { shop, runId: created.runId, createdBy: "user:1", confirmAfterRenewal: true });
        if (undo.ok) {
          const undone = await executeRun({ db, gateway, step: steps }, undo.runId);
          report.undo = undone;
          const jobIds = await db.selectDistinct({ id: schema.runProfiles.klaviyoJobId }).from(schema.runProfiles).where(eq(schema.runProfiles.runId, undo.runId));
          const started = Date.now();
          for (;;) {
            const states = [];
            for (const j of jobIds) if (j.id && j.id !== "none") states.push(await getSuppressionJob(client(), "unsuppress", j.id).then((x) => ({ status: x.status, total: x.totalCount, completed: x.completedCount, skipped: x.skippedCount })));
            report.undoJobs = states;
            if (states.every((s) => s.status === "complete") || Date.now() - started > 8 * 60_000) break;
            await sleep(10_000);
          }
          const afterUndo = await suppressedNow();
          report.afterUndo = afterUndo;
          restored = afterUndo.suppressed === before.suppressed;
        } else {
          report.undo = undo;
        }
        console.log("LIVE", JSON.stringify(report));
      }
      expect(restored).toBe(true);
      const originals = await db.query.runProfiles.findMany({ where: eq(schema.runProfiles.runId, created.runId), columns: { reactivatedAt: true } });
      expect(originals.every((p) => p.reactivatedAt !== null)).toBe(true);
    },
    30 * 60_000,
  );
});
