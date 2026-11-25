import { env } from "cloudflare:workers";
import { RULE_LIMITS } from "@tiersaver/core";
import { and, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags } from "../components/home-screen";
import { db, schema } from "../db.server";
import { sessionActor } from "../data/events-log";
import { listGroupsPage, type GroupKind } from "../klaviyo/api";
import { CANDIDATE_SEGMENT_NAME } from "../klaviyo/config";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { ensureShop } from "../orders/purchases";
import { effectiveBillingDay } from "../schedule/schedule";
import { isKlaviyoRecommended, LEAD_DAYS_LIMITS, MAX_PROTECTED_GROUPS, rulesOf, saveSettings, type SettingsInput } from "../settings/settings";
import { authenticate } from "../shopify.server";

/** Lists and segments offered as protected groups: up to 5 pages of 10 of each kind. */
const GROUP_PAGES = 5;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(db, session.shop);
  const [settings, connection, audit] = await Promise.all([
    db.query.settings.findFirst({ where: (s, { eq }) => eq(s.shop, session.shop) }),
    getConnection(db, session.shop),
    db.query.audits.findFirst({
      where: (a, { and, eq, isNotNull }) => and(eq(a.shop, session.shop), isNotNull(a.periodEnd)),
      orderBy: (a, { desc }) => desc(a.createdAt),
      columns: { periodEnd: true },
    }),
  ]);
  if (!settings) throw new Response("Settings not found", { status: 404 });

  const groups: { ref: string; kind: GroupKind; name: string }[] = [];
  let groupsError = false;
  let groupsTruncated = false;
  if (connection?.status === "connected") {
    try {
      const client = createKlaviyoClient({ db, env }, session.shop, { subrequestBudget: 30 });
      for (const kind of ["list", "segment"] as const) {
        let cursor: string | null = null;
        for (let page = 0; page < GROUP_PAGES; page++) {
          const read = await listGroupsPage(client, kind, { cursor });
          for (const g of read.items) {
            if (g.name === CANDIDATE_SEGMENT_NAME) continue;
            groups.push({ ref: `${kind}:${g.id}`, kind, name: g.name ?? g.id });
          }
          cursor = read.nextCursor;
          if (!cursor) break;
        }
        if (cursor) groupsTruncated = true;
      }
    } catch {
      groupsError = true;
    }
  }
  // A protected group that was not listed (deleted, or beyond the pages read) must stay visible and stay protected.
  const known = new Set(groups.map((g) => g.ref));
  for (const ref of settings.protectedGroupIds) {
    if (!known.has(ref)) groups.push({ ref, kind: ref.startsWith("segment:") ? "segment" : "list", name: `${ref.replace(/^(list|segment):/, "")} (not found in Klaviyo right now)` });
  }

  const rules = rulesOf(settings);
  return {
    connected: connection?.status === "connected",
    rules,
    recommended: isKlaviyoRecommended(rules),
    protectedGroupIds: settings.protectedGroupIds,
    groups,
    groupsError,
    groupsTruncated,
    billingDay: settings.billingDay,
    klaviyoBillingDay: effectiveBillingDay(null, audit?.periodEnd ?? null),
    leadDays: settings.leadDays,
    scheduleEnabled: settings.scheduleEnabled,
    mode: settings.mode,
  };
};

