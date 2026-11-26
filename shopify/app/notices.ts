import { and, eq, like } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { formatCalendarDay } from "./settings/timezone";

/**
 * Notices shown inside the app. The terms, the privacy policy and the DPA promise "a notice in the app" before
 * a change to the terms, the prices or the sub-processors; this list is that notice.
 *
 * HOW TO PUBLISH A NOTICE (a code change and a deploy; see docs/17-POLITICAS-INTERNAS.md, section 9)
 * 1. Add an entry at the TOP of `NOTICES` (newest first) with a new `id` that is never reused or renamed:
 *    a dismissal is recorded against the id, so changing it shows the notice again to everyone.
 * 2. `publishedAt` is the day the deploy goes out (UTC calendar date). An entry dated in the future stays
 *    hidden until that day.
 * 3. Deploy the app. From then on:
 *    - Home shows it as a banner for 90 days to every shop that has not pressed "Got it";
 *    - a notice of kind "terms" or "pricing" is also shown on the cleanup review screen until dismissed;
 *    - Settings lists it under "Notices" for 12 months, dismissed or not.
 * 4. Do not edit or remove an entry while it is inside those 12 months. The legal texts promise 30 days of
 *    notice: the change it announces must not take effect before `publishedAt` + 30 days.
 *
 * `title` and `body` are plain text in English, read by merchants. No personal data, no figures that are not
 * in the published terms or prices. Notices never block the app.
 */

export type NoticeKind = "terms" | "privacy" | "subprocessor" | "pricing" | "service";

export interface AppNotice {
  /** Stable and unique, for example "2027-02-terms". Letters, digits, dots and dashes only. */
  id: string;
  /** ISO calendar date (UTC), "2027-02-01". */
  publishedAt: string;
  kind: NoticeKind;
  title: string;
  /** Plain text. */
  body: string;
  linkLabel?: string;
  linkUrl?: string;
}

export const NOTICES: readonly AppNotice[] = [
  // Example (newest first):
  // {
  //   id: "2027-02-terms",
  //   publishedAt: "2027-02-01",
  //   kind: "terms",
  //   title: "Our terms change on March 3, 2027",
  //   body: "Section 6 now describes how plan changes are prorated. Nothing changes for your current plan before that date.",
  //   linkLabel: "Read the new terms",
  //   linkUrl: "https://tiersaver.com/terms",
  // },
];

/** Home shows a notice for this long; after that it is only in the Settings list. */
export const NOTICE_BANNER_DAYS = 90;
/** Settings lists the notices published in this many days (12 months). */
export const NOTICE_ARCHIVE_DAYS = 365;
/** Kinds that also stay on the cleanup review screen until dismissed: the merchant accepts terms and a price there. */
const REVIEW_KINDS: readonly NoticeKind[] = ["terms", "pricing"];

export const NOTICE_DISMISSED = "notice.dismissed";
const DAY_MS = 86_400_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/;

type Db = DrizzleD1Database<typeof schema>;

/** A notice as a screen renders it. The date is formatted here, like every date in the app. */
export interface NoticeView {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  link: { label: string; url: string } | null;
  /** "Feb 1, 2027": a calendar date, the same in every time zone. */
  publishedOn: string;
  publishedAt: string;
}

const publishedMs = (notice: AppNotice) => Date.parse(`${notice.publishedAt.slice(0, 10)}T00:00:00Z`);

function toView(notice: AppNotice): NoticeView {
  return {
    id: notice.id,
    kind: notice.kind,
    title: notice.title,
    body: notice.body,
    link: notice.linkUrl ? { label: notice.linkLabel || "Read more", url: notice.linkUrl } : null,
    publishedOn: formatCalendarDay(notice.publishedAt),
    publishedAt: notice.publishedAt.slice(0, 10),
  };
}

/** Notices already published and not older than `days`, newest first. An entry with a bad id or date is left out. */
function publishedWithin(notices: readonly AppNotice[], now: Date, days: number): AppNotice[] {
  return notices
    .filter((n) => {
      const at = publishedMs(n);
      return ID_PATTERN.test(n.id) && Number.isFinite(at) && at <= now.getTime() && now.getTime() - at < days * DAY_MS;
    })
    .sort((a, b) => publishedMs(b) - publishedMs(a));
}

/** The event id of a shop's dismissal of a notice: one row per shop and notice, so the first dismissal is the one kept. */
const dismissalId = (shop: string, noticeId: string) => `notice:${noticeId}:dismissed:${shop}`;

/** Ids of the notices this shop has dismissed. Always filtered by shop. */
export async function dismissedNoticeIds(db: Db, shop: string): Promise<Set<string>> {
  const rows = await db
    .select({ detail: schema.eventsLog.detail })
    .from(schema.eventsLog)
    .where(and(eq(schema.eventsLog.shop, shop), eq(schema.eventsLog.action, NOTICE_DISMISSED), like(schema.eventsLog.id, "notice:%")));
  const ids = new Set<string>();
  for (const row of rows) {
    const id = (row.detail as { noticeId?: unknown } | null)?.noticeId;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * The banners to show: notices of the last 90 days this shop has not dismissed, newest first.
 * `screen: "review"` keeps only the kinds that belong on the cleanup review screen.
 * Never throws: a notice must not be the reason a page fails to load. If the dismissals cannot be read, the
 * notices are shown: showing one twice is better than not showing it.
 */
export async function visibleNotices(
  db: Db,
  shop: string,
  opts: { screen?: "home" | "review"; now?: Date; notices?: readonly AppNotice[] } = {},
): Promise<NoticeView[]> {
  const recent = publishedWithin(opts.notices ?? NOTICES, opts.now ?? new Date(), NOTICE_BANNER_DAYS).filter(
    (n) => opts.screen !== "review" || REVIEW_KINDS.includes(n.kind),
  );
  if (recent.length === 0) return [];
  try {
    const dismissed = await dismissedNoticeIds(db, shop);
    return recent.filter((n) => !dismissed.has(n.id)).map(toView);
  } catch {
    return recent.map(toView);
  }
}

/** Every notice of the last 12 months, dismissed or not, newest first: the list at the bottom of Settings. */
export function noticeArchive(opts: { now?: Date; notices?: readonly AppNotice[] } = {}): NoticeView[] {
  return publishedWithin(opts.notices ?? NOTICES, opts.now ?? new Date(), NOTICE_ARCHIVE_DAYS).map(toView);
}

/**
 * Records that this shop dismissed a notice: who and when, in the audit trail. Only an id from the list is
 * recorded; dismissing twice keeps the first record. Returns whether the notice exists.
 */
export async function dismissNotice(
  db: Db,
  args: { shop: string; actor: string; noticeId: string; now?: Date; notices?: readonly AppNotice[] },
): Promise<boolean> {
  const notice = (args.notices ?? NOTICES).find((n) => n.id === args.noticeId && ID_PATTERN.test(n.id));
  if (!notice) return false;
  await db
    .insert(schema.eventsLog)
    .values({
      id: dismissalId(args.shop, notice.id),
      shop: args.shop,
      at: args.now ?? new Date(),
      actor: args.actor,
      action: NOTICE_DISMISSED,
      detail: { noticeId: notice.id, kind: notice.kind, publishedAt: notice.publishedAt },
    })
    .onConflictDoNothing();
  return true;
}
