# Comunidades: reglas y qué publicar en cada una

Armado el 2026-11-26. Documento interno. Los textos están en `drafts/communities/` y son **borradores**: Facundo los reescribe con sus palabras y los publica él, desde sus cuentas, con su nombre. Ninguna sesión de Claude publica, comenta, vota, inicia sesión ni crea cuentas.

## Cómo se leyeron las reglas (límite de esta corrida)

La red de la sesión solo dejó abrir `help.klaviyo.com`. Reddit, Hacker News, Product Hunt, Indie Hackers, LinkedIn, X, YouTube, las dos comunidades y la FTC **no se abrieron**: lo que figura como cita salió del índice del buscador (el fragmento que devuelve la búsqueda), no de la página. Donde no apareció el texto de la regla dice **"regla sin verificar — leer antes de postear"**. Antes de publicar en cualquier lugar, Facundo abre la página de reglas ese mismo día.

## Fases

| Fase | Cuándo | Qué se puede publicar |
| --- | --- | --- |
| 1 | Desde hoy hasta que Shopify apruebe la app (nadie puede instalarla) | Solo posts educativos, sin nombrar el producto. Respuestas a hilos (`drafts/T*.md`) sin la frase de transparencia o con ella donde ya estaba permitida. Nada de "I built", Show HN, Product Hunt ni Ask and Offer. |
| 2 | Hay enlace de instalación | Lo anterior, más la línea de transparencia donde se permite, el post de fundador, Ask and Offer, Show HN y Product Hunt. |

La fase vigente está en la línea `PHASE:` de `README.md`.

## Reglas comunes

- Primero lo útil. Cada post tiene que servir sin la app.
- Como mucho **una** línea de transparencia ("I built a tool that automates this (TierSaver)"), sin enlace, y solo donde la regla del lugar lo permite.
- Un lugar por vez. No se copia el mismo texto en dos foros el mismo día.
- Se responde a todos los comentarios, a mano. Sin mensajes privados a quien no los pidió.
- No se piden votos, no se compran, no se arman grupos de apoyo. No se usan cuentas secundarias.
- Textos con las reglas de `docs/12-CUMPLIMIENTO-KLAVIYO.md` 3.2: higiene de lista, nunca ahorro; nada que deje mal a Klaviyo.
- Si un moderador borra un post o pide que no se publique más: se acata, se anota en `tracker.csv` y la comunidad pasa a `do-not-contact.csv`.

## Por comunidad

### Reddit (reglas generales del sitio)

- Regla: **sin verificar — leer antes de postear**. Páginas a leer: https://www.redditinc.com/policies/content-policy y la guía de autopromoción del sitio (https://www.reddit.com/wiki/selfpromotion, URL de memoria). Fuentes secundarias coinciden en que una cuenta cuya actividad es en su mayoría promoción propia se trata como spam, que las reglas de cada subreddit se suman a las del sitio, y que publicar lo mismo en varios subreddits a la vez se marca como spam coordinado. La proporción "9 a 1" que circula no está confirmada como regla oficial.
- Consecuencia práctica: la cuenta de Facundo tiene que participar de verdad (responder dudas de otros) antes de publicar algo propio. Una cuenta nueva que solo postea su producto termina filtrada.
- Las reglas de cada subreddit están en `https://www.reddit.com/r/<nombre>/about/rules` y en el post fijado.

