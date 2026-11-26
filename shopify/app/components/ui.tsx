import { useEffect, type ReactNode } from "react";
import type { Stamp } from "../settings/timezone";

/** Small pieces shared by the app's screens. No loaders, no router. */

/** A date the server already formatted in the shop's time zone (see app/settings/timezone.ts). */
export function Time({ at }: { at: Stamp }) {
  return <time dateTime={at.iso}>{at.text}</time>;
}

export const number = (n: number) => n.toLocaleString("en-US");

/** A label with its figure on the right. The figure keeps its column on narrow screens instead of wrapping under the label. */
export function Row({ label, value, strong, indent }: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean }) {
  return (
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="start">
      <div style={indent ? { paddingInlineStart: "1rem" } : undefined}>
        {strong ? <s-text type="strong">{label}</s-text> : <s-text color="subdued">{label}</s-text>}
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "end" }}>{strong ? <s-text type="strong">{value}</s-text> : <s-text>{value}</s-text>}</span>
    </s-grid>
  );
}

/**
 * After a submit that was refused, brings the problem to where the merchant is:
 * the first element marked `data-error-focus` is scrolled into view and, when
 * it can take it, focused. `token` is the action result; a new result runs it again.
 */
export function useRevealError(token: unknown, active: boolean) {
  useEffect(() => {
    if (!active) return;
    // After the router has settled its own scrolling for the submission, and the Polaris fields have rendered their errors.
    const timer = setTimeout(() => {
      const target = document.querySelector<HTMLElement>("[data-error-focus]");
      if (!target) return;
      try {
        target.focus({ preventScroll: true });
      } catch {
        // Not focusable: being in view is enough.
      }
      // Polaris form elements are `display: contents`: they have no box of their own to scroll to, their rendered content does.
      const hasBox = (el: Element | null | undefined): boolean => Boolean(el && el.getClientRects().length > 0);
      const box: Element | null = hasBox(target) ? target : ([...(target.shadowRoot?.querySelectorAll("*") ?? [])].find(hasBox) ?? target.parentElement);
      box?.scrollIntoView({ block: "center", behavior: "auto" });
    }, 120);
    return () => clearTimeout(timer);
  }, [token, active]);
}

/** Marks an element as the place `useRevealError` goes to. */
export const errorFocus = (on: boolean) => (on ? { "data-error-focus": "" } : {});

/**
 * Downloads a file from an authenticated route of the app. A plain link would
 * not carry the session token: App Bridge adds it to same-origin `fetch` calls.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("download failed");
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
