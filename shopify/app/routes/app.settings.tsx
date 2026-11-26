import { env } from "cloudflare:workers";
import { DEFAULT_SCHEDULE, RULE_LIMITS } from "@tiersaver/core";
import { and, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags } from "../components/home-screen";
import { downloadFile, errorFocus, number, Time, useRevealError } from "../components/ui";
import { cancelPlanForShop, LARGEST_PLAN_PROFILES, PLAN_INTERVAL_DAYS, planCoversList, planForListSize, PLANS, refreshPlan, requestPlanFor, storedPlanState, usd, type BillingStatus } from "../billing/billing";
import { requestAdminGraphql } from "../billing/billing.server";
import { db, schema } from "../db.server";
import { sessionActor } from "../data/events-log";
import { listDataRequests } from "../data/privacy";
import { listGroupsPage, type GroupKind } from "../klaviyo/api";
import { CANDIDATE_SEGMENT_NAME } from "../klaviyo/config";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { embeddedAppUrl } from "../klaviyo/flow.server";
import { legalUrls, TERMS_VERSION } from "../legal";
import { ensureShop } from "../orders/purchases";
import { effectiveBillingDay } from "../schedule/schedule";
import { isKlaviyoRecommended, LEAD_DAYS_LIMITS, MAX_PROTECTED_GROUPS, rulesOf, saveSettings, type SettingsField, type SettingsInput } from "../settings/settings";
import { NoticeList } from "../components/notices";
import { noticeArchive } from "../notices";
import { dayStamp, shopTimeZone } from "../settings/timezone";
import { authenticate } from "../shopify.server";

/** The list size of the shop's latest audit, or null while there is none. */
async function latestListSize(shop: string): Promise<number | null> {
  const latest = await db.query.simulations.findFirst({ where: (s, { eq }) => eq(s.shop, shop), orderBy: (s, { desc }) => desc(s.createdAt), columns: { activeProfiles: true } });
  return latest?.activeProfiles ?? null;
}

/**
 * What the plan costs this shop: the plan for the list size of its latest audit, or the whole list of plans
 * while there is no audit. Shown next to the automatic-mode control and recorded when it is turned on.
 * Every figure comes from billing/billing.ts.
 */
async function monthlyPrice(shop: string): Promise<{ text: string; known: boolean }> {
  const size = await latestListSize(shop);
  if (size !== null) {
    const plan = planForListSize(size);
    return plan
      ? { known: true, text: `${plan.price} for your list today (up to ${number(plan.maxProfiles)} active profiles)` }
      : { known: true, text: `not sold automatically for your list, which is above ${number(LARGEST_PLAN_PROFILES)} active profiles` };
  }
  return { known: false, text: PLANS.map((p) => `${p.price} up to ${number(p.maxProfiles)} active profiles`).join(", ") };
}

