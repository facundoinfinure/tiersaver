# Video · guion y borrador grabado

Preparado el 2026-11-26; video corto regrabado y guía del screencast el 2026-11-27. Nada se subió ni se publicó.

## Qué pide Shopify (leído el 2026-11-26)

- **Video destacado de la ficha (feature media)**: opcional. Si se usa, es un video promocional de 2 a 3 minutos y las grabaciones de pantalla no pueden pasar del 25 % del video. Si no hay video, va una imagen de 1600 × 900. Fuente: https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices (5.B.1).
- **Screencast para la revisión**: obligatorio (requisito 4.5.3). En inglés o con subtítulos en inglés, con el alta y las funciones que describe la ficha, paso a paso. **La documentación no fija una duración**; los "2 a 3 minutos" son del video destacado. Fuente: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements.
- Ninguna de las dos páginas indica resolución de video. El borrador está en 1280 × 720.

Consecuencia: el recorrido de 60 a 90 segundos de la parte A **no sirve como video destacado de la ficha** (es 100 % grabación de pantalla). Sirve para el sitio, redes, el press kit y la ficha de Klaviyo. En la ficha de Shopify va la imagen `screenshots/2026-11-27/listing/00-feature-image.png`. Lo que Shopify sí exige es la parte B.

## Parte A · Recorrido de 60 a 90 segundos (una sola toma)

### Preparación (fuera de cámara)

1. En `shopify/`: `npm run preview:app`. Abrir `http://localhost:3210/__preview/reset`.
2. En `http://localhost:3210/app`: clic en "Connect Klaviyo", después "Run the free audit". Cuando termina, abrir `http://localhost:3210/__preview/orders` y, de vuelta en la app, "Run the audit again". Tiene que aparecer el aviso "2,234 profiles are waiting for your review".
3. Abrir `http://localhost:3210/__preview/klaviyo?delay=60` justo antes de grabar, para que la limpieza dure unos 7 segundos en pantalla.
4. Ventana de 1280 × 720, zoom 100 %, sin barra de marcadores. Empezar a grabar en `http://localhost:3210/app`.

En el entorno local no se ven tres pantallas que sí existen en una tienda real: el consentimiento de Klaviyo, la pantalla de aprobación del plan de Shopify y el menú lateral del admin. Para un video definitivo conviene grabar en la tienda de desarrollo con la cuenta de Klaviyo de prueba, con el mismo guion.

### Lista de tomas

Los tiempos son los de la versión del 2026-11-26; la del 2026-11-27 dura 91 segundos con el mismo orden.

| # | Tiempo | En pantalla y clic exacto | Subtítulo en pantalla | Voz en off (opcional) |
| --- | --- | --- | --- | --- |
| 1 | 0:00 | Home, sin tocar nada. Se ve "Get started" y el aviso azul | TierSaver keeps your Klaviyo list clean. You approve every cleanup. | TierSaver keeps your Klaviyo list clean. Nothing happens until you approve it. |
| 2 | 0:05 | Bajar hasta "Your list". Clic en **"Run the audit again"** | Step 1: run the audit. It changes no profile. | Start with an audit. It changes no profile in your account. |
| 3 | 0:10 | Esperar los números. Quedarse en los tres recuadros | The audit counts profiles that never opened, clicked, visited or purchased. | It counts the profiles that never opened, clicked, visited your site or purchased. |
| 4 | 0:14 | Bajar la vista a "Kept active even though they meet the criteria" | Buyers, SMS subscribers and new profiles are kept active. | Anyone who bought from your Shopify store, has SMS consent or is too new stays active. |
| 5 | 0:19 | Subir. Clic en **"Review and approve"** (aviso azul) | Step 2: review the simulation. | Then review the simulation. |
| 6 | 0:25 | Página "Review cleanup". Clic en **"Download file 1"** en "Check the candidates" | Download the candidate list and check it. | Download the exact list of profiles and check it yourself. |
| 7 | 0:29 | Bajar por "Before you approve": "What suppressing does", "Restoring", "What you pay" | Read the notices: what suppressing does, how to restore, the plan. | Read what suppressing does, how restoring works, and how the plan is billed. |
| 8 | 0:38 | Tildar **"I have read the notices above…"**. Clic en **"Approve and start plan (US$19/month)"** | Step 3: tick the box and approve. Shopify asks you to confirm the plan. | Tick the box and approve. Shopify asks you to confirm the monthly plan. |
| 9 | 0:46 | De vuelta en "Review cleanup". Clic en **"Start cleanup: suppress 2,234 profiles"** | Step 4: start the cleanup. Profiles are suppressed, never deleted. | Start the cleanup. Profiles are suppressed, never deleted. |
| 10 | 0:52 | Página "Cleanup", estado "In progress". No tocar | Each profile is checked again right before it is sent to Klaviyo. | Each profile is checked once more right before it is sent. |
| 11 | 0:59 | Estado "Completed". Quedarse en "Summary" | Done. The cleanup is logged: who approved it, which rule, how many profiles. | When it finishes, the cleanup is in your history: who approved it, which rule, how many profiles. |
| 12 | 1:04 | Bajar a "Restore this cleanup". Clic en **"Restore 2,234 profiles"**; leer el diálogo; clic en **"Cancel"** | Made a mistake? Restore removes the suppression this cleanup added. | If something looks wrong, Restore removes the suppression this cleanup added. |
| 13 | 1:12 | Menú **"Settings"**. Bajar por "Who counts as inactive", "Protected lists and segments", "Monthly schedule" | Settings: criteria, protected lists, monthly schedule and your plan. | In Settings you choose the criteria, protect lists and segments, and set a monthly schedule. |
| 14 | 1:22 | Menú **"Home"**. Cerrar | TierSaver: list hygiene for Klaviyo. | TierSaver. List hygiene for Klaviyo. |

