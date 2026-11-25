/**
 * An in-memory Klaviyo for tests. Not imported by the app.
 *
 * It answers through a `fetch`-compatible function and enforces the parts of
 * the contract our code depends on (revision 2026-10-15): required headers,
 * Basic client authentication and PKCE on the token endpoint, page size
 * limits, 100 emails per bulk suppression request, JSON:API shapes. Anything
 * outside the contract is answered with an error, so a request the real API
 * would reject fails the test too.
 */

export interface FakeProfile {
  id: string;
  email: string | null;
  created?: string | null;
  lastEventDate?: string | null;
  /** Global email suppression reasons. */
  suppression?: string[];
  emailConsent?: string;
  emailConsentTimestamp?: string | null;
  smsConsent?: string;
  canReceiveSms?: boolean;
  /** Leave the whole `subscriptions` object out of the response. */
  omitSubscriptions?: boolean;
  /** Leave `subscriptions.sms` out of the response. */
  omitSms?: boolean;
  properties?: Record<string, unknown>;
}

export interface FakeEvent {
  metricId: string;
  /** null simulates an event Klaviyo could not attach to a profile. */
  profileId: string | null;
  datetime: string;
  properties?: Record<string, unknown>;
}

export interface FakeRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

export interface FakeJob {
  id: string;
  kind: "suppress" | "unsuppress";
  emails: string[];
}

type Responder = (req: FakeRequest) => Response | null | undefined;

const MEDIA_TYPE = "application/vnd.api+json";
const REVISION = "2026-10-15";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": MEDIA_TYPE, ...headers } });
}

function apiError(status: number, code: string, detail = "detail", headers: Record<string, string> = {}): Response {
  return json(status, { errors: [{ id: "e1", status, code, title: "title", detail, source: { pointer: "/data/" } }] }, headers);
}

