import { env } from "cloudflare:workers";
import { DEFAULT_SCHEDULE, formatCalendarDate, planNextCleanup, SIMULATION_TTL_MS } from "@tiersaver/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Form, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { HomeScreen, type HomeView, type Notice } from "../components/home-screen";
import { db, schema } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { disconnect, getConnection } from "../klaviyo/connection.server";
import { legalUrls } from "../legal";
import { dayStamp, formatCalendarDay, safeTimeZone, stamp } from "../settings/timezone";
import { klaviyoStartUrl } from "../klaviyo/flow.server";
import { ensureShop } from "../orders/purchases";
import { startScan } from "../scans/start.server";
import { loadAuditView } from "../scans/view.server";
import { effectiveBillingDay } from "../schedule/schedule";
import { latestSimulation } from "../simulations/review";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs): Promise<HomeView> => {
  const { session } = await authenticate.admin(request);
  await ensureShop(db, session.shop);

  const connection = await getConnection(db, session.shop);
  const configured = Boolean(env.KLAVIYO_CLIENT_ID && env.KLAVIYO_CLIENT_SECRET);
  const raw = new URL(request.url).searchParams.get("klaviyo");
  const notice: Notice = raw === "connected" || raw === "declined" || raw === "failed" || raw === "disconnected" ? raw : null;
  const connected = connection?.status === "connected";

  const [audit, simulation, lastRun, settings, periodAudit, shopRow] = await Promise.all([
    connected ? loadAuditView(session.shop) : null,
    latestSimulation(db, session.shop),
    db.query.runs.findFirst({ where: and(eq(schema.runs.shop, session.shop), eq(schema.runs.kind, "suppress")), orderBy: desc(schema.runs.createdAt) }),
    db.query.settings.findFirst({ where: eq(schema.settings.shop, session.shop) }),
    db.query.audits.findFirst({ where: and(eq(schema.audits.shop, session.shop), isNotNull(schema.audits.periodEnd)), orderBy: desc(schema.audits.createdAt), columns: { periodEnd: true } }),
    db.query.shops.findFirst({ where: eq(schema.shops.shop, session.shop), columns: { ianaTimezone: true, purchasesCoveredSince: true, readAllOrdersGranted: true } }),
  ]);
  // Every date is formatted here, in the shop's time zone (UTC until Shopify has told us), never in the browser.
  const zone = safeTimeZone(shopRow?.ianaTimezone);
  const legal = legalUrls(env);
  const restored = lastRun
    ? await db.query.runProfiles.findFirst({ where: and(eq(schema.runProfiles.runId, lastRun.id), isNotNull(schema.runProfiles.reactivatedAt)), columns: { profileId: true } })
    : null;

  let nextAuditOn: string | null = null;
  const billingDay = effectiveBillingDay(settings?.billingDay ?? null, periodAudit?.periodEnd ?? null);
  if (settings?.scheduleEnabled && billingDay) {
    const plan = planNextCleanup(new Date(), { billingDay, leadDays: Math.max(settings.leadDays, DEFAULT_SCHEDULE.minLeadDays), minLeadDays: DEFAULT_SCHEDULE.minLeadDays });
    nextAuditOn = formatCalendarDay(formatCalendarDate(plan.runOn));
  }

  return {
    notice,
    configured,
    // A fresh ticket on every load; it is valid for ten minutes.
    startUrl: configured && !connected ? await klaviyoStartUrl(env, session.shop) : null,
    connection: connection ? { status: connection.status, klaviyoAccountId: connection.klaviyoAccountId, connectedOn: dayStamp(connection.connectedAt, zone) } : null,
    scan: audit?.scan ? { status: audit.scan.status, error: audit.scan.error, membersRead: audit.scan.membersRead } : null,
    result: audit?.result ? { ...audit.result, finishedAt: stamp(audit.result.finishedAt, zone) } : null,
    // "loading": the order history has not been read yet, or was not current when the audit ran. "partial": Shopify has not shared all of it.
    orderHistory: !shopRow?.purchasesCoveredSince || audit?.result?.purchaseDataStale ? "loading" : shopRow.readAllOrdersGranted ? "complete" : "partial",
    simulation: simulation
      ? { state: simulation.state, candidates: simulation.simulation.candidateCount, expiresAt: stamp(new Date(simulation.simulation.createdAt.getTime() + SIMULATION_TTL_MS), zone) }
      : null,
    lastCleanup: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          error: lastRun.lastError,
          finishedAt: lastRun.finishedAt ? stamp(lastRun.finishedAt, zone) : null,
          total: lastRun.totalCount,
          submitted: lastRun.processedCount,
          restored: Boolean(restored),
        }
      : null,
    schedule: { enabled: settings?.scheduleEnabled ?? false, automatic: settings?.mode === "automatic", nextAuditOn },
    links: { help: legal.help, support: legal.support, supportEmail: legal.supportEmail, sales: legal.sales, salesEmail: legal.salesEmail, schedule: legal.articles.schedule, pricing: legal.articles.pricing },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "scan") {
    // Read-only: the audit never changes anything in Klaviyo except TierSaver's own managed segment.
    const connection = await getConnection(db, session.shop);
    if (connection?.status === "connected") await startScan({ shop: session.shop, createdBy: sessionActor(sessionToken) });
    return redirect("/app");
  }
  if (intent !== "disconnect") return new Response(null, { status: 400 });

  const result = await disconnect({ db, env }, session.shop);
  if (result.existed) {
    await logEvent(db, {
      shop: session.shop,
      actor: sessionActor(sessionToken),
      action: "klaviyo.disconnected",
      detail: { revokedAtKlaviyo: result.revoked },
    });
  }
  return redirect("/app?klaviyo=disconnected");
};

export default function Index() {
  const view = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";
  const scanning = view.scan?.status === "queued" || view.scan?.status === "running";
  const revalidator = useRevalidator();
  // A cleanup in progress is shown on this page too, so it is polled like an audit.
  const working = scanning || view.lastCleanup?.status === "queued" || view.lastCleanup?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  return (
    <HomeScreen
      view={view}
      busy={busy}
      renderForm={(intent, content) => (
        <Form method="post">
          <input type="hidden" name="intent" value={intent} />
          {content}
        </Form>
      )}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