/** Lists and segments offered as protected groups: up to 5 pages of 10 of each kind. */
const GROUP_PAGES = 5;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, sessionToken } = await authenticate.admin(request);
  await ensureShop(db, session.shop);
  // The plan as Shopify reports it now; if Shopify cannot be asked, the page says so and shows the last known state.
  let billing: BillingStatus | null = null;
  try {
    billing = await refreshPlan({ db, graphql: requestAdminGraphql(admin), actor: sessionActor(sessionToken) }, session.shop);
  } catch {
    billing = null;
  }
  const [settings, connection, audit, price, requests, zone, listSize, storedPlan] = await Promise.all([
    db.query.settings.findFirst({ where: (s, { eq }) => eq(s.shop, session.shop) }),
    getConnection(db, session.shop),
    db.query.audits.findFirst({
      where: (a, { and, eq, isNotNull }) => and(eq(a.shop, session.shop), isNotNull(a.periodEnd)),
      orderBy: (a, { desc }) => desc(a.createdAt),
      columns: { periodEnd: true },
    }),
    monthlyPrice(session.shop),
    listDataRequests(db, session.shop),
    shopTimeZone(db, session.shop),
    latestListSize(session.shop),
    storedPlanState(db, session.shop),
  ]);
  if (!settings) throw new Response("Settings not found", { status: 404 });

  const current = billing?.plan ?? null;
  const needed = listSize === null ? null : planForListSize(listSize);
  const coverage = current && listSize !== null ? planCoversList(current, listSize) : null;
  const plan = {
    /** False when Shopify could not be asked just now. */
    known: billing !== null,
    current: current
      ? {
          price: `${usd(current.monthlyCents)}/month`,
          maxProfiles: current.maxProfiles,
          test: current.test,
          // Formatted here, in the shop's time zone, like every date in the app.
          periodEnds: current.currentPeriodEnd ? dayStamp(current.currentPeriodEnd, zone) : null,
        }
      : null,
    /** Why there is no plan, when there was one or one was refused: "cancelled", "declined" or "frozen". */
    ended: current ? null : billing?.frozen ? ("frozen" as const) : storedPlan && storedPlan.status !== "active" ? storedPlan.status : null,
    listSize,
    needed: needed ? { price: needed.price, maxProfiles: needed.maxProfiles, terms: needed.terms } : null,
    /** The list moved to a smaller plan than the one being paid: offered as a switch, never left unsaid. */
    lowerAvailable: Boolean(coverage?.covered && coverage.overpaying && needed),
    /** The list moved to a larger plan: the next cleanup needs the merchant to approve it in Shopify. */
    higherNeeded: Boolean(coverage && !coverage.covered && coverage.reason === "plan_price_too_low" && needed),
    aboveLargest: listSize !== null && !needed,
    largest: number(LARGEST_PLAN_PROFILES),
    intervalDays: PLAN_INTERVAL_DAYS,
    plans: PLANS.map((p) => `${p.price} up to ${number(p.maxProfiles)} active profiles`),
  };

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
    price: price.text,
    plan,
    legal: legalUrls(env),
    // Every notice of the last 12 months, dismissed or not (app/notices.ts).
    notices: noticeArchive(),
    // Customer data requests Shopify sent for this shop in the last 90 days. Dates are formatted here, in the shop's time zone.
    dataRequests: requests.map((r) => ({
      id: r.id,
      shopifyCustomerId: r.shopifyCustomerId,
      receivedOn: dayStamp(r.receivedAt, zone),
      dueOn: dayStamp(new Date(new Date(r.receivedAt).getTime() + 30 * 86_400_000), zone),
      downloadedOn: r.downloadedAt ? dayStamp(r.downloadedAt, zone) : null,
    })),
  };
};

const FIELD_LABELS: Record<string, string> = {
  purchaseDays: "The purchase window",
  clickDays: "The click window",
  openDays: "The open window",
  siteActivityDays: "The site activity window",
  newProfileDays: "The minimum profile age",
  minEmailsReceived: "The number of emails received",
};
/** Validation messages name the setting, not the field in the code. */
const readable = (message: string) => message.replace(/^(\w+)(?= must)/, (key) => FIELD_LABELS[key] ?? key).replace("or empty for any time", "or empty for \"ever\"");

function optionalInt(value: FormDataEntryValue | null): number | null | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

