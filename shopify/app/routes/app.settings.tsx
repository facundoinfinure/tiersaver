import { env } from "cloudflare:workers";
import { DEFAULT_FEE_POLICY, DEFAULT_SCHEDULE, flatTierFor, FLAT_PRICE_TIERS, formatUsd, RULE_LIMITS } from "@tiersaver/core";
import { and, eq, isNull } from "drizzle-orm";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags } from "../components/home-screen";
import { downloadFile, errorFocus, Time, useRevealError } from "../components/ui";
import { db, schema } from "../db.server";
import { sessionActor } from "../data/events-log";
import { listDataRequests } from "../data/privacy";
import { listGroupsPage, type GroupKind } from "../klaviyo/api";
import { CANDIDATE_SEGMENT_NAME } from "../klaviyo/config";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { legalUrls, TERMS_VERSION } from "../legal";
import { ensureShop } from "../orders/purchases";
import { effectiveBillingDay } from "../schedule/schedule";
import { isKlaviyoRecommended, LEAD_DAYS_LIMITS, MAX_PROTECTED_GROUPS, rulesOf, saveSettings, type SettingsField, type SettingsInput } from "../settings/settings";
import { dayStamp, shopTimeZone } from "../settings/timezone";
import { authenticate } from "../shopify.server";

/**
 * What a month with a cleanup costs this shop: the price for the list size of its latest audit, or the
 * whole price list while there is no audit. Shown next to the automatic-mode control and recorded when it is turned on.
 */
async function monthlyPrice(shop: string): Promise<{ text: string; known: boolean }> {
  const latest = await db.query.simulations.findFirst({ where: (s, { eq }) => eq(s.shop, shop), orderBy: (s, { desc }) => desc(s.createdAt), columns: { activeProfiles: true } });
  const largest = FLAT_PRICE_TIERS[FLAT_PRICE_TIERS.length - 1]!;
  if (latest) {
    const tier = flatTierFor(latest.activeProfiles);
    return tier
      ? { known: true, text: `${formatUsd(tier.monthlyCents)} for your list today (up to ${tier.maxProfiles.toLocaleString("en-US")} active profiles)` }
      : { known: true, text: `agreed with you beforehand, because your list is above ${largest.maxProfiles.toLocaleString("en-US")} active profiles` };
  }
  return { known: false, text: FLAT_PRICE_TIERS.map((t) => `${formatUsd(t.monthlyCents)} up to ${t.maxProfiles.toLocaleString("en-US")} active profiles`).join(", ") };
}

/** Lists and segments offered as protected groups: up to 5 pages of 10 of each kind. */
const GROUP_PAGES = 5;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(db, session.shop);
  const [settings, connection, audit, price, requests, zone] = await Promise.all([
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
    price: price.text,
    minDaysBetweenCharges: DEFAULT_FEE_POLICY.minDaysBetweenCharges,
    legal: legalUrls(env),
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

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const saving = navigation.state !== "idle" && navigation.formMethod === "POST";
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
  const fieldErrors: Partial<Record<SettingsField, string>> = result && !result.saved ? result.fieldErrors : {};
  const firstError = FIELD_ORDER.find((key) => fieldErrors[key]);
  const field = (key: SettingsField) => ({ error: fieldErrors[key], ...errorFocus(firstError === key) });
  useRevealError(result, Boolean(result));

  return (
    <s-page heading="Settings">
      {result?.saved ? (
        <s-banner tone="success" heading="Settings saved" {...errorFocus(true)}>
          {result.rulesChanged ? "Your rules changed, so run the audit again before the next cleanup. " : ""}
          {result.automaticTurnedOn
            ? "Automatic cleanups are on: each scheduled audit is followed by its cleanup without asking you again, and a month with a cleanup is charged. You can turn this off on this page at any time."
            : ""}
        </s-banner>
      ) : null}
      {result && !result.saved ? (
        <s-banner tone="critical" heading="Settings were not saved" {...errorFocus(!firstError)}>
          <s-unordered-list>
            {result.errors.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      {/* Inside Shopify, App Bridge shows its save bar for this form when a field changes (data-save-bar); the button below always works. */}
      <Form method="post" data-save-bar>
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
              is up to date. Klaviyo's count can take up to 72 hours to update, which is why the audit runs at least{" "}
              {LEAD_DAYS_LIMITS.min} days ahead.{" "}
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
                Each month with a cleanup is charged through Shopify at the price for your list size: {data.price}. At most one charge every{" "}
                {data.minDaysBetweenCharges} days; a month in which nothing is suppressed is not charged.
              </s-list-item>
              <s-list-item>It repeats every month until you turn it off. TierSaver does not send email: each cleanup and its charge are listed in History.</s-list-item>
              <s-list-item>To turn it off, untick the box below and save: it takes effect at once and costs nothing. Uninstalling the app stops everything.</s-list-item>
              <s-list-item>
                Only with Klaviyo's published criteria and the monthly schedule on, and only after you have approved and run at least one cleanup
                yourself. Until then, scheduled audits keep waiting for your approval.
              </s-list-item>
            </s-unordered-list>
            <s-checkbox
              name="automatic"
              value="yes"
              label="Run each scheduled cleanup automatically, without asking me again. I authorize the monthly charges described above and accept the TierSaver Terms of Service."
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

      <DataRequests requests={data.dataRequests} />

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
