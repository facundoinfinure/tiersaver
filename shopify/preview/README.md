# Local preview of the whole app (never deployed)

Runs the real routes, Workflows and D1 migrations locally, with two things simulated:

- **Shopify**: `app/shopify.server.ts` is replaced (Vite alias, this config only) by `shopify.server.stub.ts`. Every request is "authenticated" as one fake shop. Billing answers come from memory.
- **Klaviyo**: the global `fetch` is patched inside the preview Worker so that `*.klaviyo.com` goes to the in-memory `FakeKlaviyo` used by the tests, seeded with a sample list.

Nothing here reaches Shopify or Klaviyo, and none of it is part of the production build
(`wrangler.jsonc`, `vite.config.ts` and `workers/app.ts` do not reference this folder).

    npm run preview:app            # from shopify/: migrations on a local D1, then http://localhost:3210/app
    node preview/walk.mjs <dir>    # drives the app in headless Chromium and saves a screenshot per step

The preview server rewrites the two redirects that would leave localhost (Klaviyo's consent screen and the
Shopify admin URL of the embedded app), so a normal browser works too. `walk.mjs` additionally replaces
App Bridge's script with an empty one and blocks any request to klaviyo.com or shopify.com.

Helpers of the preview server (all under `/__preview/`, see `worker.ts`): `reset`, `orders`, `state`,
`klaviyo?delay=400` (slow Klaviyo, so a cleanup stays in progress), `klaviyo?rejectJobsAfter=5` (a cleanup that
stops early; `0`: one that does not run), `klaviyo?reset=1`, `age?run=<id>&hours=80` (a cleanup past its restore
window; with `&renewed=1` and 800 hours, past a Klaviyo plan renewal) and `unknown?run=<id>` (a batch whose result is unknown).

The fake Klaviyo applies a bulk job 3 seconds after accepting it, and every time it reports (job `created_at`
and `completed_at`, a profile's suppression `timestamp`) comes from one clock. Restoring right after a cleanup
answers "Klaviyo is still applying this cleanup" until then, like the real service does for 15 to 25 seconds.
