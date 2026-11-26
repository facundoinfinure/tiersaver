import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Any /app/... address that is not a page. Without this route the request matches nothing and the 404
// is rendered outside the app; with it, the app layout's ErrorBoundary shows "Page not found" in the app frame.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  throw new Response(null, { status: 404, statusText: "Not Found" });
};

export default function NotFound() {
  return null;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
