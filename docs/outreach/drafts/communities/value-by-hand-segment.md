# Value post 1 · Suppress never-engaged profiles by hand

> DRAFT. Nothing is posted by a Claude session. Facundo rewrites it in his own words and posts from his own account, in his own name.

- Status: to-review
- Fase: **1 y 2**. En fase 1 se publica SIN la línea de transparencia (sin nombrar el producto). En fase 2, con la línea solo donde las reglas lo permiten.
- Dónde sirve: r/klaviyo (si existe), r/emailmarketing, r/ecommerce (sin la línea de transparencia), r/shopify (sin la línea de transparencia), Klaviyo Community (como tema nuevo), LinkedIn (versión corta), Indie Hackers no.
- Reglas: ver `../../communities.md`. Leer las reglas del lugar el mismo día en que se publica.
- Un solo lugar por vez. No copiar y pegar el mismo texto en varios foros el mismo día (Shopify Community lo prohíbe de forma expresa; Reddit lo trata como spam).
- Fuente de cada dato: artículos 24263920096027 (actualizado 2026-10-29) y 24312135764251 (actualizado 2026-10-27) del centro de ayuda de Klaviyo, abiertos de forma directa el 2026-11-26. Coincide con `docs/12-CUMPLIMIENTO-KLAVIYO.md` sección 1.2.1 y con `site/src/pages/guides/klaviyo-list-hygiene.html`. Releer los dos artículos antes de publicar: si cambiaron, gana el artículo.
- La línea de transparencia va solo donde las reglas lo permiten. Sin enlace.

<!-- PUBLIC TEXT START -->

**Title:** How to find and suppress never-engaged profiles in Klaviyo by hand (the exact segment definition)

Klaviyo's email plan follows your active profiles, and Klaviyo's definition is wide: "Any profile that can be emailed through Klaviyo is considered an active email profile." That includes someone who typed an email at checkout and never opted in to marketing.

Klaviyo's help center documents how to take profiles that never engaged out of that count by suppressing them. Here is the whole routine by hand. No tool needed.

**1. Build the segment**

From Klaviyo's article "Understanding active profile management in Klaviyo" (updated 2026-10-29). All conditions joined with AND:

- If someone can or cannot receive marketing > Person can receive email marketing
- Properties about someone > Email is set
- Properties about someone > Created is at least 180 days ago
- What someone has done (or not done) > has Received Email at least 5 in the last 72 weeks
- has Opened Email 0 times over all time
- has Clicked Email 0 times over all time
- has Active on Site 0 times over all time
- has Viewed Product 0 times over all time
- has Checkout Started 0 times over all time
- has Placed Order 0 times over all time

Creating the segment suppresses nobody.

**2. Know that Klaviyo publishes a second, more conservative set**

Another article, "How to manage email suppressions and delete profiles in bulk" (updated 2026-10-27), lists the profiles Klaviyo itself may suggest on the Suppressed profiles page (Audience > Profiles > View suppressed profiles):

- Can receive email marketing and have not had a suppression added in the last 90 days
- Were created at least 365 days ago
- Have received 5 or more emails over roughly the last 72 weeks
- Have never opened or clicked an email from you
- Have no recorded website visits, product views, started checkouts, or purchases

Two articles, two profile ages: 180 days in the segment, 365 days in the suggestions. If you are unsure, use 365. Fewer profiles qualify, and the ones that do have had a full year to show any sign of life.

**3. Check the segment against real orders**

This step is not in Klaviyo's instructions. The conditions above rely on the activity Klaviyo has recorded for each profile. Your store's order history is an independent check: export the segment, compare it with your Shopify orders, and keep anyone who has bought from you.

**4. Decide whether to try one last sunset flow**

Klaviyo's help center suggests running long-inactive profiles through a final sunset flow before suppressing them. Suppression is a decision to stop emailing someone, and a suppressed profile stays suppressed even if that person later starts a checkout or buys.

**5. Suppress (do not delete)**

- Go to Audience > Lists & segments.
- Open the action menu next to the segment and select "Suppress current members".
- If Klaviyo offers the choice: "Suppress inactive profiles" keeps active anyone who clicked an email or placed an order within the last 182 days; "Suppress everyone" suppresses all eligible current members.
- Confirm. Processing may take some time.

Suppressed profiles stay in your account with their history. Deleting is different: Klaviyo says of deletion, "This action cannot be undone." Suppressing affects email only; SMS and push eligibility do not change.

**6. Keep a record**

Before you confirm, export the segment and keep the file with the date and the conditions you used. If you later find someone who should not be in it, that file tells you whom to restore. One limit to know: once a profile is manually suppressed and then unsuppressed, Klaviyo says "it cannot be manually suppressed again until 90 days after the previous suppression."

**7. Repeat**

The action covers current members only. Profiles that join the segment later are not suppressed, so put it in the calendar every month or quarter.

**What this does and does not change in your plan**

In Klaviyo's words, suppressed profiles "do not count toward your email plan's active profile limit". Also in Klaviyo's words, suppressing "will not automatically change the Email subscription plan on your account": you choose a smaller plan in billing settings, or turn on auto-downgrade. On the Advanced KDP plan, "billing is based on total profiles, including suppressed profiles." Klaviyo gives no fixed time for the count to update after a bulk suppression.

Happy to answer questions about any step.

<!-- OPTIONAL DISCLOSURE LINE — only where the rules allow a vendor mention; never with a link -->

Disclosure: I built a tool that automates this (TierSaver). Everything above works by hand without it.

<!-- PUBLIC TEXT END -->

## Versión corta (LinkedIn o X, un solo post)

<!-- PUBLIC TEXT START -->

Klaviyo counts as active "any profile that can be emailed through Klaviyo", including people who never opted in. Its help center publishes how to suppress the ones that never engaged:

1. Segment: can receive email marketing, email is set, created at least 180 days ago, received at least 5 emails in the last 72 weeks, and 0 opens, clicks, site activity, product views, checkouts started and orders over all time.
2. Klaviyo's own suggestions use 365 days. When unsure, use 365.
3. Compare the segment with your Shopify orders. Keep every buyer.
4. Audience > Lists & segments > Suppress current members.
5. Suppress, never delete. Export the list first.
6. Repeat monthly.

The plan does not change by itself: you pick a smaller one in billing, or turn on auto-downgrade.

<!-- PUBLIC TEXT END -->
