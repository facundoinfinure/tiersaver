/**
 * The terms a merchant accepts when approving a cleanup. `TERMS_VERSION` is
 * the effective date printed on the published terms; bump it whenever the
 * terms change, so the audit trail says which version each approval accepted.
 */
export const TERMS_VERSION = "2026-11-26";

/** Public site that hosts the terms and the privacy policy. `SITE_URL` overrides it until the domain is live. */
export function legalUrls(env: { SITE_URL?: string }): { terms: string; privacy: string } {
  const base = (env.SITE_URL || "https://tiersaver.com").replace(/\/+$/, "");
  return { terms: `${base}/terms`, privacy: `${base}/privacy` };
}