| Subreddit | Regla de autopromoción | Qué se publica | Borrador |
| --- | --- | --- | --- |
| r/shopify | **Sin verificar — leer antes de postear.** Fuente secundaria (guía de Talk Shop, 2026): prohíbe la autopromoción directa, los enlaces de afiliado y los posts de "revisen mi tienda"; reincidir lleva a expulsión. | Solo respuestas útiles y el post de valor **sin** la línea de transparencia. No se nombra TierSaver. | `value-by-hand-segment.md` sin la línea final |
| r/klaviyo | **No se pudo confirmar que exista ni sus reglas.** Leer antes de postear. | Si existe y lo permite: los dos posts de valor. | `value-by-hand-segment.md`, `value-active-profile-suppress-delete-unsubscribe.md` |
| r/emailmarketing | **Sin verificar — leer antes de postear.** (El buscador devolvió otro subreddit, r/emailmarketingnow, que prohíbe promoción y solo admite posts de texto.) | Post de valor 2, sin enlace. | `value-active-profile-suppress-delete-unsubscribe.md` |
| r/ecommerce | Post de bienvenida (2025-03-04), leído por un espejo: regla "No Self-Promotion" (no ofrecer ni promocionar; los enlaces de afiliado en general están prohibidos) y requisito de cuenta con 10 días de antigüedad y 10 de karma de comentarios. Original: https://www.reddit.com/r/ecommerce/comments/1j3crv8/welcome_to_recommerce_please_read_before_posting | Post de valor **sin** la línea de transparencia. No se nombra TierSaver. | `value-by-hand-segment.md` sin la línea final |
| r/EntrepreneurRideAlong | **Sin verificar — leer antes de postear.** | Fase 2: historia de fundador, sin enlace. | `founder-story-indie-hackers.md`, variante 2 |
| r/SaaS | **Sin verificar.** Las fuentes secundarias se contradicen (una habla de una ventana semanal para promoción, otra de "sin autopromoción salvo con contexto y transparencia"). | Fase 2: historia de fundador con pregunta, sin enlace. | variante 2 |
| r/indiehackers | **Sin verificar.** Un post de moderadores de diciembre de 2025 evaluaba un hilo semanal de autopromoción con participación obligatoria; una guía de 2026 dice que se borran los avisos disfrazados de "mi recorrido". | Fase 2, y solo en el hilo semanal si existe. | variante 2 |
| r/smallbusiness, r/SideProject | **Sin verificar.** Fuentes secundarias: r/smallbusiness tiene un hilo semanal de promoción y borra lo demás; r/SideProject es para pedir opiniones. | No prioritario. | — |

Formato que funciona en Reddit: post de texto, sin enlace, con los pasos completos adentro, y el autor contestando en los comentarios.

### Klaviyo Community

