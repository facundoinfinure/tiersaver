# Capturas del 2026-11-27

Hechas el 2026-11-26 con la app actual corriendo en el entorno local (`shopify/preview/`: sesión de Shopify simulada y Klaviyo falso con datos de ejemplo). Reemplazan a las cinco capturas sueltas de `docs/launch/screenshots/*.png` (1360 px de ancho, del 2026-11-25), que quedan solo como archivo.

**Todos los números son datos de ejemplo** (12.480 perfiles activos, 2.640 que cumplen los criterios, 2.234 candidatos). No aparece ningún mail ni nombre de tienda real: se revisó imagen por imagen.

## Qué pide Shopify (leído el 2026-11-26)

- Capturas de 1600 × 900 px (16:9), de 3 a 6 de escritorio, al menos una de la UI, sin marco de navegador ni fondo de escritorio, con alt text, cada una distinta. Fuente: https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices (5.B.3).
- Sin precios en las imágenes de la ficha (requisito 4.2.2), sin estadísticas ni garantías (4.3.4), y que muestren sobre todo la UI real (4.4.4). Fuente: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements.
- Imagen destacada: 1600 × 900, un foco, fondo sólido, sin repetir el subtítulo.

## `listing/` · las que van en la ficha (1600 × 900 exactos, PNG, menos de 210 KB cada una)

Recortes de la UI real sobre el fondo de marca (`--bg` de `brand/tokens.css`), con la marca, un título corto y la etiqueta "Example data". Tipografía del sistema, sin fuentes ni recursos de terceros. **Ninguna muestra precios**: por eso son recortes de tarjetas y no la pantalla entera.

| Archivo | Qué muestra | Título (palabras) |
| --- | --- | --- |
| `00-feature-image.png` | Imagen destacada: logo, la frase "Suppress profiles that never engaged. After you approve." y la tarjeta "Your list" | no es captura |
| `01-audit.png` | Home con la auditoría terminada: tarjeta "Your list" (perfiles activos, los que cumplen los criterios, los que suprimiría una limpieza y los que quedan activos y por qué) | See which profiles never engaged (5) |
| `02-review-and-approve.png` | Revisión de la simulación: "Check the candidates" (descarga del CSV) y "Before you approve" hasta "Restoring". Se corta antes de "What you pay" a propósito, para no mostrar el precio | Review the candidates before you approve (6) |
| `03-cleanup-running.png` | Limpieza en curso: estado "In progress", perfiles enviados hasta el momento, botón "Stop cleanup" | Follow each cleanup, or stop it (6) |
| `04-cleanup-log-and-restore.png` | Limpieza terminada: resumen (quién aprobó, regla, cantidades), "Klaviyo batches" y "Restore this cleanup" con el botón "Restore 2,234 profiles" | A log of every cleanup, with Restore (7) |
| `05-settings.png` | Settings: "Who counts as inactive", "Protected lists and segments" y "Monthly schedule" (dos recortes lado a lado). El plan no aparece porque muestra el precio | Your criteria, protected lists and schedule (6) |

El alt text de cada una está en `docs/launch/listing-shopify.md`.

## `raw/` · la app sin componer (3200 × 1800, es decir 1600 × 900 a densidad 2)

Vista de 1600 × 900 desplazada hasta la parte que importa. **Muestran el precio del plan: sirven para el sitio, el press kit y el revisor, no para la galería de la ficha.** Los `-full` son la página completa (no son 16:9).

| Archivo | Qué muestra |
| --- | --- |
| `01-home-audit.png` · `01-home-audit-full.png` | Home con la auditoría terminada: "Get started", "Your list", y a la derecha "Pricing", "Klaviyo connection", "Help", "Good to know" |
| `02-review-before-you-approve.png` · `-full.png` | "Before you approve" completo: qué hace suprimir, cómo restaurar, **"What you pay" (el aviso del plan)**, la casilla de aceptación y "Approve and start plan (US$19/month)" |
| `02b-review-simulation.png` | Arriba de la misma página: tarjeta "Simulation" con los cuatro números, incluido el plan para ese tamaño de lista |
| `03-cleanup-running.png` | Limpieza en curso |
| `04-cleanup-completed.png` | Limpieza terminada, con "Restore 2,234 profiles" |
| `05a-settings-criteria-lists-schedule.png` | Settings: criterios, listas protegidas y programación mensual |
| `05b-settings-plan.png` | Settings: final de "Automatic cleanups", "Save settings", **"Plan"** con "Cancel plan" y "Customer data requests" |
| `05-settings-full.png` | Settings entera (1 MB) |

## Qué se retocó, y qué no

Tres cosas, todas por el entorno local y ninguna en el contenido de la app:

1. Se ocultó la tira de links "Home / Review cleanup / History / Settings" que queda suelta arriba a la izquierda: en el admin de Shopify esos links van en el menú lateral.
2. El fondo de la página se puso en el gris del admin (`#f1f1f1`); el entorno local lo deja blanco.
3. El ID de la cuenta de Klaviyo de ejemplo (`PREVW1`, un resto de "preview") se cambió por uno neutro (`Xk4T9a`) en las capturas de Home.

No se tocó nada más. En `raw/` se ven dos líneas propias de una tienda de desarrollo ("This is a development store: Shopify creates a test charge and never bills it." y "Test plan (development store): Shopify does not bill it."): son reales y aparecen porque el plan de prueba es de prueba. No aparecen en `listing/`.

Lo que estas capturas no tienen: el marco del admin de Shopify. Shopify pide que la captura no traiga marco de navegador, así que no hace falta; si Facundo quiere capturas tomadas dentro del admin, se repiten en la tienda de desarrollo con el mismo guion.

## Observaciones de UI vistas en las capturas (no se corrigió nada en `shopify/app/`)

- **Settings**: la tarjeta que contiene solo el botón "Save settings" queda pegada a la tarjeta "Plan" (unos 2 px de separación contra 16 px entre las demás). Se ve en `raw/05b-settings-plan.png` y en `raw/05-settings-full.png`.
- **Limpieza recién iniciada**: los primeros segundos dice "0 of 2,234 profiles sent to Klaviyo so far" aunque ya esté trabajando. No es un error; se anota porque es lo primero que ve el merchant. Se ve en `docs/launch/video-draft.webm` hacia el segundo 50.
- **Sitio, no app**: `site/src/pages/help/undo.html` manda a la sección "Undo this cleanup", pero en la app la tarjeta se llama "Restore this cleanup".
- Sin banners de error ni textos cortados en ninguna pantalla. El recorrido no dejó errores de consola.

## Cómo regenerarlas

Con `npm run preview:app` corriendo en `shopify/`, desde una carpeta fuera del repo y con `NODE_PATH=$(npm root -g)`:

    node tools/capture.mjs <salida>                       # raw/ y crops/
    node tools/compose.mjs <salida> <salida>/listing <repo>
    node tools/feature.mjs <salida> <salida>/listing/00-feature-image.png <repo>

`tools/items.json` tiene los títulos. `tools/video.mjs` graba el borrador de video y `tools/gen.py` escribe las dos fichas con sus conteos. Los scripts usan el Playwright global (`createRequire('/')('playwright')`); no instalan nada.
