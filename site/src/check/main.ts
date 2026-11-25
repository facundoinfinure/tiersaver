/**
 * Page script for the list health check. Bundled by build/build.mjs into
 * assets/list-check.js. The page shows a worked example without this script;
 * this only makes the form live. It makes no network requests.
 */
import {
  check,
  criteriaCount,
  describe,
  formatCount,
  parseCount,
  parsePercent,
  type CheckView,
  type CriteriaUnit,
  type KlaviyoPlan,
} from "./check.js";

const PLANS: readonly KlaviyoPlan[] = ["email", "marketing", "free"];

function setText(root: Element, name: string, text: string): void {
  for (const el of root.querySelectorAll(`[data-out="${name}"]`)) el.textContent = text;
}

function render(root: HTMLElement, view: CheckView): void {
  root.dataset.status = view.valid ? "ok" : "invalid";
  setText(root, "figure", view.figure);
  setText(root, "message", view.message);
  setText(root, "staying", view.staying);
  setText(root, "leaving", view.leaving);
  setText(root, "tiersaver-price", view.tierSaverPrice);
  setText(root, "tiersaver-plan", view.tierSaverPlan);
  setText(root, "klaviyo-before", view.klaviyoBefore);
  setText(root, "klaviyo-after", view.klaviyoAfter);
  // The bar is an SVG rect sized by attribute, so no inline style is needed (CSP).
  const bar = root.querySelector("[data-bar]");
  if (bar) bar.setAttribute("width", `${view.keptPercent}%`);
}

function init(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("form");
  const fields = root.querySelector<HTMLFieldSetElement>("[data-fields]");
  const active = root.querySelector<HTMLInputElement>('[name="active"]');
  const criteria = root.querySelector<HTMLInputElement>('[name="criteria"]');
  if (!form || !fields || !active || !criteria) return;

  const currentUnit = (): CriteriaUnit => (new FormData(form).get("unit") === "percent" ? "percent" : "profiles");

  const update = (): void => {
    const unit = currentUnit();
    const planValue = String(new FormData(form).get("plan") ?? "email");
    const plan: KlaviyoPlan = (PLANS as readonly string[]).includes(planValue) ? (planValue as KlaviyoPlan) : "email";
    const activeProfiles = parseCount(active.value);
    const value = unit === "percent" ? parsePercent(criteria.value) : parseCount(criteria.value);

    active.setAttribute("aria-invalid", String(!Number.isFinite(activeProfiles)));
    criteria.setAttribute("aria-invalid", String(!Number.isFinite(value) || (unit === "percent" && value > 100)));

    render(root, describe(check({ activeProfiles, meetingCriteria: value, unit, plan })));
  };

  // Switching between a count and a percentage keeps the same quantity.
  let lastUnit = currentUnit();
  const convertUnit = (): void => {
    const unit = currentUnit();
    if (unit === lastUnit) return;
    const activeProfiles = parseCount(active.value);
    if (Number.isFinite(activeProfiles) && activeProfiles > 0) {
      if (unit === "percent") {
        const count = parseCount(criteria.value);
        if (Number.isFinite(count)) {
          criteria.value = String(Math.min(100, Math.round((count / activeProfiles) * 1000) / 10));
        }
      } else {
        const percent = parsePercent(criteria.value);
        if (Number.isFinite(percent) && percent <= 100) {
          criteria.value = formatCount(criteriaCount(activeProfiles, percent, "percent"));
        }
      }
    }
    lastUnit = unit;
  };

  fields.disabled = false;
  form.addEventListener("input", update);
  form.addEventListener("change", () => {
    convertUnit();
    update();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    update();
  });
  update();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-list-check]")) init(root);
