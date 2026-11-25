import { DEFAULT_RULE_SETTINGS, DEFAULT_SCHEDULE, RULE_LIMITS, validateRuleSettings, type RuleSettings } from "@tiersaver/core";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * Editing rules, protected groups and the schedule.
 *
 * Guardrails (docs/12-CUMPLIMIENTO-KLAVIYO.md 3.1):
 * - floors come from RULE_LIMITS in @tiersaver/core and cannot be configured away (1);
 * - automatic mode is only available with Klaviyo's own criteria, never with the wider mode (2.4);
 * - any change to rules or protected groups bumps `version`, which supersedes
 *   every simulation computed before it: an approval never outlives the rules it was given for.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };
type SettingsRow = typeof schema.settings.$inferSelect;

export const MAX_PROTECTED_GROUPS = 20;
export const LEAD_DAYS_LIMITS = { min: DEFAULT_SCHEDULE.minLeadDays, max: 14 } as const;
const GROUP_REF = /^(list|segment):[A-Za-z0-9]{1,40}$/;

export function rulesOf(row: SettingsRow): RuleSettings {
  return {
    purchaseDays: row.purchaseDays,
    clickDays: row.clickDays,
    openDays: row.openDays,
    siteActivityDays: row.siteActivityDays,
    newProfileDays: row.newProfileDays,
    minEmailsReceived: row.minEmailsReceived,
    reactivationLockDays: row.reactivationLockDays,
    countMachineOpens: row.countMachineOpens,
  };
}

/** True when the rules are at least as strict as Klaviyo's published criteria (the default mode). */
export function isKlaviyoRecommended(rules: RuleSettings): boolean {
  return (
    rules.purchaseDays === null &&
    rules.clickDays === null &&
    rules.openDays === null &&
    rules.siteActivityDays === null &&
    rules.newProfileDays >= DEFAULT_RULE_SETTINGS.newProfileDays &&
    rules.minEmailsReceived >= DEFAULT_RULE_SETTINGS.minEmailsReceived &&
    rules.countMachineOpens === true
  );
}

export interface SettingsInput {
  /** "recommended" resets every rule to Klaviyo's criteria; "wider" takes the windows below. */
  ruleMode: "recommended" | "wider";
  purchaseDays?: number | null;
  clickDays?: number | null;
  openDays?: number | null;
  siteActivityDays?: number | null;
  newProfileDays?: number;
  minEmailsReceived?: number;
  countMachineOpens?: boolean;
  /** "list:<id>" / "segment:<id>". */
  protectedGroupIds: string[];
  billingDay: number | null;
  leadDays: number;
  scheduleEnabled: boolean;
  mode: "approval" | "automatic";
}

export type SaveSettingsResult = { ok: true; versionBumped: boolean; version: number } | { ok: false; errors: string[] };

export async function saveSettings(db: Db, args: { shop: string; actor: string; input: SettingsInput; now?: Date }): Promise<SaveSettingsResult> {
  const now = args.now ?? new Date();
  const { input } = args;
  const current = await db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop) });
  if (!current) return { ok: false, errors: ["Settings are not available for this shop."] };

  const errors: string[] = [];
  const requested: Partial<RuleSettings> =
    input.ruleMode === "recommended"
      ? { ...DEFAULT_RULE_SETTINGS }
      : {
          purchaseDays: input.purchaseDays ?? null,
          clickDays: input.clickDays ?? null,
          openDays: input.openDays ?? null,
          siteActivityDays: input.siteActivityDays ?? null,
          newProfileDays: input.newProfileDays ?? DEFAULT_RULE_SETTINGS.newProfileDays,
          minEmailsReceived: input.minEmailsReceived ?? DEFAULT_RULE_SETTINGS.minEmailsReceived,
          countMachineOpens: input.countMachineOpens ?? true,
        };
  const validated = validateRuleSettings(requested);
  errors.push(...validated.errors);
  // The restore lock is not editable: 365 days, as decided (guardrail 5).
  const rules: RuleSettings = { ...validated.settings, reactivationLockDays: Math.max(current.reactivationLockDays, RULE_LIMITS.reactivationLockDays.min) };

  const groups = [...new Set(input.protectedGroupIds)];
  if (groups.some((g) => !GROUP_REF.test(g))) errors.push("A protected list or segment is not valid.");
  if (groups.length > MAX_PROTECTED_GROUPS) errors.push(`You can protect up to ${MAX_PROTECTED_GROUPS} lists and segments.`);

  if (input.billingDay !== null && (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 31)) {
    errors.push("The renewal day must be a day of the month between 1 and 31.");
  }
  if (!Number.isInteger(input.leadDays) || input.leadDays < LEAD_DAYS_LIMITS.min || input.leadDays > LEAD_DAYS_LIMITS.max) {
    errors.push(`The cleanup must be scheduled between ${LEAD_DAYS_LIMITS.min} and ${LEAD_DAYS_LIMITS.max} days before the renewal.`);
  }
  if (input.mode !== "approval" && input.mode !== "automatic") errors.push("Unknown run mode.");
  if (input.mode === "automatic" && !isKlaviyoRecommended(rules)) {
    errors.push("Automatic cleanups are only available with Klaviyo's recommended criteria. Switch back to them, or keep approving each cleanup yourself.");
  }
  if (input.mode === "automatic" && !input.scheduleEnabled) errors.push("Automatic cleanups need the monthly schedule to be on.");
  if (errors.length > 0) return { ok: false, errors };

  const before = rulesOf(current);
  const sortedGroups = [...groups].sort();
  const rulesChanged =
    (Object.keys(rules) as (keyof RuleSettings)[]).some((k) => rules[k] !== before[k]) ||
    JSON.stringify(sortedGroups) !== JSON.stringify([...current.protectedGroupIds].sort());
  const version = rulesChanged ? current.version + 1 : current.version;
  const billingDayChanged = input.billingDay !== current.billingDay;

  const changed: string[] = [];
  if (rulesChanged) changed.push("rules");
  if (billingDayChanged || input.leadDays !== current.leadDays || input.scheduleEnabled !== current.scheduleEnabled) changed.push("schedule");
  if (input.mode !== current.mode) changed.push("mode");

  await db.batch([
    db
      .update(schema.settings)
      .set({
        version,
        purchaseDays: rules.purchaseDays,
        clickDays: rules.clickDays,
        openDays: rules.openDays,
        siteActivityDays: rules.siteActivityDays,
        newProfileDays: rules.newProfileDays,
        minEmailsReceived: rules.minEmailsReceived,
        reactivationLockDays: rules.reactivationLockDays,
        countMachineOpens: rules.countMachineOpens,
        protectedGroupIds: sortedGroups,
        billingDay: input.billingDay,
        billingDaySource: input.billingDay === null ? null : billingDayChanged ? "merchant" : current.billingDaySource,
        leadDays: input.leadDays,
        scheduleEnabled: input.scheduleEnabled,
        mode: input.mode,
        updatedAt: now,
      })
      .where(eq(schema.settings.shop, args.shop)),
    db.insert(schema.eventsLog).values({
      id: crypto.randomUUID(),
      shop: args.shop,
      at: now,
      actor: args.actor,
      action: "settings.updated",
      detail: { changed, version, rules, protectedGroups: sortedGroups.length, billingDay: input.billingDay, leadDays: input.leadDays, scheduleEnabled: input.scheduleEnabled, mode: input.mode },
    }),
  ]);
  return { ok: true, versionBumped: rulesChanged, version };
}
