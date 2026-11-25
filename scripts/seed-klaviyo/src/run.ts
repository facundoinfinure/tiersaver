/**
 * Real run: guards, then the plan step by step, with a progress file.
 *
 * Nothing in this file is reachable without `--execute` (see cli.ts).
 */
import { KlaviyoApiError, KlaviyoClient, redactSecret, type FetchLike } from "./client.js";
import { generateDataset, type SeedDataset, type SeedProfile } from "./generate.js";
import { API_KEY_ENV, SEED_PROPERTIES, isReservedEmailDomain, type EndpointName } from "./klaviyo-config.js";
import { buildPlan, type Plan, type PlanStep } from "./plan.js";
import { fingerprintDiff, loadState, saveState, statePath, type RunFingerprint, type RunState } from "./state.js";

export interface RunConfig {
  seed: number;
  count: number;
  /** Explicit --now. When null, a resumed run reuses the stored instant and a new run uses the clock. */
  now: Date | null;
  emailDomain: string;
  runTag: string;
  accountId: string | null;
  expectAccountName: string | null;
  allowNonTestAccount: boolean;
  allowReservedDomain: boolean;
  protectedListId: string | null;
  skipSms: boolean;
  stateDir: string;
}

export interface RunDeps {
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  random?: () => number;
  log: (message: string) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** A refusal: the run was stopped by a safety check, before changing anything. */
export class SeedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefusal";
  }
}

export interface RunResult {
  accountId: string;
  organizationName: string;
  now: Date;
  stepsRun: number;
  stepsSkipped: number;
  requests: number;
  warnings: string[];
  statePath: string;
}

