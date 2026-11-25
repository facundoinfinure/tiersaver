import { env } from "cloudflare:workers";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Form, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { disconnect, getConnection } from "../klaviyo/connection.server";
import { klaviyoStartUrl } from "../klaviyo/flow.server";
import { ensureShop } from "../orders/purchases";
import { startScan } from "../scans/start.server";
import { loadAuditView } from "../scans/view.server";
import { authenticate } from "../shopify.server";

type Notice = "connected" | "declined" | "failed" | "disconnected" | null;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(db, session.shop);

  const connection = await getConnection(db, session.shop);
  const configured = Boolean(env.KLAVIYO_CLIENT_ID && env.KLAVIYO_CLIENT_SECRET);
  const raw = new URL(request.url).searchParams.get("klaviyo");
  const notice: Notice = raw === "connected" || raw === "declined" || raw === "failed" || raw === "disconnected" ? raw : null;

  return {
    notice,
    configured,
    audit: connection?.status === "connected" ? await loadAuditView(session.shop) : null,
    // A fresh ticket on every load; it is valid for ten minutes.
    startUrl: configured ? await klaviyoStartUrl(env, session.shop) : null,
    connection: connection
      ? {
          status: connection.status,
          klaviyoAccountId: connection.klaviyoAccountId,
          connectedAt: connection.connectedAt.toISOString(),
        }
      : null,
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

const NOTICES: Record<Exclude<Notice, null>, { tone: "success" | "warning" | "info"; text: string }> = {
  connected: { tone: "success", text: "Klaviyo is connected. Nothing has changed in your Klaviyo account." },
  declined: { tone: "info", text: "Klaviyo was not connected because the request was declined on Klaviyo." },
  failed: { tone: "warning", text: "Klaviyo could not be connected. Please try again." },
  disconnected: { tone: "info", text: "Klaviyo is disconnected. TierSaver no longer has access to your Klaviyo account." },
};

const number = (n: number) => n.toLocaleString("en-US");

const SCAN_ERRORS: Record<string, string> = {
  klaviyo_needs_reauth: "TierSaver's access to Klaviyo has ended. Reconnect Klaviyo and run the audit again.",
  candidate_segment_changed: "The TierSaver segment in Klaviyo was edited while the audit was running. Run the audit again.",
  candidate_segment_unusable: "The TierSaver segment in Klaviyo was deactivated or edited. Run the audit again to restore it.",
  candidate_segment_still_processing: "Klaviyo is still preparing the data. Run the audit again in a few minutes.",
  too_many_segment_members: "This list is larger than the audit can read right now. Contact support and we will sort it out.",
};

function Audit({ audit, busy }: { audit: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>["audit"]>; busy: boolean }) {
  const { scan, result } = audit;
  const running = scan?.status === "queued" || scan?.status === "running";
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [running, revalidator]);

  return (
    <s-section heading="List audit">
      <s-stack gap="base">
        <s-paragraph>
          The audit is free and read-only. It counts the profiles that meet Klaviyo's own criteria for long-term
          inactive profiles: created at least a year ago, sent five or more emails in about 72 weeks, and never
          opened, clicked, visited your site or purchased. To do that, TierSaver keeps one segment in your Klaviyo
          account; nothing else is created or changed.
        </s-paragraph>

        {running ? (
          <s-banner tone="info" heading="Audit in progress">
            Klaviyo is working through your list{scan.membersRead > 0 ? ` (${number(scan.membersRead)} profiles read so far)` : ""}.
            Large lists can take several minutes. You can leave this page.
          </s-banner>
        ) : null}
        {scan?.status === "failed" ? (
          <s-banner tone="warning" heading="The audit could not finish">
            {SCAN_ERRORS[scan.error ?? ""] ?? "Something went wrong while reading from Klaviyo. Nothing was changed. Please run the audit again."}
          </s-banner>
        ) : null}

        {result ? (
          <s-stack gap="base">
            {result.seededTestAccount ? (
              <s-banner tone="info">Test account: this audit reads seeded sample data.</s-banner>
            ) : null}
            {result.note ? <s-banner tone="info">{result.note}</s-banner> : null}
            <s-table>
              <s-table-header-row>
                <s-table-header>As of {new Date(result.finishedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</s-table-header>
                <s-table-header format="numeric">Profiles</s-table-header>
              </s-table-header-row>
              <s-table-body>
                <s-table-row>
                  <s-table-cell>
                    Active profiles{" "}
                    {result.activeProfilesSource === "klaviyo_usage"
                      ? "(Klaviyo's own count)"
                      : "(counted by TierSaver: profiles with an email address that are not suppressed)"}
                  </s-table-cell>
                  <s-table-cell>{number(result.activeProfiles)}</s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell>Meet Klaviyo's long-term inactive criteria</s-table-cell>
                  <s-table-cell>{number(result.matchingKlaviyoCriteria)}</s-table-cell>
                </s-table-row>
                {result.keptActive.map((row) => (
                  <s-table-row key={row.label}>
                    <s-table-cell>Kept active: {row.label.charAt(0).toLowerCase() + row.label.slice(1)}</s-table-cell>
                    <s-table-cell>{number(row.count)}</s-table-cell>
                  </s-table-row>
                ))}
                <s-table-row>
                  <s-table-cell>
                    <s-text type="strong">Would be suppressed by a cleanup</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text type="strong">{number(result.candidates)}</s-text>
                  </s-table-cell>
                </s-table-row>
              </s-table-body>
            </s-table>
            {result.keptActive.length > 1 ? (
              <s-paragraph>A profile can be kept active for more than one reason, so those rows can overlap.</s-paragraph>
            ) : null}
            {result.candidates === 0 && !result.note ? (
              <s-paragraph>
                Your list is already clean. No profiles match the cleanup criteria, so there is nothing to suppress
                and nothing to charge.
              </s-paragraph>
            ) : null}
            {result.candidates > 0 ? (
              <s-button variant="primary" href="/app/simulation">
                Review the {number(result.candidates)} profiles and approve
              </s-button>
            ) : null}
            <s-paragraph>
              {result.price
                ? `TierSaver costs ${result.price} per month for a list of this size, charged only in a month when a cleanup suppresses profiles. The audit is free.`
                : "For lists above 150,000 active profiles the price is agreed with you first. Nothing is charged automatically."}
            </s-paragraph>
            <s-paragraph>
              Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, you can
              move to a lower plan in Klaviyo's billing settings. Your Klaviyo plan does not change automatically
              unless you enabled auto-downgrade in Klaviyo.
            </s-paragraph>
          </s-stack>
        ) : null}

        <Form method="post">
          <input type="hidden" name="intent" value="scan" />
          <s-button type="submit" variant={result ? "secondary" : "primary"} disabled={busy || running}>
            {result ? "Run the audit again" : "Run the free audit"}
          </s-button>
        </Form>
      </s-stack>
    </s-section>
  );
}

export default function Index() {
  const { notice, configured, startUrl, connection, audit } = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";
  const connected = connection?.status === "connected";

  return (
    <s-page heading="TierSaver">
      {notice ? <s-banner tone={NOTICES[notice].tone}>{NOTICES[notice].text}</s-banner> : null}

      {connection && !connected ? (
        <s-banner tone="warning" heading="Reconnect Klaviyo">
          TierSaver's access to Klaviyo account {connection.klaviyoAccountId} has ended or was removed in Klaviyo.
          Cleanups are paused until you connect again.
        </s-banner>
      ) : null}

      {connected && audit ? <Audit audit={audit} busy={busy} /> : null}

      {connected ? (
        <s-section heading="Klaviyo connection">
          <s-stack gap="base">
            <s-paragraph>
              Connected to Klaviyo account <s-text type="strong">{connection.klaviyoAccountId}</s-text> since{" "}
              {new Date(connection.connectedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.
            </s-paragraph>
            <s-paragraph>
              Disconnecting removes TierSaver's access to Klaviyo. Profiles that were already suppressed stay
              suppressed, and nothing is deleted.
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <s-button type="submit" tone="critical" disabled={busy}>
                Disconnect Klaviyo
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Connect Klaviyo">
          <s-stack gap="base">
            <s-paragraph>
              Connect Klaviyo to run your free list audit. TierSaver finds profiles that never engaged, using
              Klaviyo's own recommended criteria, and shows you exactly who would be suppressed.
            </s-paragraph>
            <s-paragraph>
              Nothing changes in your Klaviyo account until you review and approve a simulation. Profiles are
              suppressed, never deleted, and every cleanup can be undone.
            </s-paragraph>
            {startUrl ? (
              <s-button variant="primary" href={startUrl} target="_top">
                Connect Klaviyo
              </s-button>
            ) : null}
            {!configured ? (
              <s-banner tone="info">Connecting to Klaviyo is not available yet.</s-banner>
            ) : null}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
