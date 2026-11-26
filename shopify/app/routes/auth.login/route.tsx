import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

/**
 * Shopify's library sends the browser here when a request arrives without a shop. With a `shop` parameter
 * `login` redirects to Shopify; without one there is nothing to ask for: the app is opened from the Shopify
 * admin, and never asks anyone to type a shop domain (App Store requirement 2.3.1).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { invalidShop: Boolean(errors.shop) && new URL(request.url).searchParams.has("shop") };
};

export default function Auth() {
  const { invalidShop } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: "32rem", margin: "4rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 500 }}>TierSaver</h1>
      {invalidShop ? <p>That store address is not valid.</p> : null}
      <p>TierSaver runs inside your Shopify admin. To open it, go to Apps in your Shopify admin and choose TierSaver.</p>
    </main>
  );
}
