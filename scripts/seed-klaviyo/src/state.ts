/**
 * Local progress file, one per run tag, under a gitignored directory.
 * It makes a run resumable: finished steps are skipped and submitted jobs are
 * polled again instead of being submitted twice. It never contains the API key.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StepState {
  status: "submitted" | "done" | "failed";
  /** Klaviyo job id, for polled steps. */
  jobId?: string;
  at: string;
  info?: Record<string, string | number | boolean>;
}

export interface RunFingerprint {
  seed: number;
  count: number;
  emailDomain: string;
  /** ISO instant the dataset is relative to. Reused on resume so the data does not shift. */
  now: string;
  accountId: string;
  protectedListId: string | null;
}

export interface RunState {
  version: 1;
  runTag: string;
  fingerprint: RunFingerprint;
  startedAt: string;
  steps: Record<string, StepState>;
}

export function statePath(stateDir: string, runTag: string): string {
  return join(stateDir, `${runTag}.json`);
}

export function loadState(stateDir: string, runTag: string): RunState | null {
  let text: string;
  try {
    text = readFileSync(statePath(stateDir, runTag), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
  const state = JSON.parse(text) as RunState;
  if (state.version !== 1 || state.runTag !== runTag) {
    throw new Error(`state file ${statePath(stateDir, runTag)} is not a version 1 state for run "${runTag}"`);
  }
  return state;
}

/** Atomic write: a crash mid-write cannot leave a truncated file. */
export function saveState(stateDir: string, state: RunState): void {
  mkdirSync(stateDir, { recursive: true });
  const target = statePath(stateDir, state.runTag);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
}

/** Fields that differ between a stored fingerprint and the one requested now. */
export function fingerprintDiff(stored: RunFingerprint, requested: RunFingerprint): string[] {
  return (Object.keys(requested) as (keyof RunFingerprint)[]).filter((key) => stored[key] !== requested[key]);
}
