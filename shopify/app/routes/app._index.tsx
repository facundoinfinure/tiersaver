import { env } from "cloudflare:workers";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { logEvent, sessionActor } from "../data/events-log";
import { disconnect, getConnection } from "../klaviyo/connection.server";
import { klaviyoStartUrl } from "../klaviyo/flow.server";
import { ensureShop } from "../orders/purchases";
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
  if (form.get("intent") !== "disconnect") return new Response(null, { status: 400 });

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

export default function Index() {
  const { notice, configured, startUrl, connection } = useLoaderData<typeof loader>();
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
