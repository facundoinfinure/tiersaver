# Video · guion y borrador grabado

Preparado el 2026-11-26. Nada se subió ni se publicó.

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

Los tiempos son los del borrador grabado (88 segundos).

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

## Parte B · Screencast para el revisor de Shopify (2 a 3 minutos, obligatorio)

Se graba **en la tienda de desarrollo, con la app instalada de verdad y la cuenta de Klaviyo de prueba**: el revisor tiene que ver la instalación y el consentimiento reales, que el entorno local no tiene. En inglés, con voz o con subtítulos. Los nombres de botones son los de la UI actual (los mismos de `listing-shopify.md`, sección 7).

| # | Duración | Qué se muestra | Qué se dice o se subtitula |
| --- | --- | --- | --- |
| 1 | 0:15 | Instalar desde el link de instalación; pantalla de permisos de Shopify (`read_orders`); la app abre en "TierSaver" con "Get started" | This is TierSaver for Klaviyo. It asks Shopify for one permission: reading orders, to know who has bought. |
| 2 | 0:20 | Clic en "Connect Klaviyo"; pantalla de consentimiento de Klaviyo; aprobar; vuelve con "Klaviyo is connected. Nothing has changed in your Klaviyo account." | Connecting Klaviyo uses OAuth. These are the permissions it asks for. |
| 3 | 0:25 | Clic en "Run the free audit"; esperar; tarjeta "Your list" | The audit changes no profile. It creates one segment in the Klaviyo account and counts the profiles that meet the criteria. |
| 4 | 0:25 | Clic en "Review and approve"; "Simulation"; "Download candidates (CSV)"; abrir el CSV un segundo | Before anything is suppressed, the merchant reviews the simulation and can download the list. |
| 5 | 0:25 | "Before you approve": recorrer los tres bloques; tildar la casilla; "Approve and start plan"; pantalla de aprobación de Shopify (cargo de prueba); aprobar | The plan starts here, with Shopify's own approval screen. This is a test charge on a development store. |
| 6 | 0:20 | "Start cleanup: suppress N profiles"; página "Cleanup" en "In progress" con "Stop cleanup"; llega a "Completed" | The cleanup runs in the background. Each profile is checked again right before it is sent. |
| 7 | 0:20 | "Check progress in Klaviyo"; "Restore N profiles"; confirmar con "Restore profiles"; página "Restore" | A cleanup can be restored. Restore removes the suppression this cleanup added. |
| 8 | 0:20 | "History" ("Cleanups and restores"); "Settings": las seis tarjetas; "Plan" con "Cancel plan" | History lists every cleanup and restore. Settings has the criteria, protected lists, the schedule and the plan. |
| 9 | 0:10 | Home: "Disconnect Klaviyo"; desinstalar la app desde el admin | Disconnecting removes the app's access. Uninstalling deletes the store's data from our systems. |

Total: unos 3 minutos. Subirlo como video no listado y pegar el link en las instrucciones de prueba (subir es publicar: lo hace Facundo).

## Borrador grabado

- Archivo: `docs/launch/video-draft.webm` · 1280 × 720, 25 cuadros por segundo, VP8, 88 segundos, sin audio, 7 MB.
- Grabado el 2026-11-26 con la grabación de video de Playwright contra el entorno local, siguiendo la lista de tomas de la parte A. Script: `screenshots/2026-11-27/tools/video.mjs`.
- Los subtítulos y el puntero (un círculo) están dibujados sobre la página con una hoja de estilos; no son parte de la app.
- Cuadros extraídos para revisarlo: `docs/launch/video-frames/frame-03s.png`, `-12s`, `-24s`, `-31s`, `-41s`, `-55s`, `-61s`, `-68s`, `-76s`, `-84s`.

### ¿Sirve tal cual?

**No como pieza final; sí como storyboard y como borrador para aprobar el guion.** Mirando los cuadros:

- Lo que está bien: el recorrido completo se entiende sin audio, el texto de la app se lee a 720p, no hay errores, banners rojos ni restos del entorno local, y los números son de ejemplo.
- El subtítulo es una barra fija abajo que **tapa parte de la interfaz**: en el cuadro del segundo 41 queda encima del botón "Approve and start plan", y en el 68 queda detrás del fondo oscuro del diálogo de restaurar y casi no se lee.
- El puntero es un círculo, no un cursor, y se mueve de forma mecánica. Los desplazamientos son bruscos.
- Entre el segundo 46 y el 59 los subtítulos cambian un instante antes que la pantalla.
- En los primeros segundos de la limpieza (hacia 0:50) la página dice "0 of 2,234 profiles sent"; en el cuadro del segundo 55 ya va por 1,200.
- Faltan las tres pantallas que el entorno local no tiene (consentimiento de Klaviyo, aprobación del plan en Shopify, menú del admin) y se ve la línea "This is a development store".
- No tiene voz ni música, y es WebM: para YouTube, redes o la galería de Klaviyo hay que exportarlo a MP4.

Para la versión final: grabar la parte A a mano en la tienda de desarrollo (una toma, con este guion), poner los subtítulos en edición fuera del área de la app, y sumar la voz en off si se quiere.
