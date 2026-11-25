import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";
import { startKlaviyoAuthorization } from "../klaviyo/flow.server";

// Top-level navigation from the embedded app's "Connect Klaviyo" button.
// Not authenticated by Shopify: see app/klaviyo/flow.server.ts.
export const loader = ({ request }: LoaderFunctionArgs) => startKlaviyoAuthorization(request, env);
