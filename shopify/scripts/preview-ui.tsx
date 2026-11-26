// Local preview of the app's screens with the real Polaris web components, outside Shopify.
// Renders the pure screen components (app/components) with sample data to static HTML.
//
//   node scripts/preview-ui.mjs <output-dir>     (bundles and runs this file)
//
// Sample numbers are the seeded test account's; nothing here talks to Klaviyo or Shopify.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeScreen, type HomeView } from "../app/components/home-screen";
import { legalUrls } from "../app/legal";
import { dayStamp, stamp } from "../app/settings/timezone";

const out = process.argv[2] ?? "preview";
mkdirSync(out, { recursive: true });

const page = (body: ReactNode) =>
  `<!doctype html><html><head><meta charset="utf-8"><script src="${process.env.POLARIS_JS ?? "https://cdn.shopify.com/shopifycloud/polaris.js"}"></script><style>body{margin:0;background:#f1f1f1}</style></head><body>${renderToStaticMarkup(body)}</body></html>`;

const form = (_intent: string, button: ReactNode) => <form>{button}</form>;

const base: HomeView = {
  notice: null,
  configured: true,
  startUrl: "#",
  connection: null,
  scan: null,
  result: null,
  simulation: null,
  lastCleanup: null,
  schedule: { enabled: false, automatic: false, nextAuditOn: null },
  plan: { status: "none", price: null, lowest: "US$9/month", largestList: "150,000", intervalDays: 30 },
  orderHistory: "complete",
  links: (({ help, support, supportEmail, sales, salesEmail, articles }) => ({ help, support, supportEmail, sales, salesEmail, schedule: articles.schedule, pricing: articles.pricing }))(legalUrls({})),
};
const connection = { status: "connected" as const, klaviyoAccountId: "SGKvLG", connectedOn: dayStamp("2026-11-25T18:55:38Z") };
const result = {
  finishedAt: stamp("2026-11-25T18:58:07Z"),
  activeProfiles: 2885,
  activeProfilesSource: "klaviyo_usage",
  matchingKlaviyoCriteria: 984,
  candidates: 696,
  keptActive: [{ label: "Created or subscribed too recently", count: 288 }],
  note: null,
  price: "US$9/month",
  seededTestAccount: true,
  resurfaced: 0,
  restoreLocked: 0,
  unverifiedPurchases: 0,
  purchaseDataStale: false,
};

const states: Record<string, HomeView> = {
  "home-1-new": base,
  "home-2-connected": { ...base, notice: "connected", connection },
  "home-3-audited": { ...base, connection, scan: { status: "completed", error: null, membersRead: 984 }, result, simulation: { state: "open", candidates: 696, expiresAt: stamp("2026-11-26T18:58:07Z") } },
  "home-4-cleaned": {
    ...base,
    connection,
    scan: { status: "completed", error: null, membersRead: 288 },
    result: { ...result, activeProfiles: 2189, matchingKlaviyoCriteria: 288, candidates: 0, seededTestAccount: false },
    simulation: { state: "executed", candidates: 696, expiresAt: stamp("2026-11-26T18:58:07Z") },
    lastCleanup: { id: "run", status: "completed", error: null, total: 696, finishedAt: stamp("2026-11-25T23:31:27Z"), submitted: 696, restored: false },
    schedule: { enabled: true, automatic: false, nextAuditOn: "Dec 26, 2026" },
  },
};
// After "Disconnect Klaviyo" on a shop that already ran a cleanup: the way back must be on screen.
states["home-5-disconnected"] = { ...states["home-4-cleaned"]!, notice: "disconnected", connection: null, scan: null, result: null, simulation: { state: "open", candidates: 696, expiresAt: stamp("2026-11-26T18:58:07Z") } };
for (const [name, view] of Object.entries(states)) {
  writeFileSync(join(out, `${name}.html`), page(<HomeScreen view={view} busy={false} renderForm={form} />));
}
console.log(Object.keys(states).join("\n"));
