import { hashShopEmail } from "../app/email-hash";
import { FakeKlaviyo, type FakeProfile } from "../app/klaviyo/testing/fake-klaviyo";

/**
 * The simulated outside world of the preview: one fake shop, an in-memory
 * Klaviyo account with a sample list, and Shopify billing kept in memory.
 * Lives in the Worker isolate, so it resets when the dev server restarts.
 */

export const PREVIEW_SHOP = "preview-shop.myshopify.com";
export const PREVIEW_USER = "1001";

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

/**
 * Shopify billing, in memory: the shop's active plan (a 30-day subscription), the one waiting on "Shopify's
 * approval page", and whether the plan is frozen. `legacyUsage` adds the usage subscription of the old
 * per-cleanup model, to see that it does not count as a plan.
 */
export interface PreviewPlan {
  id: string;
  name: string;
  monthlyCents: number;
  test: boolean;
  returnUrl: string;
}
export const billing = {
  plan: null as PreviewPlan | null,
  pending: null as PreviewPlan | null,
  frozen: false,
  legacyUsage: false,
  /** Every subscription the app asked Shopify to create, in order. */
  requested: [] as { name: string; monthlyCents: number; test: boolean }[],
  cancelled: 0,
  next: 1,
};
export function resetBilling(): void {
  Object.assign(billing, { plan: null, pending: null, frozen: false, legacyUsage: false, requested: [], cancelled: 0, next: 1 });
}

export const klaviyo = new FakeKlaviyo();
/** Preview-only controls (see /__preview/klaviyo in worker.ts): slow Klaviyo down so a running cleanup can be looked at. */
export const knobs = { delayMs: 0 };
/** Members Klaviyo "computes" for the managed segment once it stops processing. */
let segmentMembers: string[] = [];
/** Buyers to record in the shop's order history (email addresses of some segment members). */
export let buyerEmails: string[] = [];

export function seedKlaviyo(): void {
  klaviyo.profiles.clear();
  klaviyo.segments = [];
  klaviyo.jobs = [];
  klaviyo.suppressed.clear();
  klaviyo.suppressedAt.clear();
  klaviyo.responders = [];
  // Like the real service, a bulk job is accepted first and applied a little later (there: 15 to 25 seconds).
  klaviyo.jobProcessingMs = 3000;
  knobs.delayMs = 0;
  klaviyo.accountId = "PREVW1";
  klaviyo.testAccount = false;
  klaviyo.metrics = [
    { id: "M_RECV", name: "Received Email", integration: { name: "Klaviyo", category: "Internal" } },
    { id: "M_OPEN", name: "Opened Email", integration: { name: "Klaviyo", category: "Internal" } },
    { id: "M_CLICK", name: "Clicked Email", integration: { name: "Klaviyo", category: "Internal" } },
    { id: "M_ORDER", name: "Placed Order", integration: { name: "Shopify", category: "eCommerce" } },
    { id: "M_CHECKOUT", name: "Checkout Started", integration: { name: "Shopify", category: "eCommerce" } },
    { id: "M_SITE", name: "Active on Site", integration: { name: "API", category: "API" } },
  ];
  // 2,640 profiles that meet Klaviyo's criteria (segment members); the rest of the 12,480 "active profiles" only exist as a count.
  const members: FakeProfile[] = [];
  for (let i = 0; i < 2640; i++) {
    const p: FakeProfile = { id: `01PREVIEW${String(i).padStart(17, "0")}`, email: `shopper${i}@sample-customers.test`, created: iso(900 - (i % 300)), emailConsent: "SUBSCRIBED", emailConsentTimestamp: iso(880 - (i % 300)) };
    if (i % 11 === 0) p.created = iso(200); // too new
    if (i % 37 === 0) { p.smsConsent = "SUBSCRIBED"; p.canReceiveSms = true; }
    members.push(p);
    klaviyo.profiles.set(p.id, p);
  }
  segmentMembers = members.map((p) => p.id);
  buyerEmails = members.filter((_, i) => i % 23 === 0).map((p) => p.email!);
  klaviyo.lists = [
    { id: "LISTVIP", name: "VIP customers", members: members.filter((_, i) => i % 29 === 0).map((p) => p.id) },
    { id: "LISTNEWS", name: "Newsletter", members: members.slice(0, 40).map((p) => p.id) },
    { id: "LISTWHOLE", name: "Wholesale", members: [] },
  ];
  klaviyo.billingUsage = [{ id: "active_profiles", usage_used: 12480, usage_max: 15000, unit: "profiles" }];
}
seedKlaviyo();

/** Hashes of the sample buyers, for `purchase_hashes`. */
export async function buyerHashes(): Promise<string[]> {
  return Promise.all(buyerEmails.map((e) => hashShopEmail(PREVIEW_SHOP, e)));
}

const realFetch = globalThis.fetch.bind(globalThis);

/** Everything addressed to Klaviyo goes to the fake; anything else is refused, so the preview cannot reach a real service. */
export const previewFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  if (url.hostname.endsWith("klaviyo.com")) {
    // Klaviyo "finishes computing" a segment by the time it is asked again.
    for (const segment of klaviyo.segments) {
      if (segment.isProcessing && url.pathname !== "/api/segments") {
        segment.isProcessing = false;
        segment.members = segmentMembers.filter((id) => !klaviyo.suppressed.has(klaviyo.profiles.get(id)?.email ?? ""));
      }
    }
    if (knobs.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, knobs.delayMs));
    return klaviyo.fetch(input, init);
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  return new Response(`preview: outbound request to ${url.hostname} blocked`, { status: 599 });
};

let installed = false;
export function installPreviewWorld(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = previewFetch;
}
