/** Merchant-facing names of run states. Shared by the history and run pages. */
export const STATUS_LABELS: Record<string, { label: string; tone: "info" | "success" | "warning" | "critical" }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  completed_with_errors: { label: "Completed with issues", tone: "warning" },
  failed: { label: "Did not run", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
};


/** Hours a confirmed charge waits before it is sent to Shopify, so a full undo inside the window is free. */
export const CHARGE_HOLD_HOURS = 72;
