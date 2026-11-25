// Secrets set with `wrangler secret put` (prod) or .dev.vars (local).
// `wrangler types` only knows about `vars`, so secrets are declared here.
declare namespace Cloudflare {
  interface Env {
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_APP_URL: string;
    TOKEN_ENCRYPTION_KEY: string;
  }
}
