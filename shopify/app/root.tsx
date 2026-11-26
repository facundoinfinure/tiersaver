import type { ReactNode } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Last resort, outside the embedded app: an address that is not part of the app, or an error the app
 * layout could not show itself. Errors of the app's own pages are handled in routes/app.tsx.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main style={{ fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif", maxWidth: "32rem", margin: "15vh auto 0", padding: "0 1.25rem", color: "#303030", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 650 }}>{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p>
        {notFound
          ? "This page does not exist or is no longer available."
          : "This page could not be loaded. Nothing was changed in Klaviyo. Reload the page, or open TierSaver again from your Shopify admin."}
      </p>
      <p>
        <a href="/app" style={{ color: "#005bd3" }}>
          Go to home
        </a>
      </p>
    </main>
  );
}
