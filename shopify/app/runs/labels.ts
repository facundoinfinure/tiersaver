/** Merchant-facing names of run states. Shared by the history and run pages. */
export const STATUS_LABELS: Record<string, { label: string; tone: "info" | "success" | "warning" | "critical" }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_errors: { label: "Completed with issues", tone: "warning" },
  failed: { label: "Did not run", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};

/**
 * Why a profile was left untouched by a cleanup or a restore (`run_profiles.error_code` of skipped rows;
 * codes from SKIP_REASONS in gateway.server.ts). Anything not listed is shown as `OTHER_SKIP_LABEL`.
 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  purchased_since_simulation: "Placed an order after the simulation",
  not_in_candidate_segment: "No longer matched your rules in Klaviyo (engaged, changed consent, or no longer exists)",
  already_suppressed: "Already suppressed in Klaviyo",
  email_changed: "Email address changed since the simulation",
  no_email: "No email address",
  email_hash_missing: "Customer data was erased on request",
  state_unknown: "Klaviyo did not return the profile's current state",
  profile_gone: "No longer exists in Klaviyo",
  suppressed_before_cleanup: "Was already suppressed before this cleanup",
  suppressed_after_cleanup: "Suppressed again in Klaviyo after this cleanup",
};
export const OTHER_SKIP_LABEL = "Could not be confirmed";

/** Hours a confirmed charge waits before it is sent to Shopify, so a full undo inside the window is free. */
export const CHARGE_HOLD_HOURS = 72;
