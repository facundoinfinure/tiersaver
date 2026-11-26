# Founder story · Indie Hackers (y variantes para Reddit y LinkedIn)

> DRAFT. Nothing is posted by a Claude session. Facundo rewrites it in his own words and posts from his own account, in his own name.

- Status: to-review
- Fase: **solo 2**. Es un post de tipo "I built": no va antes de que Shopify apruebe la app. La variante 3 pide probar la auditoría, que en fase 1 no se puede cumplir.
- Dónde: Indie Hackers (post largo). Variante 2 para r/SaaS, r/indiehackers o r/EntrepreneurRideAlong, **solo** si las reglas del día lo permiten (ver `../../communities.md`: las tres están "sin verificar"). Variante 3 para LinkedIn.
- Todo lo que dice salió de decisiones registradas en el repo (`docs/00-HANDOVER.md`, `docs/12-CUMPLIMIENTO-KLAVIYO.md`, `CLAUDE.md`). No hay cifras de usuarios, ingresos ni resultados porque no existen. Si Facundo agrega una anécdota, que sea suya y verdadera.
- No se nombra ninguna otra marca del dueño. No se nombran las apps comparables.
- Facundo tiene que confirmar los corchetes: son datos personales que la sesión no conoce y no inventa.

## Variante 1 · Indie Hackers

<!-- PUBLIC TEXT START -->

**Title:** I built a Shopify app that touches other people's customer lists. Here is what I changed before launch.

I'm Facundo. I built TierSaver, a Shopify app that keeps a store's Klaviyo list clean: it suppresses the profiles that never engaged. It has zero users today. I'm writing this before launch because the decisions I made on the way seem more useful than a launch post.

**The problem.** Klaviyo counts as active any profile it can email, including people who typed an email at checkout and never opted in. Klaviyo's help center publishes criteria for suppressing the ones that never engaged, and the steps to do it by hand. Most small stores never get to it, because it is a monthly chore with a real risk: suppress the wrong people and you stop emailing buyers.

**What I decided, and why.**

1. Suppress, never delete. Deleting cannot be undone in Klaviyo. A suppression can be removed. So the app only suppresses.
2. Nothing happens without a simulation the merchant approves. The first run is always manual.
3. Every profile is checked against Shopify orders. Klaviyo's criteria rely on the activity Klaviyo recorded. The store's order history is an independent check, and it is the step people skip when they do this by hand.
4. Conservative defaults. Klaviyo has two help articles with two profile ages, 180 days in one and 365 in the other. I took 365. When data is missing, the profile stays active.
5. I removed a number I could not source. An earlier version of the site said how long Klaviyo takes to update its count. The figure came from an agency blog, not from Klaviyo. Klaviyo gives no fixed time, so now the site says that.
6. I dropped a feature. The first scope reactivated profiles automatically when they bought again. A tool that suppresses and reactivates in a loop is not list hygiene, so it is gone.
7. Flat price, and nothing about it depends on the merchant's Klaviyo invoice. $9 a month up to 10,000 active profiles, $19 up to 25,000, $39 up to 75,000, $79 up to 150,000, renewing every 30 days until cancelled. Free until the first cleanup: the audit and the simulation need no plan.
8. Minimum data. The database holds profile IDs and keyed hashes, not email addresses in clear.

**The stack,** for those who ask: Shopify's app template (React Router) on Cloudflare Workers, D1 with Drizzle, Workflows for the suppression runs, Cron Triggers for the schedule.

**What I don't know yet.** Whether agencies or merchants are the right first users. Whether "list hygiene" is a phrase merchants search for. Whether people trust an app with a list they spent years building, even with a simulation and a Restore button.

If you have built something that edits a customer's data in a third-party system, I would like to hear how you earned that trust.

TierSaver is not affiliated with or endorsed by Klaviyo.

<!-- PUBLIC TEXT END -->

## Variante 2 · Reddit (r/SaaS, r/indiehackers, r/EntrepreneurRideAlong) — texto, sin enlace

<!-- PUBLIC TEXT START -->

**Title:** Pre-launch, zero users: 5 things I changed in an app that edits someone else's customer list

I built a Shopify app that suppresses never-engaged profiles in a store's Klaviyo account. No users yet. Sharing the decisions, because I would have liked to read them six months ago.

1. Reversible only. Klaviyo lets you delete or suppress. Delete cannot be undone, so the app only suppresses.
2. Simulate first. Nothing runs until the merchant approves a simulation that shows how many profiles and why.
3. Cross-check with a second source. Every candidate is checked against the store's Shopify orders, so a buyer is never touched.
4. Cut what I could not source. I had a figure on the site that came from an agency blog. The platform's own documentation gives no such figure. It is gone.
5. Flat monthly price by list size, free until the first cleanup. I did not want my price to depend on anything in the merchant's invoice from another company.

Question for people further along: when your product writes to a customer's account in another platform, what convinced your first ten users to click approve?

(I'm the founder. The app is called TierSaver; not linking it.)

<!-- PUBLIC TEXT END -->

## Variante 3 · LinkedIn (post personal de Facundo)

<!-- PUBLIC TEXT START -->

I spent the last weeks building a small Shopify app, and most of the work was deciding what it must never do.

TierSaver keeps a store's Klaviyo list clean. It suppresses profiles that never engaged, following the criteria Klaviyo publishes for suppressing unengaged profiles.

The rules I wrote before the code:

- Suppress, never delete.
- No cleanup without a simulation the merchant approves.
- Every profile checked against Shopify orders first.
- Every run logged, with a Restore button.
- When data is missing, the profile stays active.

It has zero users today. If you run email for Shopify brands and would try a free audit on one account, I would value your honest opinion. The audit changes no profile; it adds one segment in Klaviyo.

TierSaver is not affiliated with or endorsed by Klaviyo.

<!-- PUBLIC TEXT END -->