function optionalInt(value: FormDataEntryValue | null): number | null | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const form = await request.formData();
  const wider = form.get("wider") === "yes";
  const billingDay = optionalInt(form.get("billingDay"));
  const input: SettingsInput = {
    ruleMode: wider ? "wider" : "recommended",
    purchaseDays: optionalInt(form.get("purchaseDays")),
    clickDays: optionalInt(form.get("clickDays")),
    openDays: optionalInt(form.get("openDays")),
    siteActivityDays: optionalInt(form.get("siteActivityDays")),
    newProfileDays: optionalInt(form.get("newProfileDays")) ?? undefined,
    minEmailsReceived: optionalInt(form.get("minEmailsReceived")) ?? undefined,
    countMachineOpens: form.get("ignoreMachineOpens") !== "yes",
    protectedGroupIds: form.getAll("protectedGroup").filter((v): v is string => typeof v === "string"),
    billingDay: billingDay ?? null,
    leadDays: optionalInt(form.get("leadDays")) ?? LEAD_DAYS_LIMITS.min + 1,
    scheduleEnabled: form.get("scheduleEnabled") === "yes",
    mode: form.get("automatic") === "yes" ? "automatic" : "approval",
  };
  const result = await saveSettings(db, { shop: session.shop, actor: sessionActor(sessionToken), input });
  if (!result.ok) return { saved: false as const, errors: result.errors };
  if (result.versionBumped) {
    // Rules changed: whatever was simulated before no longer applies.
    await db
      .update(schema.simulations)
      .set({ supersededAt: new Date() })
      .where(and(eq(schema.simulations.shop, session.shop), isNull(schema.simulations.executedAt), isNull(schema.simulations.supersededAt)));
  }
  return { saved: true as const, rulesChanged: result.versionBumped, errors: [] as string[] };
};