interface Account {
  id: string;
  organizationName: string;
  testAccount: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readApiKey(env: Record<string, string | undefined>): string {
  const key = env[API_KEY_ENV]?.trim();
  if (!key) throw new SeedRefusal(`${API_KEY_ENV} is not set. The key is read only from that environment variable.`);
  return key;
}

/** Checks that need no network. Run before the first request. */
function preflight(config: RunConfig): void {
  if (!config.accountId && !config.expectAccountName) {
    throw new SeedRefusal("A real run needs --account-id <id> and/or --expect-account-name <name> naming the TEST account to seed.");
  }
  if (isReservedEmailDomain(config.emailDomain) && !config.allowReservedDomain) {
    throw new SeedRefusal(
      `Klaviyo silently drops events for addresses at "${config.emailDomain}" (and similar test domains): the profiles would be ` +
        "created with no activity. Pass --email-domain <a domain you control that receives no mail>, " +
        "or --allow-reserved-domain to try anyway.",
    );
  }
}

async function fetchAccount(client: KlaviyoClient): Promise<Account> {
  const response = await client.request("GET", "accounts");
  const data = (response.json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new SeedRefusal("GET /api/accounts did not return exactly one account; cannot confirm which account this key belongs to.");
  }
  const account = data[0] as { id?: unknown; attributes?: { test_account?: unknown; contact_information?: { organization_name?: unknown } } };
  if (typeof account.id !== "string" || !account.id) throw new SeedRefusal("GET /api/accounts returned an account without an id.");
  const name = account.attributes?.contact_information?.organization_name;
  return {
    id: account.id,
    organizationName: typeof name === "string" ? name : "",
    testAccount: account.attributes?.test_account === true,
  };
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Refuses unless the key belongs to exactly the account the operator named. */
export function assertExpectedAccount(account: Account, config: Pick<RunConfig, "accountId" | "expectAccountName" | "allowNonTestAccount">): void {
  const actual = `account ${account.id} ("${account.organizationName}")`;
  if (config.accountId && account.id !== config.accountId) {
    throw new SeedRefusal(`The key belongs to ${actual}, not to --account-id ${config.accountId}. Nothing was changed.`);
  }
  if (config.expectAccountName && !sameName(account.organizationName, config.expectAccountName)) {
    throw new SeedRefusal(`The key belongs to ${actual}, not to --expect-account-name "${config.expectAccountName}". Nothing was changed.`);
  }
  if (!account.testAccount && !config.allowNonTestAccount) {
    throw new SeedRefusal(
      `${actual} is not flagged as a test account in Klaviyo (Settings > Account > Testing). ` +
        "Nothing was changed. Convert it, or pass --allow-non-test-account if you are certain.",
    );
  }
}

interface JobAttributes {
  status?: string;
  total_count?: number;
  completed_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
}

function jobOf(json: unknown): { id: string | null; attributes: JobAttributes } {
  const data = (json as { data?: { id?: unknown; attributes?: JobAttributes } } | null)?.data;
  return { id: typeof data?.id === "string" ? data.id : null, attributes: data?.attributes ?? {} };
}

async function pollJob(
  client: KlaviyoClient,
  step: PlanStep,
  jobId: string,
  deps: Required<Pick<RunDeps, "sleep" | "clock" | "pollIntervalMs" | "pollTimeoutMs">>,
): Promise<JobAttributes> {
  const deadline = deps.clock() + deps.pollTimeoutMs;
  for (;;) {
    const { attributes } = jobOf((await client.request("GET", step.endpoint, `/${encodeURIComponent(jobId)}`)).json);
    if (attributes.status === "complete") return attributes;
    if (attributes.status === "cancelled") throw new Error(`Klaviyo cancelled job ${jobId} (step ${step.id}).`);
    if (deps.clock() >= deadline) {
      throw new Error(`Job ${jobId} (step ${step.id}) is still "${attributes.status}". Run the same command again to keep waiting.`);
    }
    await deps.sleep(deps.pollIntervalMs);
  }
}

async function importErrors(client: KlaviyoClient, jobId: string): Promise<string> {
  try {
    const response = await client.request("GET", "profileImport", `/${encodeURIComponent(jobId)}/import-errors`, { query: { "page[size]": "20" } });
    const data = (response.json as { data?: { attributes?: { code?: string; detail?: string } }[] } | null)?.data ?? [];
    return [...new Set(data.map((e) => `${e.attributes?.code ?? "error"}: ${e.attributes?.detail ?? ""}`))].slice(0, 5).join("; ");
  } catch {
    return "could not read the import errors";
  }
}

export async function executeSeed(config: RunConfig, deps: RunDeps): Promise<RunResult> {
  preflight(config);
  const apiKey = readApiKey(deps.env);
  const log = (message: string): void => deps.log(redactSecret(message, apiKey));
  const clock = deps.clock ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const client = new KlaviyoClient({ apiKey, fetch: deps.fetch, sleep, clock, random: deps.random, log });

  const account = await fetchAccount(client);
  assertExpectedAccount(account, config);
  log(`Account confirmed: ${account.id} ("${account.organizationName}"), test account: ${account.testAccount ? "yes" : "NO"}.`);

  // Resume: reuse the stored `now` so the regenerated dataset is byte-identical.
  const existing = loadState(config.stateDir, config.runTag);
  const now = config.now ?? (existing ? new Date(existing.fingerprint.now) : new Date(clock()));
  const dataset = generateDataset({ seed: config.seed, count: config.count, now, emailDomain: config.emailDomain, runTag: config.runTag });
  const fingerprint: RunFingerprint = {
    seed: dataset.seed,
    count: dataset.count,
    emailDomain: dataset.emailDomain,
    now: dataset.now.toISOString(),
    accountId: account.id,
    protectedListId: config.protectedListId,
  };
  if (existing) {
    const diff = fingerprintDiff(existing.fingerprint, fingerprint);
    if (diff.length > 0) {
      throw new SeedRefusal(
        `Run "${config.runTag}" was started with different options (${diff.join(", ")}). Resuming would mix two datasets. ` +
          `Repeat the original options, or start a separate run with --run-tag. State: ${statePath(config.stateDir, config.runTag)}`,
      );
    }
    log(`Resuming run "${config.runTag}" (dataset relative to ${fingerprint.now}).`);
  }
  const state: RunState = existing ?? { version: 1, runTag: config.runTag, fingerprint, startedAt: new Date(clock()).toISOString(), steps: {} };
  const persist = (): void => saveState(config.stateDir, JSON.parse(redactSecret(JSON.stringify(state), apiKey)) as RunState);
  persist();

  const plan: Plan = buildPlan(dataset, { protectedListId: config.protectedListId ?? undefined, skipSms: config.skipSms });
  const pollDeps = { sleep, clock, pollIntervalMs: deps.pollIntervalMs ?? 5_000, pollTimeoutMs: deps.pollTimeoutMs ?? 30 * 60_000 };
  const warnings: string[] = [];
  const stamp = (): string => new Date(clock()).toISOString();
  let stepsRun = 0;
  let stepsSkipped = 0;

  for (const step of plan.steps) {
    const previous = state.steps[step.id];
    if (previous?.status === "done") {
      stepsSkipped += 1;
      continue;
    }
    stepsRun += 1;

    let jobId = previous?.status === "submitted" ? previous.jobId : undefined;
    if (!jobId) {
      log(`${step.id}: sending ${step.items} items (${(step.bytes / 1024).toFixed(0)} KB)`);
      let response;
      try {
        response = await client.request("POST", step.endpoint, "", { body: step.body });
      } catch (error) {
        // SMS consent depends on account setup we cannot verify; do not lose the rest of the run over it.
        if (step.kind === "subscribe_sms" && error instanceof KlaviyoApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          state.steps[step.id] = { status: "failed", at: stamp(), info: { error: error.message } };
          persist();
          warnings.push(`${step.id}: ${error.message}. The "sms_consented" cohort has no SMS consent.`);
          continue;
        }
        throw error;
      }
      const partial = response.headers.get("X-Klaviyo-Partial-Failure");
      if (partial) warnings.push(`${step.id}: Klaviyo reported a partial failure on "${partial}" (the field was ignored).`);
      if (step.polled) {
        jobId = jobOf(response.json).id ?? undefined;
        if (!jobId) throw new Error(`${step.id}: Klaviyo accepted the request but returned no job id.`);
        state.steps[step.id] = { status: "submitted", jobId, at: stamp() };
        persist();
      }
    } else {
      log(`${step.id}: already submitted as job ${jobId}, checking it`);
    }

    const info: Record<string, string | number | boolean> = { items: step.items };
    if (step.polled && jobId) {
      const job = await pollJob(client, step, jobId, pollDeps);
      for (const key of ["total_count", "completed_count", "failed_count", "skipped_count"] as const) {
        const value = job[key];
        if (typeof value === "number") info[key] = value;
      }
      if ((job.failed_count ?? 0) > 0) {
        warnings.push(`${step.id}: ${job.failed_count} profiles failed to import (${await importErrors(client, jobId)}).`);
      }
      if ((job.skipped_count ?? 0) > 0) warnings.push(`${step.id}: Klaviyo skipped ${job.skipped_count} of ${step.items} emails.`);
    }
    state.steps[step.id] = { status: "done", ...(jobId ? { jobId } : {}), at: stamp(), info };
    persist();
  }

  return {
    accountId: account.id,
    organizationName: account.organizationName,
    now: dataset.now,
    stepsRun,
    stepsSkipped,
    requests: client.requestCount,
    warnings,
    statePath: statePath(config.stateDir, config.runTag),
  };
}

export interface VerifyRow {
  cohort: string;
  email: string;
  ok: boolean;
  problems: string[];
}

function sampleProfiles(dataset: SeedDataset): SeedProfile[] {
  const seen = new Set<string>();
  return dataset.profiles.filter((p) => (seen.has(p.cohort) ? false : (seen.add(p.cohort), true)));
}

/**
 * Read-only check after a run: looks up the first profile of every cohort and
 * compares what Klaviyo stored with what was sent. Events are processed
 * asynchronously and can be dropped without an error, so this is the only way
 * to know they landed. Needs the progress file of the run (for its `now`).
 */
export async function verifySeed(config: RunConfig, deps: RunDeps): Promise<VerifyRow[]> {
  preflight({ ...config, allowReservedDomain: true });
  const apiKey = readApiKey(deps.env);
  const log = (message: string): void => deps.log(redactSecret(message, apiKey));
  const client = new KlaviyoClient({ apiKey, fetch: deps.fetch, sleep: deps.sleep, clock: deps.clock, random: deps.random, log });
  assertExpectedAccount(await fetchAccount(client), config);

  const state = loadState(config.stateDir, config.runTag);
  if (!state) throw new SeedRefusal(`No progress file for run "${config.runTag}" in ${config.stateDir}: nothing to verify.`);
  const dataset = generateDataset({
    seed: state.fingerprint.seed,
    count: state.fingerprint.count,
    now: new Date(state.fingerprint.now),
    emailDomain: state.fingerprint.emailDomain,
    runTag: config.runTag,
  });
  const smsStepDone = Object.entries(state.steps).some(([id, s]) => id.startsWith("subscribe_sms:") && s.status === "done");

  const rows: VerifyRow[] = [];
  for (const profile of sampleProfiles(dataset)) {
    const problems: string[] = [];
    const found = await client.request("GET", "profiles", "", {
      query: { filter: `equals(email,"${profile.email}")`, "additional-fields[profile]": "subscriptions" },
    });
    const record = ((found.json as { data?: unknown[] } | null)?.data ?? [])[0] as
      | {
          id?: string;
          attributes?: {
            properties?: Record<string, unknown>;
            subscriptions?: { email?: { marketing?: { suppression?: unknown[] | null } }; sms?: { marketing?: { consent?: string } } };
          };
        }
      | undefined;
    if (!record?.id) {
      rows.push({ cohort: profile.cohort, email: profile.email, ok: false, problems: ["profile not found"] });
      continue;
    }
    if (record.attributes?.properties?.[SEED_PROPERTIES.cohort] !== profile.cohort) problems.push(`${SEED_PROPERTIES.cohort} property missing or different`);
    const suppressed = (record.attributes?.subscriptions?.email?.marketing?.suppression ?? []).length > 0;
    if (suppressed !== profile.suppressed) problems.push(`email suppression is ${suppressed}, expected ${profile.suppressed}`);
    if (smsStepDone && profile.smsConsent && record.attributes?.subscriptions?.sms?.marketing?.consent !== "SUBSCRIBED") {
      problems.push("SMS consent is not SUBSCRIBED");
    }
    const events = await client.request("GET", "events" satisfies EndpointName, "", {
      query: { filter: `equals(profile_id,"${record.id}")`, "page[size]": "100", "fields[event]": "datetime" },
    });
    const stored = ((events.json as { data?: unknown[] } | null)?.data ?? []).length;
    if (stored < profile.events.length) problems.push(`${stored} events stored, ${profile.events.length} sent`);
    rows.push({ cohort: profile.cohort, email: profile.email, ok: problems.length === 0, problems });
  }
  return rows;
}
