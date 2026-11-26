import type { ReactNode } from "react";
import type { NoticeView } from "../notices";
import { flags } from "./home-screen";

/**
 * Notices from app/notices.ts, as pure components: no loaders, no router.
 * The route passes the dismiss form in, like the home screen's `renderForm`.
 */

/** One informational banner per notice, each with its "Got it" button. They inform; they never block anything. */
export function NoticeBanners({
  notices,
  busy,
  renderDismiss,
}: {
  notices: NoticeView[];
  busy: boolean;
  /** Wraps the button in the form that records the dismissal of that notice. */
  renderDismiss: (noticeId: string, button: ReactNode) => ReactNode;
}) {
  return (
    <>
      {notices.map((notice) => (
        <s-banner key={notice.id} tone="info" heading={notice.title}>
          <s-stack gap="small">
            <s-text>{notice.body}</s-text>
            <s-text color="subdued">Posted {notice.publishedOn}. You can find this notice again in Settings.</s-text>
            <s-stack direction="inline" gap="base" alignItems="center">
              {renderDismiss(
                notice.id,
                <s-button type="submit" accessibilityLabel={`Got it: ${notice.title}`} {...flags({ disabled: busy })}>
                  Got it
                </s-button>,
              )}
              {notice.link ? (
                <s-link href={notice.link.url} target="_blank">
                  {notice.link.label}
                </s-link>
              ) : null}
            </s-stack>
          </s-stack>
        </s-banner>
      ))}
    </>
  );
}

/** Every notice of the last 12 months with its date, at the bottom of Settings, so a dismissed one can be found again. */
export function NoticeList({ notices }: { notices: NoticeView[] }) {
  return (
    <s-section heading="Notices">
      <s-stack gap="base">
        <s-paragraph>Changes to the terms, the privacy policy, our sub-processors, prices or the service are announced here. Notices from the last 12 months are listed.</s-paragraph>
        {notices.length === 0 ? <s-text color="subdued">There are no notices.</s-text> : null}
        {notices.map((notice) => (
          <s-box key={notice.id} padding="base" border="base" borderRadius="base">
            <s-stack gap="small-300">
              <s-text type="strong">{notice.title}</s-text>
              <s-text color="subdued">
                Posted <time dateTime={notice.publishedAt}>{notice.publishedOn}</time>
              </s-text>
              <s-text>{notice.body}</s-text>
              {notice.link ? (
                <s-link href={notice.link.url} target="_blank">
                  {notice.link.label}
                </s-link>
              ) : null}
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}
