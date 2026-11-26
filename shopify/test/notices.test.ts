import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dismissedNoticeIds, dismissNotice, noticeArchive, NOTICES, visibleNotices, type AppNotice } from "../app/notices";
import { ensureShop } from "../app/orders/purchases";
import { db, schema, uniqueShop } from "./helpers";

const now = new Date("2027-03-10T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const terms: AppNotice = { id: "t-terms", publishedAt: daysAgo(5), kind: "terms", title: "Our terms change on April 10, 2027", body: "Section 6 changes.", linkLabel: "Read the new terms", linkUrl: "https://tiersaver.com/terms" };
const subprocessor: AppNotice = { id: "t-subprocessor", publishedAt: daysAgo(20), kind: "subprocessor", title: "A new sub-processor", body: "We will start using one more provider." };
const old: AppNotice = { id: "t-old", publishedAt: daysAgo(120), kind: "pricing", title: "Prices changed", body: "An older notice." };
const ancient: AppNotice = { id: "t-ancient", publishedAt: daysAgo(400), kind: "service", title: "Long ago", body: "Out of the list." };
const future: AppNotice = { id: "t-future", publishedAt: daysAgo(-3), kind: "privacy", title: "Not yet", body: "Dated in the future." };
const notices = [future, terms, subprocessor, old, ancient];

async function shopPair() {
  const [a, b] = [uniqueShop(), uniqueShop()];
  await ensureShop(db, a);
  await ensureShop(db, b);
  return { a, b };
}
const ids = (list: { id: string }[]) => list.map((n) => n.id);

describe("in-app notices", () => {
  it("ships with no notices, so nothing is shown until one is published", async () => {
    expect(NOTICES).toEqual([]);
    const { a } = await shopPair();
    expect(await visibleNotices(db, a)).toEqual([]);
    expect(noticeArchive()).toEqual([]);
  });

  it("shows a new notice on Home, newest first, with its date and link", async () => {
    const { a } = await shopPair();
    const shown = await visibleNotices(db, a, { now, notices });
    expect(ids(shown)).toEqual(["t-terms", "t-subprocessor"]);
    expect(shown[0]).toMatchObject({ kind: "terms", title: terms.title, body: terms.body, link: { label: "Read the new terms", url: "https://tiersaver.com/terms" }, publishedAt: daysAgo(5) });
    expect(shown[0]!.publishedOn).toBe("Mar 5, 2027");
    expect(shown[1]!.link).toBeNull();
  });

  it("hides it after dismissal for that shop only; another shop still sees it", async () => {
    const { a, b } = await shopPair();
    expect(await dismissNotice(db, { shop: a, actor: "user:42", noticeId: "t-terms", now, notices })).toBe(true);

    expect(ids(await visibleNotices(db, a, { now, notices }))).toEqual(["t-subprocessor"]);
    expect(ids(await visibleNotices(db, b, { now, notices }))).toEqual(["t-terms", "t-subprocessor"]);
  });

  it("records who dismissed which notice and when, once, in the audit trail", async () => {
    const { a } = await shopPair();
    await dismissNotice(db, { shop: a, actor: "user:42", noticeId: "t-terms", now, notices });
    // A second press (another user, later) keeps the first record.
    await dismissNotice(db, { shop: a, actor: "user:77", noticeId: "t-terms", now: new Date(now.getTime() + 60_000), notices });

    const rows = await db.select().from(schema.eventsLog).where(and(eq(schema.eventsLog.shop, a), eq(schema.eventsLog.action, "notice.dismissed")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shop: a, actor: "user:42", action: "notice.dismissed", detail: { noticeId: "t-terms", kind: "terms", publishedAt: terms.publishedAt } });
    expect(rows[0]!.at.toISOString()).toBe(now.toISOString());
  });

  it("keeps dismissals apart between shops", async () => {
    const { a, b } = await shopPair();
    await dismissNotice(db, { shop: a, actor: "user:1", noticeId: "t-terms", now, notices });
    await dismissNotice(db, { shop: b, actor: "user:2", noticeId: "t-subprocessor", now, notices });

    expect([...(await dismissedNoticeIds(db, a))]).toEqual(["t-terms"]);
    expect([...(await dismissedNoticeIds(db, b))]).toEqual(["t-subprocessor"]);
    expect(ids(await visibleNotices(db, a, { now, notices }))).toEqual(["t-subprocessor"]);
    expect(ids(await visibleNotices(db, b, { now, notices }))).toEqual(["t-terms"]);
    // Both shops can dismiss the same notice: one row each.
    await dismissNotice(db, { shop: b, actor: "user:2", noticeId: "t-terms", now, notices });
    expect([...(await dismissedNoticeIds(db, a))]).toEqual(["t-terms"]);
    expect((await visibleNotices(db, b, { now, notices })).length).toBe(0);
  });

  it("does not record an id that is not in the list", async () => {
    const { a } = await shopPair();
    expect(await dismissNotice(db, { shop: a, actor: "user:1", noticeId: "made-up", now, notices })).toBe(false);
    expect(await dismissNotice(db, { shop: a, actor: "user:1", noticeId: "", now, notices })).toBe(false);
    expect((await dismissedNoticeIds(db, a)).size).toBe(0);
  });

  it("stops showing a notice on Home after 90 days but lists it in Settings for 12 months", async () => {
    const { a } = await shopPair();
    expect(ids(await visibleNotices(db, a, { now, notices }))).not.toContain("t-old");
    expect(ids(noticeArchive({ now, notices }))).toEqual(["t-terms", "t-subprocessor", "t-old"]);
    // The boundary: day 89 is shown, day 90 is not.
    const edge = (days: number): AppNotice[] => [{ ...old, id: "t-edge", publishedAt: daysAgo(days) }];
    expect(ids(await visibleNotices(db, a, { now, notices: edge(89) }))).toEqual(["t-edge"]);
    expect(ids(await visibleNotices(db, a, { now, notices: edge(90) }))).toEqual([]);
  });

  it("lists a dismissed notice in Settings, so it can be found again", async () => {
    const { a } = await shopPair();
    await dismissNotice(db, { shop: a, actor: "user:1", noticeId: "t-terms", now, notices });
    expect(ids(noticeArchive({ now, notices }))).toContain("t-terms");
  });

  it("hides a notice dated in the future until its day", async () => {
    const { a } = await shopPair();
    expect(ids(await visibleNotices(db, a, { now, notices }))).not.toContain("t-future");
    expect(ids(noticeArchive({ now, notices }))).not.toContain("t-future");
    const later = new Date(now.getTime() + 4 * 86_400_000);
    expect(ids(await visibleNotices(db, a, { now: later, notices }))[0]).toBe("t-future");
  });

  it("keeps terms and pricing notices on the review screen until dismissed, and no other kind", async () => {
    const { a } = await shopPair();
    const recentPricing: AppNotice = { ...old, id: "t-pricing", publishedAt: daysAgo(1) };
    const list = [recentPricing, ...notices];
    expect(ids(await visibleNotices(db, a, { now, notices: list, screen: "review" }))).toEqual(["t-pricing", "t-terms"]);
    await dismissNotice(db, { shop: a, actor: "user:1", noticeId: "t-terms", now, notices: list });
    expect(ids(await visibleNotices(db, a, { now, notices: list, screen: "review" }))).toEqual(["t-pricing"]);
  });

  it("never fails a page: if the dismissals cannot be read, the notices are shown instead of throwing", async () => {
    const broken = { select: () => { throw new Error("d1 is down"); } } as unknown as typeof db;
    expect(ids(await visibleNotices(broken, "any.myshopify.com", { now, notices }))).toEqual(["t-terms", "t-subprocessor"]);
  });
});
