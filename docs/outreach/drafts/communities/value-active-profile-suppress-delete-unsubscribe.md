# Value post 2 · What Klaviyo counts as an active profile; suppress, delete, unsubscribe

> DRAFT. Nothing is posted by a Claude session. Facundo rewrites it in his own words and posts from his own account, in his own name.

- Status: to-review
- Fase: **1 y 2**. En fase 1 se publica SIN la línea de transparencia (sin nombrar el producto). En fase 2, con la línea solo donde las reglas lo permiten.
- Dónde sirve: r/emailmarketing, r/klaviyo (si existe), r/ecommerce y r/shopify (sin la línea de transparencia), Klaviyo Community, LinkedIn.
- Reglas: ver `../../communities.md`. Publicarlo al menos una semana después del post 1 y nunca en el mismo lugar el mismo día.
- Fuente de cada dato: artículos 24263920096027 y 24312135764251 del centro de ayuda de Klaviyo (abiertos el 2026-11-26) y las guías del sitio `site/src/pages/guides/how-klaviyo-counts-active-profiles.html` y `suppress-vs-delete-vs-unsubscribe.html`, que citan además los artículos de facturación y de perfiles suprimidos. Los datos de la tabla que no salen de los dos artículos abiertos hoy (baja global, rebotes, 7 rebotes blandos) vienen de esas guías: releer la fuente antes de publicar.

<!-- PUBLIC TEXT START -->

**Title:** What Klaviyo counts as an active profile, and why suppress is not delete and not unsubscribe

Three things get mixed up all the time in Klaviyo accounts. Getting them straight makes list hygiene much less scary.

**What an active profile is**

Klaviyo's definition: "Any profile that can be emailed through Klaviyo is considered an active email profile." It is about whether Klaviyo can email the profile, not about whether the person opted in or ever opened anything.

So these count toward the email plan:

- subscribers who opted in;
- people who gave an email at checkout without opting in to marketing;
- people who unsubscribed from SMS only and can still be emailed.

And these do not: suppressed profiles, profiles unsubscribed from email, deleted profiles, and profiles with no email address.

**Suppress, delete, unsubscribe**

| | Suppress | Delete | Unsubscribe |
| --- | --- | --- | --- |
| What it is | A status that blocks marketing email to the profile | Permanent removal of the profile | The recipient's own choice, recorded as a consent status |
| Profile and history | Stay in your account | Removed | Stay in your account |
| Can receive marketing email | No, even with consent | No | No |
| Changes consent | No | Not applicable | Yes |
| Can it be reversed | Yes, a manual suppression can be removed | No. Klaviyo: "This action cannot be undone." | Not by you |

A few details that surprise people:

- Suppressing affects email only. SMS and push eligibility do not change.
- A suppressed profile stays suppressed even if the person later starts a checkout or buys. It comes back when the person resubscribes or you remove the suppression.
- After a manual suppression is removed, Klaviyo says the profile "cannot be manually suppressed again until 90 days after the previous suppression."
- If you delete someone and they sign up again, they enter the account as a new profile, with no history.

**Which one for profiles that never engaged**

Suppress. You keep the history, the profile stops receiving marketing email, and a mistake can be corrected. Delete only what you are certain you will never need, such as test profiles.

**What it means for the plan**

Klaviyo says suppressed profiles "do not count toward your email plan's active profile limit". It also says suppressing "will not automatically change the Email subscription plan on your account": you pick a smaller plan yourself in billing settings, or enable auto-downgrade. On the Advanced KDP plan, "billing is based on total profiles, including suppressed profiles."

If useful, I can post the exact segment definition Klaviyo publishes for finding profiles that never engaged.

<!-- OPTIONAL DISCLOSURE LINE — only where the rules allow a vendor mention; never with a link -->

Disclosure: I built a tool that automates the suppress step (TierSaver). Nothing above depends on it.

<!-- PUBLIC TEXT END -->
