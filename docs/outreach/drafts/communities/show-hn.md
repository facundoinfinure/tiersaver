# Hacker News · Show HN

> DRAFT. Nothing is posted by a Claude session. Facundo rewrites it in his own words and posts from his own account, in his own name.

- Status: on-hold (decisión de Facundo)
- Fase: **solo 2**, y además con algo que cualquiera pueda probar.
- Regla (https://news.ycombinator.com/showhn.html, leída por el índice del buscador el 2026-11-26): "Show HN is for something you've made that other people can play with. HN users can try it out, give you feedback, and ask questions in the thread." El resto de la página no se pudo abrir: **regla sin verificar — leer antes de postear**. De memoria, sin verificar: las páginas de registro y las listas de espera no califican, y pedir votos está prohibido.
- Consecuencia: **no publicar mientras no haya algo que cualquiera pueda probar.** TierSaver necesita una tienda Shopify y una cuenta de Klaviyo, así que el enlace del Show HN tiene que ser algo que funcione sin eso: el "list health check" público o una demo con datos de muestra, si existen ese día. Si no existen, este canal se saltea.
- No pedir votos ni comentarios a nadie, por ningún medio. Facundo se queda en el hilo y contesta todo.
- Audiencia técnica: va la arquitectura y los límites, sin texto de marketing.

<!-- PUBLIC TEXT START -->

**Title:** Show HN: TierSaver – suppress never-engaged Klaviyo profiles, with a dry run first

**URL:** [link to something anyone can try without a store — list health check or sample-data demo]

**First comment:**

Hi HN. I built TierSaver, a Shopify app that keeps a store's Klaviyo list clean. Klaviyo counts as active any profile it can email, and its help center publishes criteria for suppressing the ones that never engaged (created at least 365 days ago, sent 5 or more emails over roughly 72 weeks, zero opens, clicks, site visits, product views, checkouts and purchases). The app applies those criteria on a schedule.

The parts that took the most thought:

- Dry run first. Every cleanup starts as a simulation: which profiles, by which rule, and which are protected and why. Nothing is written until a person approves. The first run is always manual.
- Second source of truth. Each candidate is checked against the store's Shopify orders before it can be suppressed. If the order data does not cover the window, everyone stays protected.
- Reversible. It only suppresses; it never deletes. Each run is logged and can be restored. Klaviyo has a 90-day limit on suppressing a profile again after a suppression is removed, and the UI says so before you restore.
- Little data. The database stores Klaviyo profile IDs and keyed hashes, not email addresses in clear. Tokens are encrypted at rest. Everything is removed on uninstall through Shopify's privacy webhooks.
- Stack: Shopify's React Router app template adapted to Cloudflare Workers, D1 (SQLite) with Drizzle, Workflows for the long suppression runs, Cron Triggers for the schedule.

What it does not do: it does not send email, it does not reactivate profiles, and it makes no promise about what anyone pays Klaviyo. Klaviyo's own documentation says suppressing does not change a plan by itself.

It is a paid app after a free audit and simulation: a flat monthly plan by list size, $9 to $79.

I would like feedback on the dry-run model and on what else you would want before letting an app write to a list like this.

Not affiliated with or endorsed by Klaviyo.

<!-- PUBLIC TEXT END -->
