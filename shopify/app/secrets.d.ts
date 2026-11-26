// Secrets set with `wrangler secret put` (prod) or .dev.vars (local).
// `wrangler types` only knows about `vars`, so secrets are declared here.
interface TierSaverSecrets {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  /** Secret the per-store email hash keys are derived from (app/email-hash.ts). At least 32 random bytes, base64. */
  HASH_PEPPER: string;
  /** Klaviyo OAuth app credentials (app created at klaviyo.com/manage-apps). */
  KLAVIYO_CLIENT_ID: string;
  KLAVIYO_CLIENT_SECRET: string;
  /**
   * Safety switch, a plain variable rather than a secret. Runs can change a
   * merchant's Klaviyo account only when this is exactly "true". It is not
   * set anywhere by default: see app/runs/gateway.server.ts.
   */
  SUPPRESSION_ENABLED?: string;
  /** Optional: restricts SUPPRESSION_ENABLED to shops connected to this one Klaviyo account. See app/runs/gateway.server.ts. */
  SUPPRESSION_ALLOWED_ACCOUNT_ID?: string;
  /** Plain variable in wrangler.jsonc: id of the seeded Klaviyo test account. See app/scans/engine.ts. */
  KLAVIYO_SEEDED_ACCOUNT_ID?: string;
  /** Plain variable: base URL of the public site (terms, privacy). Defaults to https://tiersaver.com. */
  SITE_URL?: string;
}

declare namespace Cloudflare {
  interface Env extends TierSaverSecrets {}
}

// The generated global `Env` (type of `this.env` in Workflows and of the fetch
// handler's `env`) is built from wrangler.jsonc alone; it needs the secrets too.
interface Env extends TierSaverSecrets {}
