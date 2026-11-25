/** In-memory stand-in for the Klaviyo API, plus a fake clock. Offline only. */
import type { FetchLike } from "../src/client.js";

export const TEST_KEY = "pk_test_0123456789abcdef0123456789abcdef";

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: any;
}

export interface FakeAccount {
  id: string;
  organizationName: string;
  testAccount: boolean;
}

type Canned = { status: number; headers?: Record<string, string>; body?: unknown } | "network-error";

export class FakeKlaviyo {
  account: FakeAccount = { id: "TsTest", organizationName: "TierSaver Test", testAccount: true };
  requests: RecordedRequest[] = [];
  /** email -> profile attributes */
  profiles = new Map<string, any>();
  /** `${email}|${metric}|${unique_id}` */
  events = new Set<string>();
  eventPosts = 0;
  duplicateEventPosts = 0;
  suppressed = new Set<string>();
  smsConsent = new Set<string>();
  jobs = new Map<string, { pollsLeft: number; total: number }>();
  /** How many GETs a job answers "processing" before "complete". */
  pollsUntilComplete = 1;
  private nextJob = 1;
  private canned: { method: string; path: RegExp; responses: Canned[] }[] = [];

  /** Queue responses returned instead of the normal behaviour for matching requests. */
  failNext(method: string, path: RegExp, ...responses: Canned[]): void {
    this.canned.push({ method, path, responses });
  }

  posts(pathPart: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === "POST" && r.path.includes(pathPart));
  }

  fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path: parsed.pathname, query: parsed.searchParams, headers: init.headers as Record<string, string>, body });

    const canned = this.canned.find((c) => c.method === method && c.path.test(parsed.pathname) && c.responses.length > 0);
    if (canned) {
      const next = canned.responses.shift() as Canned;
      if (next === "network-error") throw new TypeError("fetch failed");
      return this.respond(next.status, next.body, next.headers);
    }
    return this.route(method, parsed, body);
  };

  private respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
  }

  private job(type: string, total: number): Response {
    const id = `job-${this.nextJob++}`;
    this.jobs.set(id, { pollsLeft: this.pollsUntilComplete, total });
    return this.respond(202, { data: { type, id, attributes: { status: "queued", total_count: total } } });
  }

  private route(method: string, url: URL, body: any): Response {
    const path = url.pathname;
    if (method === "GET" && path === "/api/accounts") {
      return this.respond(200, {
        data: [
          {
            type: "account",
            id: this.account.id,
            attributes: { test_account: this.account.testAccount, contact_information: { organization_name: this.account.organizationName } },
          },
        ],
      });
    }
    const jobMatch = /^\/api\/(profile-bulk-import-jobs|profile-suppression-bulk-(?:create|delete)-jobs)\/([^/]+)$/.exec(path);
    if (method === "GET" && jobMatch) {
      const job = this.jobs.get(jobMatch[2] as string);
      if (!job) return this.respond(404, { errors: [{ code: "not_found", title: "Not found", detail: "no such job" }] });
      const complete = job.pollsLeft <= 0;
      job.pollsLeft -= 1;
      return this.respond(200, {
        data: {
          id: jobMatch[2],
          attributes: { status: complete ? "complete" : "processing", total_count: job.total, completed_count: complete ? job.total : 0, failed_count: 0, skipped_count: 0 },
        },
      });
    }
    if (method === "POST" && path === "/api/profile-bulk-import-jobs") {
      const list = body.data.attributes.profiles.data as any[];
      for (const p of list) this.profiles.set(p.attributes.email, { ...p.attributes, lists: body.data.relationships?.lists?.data ?? [] });
      return this.job("profile-bulk-import-job", list.length);
    }
    if (method === "POST" && path === "/api/event-bulk-create-jobs") {
      for (const entry of body.data.attributes["events-bulk-create"].data as any[]) {
        for (const event of entry.attributes.events.data as any[]) {
          this.eventPosts += 1;
          const key = `${entry.attributes.profile.data.attributes.email}|${event.attributes.metric.data.attributes.name}|${event.attributes.unique_id}`;
          if (this.events.has(key)) this.duplicateEventPosts += 1;
          this.events.add(key);
        }
      }
      return this.respond(202);
    }
    if (method === "POST" && path === "/api/profile-suppression-bulk-create-jobs") {
      const list = body.data.attributes.profiles.data as any[];
      for (const p of list) this.suppressed.add(p.attributes.email);
      return this.job("profile-suppression-bulk-create-job", list.length);
    }
    if (method === "POST" && path === "/api/profile-suppression-bulk-delete-jobs") {
      const list = body.data.attributes.profiles.data as any[];
      for (const p of list) this.suppressed.delete(p.attributes.email);
      return this.job("profile-suppression-bulk-delete-job", list.length);
    }
    if (method === "POST" && path === "/api/profile-subscription-bulk-create-jobs") {
      for (const p of body.data.attributes.profiles.data as any[]) this.smsConsent.add(p.attributes.email);
      return this.respond(202);
    }
    if (method === "GET" && path === "/api/profiles") {
      const email = /equals\(email,"([^"]+)"\)/.exec(url.searchParams.get("filter") ?? "")?.[1] ?? "";
      const profile = this.profiles.get(email);
      if (!profile) return this.respond(200, { data: [] });
      return this.respond(200, {
        data: [
          {
            type: "profile",
            id: `id:${email}`,
            attributes: {
              email,
              properties: profile.properties,
              subscriptions: {
                email: { marketing: { suppression: this.suppressed.has(email) ? [{ reason: "USER_SUPPRESSED" }] : [] } },
                sms: { marketing: { consent: this.smsConsent.has(email) ? "SUBSCRIBED" : "NEVER_SUBSCRIBED" } },
              },
            },
          },
        ],
      });
    }
    if (method === "GET" && path === "/api/events") {
      const email = /equals\(profile_id,"id:([^"]+)"\)/.exec(url.searchParams.get("filter") ?? "")?.[1] ?? "";
      const count = [...this.events].filter((key) => key.startsWith(`${email}|`)).length;
      return this.respond(200, { data: Array.from({ length: count }, (_, i) => ({ type: "event", id: `e${i}` })) });
    }
    return this.respond(404, { errors: [{ code: "not_found", title: "Not found", detail: `${method} ${path}` }] });
  }
}

/** Clock that only moves when something sleeps. */
export function fakeTime(startMs = Date.parse("2026-11-25T12:00:00Z")) {
  let nowMs = startMs;
  const sleeps: number[] = [];
  return {
    clock: () => nowMs,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    sleeps,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}
