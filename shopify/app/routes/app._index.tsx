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

  const [audit, simulation, lastRun, settings, periodAudit] = await Promise.all([
    connected ? loadAuditView(session.shop) : null,
    latestSimulation(db, session.shop),
    db.query.runs.findFirst({ where: and(eq(schema.runs.shop, session.shop), eq(schema.runs.kind, "suppress")), orderBy: desc(schema.runs.createdAt) }),
    db.query.settings.findFirst({ where: eq(schema.settings.shop, session.shop) }),
    db.query.audits.findFirst({ where: and(eq(schema.audits.shop, session.shop), isNotNull(schema.audits.periodEnd)), orderBy: desc(schema.audits.createdAt), columns: { periodEnd: true } }),
  ]);
  const restored = lastRun
    ? await db.query.runProfiles.findFirst({ where: and(eq(schema.runProfiles.runId, lastRun.id), isNotNull(schema.runProfiles.reactivatedAt)), columns: { profileId: true } })
    : null;

  let nextAuditOn: string | null = null;
  const billingDay = effectiveBillingDay(settings?.billingDay ?? null, periodAudit?.periodEnd ?? null);
  if (settings?.scheduleEnabled && billingDay) {
    const plan = planNextCleanup(new Date(), { billingDay, leadDays: Math.max(settings.leadDays, DEFAULT_SCHEDULE.minLeadDays), minLeadDays: DEFAULT_SCHEDULE.minLeadDays });
    nextAuditOn = formatCalendarDate(plan.runOn);
  }

  return {
    notice,
    configured,
    // A fresh ticket on every load; it is valid for ten minutes.
    startUrl: configured && !connected ? await klaviyoStartUrl(env, session.shop) : null,
    connection: connection ? { status: connection.status, klaviyoAccountId: connection.klaviyoAccountId, connectedAt: connection.connectedAt.toISOString() } : null,
    scan: audit?.scan ? { status: audit.scan.status, error: audit.scan.error, membersRead: audit.scan.membersRead } : null,
    result: audit?.result ?? null,
    simulation: simulation
      ? { state: simulation.state, candidates: simulation.simulation.candidateCount, expiresAt: new Date(simulation.simulation.createdAt.getTime() + SIMULATION_TTL_MS).toISOString() }
      : null,
    lastCleanup: lastRun
      ? { id: lastRun.id, status: lastRun.status, finishedAt: lastRun.finishedAt?.toISOString() ?? null, submitted: lastRun.processedCount, restored: Boolean(restored) }
      : null,
    schedule: { enabled: settings?.scheduleEnabled ?? false, automatic: settings?.mode === "automatic", nextAuditOn },
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
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [scanning, revalidator]);

  return (
    <HomeScreen
      view={view}
      busy={busy}
      renderForm={(intent, button) => (
        <Form method="post">
          <input type="hidden" name="intent" value={intent} />
          {button}
        </Form>
      )}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