- Regla (guía, https://community.klaviyo.com/getting-started-with-the-community-50, por el índice): "Promotion of other products/services should be relevant to the original post. The product/service should directly assist the community member with their issue."
- Términos (https://community.klaviyo.com/site/terms, por el índice): prohíben "Post unsolicited or unauthorized advertising, promotional materials, "junk mail," "spam," or any other form of solicitation".
- Lectura prudente: mandan los términos. Se responde la duda con los pasos a mano; la frase de transparencia va solo si la app resuelve de forma directa lo que preguntan, una vez, sin enlace. Un tema nuevo que presente el producto no va.
- Es la casa de Klaviyo: tono neutro, nada de quejas por precios, y los datos citados de su centro de ayuda.
- Qué se publica: las respuestas a hilos ya redactadas (`drafts/T01.md` a `T11.md`) y, como tema nuevo, el post de valor 1 sin la línea final.

### Shopify Community

- Regla (FAQ, https://community.shopify.com/faq, por el índice): es infracción "Unsolicited/self-promotional mentions, including promoting unrelated products, services, websites, or blogs posted outside the Ask and Offer board." y "Use the Ask and Offer board if you want to post general information about your app or solicit feedback from members about your app or service."
- También: "Copying and pasting the same content across multiple boards or topics." y "AI produced content is subject to removal and highly discouraged." Por eso todo lo que vaya ahí lo reescribe Facundo.
- Tablero: https://community.shopify.com/c/ask-offer/294. Guía general: https://community.shopify.com/t/community-guidelines/45626.
- Qué se publica: fuera de Ask and Offer, respuestas sin nombrar la app (`drafts/T12.md`). En Ask and Offer, **solo en fase 2**, `shopify-ask-and-offer.md`.

### Indie Hackers

- Regla: **sin verificar — leer antes de postear** (no apareció la página oficial). Posts de usuarios dicen que el sitio tolera más la autopromoción que otros, que premia lo que genera conversación, y que los títulos tipo "Promo" o "My app" caen mal.
- Formato: historia con decisiones concretas y una pregunta al final.
- Qué se publica: fase 2, `founder-story-indie-hackers.md`, variante 1.

### Hacker News (Show HN)

- Regla (https://news.ycombinator.com/showhn.html, por el índice): "Show HN is for something you've made that other people can play with. HN users can try it out, give you feedback, and ask questions in the thread." El resto: **sin verificar — leer antes de postear**. Guías generales: https://news.ycombinator.com/newsguidelines.html.
- Solo fase 2 y solo si hay algo que cualquiera pueda probar sin tienda ni cuenta de Klaviyo. Si no, se saltea. Borrador: `show-hn.md`.

### Product Hunt

- Regla (guía oficial, https://www.producthunt.com/launch/preparing-for-launch, por el índice): "Tagline (max 60 characters) - A very short description of the product — no gimmicks or over-the-top language." Límite de 260 para la descripción y regla sobre pedir votos: **sin verificar**.
- Solo fase 2. Crear la cuenta y publicar son decisiones de Facundo. Borrador: `product-hunt.md`.

### Grupos de Facebook, Slack, Discord, Skool

- Lo único que apareció en la búsqueda: **LTV Lab (Ecom Email & SMS)**, comunidad en Skool, https://www.skool.com/ecommerce-retention-marketing-1511. Reglas y condiciones de ingreso: **sin verificar — leer antes de postear**.
- No se pudo verificar por búsqueda ningún grupo de Facebook, Slack o Discord de marketers de email para DTC. No se lista ninguno de memoria. Si Facundo ya participa en alguno, se agrega acá con su regla.
- Criterio: en grupos cerrados se participa como miembro, se responde lo que preguntan y no se publica el producto salvo que el administrador lo autorice por escrito.

### X

- Regla (https://help.x.com/en/rules-and-policies/x-automation, por el índice): "You may not send automated posts or Direct Messages that are spam, or otherwise engage in spamming activity." La documentación para desarrolladores agrega que las respuestas automáticas solo valen si la persona interactuó primero.
- Todo a mano, desde la cuenta de Facundo. Sin mensajes directos a desconocidos. Borrador: `x-and-linkedin-posts.md`.

### LinkedIn

- Regla (ayuda de LinkedIn, https://www.linkedin.com/help/linkedin/answer/a1341387, por el índice): LinkedIn no permite software ni extensiones de terceros que extraigan datos, modifiquen la apariencia o automaticen actividad en su sitio; el riesgo es la restricción o el cierre de la cuenta. El texto exacto del acuerdo de usuario: **sin verificar**.
- Los mensajes a agencias por LinkedIn salen uno por uno, a mano, y con el mismo límite que el mail: un mensaje y un único seguimiento.
- Borradores: `x-and-linkedin-posts.md` (valor) y `founder-story-indie-hackers.md` variante 3 (fase 2).

### YouTube (comentarios)

- Regla: **sin verificar — leer antes de postear** (políticas de spam y prácticas engañosas de YouTube, en support.google.com/youtube).
- Criterio: no se comenta en videos de creadores para nombrar el producto. A los creadores se les escribe por el canal comercial que publican (`creators.csv`).

## Qué no se hace en ninguna

- Comprar votos, reseñas o seguidores, o pedirle a conocidos que voten.
- Publicar con cuentas que no sean la de Facundo, o sin decir quién es.
- Automatizar publicaciones, comentarios o mensajes (ver `AUTOMATION.md`).
- Contestar un hilo viejo solo para dejar el nombre del producto.