function oauthError(status: number, error: string, description = ""): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class FakeKlaviyo {
  clientId = "fake-client-id";
  clientSecret = "fake-client-secret-0123456789abcdef";
  accountId = "ACC001";
  testAccount = true;

  /** "rotate": every refresh returns a new refresh token and kills the old one. "static": the token never changes. */
  refreshMode: "rotate" | "static" = "rotate";
  accessTokenTtlSeconds = 3600;
  grantedScopes: string | null = null;
  /** Artificial delay of the token endpoint, to widen race windows. */
  tokenDelayMs = 0;

  profiles = new Map<string, FakeProfile>();
  events: FakeEvent[] = [];
  metrics: { id: string; name: string; integration: { name: string; category: string } }[] = [];
  lists: { id: string; name: string; members: string[] }[] = [];
  segments: {
    id: string;
    name: string;
    members: string[];
    isActive?: boolean;
    definition?: unknown;
    /** While true, GET reports `is_processing: true`. Set after every create / update; the test ends it. */
    isProcessing?: boolean;
  }[] = [];
  billingUsage: { id: string; usage_used: number; usage_max: number; unit: string }[] = [];
  suppressed = new Set<string>();
  jobs: FakeJob[] = [];

  requests: FakeRequest[] = [];
  /** Checked before normal handling; the first responder that returns a Response wins. */
  responders: Responder[] = [];

  private codes = new Map<string, { challenge: string; redirectUri: string; scope: string }>();
  private refreshTokens = new Map<string, { scope: string; alive: boolean }>();
  private accessTokens = new Map<string, { expiresAt: number }>();
  private counter = 0;
  now: () => number = Date.now;

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const req: FakeRequest = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: request.method === "GET" ? "" : new TextDecoder().decode(await request.arrayBuffer()),
    };
    this.requests.push(req);
    for (const responder of this.responders) {
      const res = responder(req);
      if (res) return res;
    }
    if (req.url.pathname.startsWith("/oauth/")) return this.handleOAuth(req);
    return this.handleApi(req);
  };

  // -- test controls --------------------------------------------------------

  /** Answer the next `times` requests whose path matches with `make()`. */
  failNext(pathPattern: RegExp, make: () => Response, times = 1): void {
    let left = times;
    this.responders.push((req) => {
      if (left <= 0 || !pathPattern.test(req.url.pathname)) return null;
      left--;
      return make();
    });
  }

  static rateLimited(retryAfterSeconds: number): Response {
    return apiError(429, "throttled", "Request was throttled.", { "Retry-After": String(retryAfterSeconds) });
  }

  static serverError(status = 503): Response {
    return apiError(status, "server_error");
  }

  static clientError(status: number, code: string, detail?: string): Response {
    return apiError(status, code, detail);
  }

  requestsTo(pathPattern: RegExp, method?: string): FakeRequest[] {
    return this.requests.filter((r) => pathPattern.test(r.url.pathname) && (!method || r.method === method));
  }

  /** What Klaviyo's consent screen would do: issue a code for a PKCE challenge. */
  authorize(args: { codeChallenge: string; redirectUri: string; scope: string }): string {
    const code = `code-${++this.counter}`;
    this.codes.set(code, { challenge: args.codeChallenge, redirectUri: args.redirectUri, scope: args.scope });
    return code;
  }

  /** Issues a token pair directly, as if the merchant had already authorized. */
  issueTokens(scope: string): { accessToken: string; refreshToken: string } {
    const refreshToken = `refresh-${++this.counter}-${crypto.randomUUID()}`;
    this.refreshTokens.set(refreshToken, { scope, alive: true });
    return { accessToken: this.newAccessToken(), refreshToken };
  }

  /** The merchant uninstalls the app in Klaviyo: every token dies. */
  revokeEverything(): void {
    for (const t of this.refreshTokens.values()) t.alive = false;
    this.accessTokens.clear();
  }

  expireAccessTokens(): void {
    this.accessTokens.clear();
  }

  liveRefreshTokens(): string[] {
    return [...this.refreshTokens].filter(([, v]) => v.alive).map(([k]) => k);
  }

  private newAccessToken(): string {
    const token = `access-${++this.counter}-${crypto.randomUUID()}`;
    this.accessTokens.set(token, { expiresAt: this.now() + this.accessTokenTtlSeconds * 1000 });
    return token;
  }

  // -- OAuth ----------------------------------------------------------------

  private async handleOAuth(req: FakeRequest): Promise<Response> {
    if (req.url.host !== "a.klaviyo.com") return oauthError(403, "blocked_host");
    if (req.method !== "POST") return oauthError(405, "invalid_request");
    if (!(req.headers.get("Content-Type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      return oauthError(400, "invalid_request", "body must be form encoded");
    }
    const expected = `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`;
    if (req.headers.get("Authorization") !== expected) return oauthError(401, "invalid_client");
    const form = new URLSearchParams(req.body);
    if (this.tokenDelayMs > 0) await new Promise((r) => setTimeout(r, this.tokenDelayMs));

    if (req.url.pathname === "/oauth/revoke") {
      const entry = this.refreshTokens.get(form.get("token") ?? "");
      if (entry) entry.alive = false;
      this.accessTokens.clear();
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (req.url.pathname !== "/oauth/token") return oauthError(404, "invalid_request");

    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const entry = this.codes.get(code);
      this.codes.delete(code); // single use
      if (!entry) return oauthError(400, "invalid_grant", "Invalid code.");
      if (form.get("redirect_uri") !== entry.redirectUri) return oauthError(400, "invalid_grant", "redirect_uri mismatch");
      const verifier = form.get("code_verifier") ?? "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError(400, "invalid_grant", "Code challenge failed.");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      if (b64url(digest) !== entry.challenge) return oauthError(400, "invalid_grant", "Code challenge failed.");
      const scope = this.grantedScopes ?? entry.scope;
      const tokens = this.issueTokens(scope);
      return this.tokenResponse(tokens.accessToken, tokens.refreshToken, scope);
    }
    if (grant === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const entry = this.refreshTokens.get(presented);
      if (!entry) return oauthError(400, "invalid_grant", "400-01 Refresh token does not exist");
      if (!entry.alive) return oauthError(400, "invalid_grant", "400-02 Refresh token has been revoked");
      if (this.refreshMode === "static") return this.tokenResponse(this.newAccessToken(), null, entry.scope);
      entry.alive = false;
      const next = this.issueTokens(entry.scope);
      return this.tokenResponse(next.accessToken, next.refreshToken, entry.scope);
    }
    return oauthError(400, "unsupported_grant_type");
  }

  private tokenResponse(accessToken: string, refreshToken: string | null, scope: string): Response {
    const body: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.accessTokenTtlSeconds,
      scope,
    };
    if (refreshToken) body.refresh_token = refreshToken;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // -- API ------------------------------------------------------------------

  private handleApi(req: FakeRequest): Response {
    if (req.url.host !== "a.klaviyo.com") return apiError(404, "not_found");
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const known = this.accessTokens.get(token);
    if (!known || known.expiresAt <= this.now()) {
      return apiError(401, "authentication_failed", "Incorrect authentication credentials.");
    }
    if (req.headers.get("revision") !== REVISION) return apiError(400, "invalid", "revision header is required");
    if (!(req.headers.get("Accept") ?? "").includes(MEDIA_TYPE)) return apiError(406, "not_acceptable");
    if (req.method !== "GET" && req.headers.get("Content-Type") !== MEDIA_TYPE) {
      return apiError(415, "unsupported_media_type");
    }

    const path = req.url.pathname.replace(/\/$/, "");
    const q = req.url.searchParams;
    let m: RegExpMatchArray | null;

    if (req.method === "GET" && path === "/api/accounts") {
      return json(200, {
        data: [
          {
            type: "account",
            id: this.accountId,
            attributes: {
              test_account: this.testAccount,
              timezone: "US/Eastern",
              contact_information: { organization_name: "Fake Org" },
            },
          },
        ],
      });
    }
    if (req.method === "GET" && path === "/api/billing-usage") {
      return json(200, {
        data: this.billingUsage.map((u) => ({
          type: "billing-usage",
          id: u.id,
          attributes: {
            usage_used: u.usage_used,
            usage_max: u.usage_max,
            unit: u.unit,
            period_start: "2026-11-08T05:00:00+00:00",
            period_end: "2026-12-08T05:00:00+00:00",
            as_of: "2026-11-25T06:30:04.769339+00:00",
          },
          links: { self: `https://a.klaviyo.com/api/billing-usage/${u.id}/` },
        })),
        links: { self: "https://a.klaviyo.com/api/billing-usage/" },
      });
    }
    if (req.method === "GET" && path === "/api/profiles") return this.listProfiles(req);
    if (req.method === "GET" && path === "/api/events") return this.listEvents(req);
    if (req.method === "GET" && path === "/api/metrics") {
      return this.page(req, this.metrics, 200, 200, (x) => ({
        type: "metric",
        id: x.id,
        attributes: { name: x.name, integration: { id: "int1", ...x.integration } },
      }));
    }
    if (req.method === "GET" && (path === "/api/lists" || path === "/api/segments")) {
      const size = Number(q.get("page[size]") ?? 10);
      if (!(size >= 1 && size <= 10)) return apiError(400, "invalid", "page size must be between 1 and 10");
      const isList = path === "/api/lists";
      let items: { id: string; name: string }[] = isList ? this.lists : this.segments;
      const filter = q.get("filter");
      if (filter) {
        const byName = filter.match(/^equals\(name,"((?:[^"\\]|\\.)*)"\)$/);
        if (!byName) return apiError(400, "invalid", "unsupported filter");
        items = items.filter((g) => g.name === byName[1]);
      }
      return this.page(req, items, size, 10, (g) =>
        isList ? { type: "list", id: g.id, attributes: { name: g.name } } : this.segmentResource(g.id, q.get("fields[segment]")),
      );
    }
    if (path === "/api/segments" && req.method === "POST") return this.writeSegment(req, null);
    if ((m = path.match(/^\/api\/segments\/([^/]+)$/))) {
      const segment = this.segments.find((g) => g.id === m![1]);
      if (!segment) return apiError(404, "not_found");
      if (req.method === "PATCH") return this.writeSegment(req, segment.id);
      if (req.method === "GET") return json(200, { data: this.segmentResource(segment.id, q.get("fields[segment]")) });
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/segments\/([^/]+)\/profiles$/))) {
      const segment = this.segments.find((g) => g.id === m![1]);
      if (!segment) return apiError(404, "not_found");
      return this.listProfiles(req, new Set(segment.members));
    }
    if (req.method === "GET" && (m = path.match(/^\/api\/(lists|segments)\/([^/]+)\/relationships\/profiles$/))) {
      const group = (m[1] === "lists" ? this.lists : this.segments).find((g) => g.id === m![2]);
      if (!group) return apiError(404, "not_found");
      const size = Number(q.get("page[size]") ?? 20);
      if (!(size >= 1 && size <= 100)) return apiError(400, "invalid", "page size must be between 1 and 100");
      return this.page(req, group.members, size, 100, (id) => ({ type: "profile", id }));
    }
    if ((m = path.match(/^\/api\/profile-suppression-bulk-(create|delete)-jobs$/)) && req.method === "POST") {
      return this.createJob(req, m[1] === "create" ? "suppress" : "unsuppress");
    }
    if ((m = path.match(/^\/api\/profile-suppression-bulk-(create|delete)-jobs\/([^/]+)$/)) && req.method === "GET") {
      const job = this.jobs.find((j) => j.id === m![2] && j.kind === (m![1] === "create" ? "suppress" : "unsuppress"));
      if (!job) return apiError(404, "not_found");
      return json(200, { data: this.jobResource(job, "complete") });
    }
    return apiError(404, "not_found", `no route for ${req.method} ${path}`);
  }

  private page<T>(req: FakeRequest, all: readonly T[], size: number, max: number, render: (x: T) => unknown): Response {
    const cursor = req.url.searchParams.get("page[cursor]");
    const offset = cursor ? Number(atob(cursor)) : 0;
    if (!Number.isInteger(offset) || offset < 0) return apiError(400, "invalid", "bad cursor");
    const limit = Math.min(size, max);
    const slice = all.slice(offset, offset + limit);
    const next = offset + limit < all.length ? new URL(req.url) : null;
    next?.searchParams.set("page[cursor]", btoa(String(offset + limit)));
    return json(200, {
      data: slice.map(render),
      links: { self: req.url.toString(), next: next ? next.toString() : null, prev: null },
    });
  }

  private profileResource(p: FakeProfile, fields: string[], withSubscriptions: boolean): unknown {
    const attributes: Record<string, unknown> = {};
    if (fields.includes("email")) attributes.email = p.email;
    if (fields.includes("created")) attributes.created = p.created === undefined ? "2024-01-01T00:00:00+00:00" : p.created;
    if (fields.includes("last_event_date")) attributes.last_event_date = p.lastEventDate ?? null;
    if (fields.includes("properties")) attributes.properties = p.properties ?? {};
    if (withSubscriptions && !p.omitSubscriptions && fields.some((f) => f.startsWith("subscriptions"))) {
      const reasons = [...(p.suppression ?? [])];
      if (p.email && this.suppressed.has(p.email) && !reasons.includes("USER_SUPPRESSED")) reasons.push("USER_SUPPRESSED");
      const subscriptions: Record<string, unknown> = {
        email: {
          marketing: {
            can_receive_email_marketing: reasons.length === 0,
            consent: p.emailConsent ?? "SUBSCRIBED",
            consent_timestamp: p.emailConsentTimestamp ?? null,
            suppression: reasons.map((reason) => ({ reason, timestamp: "2026-01-01T00:00:00+00:00" })),
          },
        },
      };
      if (!p.omitSms) {
        subscriptions.sms = {
          marketing: {
            can_receive_sms_marketing: p.canReceiveSms ?? false,
            consent: p.smsConsent ?? "NEVER_SUBSCRIBED",
          },
        };
      }
      attributes.subscriptions = subscriptions;
    }
    return { type: "profile", id: p.id, attributes, links: { self: `https://a.klaviyo.com/api/profiles/${p.id}/` } };
  }

  private segmentResource(id: string, fieldsParam: string | null): unknown {
    const segment = this.segments.find((g) => g.id === id)!;
    const all: Record<string, unknown> = {
      name: segment.name,
      definition: echoDefinition(segment.definition ?? { condition_groups: [] }),
      is_processing: segment.isProcessing ?? false,
      is_active: segment.isActive ?? true,
    };
    const fields = fieldsParam ? fieldsParam.split(",") : ["name", "definition", "is_processing", "is_active"];
    return { type: "segment", id, attributes: Object.fromEntries(fields.filter((f) => f in all).map((f) => [f, all[f]])) };
  }

  /** POST /api/segments (id null) or PATCH /api/segments/{id}. Validates the definition against the documented shapes. */
  private writeSegment(req: FakeRequest, id: string | null): Response {
    let body: { data?: { type?: string; id?: string; attributes?: { name?: unknown; definition?: unknown } } };
    try {
      body = JSON.parse(req.body);
    } catch {
      return apiError(400, "invalid", "body is not JSON");
    }
    if (body.data?.type !== "segment") return apiError(400, "invalid", "wrong resource type");
    if (id !== null && body.data.id !== id) return apiError(409, "conflict", "id mismatch");
    const attributes = body.data.attributes ?? {};
    const problem = FakeKlaviyo.definitionProblem(attributes.definition);
    if (problem) return apiError(400, "invalid", problem);
    if (id === null) {
      if (typeof attributes.name !== "string" || !attributes.name) return apiError(400, "invalid", "name is required");
      const created = { id: `SEG${String(this.segments.length + 1).padStart(3, "0")}`, name: attributes.name, members: [] as string[], definition: attributes.definition, isProcessing: true };
      this.segments.push(created);
      return json(201, { data: this.segmentResource(created.id, null) });
    }
    const segment = this.segments.find((g) => g.id === id)!;
    segment.definition = attributes.definition;
    segment.isProcessing = true;
    return json(200, { data: this.segmentResource(segment.id, null) });
  }

  /** Returns what is wrong with a segment definition, or null. Only the condition types TierSaver uses are accepted. */
  static definitionProblem(definition: unknown): string | null {
    const groups = (definition as { condition_groups?: unknown })?.condition_groups;
    if (!Array.isArray(groups) || groups.length === 0) return "condition_groups is required";
    for (const group of groups) {
      const conditions = (group as { conditions?: unknown })?.conditions;
      if (!Array.isArray(conditions) || conditions.length === 0) return "conditions is required";
      for (const c of conditions as Record<string, any>[]) {
        if (c.type === "profile-marketing-consent") {
          const k = c.consent;
          if (k?.channel !== "email" || k?.can_receive_marketing !== true || k?.consent_status?.subscription !== "any") return "bad consent condition";
        } else if (c.type === "profile-metric") {
          if (typeof c.metric_id !== "string" || !c.metric_id) return "metric_id is required";
          if (c.measurement !== "count") return "bad measurement";
          const f = c.measurement_filter;
          if (f?.type !== "numeric" || !["equals", "greater-than-or-equal"].includes(f?.operator) || !Number.isInteger(f?.value)) return "bad measurement_filter";
          const t = c.timeframe_filter;
          const alltime = t?.type === "date" && t?.operator === "alltime";
          const inTheLast = t?.type === "date" && t?.operator === "in-the-last" && ["day", "hour", "week"].includes(t?.unit) && Number.isInteger(t?.quantity);
          if (!alltime && !inTheLast) return "bad timeframe_filter";
        } else return `unsupported condition type ${String(c.type)}`;
      }
    }
    return null;
  }

  private listProfiles(req: FakeRequest, only?: Set<string>): Response {
    const q = req.url.searchParams;
    const size = Number(q.get("page[size]") ?? 20);
    if (!(size >= 1 && size <= 100)) return apiError(400, "invalid", "page size must be between 1 and 100");
    const fields = (q.get("fields[profile]") ?? "email,created").split(",");
    const additional = (q.get("additional-fields[profile]") ?? "").split(",");
    if (additional.includes("predictive_analytics")) return apiError(400, "invalid", "not used by TierSaver");
    const wantsSubscriptions = fields.some((f) => f.startsWith("subscriptions"));
    if (wantsSubscriptions && !additional.includes("subscriptions")) {
      return apiError(400, "invalid", "subscriptions requires additional-fields[profile]=subscriptions");
    }
    let all = [...this.profiles.values()];
    if (only) all = all.filter((p) => only.has(p.id));
    const filter = q.get("filter");
    if (filter) {
      const m = filter.match(/^any\(id,\[(.*)\]\)$/);
      if (!m) return apiError(400, "invalid", "unsupported filter");
      const ids = [...m[1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]!);
      all = all.filter((p) => ids.includes(p.id));
    }
    return this.page(req, all, size, 100, (p) => this.profileResource(p, fields, additional.includes("subscriptions")));
  }

  private listEvents(req: FakeRequest): Response {
    const q = req.url.searchParams;
    const size = Number(q.get("page[size]") ?? 200);
    if (!(size >= 1 && size <= 1000)) return apiError(400, "invalid", "page size must be between 1 and 1000");
    const filter = q.get("filter") ?? "";
    const m = filter.match(/^equals\(metric_id,"([^"]+)"\),greater-or-equal\(datetime,([0-9TZ:.+-]+)\)$/);
    if (!m) return apiError(400, "invalid", "unsupported filter");
    const since = Date.parse(m[2]!);
    if (Number.isNaN(since)) return apiError(400, "invalid", "bad datetime");
    const fields = (q.get("fields[event]") ?? "datetime,event_properties").split(",");
    const all = this.events
      .filter((e) => e.metricId === m[1] && Date.parse(e.datetime) >= since)
      .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    return this.page(req, all, size, 1000, (e) => {
      const attributes: Record<string, unknown> = {};
      if (fields.includes("datetime")) attributes.datetime = e.datetime;
      if (fields.includes("event_properties")) attributes.event_properties = e.properties ?? {};
      const relationships: Record<string, unknown> = { metric: { data: { type: "metric", id: e.metricId } } };
      if (e.profileId) relationships.profile = { data: { type: "profile", id: e.profileId } };
      return { type: "event", id: `evt-${++this.counter}`, attributes, relationships };
    });
  }

  private jobResource(job: FakeJob, status: string): unknown {
    return {
      type: `profile-suppression-bulk-${job.kind === "suppress" ? "create" : "delete"}-job`,
      id: job.id,
      attributes: {
        status,
        created_at: "2026-11-25T12:00:00+00:00",
        total_count: job.emails.length,
        completed_count: status === "complete" ? job.emails.length : 0,
        skipped_count: 0,
        completed_at: status === "complete" ? "2026-11-25T12:00:05+00:00" : null,
      },
      links: { self: "https://a.klaviyo.com/api/jobs/" },
    };
  }

  private createJob(req: FakeRequest, kind: "suppress" | "unsuppress"): Response {
    let body: {
      data?: { type?: string; attributes?: { profiles?: { data?: { type?: string; attributes?: { email?: unknown } }[] } } };
    };
    try {
      body = JSON.parse(req.body);
    } catch {
      return apiError(400, "invalid", "body is not JSON");
    }
    const expectedType = `profile-suppression-bulk-${kind === "suppress" ? "create" : "delete"}-job`;
    if (body.data?.type !== expectedType) return apiError(400, "invalid", "wrong resource type");
    const entries = body.data.attributes?.profiles?.data;
    if (!Array.isArray(entries) || entries.length === 0) return apiError(400, "invalid", "profiles are required");
    if (entries.length > 100) return apiError(400, "invalid", "Email address per request limit: 100");
    const emails: string[] = [];
    for (const entry of entries) {
      const email = entry?.attributes?.email;
      if (entry?.type !== "profile" || typeof email !== "string" || !email.includes("@")) {
        return apiError(400, "invalid", `Invalid email address: ${String(email)}`);
      }
      emails.push(email);
    }
    for (const email of emails) {
      if (kind === "suppress") this.suppressed.add(email);
      else this.suppressed.delete(email);
    }
    const job: FakeJob = { id: `JOB${String(this.jobs.length + 1).padStart(4, "0")}`, kind, emails };
    this.jobs.push(job);
    return json(202, { data: this.jobResource(job, "queued") });
  }
}

/**
 * The real API echoes a definition with its optional members spelled out as
 * null (`metric_filters: null`, `consent_status.filters: null`); seen on
 * account SGKvLG, revision 2026-10-15, on 2026-11-25. The fake does the same so
 * the comparison in `canonicalDefinition` is exercised the way Klaviyo exercises it.
 */
function echoDefinition(definition: unknown): unknown {
  const d = structuredClone(definition) as { condition_groups?: { conditions?: Record<string, unknown>[] }[] };
  for (const group of d?.condition_groups ?? []) {
    for (const condition of group?.conditions ?? []) {
      if (condition.type === "profile-metric" && !("metric_filters" in condition)) condition.metric_filters = null;
      const status = (condition.consent as { consent_status?: Record<string, unknown> } | undefined)?.consent_status;
      if (status && !("filters" in status)) status.filters = null;
    }
  }
  return d;
}
