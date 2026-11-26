import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "../db.server";
import { startKlaviyoAuthorization } from "../klaviyo/flow.server";
import { isShopExcluded } from "../markets";

// Top-level navigation from the embedded app's "Connect Klaviyo" button.
// Not authenticated by Shopify: see app/klaviyo/flow.server.ts. The shop comes from the signed ticket;
// a store TierSaver is not offered to (app/markets.ts) is stopped here, before Klaviyo.
export const loader = ({ request }: LoaderFunctionArgs) => startKlaviyoAuthorization(request, env, new Date(), (shop) => isShopExcluded(db, shop));
