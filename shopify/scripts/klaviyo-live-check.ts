/**
 * Runs the app's own Klaviyo layer (app/klaviyo/api.ts) against the TEST
 * account filled by scripts/seed-klaviyo, and prints what the real API returns
 * next to what the code assumes. Results go to docs/STATUS.md by hand.
 *
 *   KLAVIYO_TEST_PRIVATE_KEY=... NODE_USE_ENV_PROXY=1 \
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/register-ts.mjs scripts/klaviyo-live-check.ts --account-id <id> [--write-segment]
 *
 * Safety:
 * - The key is read only from KLAVIYO_TEST_PRIVATE_KEY and never printed.
 * - Refuses to continue unless GET /api/accounts returns exactly --account-id
 *   AND Klaviyo flags the account as a test account.
 * - Read-only by default. `--write-segment` creates or updates the one managed
 *   candidate segment (the same write the app does). Nothing is ever suppressed.
 * - Prints ids, counts and field shapes. No email address is printed.
 */
import { DEFAULT_RULE_SETTINGS } from "@tiersaver/core";
import {
  buildCandidateSegmentDefinition,
  ensureCandidateSegment,
  getAccount,
  getCandidateSegment,
  getProfileEmails,
  getSuppressionJob,
  listBillingUsage,
  listCandidateSegmentProfilesPage,
  listEngagementEventsPage,
  listGroupsPage,
  listMetricsPage,
  listProfilesPage,
  pickProfilesUsage,
  resolveMetrics,
  type KlaviyoMetric,
  type KlaviyoProfileRecord,
} from "../app/klaviyo/api";
import { KlaviyoClient } from "../app/klaviyo/client";
import { SEEDED_METRIC_SPECS, SEED_CREATED_AT_PROPERTY } from "../app/klaviyo/config";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const key = process.env.KLAVIYO_TEST_PRIVATE_KEY;
const expectedAccountId = option("--account-id");
if (!key || !expectedAccountId) {
  console.error("Needs KLAVIYO_TEST_PRIVATE_KEY and --account-id <id>.");
  process.exit(2);
}

/** Klaviyo error details of the last failed request (status, code, detail), for the report. Never holds the key. */
let lastError: string | null = null;

// The app talks OAuth (`Bearer`); a private key uses the `Klaviyo-API-Key` scheme. Everything else is the app's request.
const privateKeyFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Klaviyo-API-Key ${key}`);
  const res = await fetch(input, { ...init, headers });
  if (!res.ok) {
    try {
      const body = (await res.clone().json()) as { errors?: { code?: string; detail?: string; source?: unknown }[] };
      lastError = `${res.status} ${(body.errors ?? []).map((e) => `${e.code}: ${e.detail} ${JSON.stringify(e.source ?? {})}`).join(" | ")}`;
    } catch {
      lastError = `${res.status}`;
    }
    lastError = lastError.split(key!).join("[REDACTED]");
  }
  return res;
};

const client = new KlaviyoClient({ getAccessToken: async () => "unused", fetch: privateKeyFetch, maxWaitMs: 120_000 });

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  lastError = null;
  try {
    const detail = await fn();
    console.log(`ok    ${name}${detail ? `\n      ${detail.split("\n").join("\n      ")}` : ""}`);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}: ${message}${lastError ? `\n      Klaviyo said: ${lastError}` : ""}`);
  }
}

function tally<T>(items: readonly T[], keyOf: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(", ");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 1. Account guard -------------------------------------------------------
const account = await getAccount(client).catch((error) => {
  console.error(`Account check failed: ${error instanceof Error ? error.message : error} ${lastError ?? ""}`);
  process.exit(1);
});
if (account.id !== expectedAccountId || !account.testAccount) {
  console.error(`Refusing to run: account ${account.id}, test account: ${account.testAccount}. Expected ${expectedAccountId}, flagged as test.`);
  process.exit(2);
}
console.log(`Account ${account.id} ("${account.organizationName}"), test account: yes, timezone ${account.timezone}\n`);

// --- 2. Billing usage -------------------------------------------------------
await check("billing usage: active_profiles row", async () => {
  const rows = await listBillingUsage(client);
  const picked = pickProfilesUsage(rows);
  if (!picked.usage) throw new Error(`no profiles usage row; candidates: ${picked.candidates.join(",") || "none"}`);
  const u = picked.usage;
  return `ids: ${rows.map((r) => `${r.usageTypeId}(${r.unit})`).join(", ")}\npicked ${u.usageTypeId}: used ${u.usageUsed}, max ${u.usageMax}, period ${u.periodStart?.toISOString()} -> ${u.periodEnd?.toISOString()}, as of ${u.asOf?.toISOString()}`;
});

// --- 3. Profiles: full scan with the app's reader ----------------------------
const profiles: KlaviyoProfileRecord[] = [];
await check("profiles: full scan (sort=created, 100 per page, subscriptions, seed property)", async () => {
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await listProfilesPage(client, { cursor, testCreatedAtProperty: SEED_CREATED_AT_PROPERTY });
    profiles.push(...page.items);
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 100);
  const ids = new Set(profiles.map((p) => p.id));
  return [
    `${profiles.length} profiles in ${pages} pages, ${ids.size} distinct ids`,
    `email hash present: ${profiles.filter((p) => p.emailHash).length}`,
    `created present: ${profiles.filter((p) => p.createdAt).length}; ${SEED_CREATED_AT_PROPERTY} parsed: ${profiles.filter((p) => p.testCreatedAt).length}`,
    `last_event_date present: ${profiles.filter((p) => p.lastEventAt).length}`,
    `subscriptions.email.marketing present: ${profiles.filter((p) => p.email).length}`,
    `  can_receive_email_marketing: ${tally(profiles, (p) => String(p.email?.canReceiveMarketing))}`,
    `  consent: ${tally(profiles, (p) => String(p.email?.consent))}`,
    `  suppression reasons: ${tally(profiles, (p) => p.email?.suppressionReasons.join("+") || "(none)")}`,
    `subscriptions.sms.marketing present: ${profiles.filter((p) => p.sms).length}`,
    `  can_receive_sms_marketing: ${tally(profiles, (p) => String(p.sms?.canReceiveMarketing))}`,
    `  consent: ${tally(profiles, (p) => String(p.sms?.consent))}`,
  ].join("\n");
});

