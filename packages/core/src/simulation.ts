import { quotePlan, type FeePolicy, type PlanQuote } from "./charge.js";
import type { PriceTable } from "./pricing.js";
import {
  evaluateProfile,
  type CandidateReason,
  type DataCoverage,
  type ProfileSignals,
  type ProtectionReason,
  type RuleSettings,
  type SkipReason,
} from "./rules.js";
import { estimateSavings, type SavingsEstimate } from "./savings.js";

/** A simulation must be approved and executed within this window. */
export const SIMULATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SimulationSummary {
  evaluated: number;
  candidates: number;
  protected: number;
  skipped: number;
  candidatesByReason: Record<CandidateReason, number>;
  /** A profile can be protected by several rules; counts overlap. */
  protectedByReason: Partial<Record<ProtectionReason, number>>;
  skippedByReason: Partial<Record<SkipReason, number>>;
}

export interface SimulationResult {
  summary: SimulationSummary;
  /** Klaviyo profile ids that would be suppressed, with the reason. */
  candidates: { id: string; reason: CandidateReason }[];
  /** Informational only: which Klaviyo list-price plan size the remaining count corresponds to. Never used for the fee. */
  savings: SavingsEstimate;
  /** The monthly TierSaver plan a list of this size needs. Nothing is charged per cleanup. */
  plan: PlanQuote;
}

export interface SimulationInput {
  profiles: Iterable<ProfileSignals>;
  settings: RuleSettings;
  coverage: DataCoverage;
  /** Active profile count of the account (from the audit). */
  activeProfiles: number;
  table: PriceTable;
  onFreePlan?: boolean;
  now: Date;
  feePolicy?: FeePolicy;
}

export function simulate(input: SimulationInput): SimulationResult {
  const summary: SimulationSummary = {
    evaluated: 0,
    candidates: 0,
    protected: 0,
    skipped: 0,
    candidatesByReason: { never_engaged: 0, lapsed: 0 },
    protectedByReason: {},
    skippedByReason: {},
  };
  const candidates: { id: string; reason: CandidateReason }[] = [];
  const seen = new Set<string>();

  for (const profile of input.profiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    summary.evaluated++;
    const decision = evaluateProfile(profile, input.settings, input.coverage, input.now);
    switch (decision.kind) {
      case "candidate":
        summary.candidates++;
        summary.candidatesByReason[decision.reason]++;
        candidates.push({ id: profile.id, reason: decision.reason });
        break;
      case "protected":
        summary.protected++;
        for (const r of decision.reasons) summary.protectedByReason[r] = (summary.protectedByReason[r] ?? 0) + 1;
        break;
      case "skipped":
        summary.skipped++;
        summary.skippedByReason[decision.reason] = (summary.skippedByReason[decision.reason] ?? 0) + 1;
        break;
    }
  }

  const savings = estimateSavings({
    profilesBefore: input.activeProfiles,
    profilesRemoved: summary.candidates,
    table: input.table,
    onFreePlan: input.onFreePlan,
  });

  const plan = quotePlan(input.activeProfiles, input.feePolicy);

  return { summary, candidates, savings, plan };
}

export type SimulationState = {
  createdAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  /** The merchant's settings changed after this simulation was computed. */
  superseded: boolean;
};

export type NotExecutableReason = "not_approved" | "expired" | "already_executed" | "superseded";

/**
 * Hard gate: nothing is ever suppressed without an approved, fresh simulation.
 * Returns null when executable, otherwise the reason.
 */
export function whyNotExecutable(sim: SimulationState, now: Date): NotExecutableReason | null {
  if (sim.executedAt) return "already_executed";
  if (sim.superseded) return "superseded";
  if (!sim.approvedAt) return "not_approved";
  if (now.getTime() - sim.createdAt.getTime() >= SIMULATION_TTL_MS) return "expired";
  if (sim.approvedAt.getTime() < sim.createdAt.getTime()) return "not_approved";
  return null;
}