const checked = (on: boolean) => (on ? { checked: true } : {});
const days = (value: number | null) => (value === null ? "" : String(value));

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const { rules } = data;
  // React 18 does not deliver custom-element events through props, so the checkbox is listened to directly.
  const [wider, setWider] = useState(!data.recommended);
  const widerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = widerRef.current;
    if (!el) return;
    const onChange = () => setWider(Boolean((el as HTMLElement & { checked?: boolean }).checked));
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  const window = (key: "purchaseDays" | "clickDays" | "openDays" | "siteActivityDays") =>
    `Leave empty for "ever". Otherwise between ${RULE_LIMITS[key].min} and ${RULE_LIMITS[key].max} days.`;

  return (
    <s-page heading="Settings">
      {result?.saved ? (
        <s-banner tone="success">
          Settings saved.{result.rulesChanged ? " Your rules changed, so run the audit again before the next cleanup." : ""}
        </s-banner>
      ) : null}
      {result && !result.saved ? (
        <s-banner tone="warning" heading="Settings were not saved">
          <s-unordered-list>
            {result.errors.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <Form method="post">
        <s-section heading="Who counts as inactive">
          <s-stack gap="base">
            <s-paragraph>
              By default TierSaver uses Klaviyo's own recommended criteria: a profile created at least 365 days ago that was sent
              five or more emails in about 72 weeks and never opened, clicked, visited your site or purchased. Profiles with SMS
              consent, in a protected list or segment, or restored in the last 365 days are always kept active.
            </s-paragraph>
            <s-checkbox
              ref={(el: unknown) => {
                widerRef.current = el as HTMLElement | null;
              }}
              name="wider"
              value="yes"
              label="Use wider windows instead of Klaviyo's recommended criteria"
              details="Optional. Wider windows also treat profiles as inactive when their last activity is older than the number of days you set. The minimums below cannot be lowered. Automatic cleanups are not available with wider windows."
              {...checked(!data.recommended)}
            />
            <div style={{ display: wider ? "block" : "none" }}>
              <s-stack gap="base">
            <s-number-field name="purchaseDays" label="Keep active if they purchased in the last (days)" value={days(rules.purchaseDays)} min={RULE_LIMITS.purchaseDays.min} max={RULE_LIMITS.purchaseDays.max} details={window("purchaseDays")} />
            <s-number-field name="clickDays" label="Keep active if they clicked an email in the last (days)" value={days(rules.clickDays)} min={RULE_LIMITS.clickDays.min} max={RULE_LIMITS.clickDays.max} details={window("clickDays")} />
            <s-number-field name="openDays" label="Keep active if they opened an email in the last (days)" value={days(rules.openDays)} min={RULE_LIMITS.openDays.min} max={RULE_LIMITS.openDays.max} details={window("openDays")} />
            <s-number-field name="siteActivityDays" label="Keep active if they were on your site in the last (days)" value={days(rules.siteActivityDays)} min={RULE_LIMITS.siteActivityDays.min} max={RULE_LIMITS.siteActivityDays.max} details={window("siteActivityDays")} />
            <s-number-field name="newProfileDays" label="Keep active if created or subscribed in the last (days)" value={String(rules.newProfileDays)} min={RULE_LIMITS.newProfileDays.min} max={RULE_LIMITS.newProfileDays.max} details={`Between ${RULE_LIMITS.newProfileDays.min} and ${RULE_LIMITS.newProfileDays.max} days.`} />
            <s-number-field name="minEmailsReceived" label="Emails a profile must have received in about 72 weeks" value={String(rules.minEmailsReceived)} min={RULE_LIMITS.minEmailsReceived.min} max={RULE_LIMITS.minEmailsReceived.max} details={`At least ${RULE_LIMITS.minEmailsReceived.min}. Nobody is inactive if you never wrote to them.`} />
                <s-checkbox
                  name="ignoreMachineOpens"
                  value="yes"
                  label="Ignore opens that Klaviyo flags as automatic (Apple Mail Privacy Protection)"
                  details="Off by default: every open keeps a profile active."
                  {...checked(!rules.countMachineOpens)}
                />
              </s-stack>
            </div>
          </s-stack>
        </s-section>

        <s-section heading="Protected lists and segments">
          <s-stack gap="base">
            <s-paragraph>
              Profiles in a protected list or segment are never suppressed, whatever their activity. You can protect up to{" "}
              {MAX_PROTECTED_GROUPS}. If a protected list or segment cannot be read during an audit, every profile is kept active.
            </s-paragraph>
            {!data.connected ? <s-banner tone="info">Connect Klaviyo from the home page to choose lists and segments.</s-banner> : null}
            {data.groupsError ? <s-banner tone="warning">Your lists and segments could not be read from Klaviyo right now. The ones you already protect are still protected.</s-banner> : null}
            {data.groups.map((group) => (
              <s-checkbox
                key={group.ref}
                name="protectedGroup"
                value={group.ref}
                label={`${group.name} (${group.kind})`}
                {...checked(data.protectedGroupIds.includes(group.ref))}
              />
            ))}
            {data.groupsTruncated ? <s-paragraph>Only the first 50 lists and the first 50 segments are shown, in alphabetical order.</s-paragraph> : null}
          </s-stack>
        </s-section>

        <s-section heading="Monthly schedule">
          <s-stack gap="base">
            <s-paragraph>
              With the schedule on, TierSaver runs the audit once a month and finishes before your plan renews, so Klaviyo's count
              is up to date. Klaviyo's count can take up to 72 hours to update, which is why the cleanup runs at least{" "}
              {LEAD_DAYS_LIMITS.min} days ahead.
            </s-paragraph>
            <s-checkbox name="scheduleEnabled" value="yes" label="Run the audit every month" {...checked(data.scheduleEnabled)} />
            <s-number-field
              name="billingDay"
              label="Day of the month your Klaviyo plan renews"
              value={data.billingDay === null ? "" : String(data.billingDay)}
              min={1}
              max={31}
              details={
                data.klaviyoBillingDay
                  ? `Leave empty to use the day Klaviyo reported in your last audit (day ${data.klaviyoBillingDay}).`
                  : "You can find it in Klaviyo under Billing. Leave empty to use the day Klaviyo reports, when available."
              }
            />
            <s-number-field name="leadDays" label="Days before the renewal to run" value={String(data.leadDays)} min={LEAD_DAYS_LIMITS.min} max={LEAD_DAYS_LIMITS.max} />
            <s-checkbox
              name="automatic"
              value="yes"
              label="Run the scheduled cleanup automatically, without waiting for my approval"
              details="Off by default. Only with Klaviyo's recommended criteria, and only after you have approved and run at least one cleanup yourself. With this off, each scheduled audit waits for your approval for 24 hours."
              {...checked(data.mode === "automatic")}
            />
          </s-stack>
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary" {...flags({ disabled: busy })}>
            Save settings
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
