/** Merchant-facing names of run states. Shared by the history and run pages. */
export const STATUS_LABELS: Record<string, { label: string; tone: "info" | "success" | "warning" | "critical" }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_errors: { label: "Completed with issues", tone: "warning" },
  failed: { label: "Did not run", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

/** The badge of a run. A cleanup that failed after sending some profiles "stopped early"; it "did not run" only when it sent none. */
export function statusLabel(run: { status: string; submitted: number; unknown?: number; stopping?: boolean; kind?: string; error?: string | null }): { label: string; tone: "info" | "success" | "warning" | "critical" } {
  if (run.stopping) return { label: "Stopping", tone: "warning" };
  // An error closed it before the end, after it had sent something: the same words as the banner on its page.
  if ((run.status === "failed" || (run.status === "completed_with_errors" && run.error)) && run.submitted + (run.unknown ?? 0) > 0) return { label: "Stopped early", tone: "warning" };
  if (run.status === "cancelled" && run.kind !== "undo") return { label: "Stopped", tone: "warning" };
  return STATUS_LABELS[run.status] ?? { label: run.status, tone: "info" };
}

/**
 * Why a profile was left untouched by a cleanup or a restore (`run_profiles.error_code` of skipped rows;
 * codes from SKIP_REASONS in gateway.server.ts). Anything not listed is shown as `OTHER_SKIP_LABEL`.
 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  purchased_since_simulation: "Placed an order after the simulation",
  not_in_candidate_segment: "No longer matched your rules in Klaviyo (engaged, changed consent, or no longer exists)",
  already_suppressed: "Already suppressed in Klaviyo",
  email_changed: "Email address changed since the simulation",
  no_email: "No email address in Klaviyo",
  email_hash_missing: "Customer data was erased on request",
  state_unknown: "Klaviyo did not return the profile's current state",
  profile_gone: "No longer exists in Klaviyo",
  suppressed_before_cleanup: "Already suppressed in Klaviyo more than a day before this cleanup, so that suppression is not TierSaver's",
  suppressed_after_cleanup: "Suppressed again in Klaviyo more than a day after this cleanup, by you or another tool",
};
export const OTHER_SKIP_LABEL = "Could not be confirmed";

/** Why a cleanup stopped or did not run (`runs.last_error`), in the merchant's words. */
export const RUN_ERROR_LABELS: Record<string, string> = {
  suppression_disabled: "Cleanups are not switched on for this installation. Nothing was changed in Klaviyo.",
  suppression_not_allowed_for_account: "Cleanups are not switched on for this Klaviyo account. Nothing was changed in Klaviyo.",
  klaviyo_needs_reauth: "TierSaver's access to Klaviyo ended. Reconnect Klaviyo from the home page.",
  klaviyo_not_connected: "Klaviyo is not connected.",
  klaviyo_account_used_by_another_store: "This Klaviyo account is already connected to another store that uses TierSaver. Only one store can clean a Klaviyo account. Nothing was changed in Klaviyo.",
  klaviyo_disconnected: "Klaviyo was disconnected.",
  simulation_expired: "The simulation was more than 24 hours old when the cleanup started.",
  simulation_superseded: "Your rules changed after the simulation was approved.",
  run_stalled: "The cleanup stopped responding and was closed. The counts below are what was actually sent to Klaviyo.",
  run_never_started: "The cleanup could not be started. Nothing was changed in Klaviyo.",
  candidate_segment_missing: "TierSaver's segment in Klaviyo could not be found, so the profiles could not be checked again.",
  candidate_segment_changed: "TierSaver's segment in Klaviyo was edited or deactivated, so the profiles could not be checked again.",
  candidate_segment_processing: "Klaviyo was still updating TierSaver's segment, so the profiles could not be checked again.",
  candidate_segment_unavailable: "The profiles could not be checked again in Klaviyo.",
  klaviyo_account_changed: "The connected Klaviyo account changed.",
  market_excluded: "TierSaver is not available for stores in the European Union, the United Kingdom or Switzerland yet. Nothing was changed in Klaviyo and nothing is charged.",
};
export const OTHER_RUN_ERROR_LABEL = "Something went wrong while talking to Klaviyo.";
