import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError, useRouteLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { env } from "cloudflare:workers";
import { db } from "../db.server";
import { legalUrls } from "../legal";
import { rememberShopTimeZone } from "../settings/timezone";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // Dates are shown in the shop's time zone; it is read from Shopify once and kept.
  await rememberShopTimeZone(db, session.shop, (query) => admin.graphql(query));

  const legal = legalUrls(env);
  return { apiKey: env.SHOPIFY_API_KEY || "", support: legal.support, supportEmail: legal.supportEmail };
};

function Nav() {
  return (
    <s-app-nav>
      <s-link href="/app">Home</s-link>
      <s-link href="/app/simulation">Review cleanup</s-link>
      <s-link href="/app/runs">History</s-link>
      <s-link href="/app/settings">Settings</s-link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <Nav />
      <Outlet />
    </AppProvider>
  );
}

/**
 * Errors of every page of the app end here, inside the app frame: a missing
 * page (404) and anything unexpected get a page with the navigation and a way
 * back. Shopify's own thrown responses (the re-authentication pages, which
 * carry headers and an HTML body) are still handed to `boundary.error`.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const shell = useRouteLoaderData<typeof loader>("routes/app");
  const response = isRouteErrorResponse(error) ? error : null;
  const notFound = response?.status === 404;
  const unexpected = !response || response.status >= 500;

  // Without the layout's data there is no app frame to render in (the layout loader itself failed).
  if (!shell || (!notFound && !unexpected)) return boundary.error(error);

  return (
    <AppProvider apiKey={shell.apiKey}>
      <Nav />
      {notFound ? (
        <s-page heading="Page not found">
          <s-section heading="This page does not exist or is no longer available">
            <s-stack gap="base">
              <s-paragraph>The link may be old, or the cleanup it pointed to may have been removed. Nothing was changed in Klaviyo.</s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button href="/app" variant="primary">
                  Go to home
                </s-button>
                <s-button href="/app/runs">History</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </s-page>
      ) : (
        <s-page heading="Something went wrong">
          <s-section heading="This page could not be loaded">
            <s-stack gap="base">
              <s-paragraph>
                Nothing was changed in Klaviyo. Reload the page. If it keeps happening, write to{" "}
                <s-link href={shell.support} target="_blank">
                  {shell.supportEmail}
                </s-link>
                .
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" onClick={() => window.location.reload()}>
                  Reload
                </s-button>
                <s-button href="/app">Go to home</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </s-page>
      )}
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
