import { flatTierFor, formatUsd, type ProtectionReason } from "@tiersaver/core";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db.server";
import type { ScanSummary } from "./engine";

/** What the audit screen shows. Every number comes from the merchant's own Klaviyo account. */
export interface AuditView {
  scan: { id: string; status: "queued" | "running" | "completed" | "failed"; error: string | null; createdAt: string; membersRead: number } | null;
  result: {
    finishedAt: string;
    activeProfiles: number;
    /** "klaviyo_usage": Klaviyo's own billing count. "counted": counted by TierSaver. */
    activeProfilesSource: string | null;
    /** Profiles that meet Klaviyo's criteria according to Klaviyo's segment engine. */
    matchingKlaviyoCriteria: number;
    /** Of those, the ones every TierSaver rule also lets through. */
    candidates: number;
    keptActive: { label: string; count: number }[];
    note: string | null;
    /** TierSaver's monthly price for this list size, e.g. "$15". Null above the public tiers. */
    price: string | null;
    seededTestAccount: boolean;
  } | null;
}

export const KEPT_LABELS: Record<ProtectionReason, string> = {
  recent_purchase: "Purchased from your Shopify store",
  recent_click: "Clicked an email",
  recent_open: "Opened an email",
  recent_site_activity: "Was active on your site",
  new_profile: "Created or subscribed too recently",
  sms_consent: "Has SMS consent",
  protected_group: "Belongs to a list or segment you protect",
  recently_reactivated: "Was restored in the last 365 days",
  not_enough_emails_received: "Has not received enough emails",
  unknown_send_history: "Send history could not be read",
  unknown_profile_age: "Creation date could not be read",
  insufficient_engagement_history: "Engagement history is incomplete",
  insufficient_purchase_history: "Shopify order history does not reach back far enough",
};

const NOTES: Record<string, string> = {
  received_metric_unresolved:
    "Your Klaviyo account has no record of delivered emails yet, so no profile can be called inactive.",
  open_metric_missing: "Your Klaviyo account has no email open data yet, so no profile can be called inactive.",
  click_metric_missing: "Your Klaviyo account has no email click data yet, so no profile can be called inactive.",
};

/** The latest scan of the shop and the result of the latest scan that finished. */
export async function loadAuditView(shop: string): Promise<AuditView> {
  const scans = await db.query.scans.findMany({ where: eq(schema.scans.shop, shop), orderBy: desc(schema.scans.createdAt), limit: 10 });
  const latest = scans[0] ?? null;
  const completed = scans.find((s) => s.status === "completed" && s.simulationId);
  const simulation = completed?.simulationId
    ? await db.query.simulations.findFirst({ where: eq(schema.simulations.id, completed.simulationId) })
    : null;

  let result: AuditView["result"] = null;
  if (completed && simulation) {
    const summary = simulation.summary as ScanSummary;
    const tier = flatTierFor(simulation.activeProfiles);
    result = {
      finishedAt: (completed.finishedAt ?? simulation.createdAt).toISOString(),
      activeProfiles: simulation.activeProfiles,
      activeProfilesSource: simulation.activeProfilesSource,
      matchingKlaviyoCriteria: simulation.evaluatedCount,
      candidates: simulation.candidateCount,
      keptActive: (Object.entries(summary.protectedByReason ?? {}) as [ProtectionReason, number][])
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ label: KEPT_LABELS[reason] ?? reason, count })),
      note: summary.protectedGroupsUnknown
        ? "A protected list or segment could not be read, so every profile was kept active."
        : summary.note
          ? (NOTES[summary.note] ?? null)
          : null,
      price: tier ? formatUsd(tier.monthlyCents) : null,
      seededTestAccount: summary.seededTestAccount === true,
    };
  }

  return {
    scan: latest
      ? { id: latest.id, status: latest.status, error: latest.lastError, createdAt: latest.createdAt.toISOString(), membersRead: latest.memberCount }
      : null,
    result,
  };
}
