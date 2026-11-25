import { hashEmail } from "@tiersaver/core";
import { filterDate, filterString, nextCursor, type JsonApiLinks, type KlaviyoClient } from "./client";
import {
  BILLING_USAGE,
  DEFAULT_METRIC_SPECS,
  LIMITS,
  MACHINE_OPEN_PROPERTY_KEYS,
  type EngagementSignal,
  type MetricSpec,
} from "./config";
import { KlaviyoApiError } from "./errors";

/**
 * Klaviyo API calls used by TierSaver. Every function sends exactly one HTTP
 * request (plus the client's bounded retries). Paginated readers take a cursor
 * and return the next one, so the caller decides how many pages fit in one
 * Worker invocation and can stop and resume anywhere.
 *
 * Parameters, fields, filters and page sizes were checked against the OpenAPI
 * spec, revision 2026-10-15. Nothing here has run against a real account yet.
 */

interface Resource<A = Record<string, unknown>> {
  type?: string;
  id?: string;
  attributes?: A | null;
  relationships?: Record<string, { data?: { type?: string; id?: string } | null } | undefined> | null;
}

interface Collection<A = Record<string, unknown>> {
  data?: Resource<A>[] | null;
  links?: JsonApiLinks | null;
}

export interface Page<T> {
  items: T[];
  /** Pass to the same function to read the next page; null on the last page. */
  nextCursor: string | null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function pathId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new KlaviyoApiError("klaviyo_invalid_id");
  return id;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface KlaviyoAccount {
  id: string;
  /** True for accounts created as test accounts (the seed script requires it). */
  testAccount: boolean;
  organizationName: string | null;
  timezone: string | null;
}

/** GET /api/accounts — scope accounts:read. Returns the one account the token belongs to. */
export async function getAccount(client: KlaviyoClient): Promise<KlaviyoAccount> {
  const body = await client.request<
    Collection<{
      test_account?: boolean;
      timezone?: string;
      contact_information?: { organization_name?: string } | null;
    }>
  >({
    endpoint: "accounts",
    path: "/api/accounts",
    query: { "fields[account]": ["test_account", "timezone", "contact_information.organization_name"] },
  });
  const account = body?.data?.[0];
  if (!account?.id) throw new KlaviyoApiError("klaviyo_account_missing");
  return {
    id: account.id,
    testAccount: account.attributes?.test_account === true,
    organizationName: account.attributes?.contact_information?.organization_name ?? null,
    timezone: account.attributes?.timezone ?? null,
  };
}

// ---------------------------------------------------------------------------
// Billing usage
// ---------------------------------------------------------------------------

export interface BillingUsageRow {
  /** The usage type key, e.g. "active_profiles" or "email_sends". */
  usageTypeId: string;
  usageUsed: number | null;
  usageMax: number | null;
  unit: string | null;
  periodStart: Date | null;
  /** Exclusive end of the current billing period: the renewal instant. */
  periodEnd: Date | null;
  /** When Klaviyo last read `usageUsed`. `active_profiles` refreshes about twice a day. */
  asOf: Date | null;
}

/**
 * GET /api/billing-usage — scope usage:read, 10/s, 150/m. One row per product
 * the account is billed for; an account on the free plan may return none.
 */
export async function listBillingUsage(client: KlaviyoClient): Promise<BillingUsageRow[]> {
  const body = await client.request<
    Collection<{
      usage_used?: number;
      usage_max?: number;
      unit?: string;
      period_start?: string;
      period_end?: string;
      as_of?: string;
    }>
  >({ endpoint: "billingUsage", path: "/api/billing-usage" });
  const rows: BillingUsageRow[] = [];
  for (const item of body?.data ?? []) {
    if (!item?.id) continue;
    const a = item.attributes ?? {};
    rows.push({
      usageTypeId: item.id,
      usageUsed: typeof a.usage_used === "number" && Number.isFinite(a.usage_used) ? a.usage_used : null,
      usageMax: typeof a.usage_max === "number" && Number.isFinite(a.usage_max) ? a.usage_max : null,
      unit: typeof a.unit === "string" ? a.unit : null,
      periodStart: parseDate(a.period_start),
      periodEnd: parseDate(a.period_end),
      asOf: parseDate(a.as_of),
    });
  }
  return rows;
}

/**
 * Picks the usage type that counts the email plan's billable profiles.
 *
 * Klaviyo documents it as `active_profiles` (unit "profiles"). If that id is
 * absent, the only acceptable fallback is a single row with unit "profiles"
 * that is not one of the other documented profile-based products; with zero
 * or several such rows the answer is "unknown" and the candidates are
 * returned so a person can decide. A wrong pick would make the tier, the
 * savings and the charge wrong, so there is no guessing.
 */
export function pickProfilesUsage(
  rows: readonly BillingUsageRow[],
  knownUsageTypeId?: string | null,
): { usage: BillingUsageRow | null; candidates: string[] } {
  const profileRows = rows.filter((r) => r.unit === BILLING_USAGE.profilesUnit);
  const candidates = profileRows.map((r) => r.usageTypeId);
  const byId = (id: string) => profileRows.find((r) => r.usageTypeId === id) ?? null;

  if (knownUsageTypeId) return { usage: byId(knownUsageTypeId), candidates };
  const documented = byId(BILLING_USAGE.activeProfilesId);
  if (documented) return { usage: documented, candidates };

  const others = new Set<string>(BILLING_USAGE.otherProfileUsageIds);
  const unknown = profileRows.filter((r) => !others.has(r.usageTypeId));
  return { usage: unknown.length === 1 ? unknown[0]! : null, candidates };
}

/**
 * Billing usage of active email profiles: `usageUsed` (billable profiles now),
 * `usageMax` (the plan's cap, i.e. the price tier) and the billing period.
 * `usage` is null when the account has no such row or it cannot be identified
 * with certainty; store `usage.usageTypeId` in `profiles_usage_type_id` and
 * pass it back on later calls.
 */
export async function getProfilesUsage(
  client: KlaviyoClient,
  knownUsageTypeId?: string | null,
): Promise<{ usage: BillingUsageRow | null; candidates: string[] }> {
  return pickProfilesUsage(await listBillingUsage(client), knownUsageTypeId);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** One profile as the audit needs it. There is no email in here: only its SHA-256. */
export interface KlaviyoProfileRecord {
  id: string;
  /** SHA-256 (hex) of the normalized email; null when the profile has no email. */
  emailHash: string | null;
  /** When Klaviyo created the profile. Cannot be backdated through the API. */
  createdAt: Date | null;
  /** Most recent event of any kind (including emails received). Upper bound for every engagement date. */
  lastEventAt: Date | null;
  /** Email marketing state; null when Klaviyo did not return it. */
  email: {
    canReceiveMarketing: boolean | null;
    consent: string | null;
    consentAt: Date | null;
    /** Global suppression reasons: USER_SUPPRESSED, UNSUBSCRIBE, HARD_BOUNCE, INVALID_EMAIL, SPAM_COMPLAINT. */
    suppressionReasons: string[];
  } | null;
  /** SMS marketing state; null when Klaviyo did not return it. */
  sms: { canReceiveMarketing: boolean | null; consent: string | null } | null;
  /** Value of the requested test property (seeded accounts only), when asked for. */
  testCreatedAt?: Date | null;
}

interface ProfileAttributes {
  email?: string | null;
  created?: string | null;
  last_event_date?: string | null;
  properties?: Record<string, unknown> | null;
  subscriptions?: {
    email?: {
      marketing?: {
        can_receive_email_marketing?: boolean;
        consent?: string;
        consent_timestamp?: string | null;
        suppression?: { reason?: string; timestamp?: string }[] | null;
      } | null;
    } | null;
    sms?: { marketing?: { can_receive_sms_marketing?: boolean; consent?: string } | null } | null;
  } | null;
}

const PROFILE_FIELDS = [
  "email",
  "created",
  "last_event_date",
  "subscriptions.email.marketing.can_receive_email_marketing",
  "subscriptions.email.marketing.consent",
  "subscriptions.email.marketing.consent_timestamp",
  "subscriptions.email.marketing.suppression",
  "subscriptions.sms.marketing.can_receive_sms_marketing",
  "subscriptions.sms.marketing.consent",
] as const;

async function toProfileRecord(item: Resource<ProfileAttributes>, testProperty?: string): Promise<KlaviyoProfileRecord | null> {
  if (!item?.id) return null;
  const a = item.attributes ?? {};
  const email = typeof a.email === "string" && a.email.trim() !== "" ? a.email : null;
  const marketing = a.subscriptions?.email?.marketing;
  const sms = a.subscriptions?.sms?.marketing;
  const record: KlaviyoProfileRecord = {
    id: item.id,
    emailHash: email ? await hashEmail(email) : null,
    createdAt: parseDate(a.created),
    lastEventAt: parseDate(a.last_event_date),
    email: marketing
      ? {
          canReceiveMarketing:
            typeof marketing.can_receive_email_marketing === "boolean" ? marketing.can_receive_email_marketing : null,
          consent: typeof marketing.consent === "string" ? marketing.consent : null,
          consentAt: parseDate(marketing.consent_timestamp),
          suppressionReasons: Array.isArray(marketing.suppression)
            ? marketing.suppression.map((s) => (typeof s?.reason === "string" ? s.reason : "UNKNOWN"))
            : [],
        }
      : null,
    sms: sms
      ? {
          canReceiveMarketing:
            typeof sms.can_receive_sms_marketing === "boolean" ? sms.can_receive_sms_marketing : null,
          consent: typeof sms.consent === "string" ? sms.consent : null,
        }
      : null,
  };
  if (testProperty) record.testCreatedAt = parseDate(a.properties?.[testProperty]);
  return record;
}

/**
 * GET /api/profiles — scope profiles:read, 75/s, 700/m, 100 profiles per page.
 * `additional-fields[profile]=subscriptions` adds consent and suppression
 * (it does not lower the rate limit; only `predictive_analytics` does).
 *
 * What this endpoint cannot give: the last open, click or order. Its
 * `last_event_date` is the last event of ANY kind, including emails received,
 * and it cannot be filtered. Those dates come from the Events API
 * (see `listEngagementEventsPage`).
 *
 * `testCreatedAtProperty` is for seeded test accounts only: Klaviyo's
 * `created` is always the import time there, so the intended age is read from
 * a profile property. It makes Klaviyo return ALL custom properties of each
 * profile; never set it for a merchant account.
 */
export async function listProfilesPage(
  client: KlaviyoClient,
  opts: { cursor?: string | null; pageSize?: number; testCreatedAtProperty?: string } = {},
): Promise<Page<KlaviyoProfileRecord>> {
  const fields: string[] = [...PROFILE_FIELDS];
  if (opts.testCreatedAtProperty) fields.push("properties");
  const body = await client.request<Collection<ProfileAttributes>>({
    endpoint: "profiles",
    path: "/api/profiles",
    query: {
      "fields[profile]": fields,
      "additional-fields[profile]": "subscriptions",
      "page[size]": Math.min(opts.pageSize ?? LIMITS.profilesPageSize, LIMITS.profilesPageSize),
      "page[cursor]": opts.cursor ?? null,
      // Oldest first: profiles created while the scan runs land on later pages.
      sort: "created",
    },
  });
  const items: KlaviyoProfileRecord[] = [];
  for (const item of body?.data ?? []) {
    const record = await toProfileRecord(item, opts.testCreatedAtProperty);
    if (record) items.push(record);
  }
  return { items, nextCursor: nextCursor(body?.links) };
}

/**
 * Current email of each profile id, for the suppression gateway. One request
 * for up to 50 ids. Ids that no longer exist are absent from the map; a
 * profile without an email maps to null. The emails are returned to the
 * caller in memory and must not be stored or logged.
 */
export async function getProfileEmails(
  client: KlaviyoClient,
  profileIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (profileIds.length === 0) return new Map();
  if (profileIds.length > LIMITS.profileIdsPerLookup) throw new KlaviyoApiError("klaviyo_too_many_profile_ids");
  const wanted = new Set(profileIds);
  const body = await client.request<Collection<ProfileAttributes>>({
    endpoint: "profiles",
    path: "/api/profiles",
    query: {
      filter: `any(id,[${profileIds.map(filterString).join(",")}])`,
      "fields[profile]": "email",
      "page[size]": LIMITS.profilesPageSize,
    },
  });
  const out = new Map<string, string | null>();
  for (const item of body?.data ?? []) {
    if (!item?.id || !wanted.has(item.id)) continue;
    const email = item.attributes?.email;
    out.set(item.id, typeof email === "string" && email.trim() !== "" ? email : null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics and engagement events
// ---------------------------------------------------------------------------

export interface KlaviyoMetric {
  id: string;
  name: string | null;
  integrationName: string | null;
  integrationCategory: string | null;
}

/** GET /api/metrics — scope metrics:read, 10/s, 150/m, up to 200 per page. */
export async function listMetricsPage(
  client: KlaviyoClient,
  opts: { cursor?: string | null } = {},
): Promise<Page<KlaviyoMetric>> {
  const body = await client.request<
    Collection<{ name?: string | null; integration?: { name?: string; category?: string } | null }>
  >({
    endpoint: "metrics",
    path: "/api/metrics",
    query: { "fields[metric]": ["name", "integration"], "page[cursor]": opts.cursor ?? null },
  });
  const items: KlaviyoMetric[] = [];
  for (const item of body?.data ?? []) {
    if (!item?.id) continue;
    items.push({
      id: item.id,
      name: item.attributes?.name ?? null,
      integrationName: item.attributes?.integration?.name ?? null,
      integrationCategory: item.attributes?.integration?.category ?? null,
    });
  }
  return { items, nextCursor: nextCursor(body?.links) };
}

export type ResolvedMetrics = Record<EngagementSignal, string[]>;

/**
 * Maps each signal to the metric ids that feed it, by exact name AND
 * integration (an API-created "Opened Email" is a different metric from
 * Klaviyo's own). `overrides` replaces the spec of individual signals, for
 * example SEEDED_METRIC_SPECS for the test account. A signal with no match
 * gets an empty list, which the coverage logic treats as "no data".
 * When several metrics match they are all used: more events can only protect
 * more profiles.
 */
export function resolveMetrics(
  metrics: readonly KlaviyoMetric[],
  overrides: Partial<Record<EngagementSignal, MetricSpec>> = {},
): ResolvedMetrics {
  const specs = { ...DEFAULT_METRIC_SPECS, ...overrides };
  const out = { open: [], click: [], purchase: [], checkout: [], activeOnSite: [] } as ResolvedMetrics;
  for (const signal of Object.keys(out) as EngagementSignal[]) {
    const spec = specs[signal];
    out[signal] = metrics
      .filter((m) => m.name !== null && m.integrationName !== null)
      .filter((m) => spec.names.includes(m.name!) && spec.integrations.includes(m.integrationName!))
      .map((m) => m.id);
  }
  return out;
}

export interface EngagementEvent {
  profileId: string;
  at: Date;
  /**
   * For opens: true only when the event carries a known machine-open flag set
   * to true. Missing flag, unknown key or unreadable value all give false,
   * i.e. the open counts as a person's.
   */
  machineOpen: boolean;
}

export interface EngagementEventsPage extends Page<EngagementEvent> {
  /**
   * Events on this page that could not be attributed (no profile id or no
   * readable date). Any non-zero value means the scan cannot prove who was
   * inactive, and the coverage for that signal must be treated as unknown.
   */
  unattributed: number;
}

/** Reads the machine-open flag from an event's properties. See MACHINE_OPEN_PROPERTY_KEYS. */
export function isMachineOpen(properties: unknown): boolean {
  if (!properties || typeof properties !== "object") return false;
  const props = properties as Record<string, unknown>;
  for (const key of MACHINE_OPEN_PROPERTY_KEYS) {
    const value = props[key];
    if (value === true) return true;
    if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  }
  return false;
}

/**
 * GET /api/events — scope events:read, 350/s, 3,500/m, up to 1,000 events per
 * page. Returns the events of ONE metric since `since`, oldest first, as
 * (profile id, time) pairs. Feed the pages to `foldEngagement`.
 *
 * `withProperties` asks for the event properties, which is only needed to tell
 * machine opens apart (merchant setting `countMachineOpens = false`). Without
 * it the payload is a fraction of the size and every open counts as a person's.
 */
export async function listEngagementEventsPage(
  client: KlaviyoClient,
  opts: { metricId: string; since: Date; cursor?: string | null; withProperties?: boolean; pageSize?: number },
): Promise<EngagementEventsPage> {
  const body = await client.request<Collection<{ datetime?: string | null; event_properties?: unknown }>>({
    endpoint: "events",
    path: "/api/events",
    query: {
      filter: `equals(metric_id,${filterString(opts.metricId)}),greater-or-equal(datetime,${filterDate(opts.since)})`,
      "fields[event]": opts.withProperties ? ["datetime", "event_properties"] : ["datetime"],
      "page[size]": Math.min(opts.pageSize ?? LIMITS.eventsPageSize, LIMITS.eventsPageSize),
      "page[cursor]": opts.cursor ?? null,
      sort: "datetime",
    },
  });
  const items: EngagementEvent[] = [];
  let unattributed = 0;
  for (const item of body?.data ?? []) {
    const profileId = item?.relationships?.profile?.data?.id;
    const at = parseDate(item?.attributes?.datetime);
    if (typeof profileId !== "string" || !profileId || !at) {
      unattributed++;
      continue;
    }
    items.push({
      profileId,
      at,
      machineOpen: opts.withProperties ? isMachineOpen(item?.attributes?.event_properties) : false,
    });
  }
  return { items, nextCursor: nextCursor(body?.links), unattributed };
}

// ---------------------------------------------------------------------------
// Lists and segments (protected groups)
// ---------------------------------------------------------------------------

export type GroupKind = "list" | "segment";

export interface KlaviyoGroup {
  kind: GroupKind;
  id: string;
  name: string | null;
  /** Segments only: false when the merchant deactivated it. */
  isActive: boolean | null;
}

/** GET /api/lists or /api/segments — scopes lists:read / segments:read. Klaviyo returns at most 10 per page. */
export async function listGroupsPage(
  client: KlaviyoClient,
  kind: GroupKind,
  opts: { cursor?: string | null } = {},
): Promise<Page<KlaviyoGroup>> {
  const body = await client.request<Collection<{ name?: string | null; is_active?: boolean }>>(
    kind === "list"
      ? {
          endpoint: "lists",
          path: "/api/lists",
          query: {
            "fields[list]": "name",
            "page[size]": LIMITS.groupsPageSize,
            "page[cursor]": opts.cursor ?? null,
            sort: "name",
          },
        }
      : {
          endpoint: "segments",
          path: "/api/segments",
          query: {
            "fields[segment]": ["name", "is_active"],
            "page[size]": LIMITS.groupsPageSize,
            "page[cursor]": opts.cursor ?? null,
            sort: "name",
          },
        },
  );
  const items: KlaviyoGroup[] = [];
  for (const item of body?.data ?? []) {
    if (!item?.id) continue;
    items.push({
      kind,
      id: item.id,
      name: item.attributes?.name ?? null,
      isActive: kind === "segment" ? (item.attributes?.is_active ?? null) : null,
    });
  }
  return { items, nextCursor: nextCursor(body?.links) };
}

/**
 * GET /api/{lists|segments}/{id}/relationships/profiles — 100 profile ids per
 * page, ids only (no personal data). A 404 means the group no longer exists;
 * the caller must then treat membership of that protected group as unknown.
 */
export async function listGroupMemberIdsPage(
  client: KlaviyoClient,
  group: { kind: GroupKind; id: string },
  opts: { cursor?: string | null } = {},
): Promise<Page<string>> {
  const body = await client.request<Collection>({
    endpoint: "groupMembers",
    path: `/api/${group.kind === "list" ? "lists" : "segments"}/${pathId(group.id)}/relationships/profiles`,
    query: { "page[size]": LIMITS.profilesPageSize, "page[cursor]": opts.cursor ?? null },
  });
  const items: string[] = [];
  for (const item of body?.data ?? []) if (item?.id) items.push(item.id);
  return { items, nextCursor: nextCursor(body?.links) };
}

// ---------------------------------------------------------------------------
// Bulk suppress / unsuppress
// ---------------------------------------------------------------------------

export type SuppressionJobKind = "suppress" | "unsuppress";

export interface SuppressionJob {
  id: string;
  status: "queued" | "processing" | "complete" | "cancelled" | "unknown";
  totalCount: number | null;
  completedCount: number | null;
  /** Profiles Klaviyo left untouched (presumably including those inside the 90-day re-suppression lock). */
  skippedCount: number | null;
  completedAt: Date | null;
}

const JOB_RESOURCE = {
  suppress: { path: "/api/profile-suppression-bulk-create-jobs", type: "profile-suppression-bulk-create-job" },
  unsuppress: { path: "/api/profile-suppression-bulk-delete-jobs", type: "profile-suppression-bulk-delete-job" },
} as const;

interface JobAttributes {
  status?: string;
  total_count?: number;
  completed_count?: number | null;
  skipped_count?: number | null;
  completed_at?: string | null;
}

function toJob(resource: Resource<JobAttributes> | null | undefined): SuppressionJob {
  if (!resource?.id) throw new KlaviyoApiError("klaviyo_job_missing", { retryable: true });
  const a = resource.attributes ?? {};
  const known = ["queued", "processing", "complete", "cancelled"] as const;
  return {
    id: resource.id,
    status: known.find((s) => s === a.status) ?? "unknown",
    totalCount: typeof a.total_count === "number" ? a.total_count : null,
    completedCount: typeof a.completed_count === "number" ? a.completed_count : null,
    skippedCount: typeof a.skipped_count === "number" ? a.skipped_count : null,
    completedAt: parseDate(a.completed_at),
  };
}

/**
 * POST /api/profile-suppression-bulk-create-jobs (suppress; scopes
 * profiles:write + subscriptions:write) or -bulk-delete-jobs (unsuppress;
 * subscriptions:write). At most 100 emails per request; answers 202 with the
 * job. Always by email list, never by list/segment id, so exactly the approved
 * profiles are touched.
 *
 * Suppressing an email that is already suppressed changes nothing, which is
 * what makes a repeated request safe. Unsuppress only removes the
 * USER_SUPPRESSED reason: unsubscribes and bounces stay as they are.
 * Suppress never deletes anything.
 */
export async function submitSuppressionJob(
  client: KlaviyoClient,
  kind: SuppressionJobKind,
  emails: readonly string[],
): Promise<SuppressionJob> {
  if (emails.length === 0) throw new KlaviyoApiError("klaviyo_suppression_batch_empty");
  if (emails.length > LIMITS.emailsPerSuppressionRequest) throw new KlaviyoApiError("klaviyo_suppression_batch_too_large");
  const resource = JOB_RESOURCE[kind];
  const body = await client.request<{ data?: Resource<JobAttributes> }>({
    endpoint: "suppressionJobs",
    method: "POST",
    path: resource.path,
    body: {
      data: {
        type: resource.type,
        attributes: {
          profiles: { data: emails.map((email) => ({ type: "profile", attributes: { email } })) },
        },
      },
    },
  });
  return toJob(body?.data);
}

/** GET the job by id — scope subscriptions:read. Jobs are asynchronous: poll until `complete`. */
export async function getSuppressionJob(
  client: KlaviyoClient,
  kind: SuppressionJobKind,
  jobId: string,
): Promise<SuppressionJob> {
  const body = await client.request<{ data?: Resource<JobAttributes> }>({
    endpoint: "suppressionJobs",
    path: `${JOB_RESOURCE[kind].path}/${pathId(jobId)}`,
  });
  return toJob(body?.data);
}