const NO_FIELD_ERRORS = {} as Partial<Record<SettingsField, string>>;
const PLAN_ERRORS: Record<string, string> = {
  billing_unavailable: "Shopify could not be reached, so your plan was not changed. Please try again.",
  plan_not_cancelled: "Shopify did not cancel the plan. Nothing was changed. Please try again.",
  above_price_tiers: "TierSaver is not sold automatically for a list of this size. Write to hello@tiersaver.com.",
  no_audit: "Run the audit first, so TierSaver knows your list size.",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken, admin, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "cancel_plan") {
    // Cancels the subscription at Shopify. Its consequences (no more cleanups, automatic cleanups off) are in billing/billing.ts.
    const result = await cancelPlanForShop({ db, graphql: requestAdminGraphql(admin) }, { shop: session.shop, actor: sessionActor(sessionToken) });
    if (!result.ok) return { saved: null, planError: PLAN_ERRORS[result.reason] ?? PLAN_ERRORS.billing_unavailable!, errors: [] as string[], fieldErrors: NO_FIELD_ERRORS };
    return { saved: null, planCancelled: true as const, automaticTurnedOff: result.automaticTurnedOff, errors: [] as string[], fieldErrors: NO_FIELD_ERRORS };
  }
  if (intent === "switch_plan") {
    // Moves to the plan of the list size of the latest audit. Shopify asks the merchant to approve it.
    const size = await latestListSize(session.shop);
    if (size === null) return { saved: null, planError: PLAN_ERRORS.no_audit!, errors: [] as string[], fieldErrors: NO_FIELD_ERRORS };
    const requested = await requestPlanFor({ db, graphql: requestAdminGraphql(admin) }, { shop: session.shop, activeProfiles: size, returnUrl: embeddedAppUrl(env, session.shop, "/app/settings"), actor: sessionActor(sessionToken), termsVersion: TERMS_VERSION });
    if (!requested.ok) return { saved: null, planError: PLAN_ERRORS[requested.reason] ?? PLAN_ERRORS.billing_unavailable!, errors: [] as string[], fieldErrors: NO_FIELD_ERRORS };
    return requested.next === "approve_in_shopify" ? redirect(requested.confirmationUrl, { target: "_top" }) : redirect("/app/settings");
  }

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
  const result = await saveSettings(db, {
    shop: session.shop,
    actor: sessionActor(sessionToken),
    input,
    // Recorded only when this save turns automatic cleanups on: the terms and the price that were on screen.
    termsVersion: TERMS_VERSION,
    priceShown: (await monthlyPrice(session.shop)).text,
  });
  if (!result.ok) return { saved: false as const, errors: result.errors.map(readable), fieldErrors: result.fieldErrors };
  if (result.versionBumped) {
    // Rules changed: whatever was simulated before no longer applies.
    await db
      .update(schema.simulations)
      .set({ supersededAt: new Date() })
      .where(and(eq(schema.simulations.shop, session.shop), isNull(schema.simulations.executedAt), isNull(schema.simulations.supersededAt)));
  }
  return { saved: true as const, rulesChanged: result.versionBumped, automaticTurnedOn: result.automaticTurnedOn, errors: [] as string[], fieldErrors: {} as Partial<Record<SettingsField, string>> };
};

const checked = (on: boolean) => (on ? { checked: true } : {});
const days = (value: number | null) => (value === null ? "" : String(value));

/** Order of the fields on the page: the first one with an error gets the focus. */
const FIELD_ORDER: SettingsField[] = ["purchaseDays", "clickDays", "openDays", "siteActivityDays", "newProfileDays", "minEmailsReceived", "protectedGroup", "billingDay", "leadDays", "automatic"];

