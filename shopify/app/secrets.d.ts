// Secrets set with `wrangler secret put` (prod) or .dev.vars (local).
// `wrangler types` only knows about `vars`, so secrets are declared here.
interface TierSaverSecrets {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  /** Klaviyo OAuth app credentials (app created at klaviyo.com/manage-apps). */
  KLAVIYO_CLIENT_ID: string;
  KLAVIYO_CLIENT_SECRET: string;
  /**
   * Safety switch, a plain variable rather than a secret. Runs can change a
   * merchant's Klaviyo account only when this is exactly "true". It is not
   * set anywhere by default: see app/runs/gateway.server.ts.
   */
  SUPPRESSION_ENABLED?: string;
  /** Plain variable in wrangler.jsonc: id of the seeded Klaviyo test account. See app/scans/engine.ts. */
  KLAVIYO_SEEDED_ACCOUNT_ID?: string;
}

declare namespace Cloudflare {
  interface Env extends TierSaverSecrets {}
}

// The generated global `Env` (type of `this.env` in Workflows and of the fetch
// handler's `env`) is built from wrangler.jsonc alone; it needs the secrets too.
interface Env extends TierSaverSecrets {}
