/**
 * The terms a merchant accepts when approving a cleanup. `TERMS_VERSION` is
 * the effective date printed on the published terms; bump it whenever the
 * terms change, so the audit trail says which version each approval accepted.
 */
// 2026-11-27: the pricing terms changed (monthly plan by list size that starts with the first cleanup, instead of
// one charge per cleanup). The published terms must carry this date and describe that model.
export const TERMS_VERSION = "2026-11-27";

/** Where merchants write for help with the app, and to agree a price above the public tiers. */
export const SUPPORT_EMAIL = "support@tiersaver.com";
export const SALES_EMAIL = "hello@tiersaver.com";

/**
 * Help-centre articles the app links to. Each one is a page under `site/src/pages/help/`;
 * link only to a file that exists there.
 */
const HELP_ARTICLES = {
  whatSuppressMeans: "what-suppress-means",
  simulationAndApproval: "simulation-and-approval",
  undo: "undo",
  pricing: "pricing",
  schedule: "monthly-schedule-and-your-klaviyo-plan",
  criteria: "cleanup-criteria",
  audit: "how-the-audit-works",
  dataAndPrivacy: "data-and-privacy",
  uninstalling: "uninstalling",
  gettingStarted: "getting-started",
  afterACleanup: "after-a-cleanup",
  billing: "billing",
  troubleshooting: "troubleshooting",
  contact: "contact",
} as const;

export type HelpArticle = keyof typeof HELP_ARTICLES;

export interface LegalUrls {
  terms: string;
  privacy: string;
  /** Help-centre home. */
  help: string;
  articles: Record<HelpArticle, string>;
  /** `mailto:` links. The app itself sends no email. */
  support: string;
  sales: string;
  supportEmail: string;
  salesEmail: string;
}

/** Public site that hosts the terms, the privacy policy and the help centre. `SITE_URL` overrides it until the domain is live. */
export function legalUrls(env: { SITE_URL?: string }): LegalUrls {
  const base = (env.SITE_URL || "https://tiersaver.com").replace(/\/+$/, "");
  const articles = Object.fromEntries(Object.entries(HELP_ARTICLES).map(([key, slug]) => [key, `${base}/help/${slug}`])) as Record<HelpArticle, string>;
  return {
    terms: `${base}/terms`,
    privacy: `${base}/privacy`,
    help: `${base}/help/`,
    articles,
    support: `mailto:${SUPPORT_EMAIL}`,
    sales: `mailto:${SALES_EMAIL}`,
    supportEmail: SUPPORT_EMAIL,
    salesEmail: SALES_EMAIL,
  };
}