function DataRequests({ requests }: { requests: ReturnType<typeof useLoaderData<typeof loader>>["dataRequests"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const download = async (id: string) => {
    setBusy(id);
    setFailed(false);
    try {
      await downloadFile(`/app/settings/data-request?id=${encodeURIComponent(id)}`, `tiersaver-customer-data-${id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40)}.json`);
      setDone((ids) => [...ids, id]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <s-section heading="Customer data requests">
      <s-stack gap="base">
        <s-paragraph>
          When one of your customers asks for their data, Shopify sends the request to TierSaver. Download the file and pass it on to that
          customer within 30 days of the request. Requests from the last 90 days are listed here.
        </s-paragraph>
        {requests.length === 0 ? <s-text color="subdued">No customer has asked for their data.</s-text> : null}
        {requests.map((r) => (
          <s-box key={r.id} padding="base" border="base" borderRadius="base">
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-stack gap="small-300">
                <s-text type="strong">{r.shopifyCustomerId ? `Shopify customer ${r.shopifyCustomerId}` : "Customer without a Shopify customer ID"}</s-text>
                <s-text color="subdued">
                  Requested <Time at={r.receivedOn} />. Pass it on by <Time at={r.dueOn} />.
                </s-text>
                <s-text color="subdued">
                  {r.downloadedOn ? (
                    <>
                      First downloaded <Time at={r.downloadedOn} />.
                    </>
                  ) : done.includes(r.id) ? (
                    "Downloaded just now."
                  ) : (
                    "Not downloaded yet."
                  )}
                </s-text>
              </s-stack>
              <s-button
                variant={r.downloadedOn || done.includes(r.id) ? "secondary" : "primary"}
                accessibilityLabel={`Download the data of ${r.shopifyCustomerId ? `Shopify customer ${r.shopifyCustomerId}` : "this customer"}`}
                {...flags({ disabled: busy !== null, loading: busy === r.id })}
                onClick={() => download(r.id)}
              >
                Download
              </s-button>
            </s-grid>
          </s-box>
        ))}
        {failed ? <s-banner tone="warning">The file could not be prepared. Please try again.</s-banner> : null}
        <s-text color="subdued">
          The file holds what TierSaver stores that is linked to the customer's email: whether an order is on record, and the cleanups that
          included their Klaviyo profile. TierSaver stores no email address in clear.
        </s-text>
      </s-stack>
    </s-section>
  );
}

/** What the action answers: a save of the settings form (`saved` true or false) or one of the plan actions (`saved` null). */
type SettingsResult = {
  saved: boolean | null;
  errors: string[];
  fieldErrors: Partial<Record<SettingsField, string>>;
  rulesChanged?: boolean;
  automaticTurnedOn?: boolean;
  planCancelled?: boolean;
  automaticTurnedOff?: boolean;
  planError?: string;
};

const CANCEL_PLAN_MODAL = "cancel-plan";

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as SettingsResult | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pendingIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : undefined;
  const saving = navigation.state !== "idle" && navigation.formMethod === "POST" && !pendingIntent;
  const { plan } = data;
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

  // A refused save shows each problem next to its field and takes the merchant to the first one; a save that worked, to its confirmation.
  const fieldErrors: Partial<Record<SettingsField, string>> = result && result.saved === false ? result.fieldErrors : {};
  const firstError = FIELD_ORDER.find((key) => fieldErrors[key]);
  const field = (key: SettingsField) => ({ error: fieldErrors[key], ...errorFocus(firstError === key) });
  useRevealError(result, Boolean(result));

  return (
    <s-page heading="Settings">
      {result?.saved ? (
        <s-banner tone="success" heading="Settings saved" {...errorFocus(true)}>
          {result.rulesChanged ? "Your rules changed, so run the audit again before the next cleanup. " : ""}
          {result.automaticTurnedOn
            ? "Automatic cleanups are on: each scheduled audit is followed by its cleanup without asking you again. They are covered by your monthly plan; nothing extra is charged per cleanup. You can turn this off on this page at any time."
            : ""}
        </s-banner>
      ) : null}
      {result?.planCancelled ? (
        <s-banner tone="success" heading="Your plan is cancelled" {...errorFocus(true)}>
          Shopify will not charge it again. Cleanups cannot start without a plan
          {result.automaticTurnedOff ? ", and automatic cleanups were turned off" : ""}. Profiles already suppressed stay suppressed, and you
          can still restore them from History. A new plan starts if you approve another cleanup.
        </s-banner>
      ) : null}
      {result?.planError ? (
        <s-banner tone="warning" heading="Your plan was not changed" {...errorFocus(true)}>
          {result.planError}
        </s-banner>
      ) : null}
      {result && result.saved === false ? (
        <s-banner tone="critical" heading="Settings were not saved" {...errorFocus(!firstError)}>
          <s-unordered-list>
            {result.errors.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      {/* Inside Shopify, App Bridge shows its save bar for this form when a field changes (data-save-bar); the button below always works. */}
      <Form method="post" data-save-bar preventScrollReset>
        <s-stack gap="base">
        <s-section heading="Who counts as inactive">
          <s-stack gap="base">
            <s-paragraph>
              By default TierSaver uses the criteria Klaviyo publishes for long-term inactive profiles: a profile created at least 365 days
              ago that was sent five or more emails in about 72 weeks and never opened, clicked, visited your site or purchased. Profiles with
              SMS consent, in a protected list or segment, or restored in the last 365 days are always kept active.{" "}
              <s-link href={data.legal.articles.criteria} target="_blank">
                How the criteria work
              </s-link>
            </s-paragraph>
            <s-checkbox
              ref={(el: unknown) => {
                widerRef.current = el as HTMLElement | null;
              }}
              name="wider"
              value="yes"
              label="Use wider windows instead of Klaviyo's published criteria"
              details="Optional. Wider windows also treat profiles as inactive when their last activity is older than the number of days you set. The minimums below cannot be lowered. Automatic cleanups are not available with wider windows."
              {...checked(!data.recommended)}
            />
            <div style={{ display: wider ? "block" : "none" }}>
              <s-stack gap="base">
            <s-number-field name="purchaseDays" label="Keep active if they purchased in the last (days)" value={days(rules.purchaseDays)} min={RULE_LIMITS.purchaseDays.min} max={RULE_LIMITS.purchaseDays.max} details={window("purchaseDays")} {...field("purchaseDays")} />
            <s-number-field name="clickDays" label="Keep active if they clicked an email in the last (days)" value={days(rules.clickDays)} min={RULE_LIMITS.clickDays.min} max={RULE_LIMITS.clickDays.max} details={window("clickDays")} {...field("clickDays")} />
            <s-number-field name="openDays" label="Keep active if they opened an email in the last (days)" value={days(rules.openDays)} min={RULE_LIMITS.openDays.min} max={RULE_LIMITS.openDays.max} details={window("openDays")} {...field("openDays")} />
            <s-number-field name="siteActivityDays" label="Keep active if they were on your site in the last (days)" value={days(rules.siteActivityDays)} min={RULE_LIMITS.siteActivityDays.min} max={RULE_LIMITS.siteActivityDays.max} details={window("siteActivityDays")} {...field("siteActivityDays")} />
            <s-number-field name="newProfileDays" label="Keep active if created or subscribed in the last (days)" value={String(rules.newProfileDays)} min={RULE_LIMITS.newProfileDays.min} max={RULE_LIMITS.newProfileDays.max} details={`Between ${RULE_LIMITS.newProfileDays.min} and ${RULE_LIMITS.newProfileDays.max} days.`} {...field("newProfileDays")} />
            <s-number-field name="minEmailsReceived" label="Emails a profile must have received in about 72 weeks" value={String(rules.minEmailsReceived)} min={RULE_LIMITS.minEmailsReceived.min} max={RULE_LIMITS.minEmailsReceived.max} details={`At least ${RULE_LIMITS.minEmailsReceived.min}. Nobody is inactive if you never wrote to them.`} {...field("minEmailsReceived")} />
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
            {!data.connected ? <s-text color="subdued">Connect Klaviyo from the home page to choose lists and segments.</s-text> : null}
            {data.groupsError ? <s-banner tone="warning">Your lists and segments could not be read from Klaviyo right now. The ones you already protect are still protected.</s-banner> : null}
            {fieldErrors.protectedGroup ? (
              <s-banner tone="critical" {...errorFocus(firstError === "protectedGroup")}>
                {fieldErrors.protectedGroup}
              </s-banner>
            ) : null}
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
              is up to date. Klaviyo updates its count on its own schedule and checks it shortly before your plan renews, which is why the
              audit runs at least {LEAD_DAYS_LIMITS.min} days ahead.{" "}
              <s-link href={data.legal.articles.schedule} target="_blank">
                The monthly schedule and your Klaviyo plan
              </s-link>
            </s-paragraph>
            <s-checkbox
              name="scheduleEnabled"
              value="yes"
              label="Run the audit every month"
              details="Each scheduled audit produces a simulation that waits 24 hours for your approval. TierSaver does not send email: open the app on the day of the audit to review it."
              {...checked(data.scheduleEnabled)}
            />
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
              {...field("billingDay")}
            />
            <s-number-field
              name="leadDays"
              label="Days before the renewal to run the audit"
              value={String(data.leadDays)}
              min={LEAD_DAYS_LIMITS.min}
              max={LEAD_DAYS_LIMITS.max}
              details={`Between ${LEAD_DAYS_LIMITS.min} and ${LEAD_DAYS_LIMITS.max}. The default is ${DEFAULT_SCHEDULE.leadDays}.`}
              {...field("leadDays")}
            />
          </s-stack>
        </s-section>

        <s-section heading="Automatic cleanups">
          <s-stack gap="base">
            <s-paragraph>
              Off by default. With this on, each month TierSaver audits your list and, without asking you again, suppresses the profiles that
              match the criteria you approved.
            </s-paragraph>
            <s-unordered-list>
              <s-list-item>
                Automatic cleanups need an active TierSaver plan: {data.price}, charged by Shopify every {plan.intervalDays} days whether or
                not a cleanup runs that month, until you cancel the plan. Nothing extra is charged per cleanup.
              </s-list-item>
              <s-list-item>
                If your list grows into a larger plan, the automatic cleanup waits until you approve the new monthly price in Shopify. A
                higher price is never charged without your approval.
              </s-list-item>
              <s-list-item>It repeats every month until you turn it off. TierSaver does not send email: each cleanup is listed in History.</s-list-item>
              <s-list-item>
                To turn it off, untick the box below and save: it takes effect at once. Turning it off does not cancel your plan; you cancel
                the plan in the Plan section of this page. Uninstalling the app stops everything.
              </s-list-item>
              <s-list-item>
                Only with Klaviyo's published criteria and the monthly schedule on, and only after you have approved and run at least one cleanup
                yourself. Until then, scheduled audits keep waiting for your approval.
              </s-list-item>
            </s-unordered-list>
            <s-checkbox
              name="automatic"
              value="yes"
              label="Run each scheduled cleanup automatically, without asking me again. I accept the monthly plan described above and the TierSaver Terms of Service."
              {...checked(data.mode === "automatic")}
              {...field("automatic")}
            />
            <s-text color="subdued">
              Read the{" "}
              <s-link href={data.legal.terms} target="_blank">
                Terms of Service
              </s-link>
              . You can restore the profiles of any cleanup from History.
            </s-text>
          </s-stack>
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary" {...flags({ disabled: busy, loading: saving })}>
            Save settings
          </s-button>
        </s-section>
        </s-stack>
      </Form>

      <s-section heading="Plan">
        <s-stack gap="base">
          {!plan.known ? <s-banner tone="warning">Shopify could not be asked about your plan just now. Reload the page to see it.</s-banner> : null}
          {plan.current ? (
            <>
              <s-stack gap="small-200">
                <s-text type="strong">
                  {plan.current.price}
                  {plan.current.maxProfiles ? ` for lists up to ${number(plan.current.maxProfiles)} active profiles` : ""}
                </s-text>
                <s-text color="subdued">
                  Charged by Shopify every {plan.intervalDays} days, whether or not a cleanup runs that month, until you cancel.
                  {plan.current.periodEnds ? (
                    <>
                      {" "}
                      The current period ends on <Time at={plan.current.periodEnds} />.
                    </>
                  ) : null}
                </s-text>
                {plan.current.test ? <s-text color="subdued">Test plan (development store): Shopify does not bill it.</s-text> : null}
              </s-stack>
              {plan.higherNeeded && plan.needed ? (
                <s-banner tone="info" heading="Your list has grown into a larger plan">
                  Your last audit counted {number(plan.listSize ?? 0)} active profiles. The plan for that size is {plan.needed.price} (lists up
                  to {number(plan.needed.maxProfiles)} active profiles). Your next cleanup waits until you approve the new price in Shopify,
                  which you do when you approve that cleanup. Until then you keep paying {plan.current.price}.
                </s-banner>
              ) : null}
              {plan.lowerAvailable && plan.needed ? (
                <s-banner tone="info" heading="Your list now fits a smaller plan">
                  <s-stack gap="base">
                    <s-text>
                      Your last audit counted {number(plan.listSize ?? 0)} active profiles. The plan for that size is {plan.needed.price} (lists
                      up to {number(plan.needed.maxProfiles)} active profiles); you are paying {plan.current.price}. Shopify asks you to approve
                      the lower price and credits the difference for the rest of the current {plan.intervalDays} days.
                    </s-text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="switch_plan" />
                      <s-button type="submit" {...flags({ disabled: busy, loading: pendingIntent === "switch_plan" })}>
                        Switch to the {plan.needed.price} plan
                      </s-button>
                    </Form>
                  </s-stack>
                </s-banner>
              ) : null}
              <Form method="post">
                <input type="hidden" name="intent" value="cancel_plan" />
                <s-button tone="critical" commandFor={CANCEL_PLAN_MODAL} command="--show" {...flags({ disabled: busy })}>
                  Cancel plan
                </s-button>
                <s-modal id={CANCEL_PLAN_MODAL} heading="Cancel your TierSaver plan?">
                  <s-stack gap="base">
                    <s-paragraph>
                      Shopify stops charging {plan.current.price}. The period you already paid for is not refunded.
                    </s-paragraph>
                    <s-paragraph>
                      Cleanups stop: no cleanup can start without a plan{data.mode === "automatic" ? ", and automatic cleanups are turned off" : ""}.
                      Scheduled audits keep running and stay free.
                    </s-paragraph>
                    <s-paragraph>
                      Profiles already suppressed stay suppressed in Klaviyo, and you can still restore them from History. A new plan starts
                      if you approve another cleanup.
                    </s-paragraph>
                  </s-stack>
                  <s-button slot="primary-action" type="submit" variant="primary" tone="critical" {...flags({ disabled: busy, loading: pendingIntent === "cancel_plan" })}>
                    Cancel plan
                  </s-button>
                  <s-button slot="secondary-actions" commandFor={CANCEL_PLAN_MODAL} command="--hide">
                    Keep plan
                  </s-button>
                </s-modal>
              </Form>
            </>
          ) : (
            <s-stack gap="small-200">
              <s-text type="strong">
                {plan.ended === "frozen"
                  ? "Your plan is on hold in Shopify."
                  : plan.ended === "cancelled"
                    ? "Your plan was cancelled."
                    : plan.ended === "declined"
                      ? "No plan: it was declined in Shopify."
                      : "No plan yet. It starts when you approve your first cleanup."}
              </s-text>
              {plan.ended === "frozen" ? (
                <s-text>
                  Shopify put it on hold because of a billing issue with your store, and reactivates it when that is solved. Cleanups cannot
                  start until then.
                </s-text>
              ) : plan.ended ? (
                <s-text>Cleanups cannot start without a plan. A new plan starts when you approve a cleanup; nothing is charged until then.</s-text>
              ) : null}
              <s-text color="subdued">
                {plan.aboveLargest
                  ? `TierSaver is not sold automatically for lists above ${plan.largest} active profiles. Write to ${data.legal.salesEmail}.`
                  : plan.needed
                    ? `For your list today: ${plan.needed.terms}`
                    : `Plans by list size: ${plan.plans.join(", ")}. Charged by Shopify every ${plan.intervalDays} days until you cancel.`}{" "}
                Connecting, the audit and the simulation are free.
              </s-text>
            </s-stack>
          )}
          <s-link href={data.legal.articles.pricing} target="_blank">
            How pricing works
          </s-link>
        </s-stack>
      </s-section>

      <DataRequests requests={data.dataRequests} />

      <NoticeList notices={data.notices} />

      <s-section slot="aside" heading="Help">
        <s-stack gap="small">
          <s-link href={data.legal.help} target="_blank">
            Help center
          </s-link>
          <s-link href={data.legal.articles.dataAndPrivacy} target="_blank">
            Data and privacy
          </s-link>
          <s-link href={data.legal.articles.uninstalling} target="_blank">
            What happens when you uninstall
          </s-link>
          <s-text>
            Contact support:{" "}
            <s-link href={data.legal.support} target="_blank">
              {data.legal.supportEmail}
            </s-link>
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