// --- 4. Id -> email lookup used by the suppression gateway -------------------
await check("profiles: any(id,[...]) lookup of 50 ids plus one unknown id", async () => {
  const ids = profiles.slice(0, 49).map((p) => p.id);
  if (ids.length < 49) throw new Error("not enough profiles");
  const found = await getProfileEmails(client, [...ids, "01ZZZZZZZZZZZZZZZZZZZZZZZZ"]);
  return `asked 50, got ${found.size}; with email: ${[...found.values()].filter(Boolean).length}; unknown id absent: ${!found.has("01ZZZZZZZZZZZZZZZZZZZZZZZZ")}`;
});

// --- 5. Lists ---------------------------------------------------------------
await check("lists: first page", async () => {
  const page = await listGroupsPage(client, "list");
  return `${page.items.length} lists on the first page${page.nextCursor ? " (more pages)" : ""}`;
});

// --- 6. Suppression job status ----------------------------------------------
const jobId = option("--suppress-job-id");
if (jobId) {
  await check("suppression job status", async () => {
    const job = await getSuppressionJob(client, "suppress", jobId);
    return `status ${job.status}, total ${job.totalCount}, completed ${job.completedCount}, skipped ${job.skippedCount}, completed_at ${job.completedAt?.toISOString()}`;
  });
}

// --- 7. Metrics -------------------------------------------------------------
const metrics: KlaviyoMetric[] = [];
await check("metrics: list (scope metrics:read)", async () => {
  let cursor: string | null = null;
  do {
    const page = await listMetricsPage(client, { cursor });
    metrics.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const resolved = resolveMetrics(metrics, SEEDED_METRIC_SPECS);
  return [
    ...metrics.map((m) => `${m.id}  "${m.name}"  ${m.integrationName} / ${m.integrationCategory}`),
    `resolved with SEEDED_METRIC_SPECS: ${JSON.stringify(resolved)}`,
    `resolved with defaults: ${JSON.stringify(resolveMetrics(metrics))}`,
  ].join("\n");
});

// --- 8. Events path (alternative reader) ------------------------------------
if (metrics.length > 0) {
  const resolved = resolveMetrics(metrics, SEEDED_METRIC_SPECS);
  for (const signal of ["received", "open"] as const) {
    const metricId = resolved[signal][0];
    if (!metricId) continue;
    await check(`events: first page of seeded "${signal}" metric ${metricId}`, async () => {
      const page = await listEngagementEventsPage(client, { metricId, since: new Date("2020-01-01T00:00:00Z"), withProperties: true, pageSize: 200 });
      return `${page.items.length} events, unattributed ${page.unattributed}, machine opens ${page.items.filter((e) => e.machineOpen).length}, more pages: ${Boolean(page.nextCursor)}`;
    });
  }
}

// --- 9. Candidate segment ---------------------------------------------------
if (metrics.length > 0) {
  const built = buildCandidateSegmentDefinition(metrics, DEFAULT_RULE_SETTINGS, SEEDED_METRIC_SPECS);
  await check("candidate segment: definition from the account's metrics", async () => {
    if (!built.ok) throw new Error(built.reason);
    return `${built.definition.condition_groups.length} condition groups`;
  });
  if (built.ok && flag("--write-segment")) {
    let segmentId: string | null = null;
    await check("candidate segment: create or update (scope segments:write)", async () => {
      const segment = await ensureCandidateSegment(client, built.definition);
      segmentId = segment.id;
      return `segment ${segment.id}, written: ${segment.written ?? "no (already correct)"}`;
    });
    if (segmentId) {
      await check("candidate segment: processing finishes and the echoed definition matches ours", async () => {
        const started = Date.now();
        for (;;) {
          const segment = await getCandidateSegment(client, segmentId!, built.definition);
          if (!segment.isProcessing) {
            if (!segment.definitionMatches) throw new Error("definition echoed by Klaviyo differs from the one sent");
            return `processed after ${Math.round((Date.now() - started) / 1000)} s, active: ${segment.isActive}, definition matches: yes`;
          }
          if (Date.now() - started > 15 * 60_000) throw new Error("still processing after 15 minutes");
          await sleep(10_000);
        }
      });
      await check("candidate segment: members", async () => {
        const members: KlaviyoProfileRecord[] = [];
        let cursor: string | null = null;
        do {
          const page = await listCandidateSegmentProfilesPage(client, segmentId!, { cursor });
          members.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);
        return `${members.length} members; sms present on ${members.filter((p) => p.sms).length}; suppressed among them: ${members.filter((p) => (p.email?.suppressionReasons.length ?? 0) > 0).length}`;
      });
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