Reglas para los subtítulos y la voz: nada sobre la factura de Klaviyo ni sobre pagar menos; nada de "Klaviyo recommends"; la auditoría "changes no profile" (no "read-only"); sin cifras propias ni testimonios; no decir que la app está en el App Store. Si el video va a la ficha de Shopify, además: sin precios en pantalla (habría que saltear la tarjeta "What you pay" y tapar el precio del botón), lo que es otra razón para no usarlo ahí.

## Parte B · Screencast para el revisor de Shopify (obligatorio)

Se graba **en la tienda de desarrollo, con la app instalada de verdad y la cuenta de Klaviyo de prueba**: el revisor tiene que ver la instalación, el consentimiento de Klaviyo y la pantalla de aprobación del plan de Shopify, que el entorno local no tiene. Lo graba Facundo: hace falta su sesión iniciada en Shopify y en Klaviyo, y esta sesión no tiene navegador conectado ni acceso a su computadora.

**Guía para grabar: https://claude.ai/artifact/38J2MRoKjjpxoTksF5w7bc** (fuente: `docs/launch/screencast-guide.html`). Se abre en el celular mientras se graba la PC. Tiene la preparación, 20 pasos con el clic exacto y la frase en inglés de cada uno, y un botón "Siguiente" que marca el tiempo de cada paso. Al terminar arma el archivo `.srt` con los tiempos reales, para subirlo a YouTube como subtítulos en inglés. La voz es opcional (requisito 4.5.3: inglés o subtítulos en inglés).

Condiciones antes de grabar:

- **La supresión tiene que estar encendida y trabada a la cuenta de prueba** (`SUPPRESSION_ENABLED=true`, `SUPPRESSION_ALLOWED_ACCOUNT_ID=SGKvLG`). Hoy está apagada; el control de permisos de la sesión pide el OK explícito de Facundo para encenderla. El mismo estado sirve para la revisión, porque el revisor usa la misma cuenta de Klaviyo.
- Desinstalar la app de la tienda de desarrollo antes de empezar, para grabar la instalación. Borra solo datos de prueba.
- La tienda de desarrollo tiene que tener dirección fuera de la UE, el Reino Unido y Suiza (la de la prueba del 2026-11-27 sirve).

Duración esperada: 4 a 6 minutos (la auditoría y la limpieza tardan lo que tardan; la documentación no fija una duración). Subirlo como **no listado** y pegar el link en "App testing information" lo hace Facundo (subir es publicar). Si me pasa el archivo o el link antes, lo reviso cuadro por cuadro.

## Video corto (parte A), versión del 2026-11-27

- Archivo: `docs/launch/tiersaver-walkthrough.mp4` · 1280 × 720, H.264, 30 cuadros por segundo, 91 segundos, sin audio, 4,6 MB. Subtítulos también aparte: `tiersaver-walkthrough.en.srt`.
- Grabado con Playwright contra el entorno local con datos de ejemplo (`screenshots/2026-11-27/tools/video.mjs`) y terminado con `finish-video.mjs` (franja de subtítulos y exportación).
- Corregido respecto del borrador del 2026-11-26: los subtítulos van en una franja de 80 px **debajo** de la interfaz y ya no tapan botones ni diálogos; el puntero es una flecha; los subtítulos de los pasos 10, 13 y 14 cambian después de la pantalla, no antes; el paso de la auditoría baja de verdad hasta "Your list" (antes quedaba arriba por un elemento sin tamaño); sale en MP4, que aceptan YouTube, redes y la galería de Klaviyo.
- Cuadros para revisarlo: `docs/launch/video-frames/`.
- Sigue sin voz ni música, y en el entorno local no se ven el consentimiento de Klaviyo, la aprobación del plan en Shopify ni el menú del admin. Sirve para el sitio, redes, el press kit y la ficha de Klaviyo. **No va en la ficha de Shopify**: es 100 % grabación de pantalla y muestra precios.
