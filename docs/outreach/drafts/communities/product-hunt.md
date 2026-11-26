# Product Hunt · listing draft

> DRAFT. Nothing is posted by a Claude session. Facundo creates the listing from his own account.

- Status: on-hold (decisión de Facundo; crear la cuenta y publicar son frenos del `CLAUDE.md`)
- Fase: **solo 2**.
- Regla (guía oficial, https://www.producthunt.com/launch/preparing-for-launch, leída por el índice del buscador el 2026-11-26): "Tagline (max 60 characters) - A very short description of the product — no gimmicks or over-the-top language." La misma guía dice que el primer comentario del maker importa. El límite de 260 caracteres para la descripción sale de guías de terceros: **sin verificar — mirar el formulario**. La regla sobre pedir votos no se pudo leer: **regla sin verificar — leer antes de postear**. Criterio propio, más estricto: no se piden votos, no se compran, no se organizan grupos de apoyo.
- Publicar solo cuando cualquiera pueda instalar la app. Si no está en el Shopify App Store ese día, se dice.
- Los largos están verificados por `tools/check_outreach.py` (tagline ≤ 60, descripción ≤ 260).

<!-- PUBLIC TEXT START -->

**Name:** TierSaver

**Tagline (≤ 60):** Automatic list hygiene for Klaviyo, on Shopify

**Description (≤ 260):** TierSaver keeps a Shopify store's Klaviyo list clean. It finds profiles that never engaged, checks each one against Shopify orders, and suppresses them only after a simulation you approve. Every cleanup is logged and can be restored. Nothing is deleted.

**Topics:** Email Marketing, E-Commerce, Shopify

**Pricing field:** Paid, with a free audit and simulation

**First comment (maker):**

Hi Product Hunt. I'm Facundo, the maker.

Klaviyo counts as active any profile it can email, including people who gave an email at checkout and never opted in. Klaviyo's help center publishes criteria for suppressing the profiles that never engaged, and you can do it by hand: build a segment, compare it with your orders, suppress, keep a record, repeat every month. Most small stores never get to it.

TierSaver runs that routine for Shopify stores:

- It uses the criteria Klaviyo publishes for suppressing unengaged profiles (created at least 365 days ago, sent 5 or more emails, never opened, clicked, visited or purchased).
- It checks every profile against your Shopify orders.
- It shows a simulation with the reason for each group. Nothing is suppressed until you approve.
- Every cleanup is logged and can be restored. It never deletes profiles.

Pricing: installing, the audit and the simulation are free. A monthly plan starts when you approve your first cleanup: $9 up to 10,000 active profiles, $19 up to 25,000, $39 up to 75,000, $79 up to 150,000. It renews every 30 days through Shopify until you cancel in Settings or uninstall.

What it is not: it does not send email, and it makes no promise about your Klaviyo plan. Klaviyo's documentation says suppressed profiles do not count toward the email plan's active profiles, and also that a plan does not change by itself.

I would like to hear what you would need to see before letting an app touch your list.

[STATUS LINE — keep the one that is true on launch day: "It is on the Shopify App Store: <link>." / "It is not on the Shopify App Store yet; write to hello@tiersaver.com for access."]

TierSaver is not affiliated with or endorsed by Klaviyo.

<!-- PUBLIC TEXT END -->
