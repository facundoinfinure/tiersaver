import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";
import { handleKlaviyoCallback } from "../klaviyo/flow.server";

// Klaviyo's redirect URI (KLAVIYO_OAUTH_CALLBACK_PATH). Hands the code over to
// the embedded app; nothing is stored here. See app/klaviyo/flow.server.ts.
export const loader = ({ request }: LoaderFunctionArgs) => handleKlaviyoCallback(request, env);
