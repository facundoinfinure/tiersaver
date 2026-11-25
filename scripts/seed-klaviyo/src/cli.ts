/**
 * Command line entry point. Default mode is a dry run: it prints the plan and
 * makes no network request. See README.md.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FetchLike } from "./client.js";
import { redactSecret } from "./client.js";
import { DEFAULT_COUNT, DEFAULT_EMAIL_DOMAIN, DEFAULT_SEED, MAX_COUNT, MIN_COUNT, defaultRunTag, generateDataset } from "./generate.js";
import { API_KEY_ENV, KLAVIYO_REVISION, isReservedEmailDomain } from "./klaviyo-config.js";
import { buildPlan, formatPlan } from "./plan.js";
import { SeedRefusal, executeSeed, verifySeed, type RunConfig } from "./run.js";

export const EXIT = { ok: 0, error: 1, refused: 2, warnings: 3 } as const;

const VALUE_FLAGS = ["seed", "count", "now", "email-domain", "run-tag", "account-id", "expect-account-name", "protected-list-id", "state-dir"] as const;
const BOOLEAN_FLAGS = ["execute", "dry-run", "verify", "allow-non-test-account", "allow-reserved-domain", "skip-sms", "help"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
type BooleanFlag = (typeof BOOLEAN_FLAGS)[number];

export interface ParsedArgs {
  values: Partial<Record<ValueFlag, string>>;
  flags: Set<BooleanFlag>;
}

const KEY_HINT = `The API key is never accepted on the command line. Set the ${API_KEY_ENV} environment variable instead.`;

/** Never echoes argument values: a mistyped command line may contain the key. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values: Partial<Record<ValueFlag, string>> = {};
  const flags = new Set<BooleanFlag>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      throw new SeedRefusal(/^pk_/i.test(arg) ? KEY_HINT : `Unexpected argument in position ${i + 1}. Run with --help.`);
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (/key|token|secret/i.test(name)) throw new SeedRefusal(KEY_HINT);
    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (eq !== -1) throw new SeedRefusal(`--${name} does not take a value.`);
      flags.add(name as BooleanFlag);
    } else if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
      if (value === undefined || value === "" || (eq === -1 && value.startsWith("--"))) throw new SeedRefusal(`--${name} needs a value.`);
      if (/^pk_/i.test(value)) throw new SeedRefusal(KEY_HINT);
      values[name as ValueFlag] = value;
    } else {
      throw new SeedRefusal(`Unknown option --${name.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}. Run with --help.`);
    }
  }
  return { values, flags };
}

function wholeNumber(text: string, name: string): number {
  if (!/^\d{1,10}$/.test(text)) throw new SeedRefusal(`--${name} must be a whole number.`);
  return Number(text);
}

export const DEFAULT_STATE_DIR = fileURLToPath(new URL("../.state", import.meta.url));

export function toRunConfig(parsed: ParsedArgs): RunConfig {
  const { values, flags } = parsed;
  const seed = values.seed === undefined ? DEFAULT_SEED : wholeNumber(values.seed, "seed");
  const count = values.count === undefined ? DEFAULT_COUNT : wholeNumber(values.count, "count");
  if (count < MIN_COUNT || count > MAX_COUNT) throw new SeedRefusal(`--count must be between ${MIN_COUNT} and ${MAX_COUNT}.`);
  let now: Date | null = null;
  if (values.now !== undefined) {
    now = new Date(values.now);
    if (Number.isNaN(now.getTime())) throw new SeedRefusal("--now must be an ISO 8601 date, e.g. 2026-11-25T12:00:00Z.");
  }
  return {
    seed,
    count,
    now,
    emailDomain: (values["email-domain"] ?? DEFAULT_EMAIL_DOMAIN).toLowerCase(),
    runTag: values["run-tag"] ?? defaultRunTag(seed),
    accountId: values["account-id"] ?? null,
    expectAccountName: values["expect-account-name"] ?? null,
    allowNonTestAccount: flags.has("allow-non-test-account"),
    allowReservedDomain: flags.has("allow-reserved-domain"),
    protectedListId: values["protected-list-id"] ?? null,
    skipSms: flags.has("skip-sms"),
    stateDir: values["state-dir"] ?? DEFAULT_STATE_DIR,
  };
}

export const HELP = `Seed a TEST Klaviyo account with fictitious profiles (API revision ${KLAVIYO_REVISION}).

Usage: npm run seed -w @tiersaver/seed-klaviyo -- [options]

Default is a dry run: prints the plan, makes no network request.

Dataset
  --seed <n>                 PRNG seed (default ${DEFAULT_SEED})
  --count <n>                Number of profiles, ${MIN_COUNT}-${MAX_COUNT} (default ${DEFAULT_COUNT})
  --now <iso-date>           Instant all ages are relative to (default: current time)
  --email-domain <domain>    Domain of the generated addresses (default ${DEFAULT_EMAIL_DOMAIN})
  --run-tag <tag>            Prefix of emails and event ids (default ts-seed-<seed>)
  --protected-list-id <id>   Existing list to add the "protected_group" cohort to
  --skip-sms                 Do not set SMS consent on the "sms_consented" cohort

Real run (all required)
  --execute                  Actually call the Klaviyo API
  --account-id <id>          Expected account id (the 6-character public API key / site id)
  --expect-account-name <n>  Expected organization name; at least one of the two is required
  ${API_KEY_ENV}             Environment variable with the private key of the TEST account

Other
  --verify                   Read-only check of one profile per cohort after a run
  --allow-non-test-account   Proceed although Klaviyo does not flag the account as a test account
  --allow-reserved-domain    Proceed with a domain whose events Klaviyo is documented to drop
  --state-dir <dir>          Where progress files live (default: .state/ in this package)
  --dry-run                  Explicit form of the default
  --help
`;

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  err: (line: string) => void;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  random?: () => number;
  pollIntervalMs?: number;
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  // The key may be present in the environment even in a dry run; scrub every line regardless.
  const secret = deps.env[API_KEY_ENV]?.trim() ?? "";
  const out = (line: string): void => deps.out(redactSecret(line, secret));
  const err = (line: string): void => deps.err(redactSecret(line, secret));
  try {
    const parsed = parseArgs(argv);
    if (parsed.flags.has("help")) {
      out(HELP);
      return EXIT.ok;
    }
    const modes = (["execute", "dry-run", "verify"] as const).filter((m) => parsed.flags.has(m));
    if (modes.length > 1) throw new SeedRefusal(`Choose one of --${modes.join(", --")}.`);
    const config = toRunConfig(parsed);
    const runDeps = { env: deps.env, fetch: deps.fetch, sleep: deps.sleep, clock: deps.clock, random: deps.random, pollIntervalMs: deps.pollIntervalMs, log: out };

    if (parsed.flags.has("verify")) {
      const rows = await verifySeed(config, runDeps);
      for (const row of rows) out(`${row.ok ? "ok  " : "FAIL"} ${row.cohort.padEnd(38)} ${row.ok ? "" : row.problems.join("; ")}`);
      const failed = rows.filter((r) => !r.ok).length;
      out(failed === 0 ? `All ${rows.length} sampled profiles match.` : `${failed} of ${rows.length} sampled profiles do not match.`);
      return failed === 0 ? EXIT.ok : EXIT.warnings;
    }

    if (!parsed.flags.has("execute")) {
      const now = config.now ?? new Date((deps.clock ?? Date.now)());
      const dataset = generateDataset({ seed: config.seed, count: config.count, now, emailDomain: config.emailDomain, runTag: config.runTag });
      const plan = buildPlan(dataset, { protectedListId: config.protectedListId ?? undefined, skipSms: config.skipSms });
      out(formatPlan(dataset, plan));
      if (isReservedEmailDomain(config.emailDomain)) {
        out("");
        out(`Note: Klaviyo silently drops events for "@${config.emailDomain}" addresses. A real run needs --email-domain <a domain you control>.`);
      }
      out("");
      out("DRY RUN: no network request was made. Add --execute with --account-id / --expect-account-name to seed the test account.");
      return EXIT.ok;
    }

    const result = await executeSeed(config, runDeps);
    out(`Done: ${result.stepsRun} steps run, ${result.stepsSkipped} already complete, ${result.requests} requests.`);
    out(`Dataset is relative to ${result.now.toISOString()}; evaluate rules as of that instant.`);
    out(`Progress file: ${result.statePath}`);
    for (const warning of result.warnings) out(`WARNING: ${warning}`);
    return result.warnings.length > 0 ? EXIT.warnings : EXIT.ok;
  } catch (error) {
    if (error instanceof SeedRefusal || error instanceof RangeError) {
      err(`Refused: ${error.message}`);
      return EXIT.refused;
    }
    err(`Error: ${error instanceof Error ? error.message : "unknown error"}`);
    return EXIT.error;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}
