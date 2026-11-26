# Revisión del sitio público de TierSaver

Fecha: 2026-11-26. Alcance: `site/` completo (landing con list check, precios y FAQ; centro de ayuda; guías; términos; privacidad; 404) y `brand/`. Se revisó el build local (`npm run build -w @tiersaver/site`, servido con `site/build/serve.mjs` en `127.0.0.1:8788`, que aplica `_headers`). No se tocó ningún archivo del repo.

Capturas: `/tmp/claude-0/-home-user-tiersaver/7c941f9f-138b-569f-a393-87cc163dabd0/scratchpad/review/site-shots/` (en adelante `site-shots/`). Hay una captura de página completa por página y ancho (`<pagina>-<390|768|1280|1920>.png`, 17 páginas × 4 anchos), recortes legibles en `site-shots/sheets/`, y datos crudos en `site-shots/report.json`.

## Qué se hizo y qué no

- Build: 19 archivos generados, 0 cambios respecto de lo commiteado. Tests del sitio: 293 pasan. `check:links`: 828 referencias, 0 rotas.
- Playwright (Chromium), deviceScaleFactor 1: 17 páginas a 390, 768, 1280 y 1920; además 320 px, sin JavaScript, navegación por teclado y 24 casos del list check.
- **Modo oscuro: el sitio no lo soporta** (no hay `prefers-color-scheme` en ningún CSS). `home-1280-dark.png` es idéntica a la clara. No es un defecto; queda anotado como decisión (hallazgo B-12).
- **No verificado, por falta de red hacia afuera:** que las seis URL de help.klaviyo.com respondan y digan lo que el sitio les atribuye; que los precios de lista de Klaviyo de `packages/core/src/price-tables/klaviyo.ts` sigan vigentes; que la regla `https://:project.:account.workers.dev/*` de `_headers` funcione en Workers static assets tal como está escrita (el servidor local ignora el host, por eso localmente todo sale con `X-Robots-Tag: noindex`). Las tres cosas hay que mirarlas contra el staging real.

## Resumen

| Severidad | Cantidad |
| --- | --- |
| Bloqueante | 4 |
| Alto | 8 |
| Medio | 15 |
| Bajo | 12 |

Lo que está bien y no hay que tocar: ninguna mención a las otras marcas en `site/` ni en `brand/` (texto, nombres de archivo, clases CSS, alt, metadatos de PNG); cero requests a terceros y cero cookies en las 17 páginas; CSP estricta sin inline; peso de la landing ≈ 78 KB comprimidos en 10 requests; sin desborde horizontal en ningún ancho, incluido 320 px; todo el texto pasa contraste AA; foco visible en todos los controles; skip link; `prefers-reduced-motion` respetado; precios y criterios salen de `@tiersaver/core`; sin testimonios, logos de clientes ni estadísticas inventadas; "Klaviyo" y "Shopify" solo como texto, con aviso de no afiliación en cada página.

---

## Bloqueantes

### X-1 · El CTA principal no lleva a ningún lado
- **Dónde:** todas las páginas (header) + hero y panel de cierre de la landing. Todos los anchos. `home-1280.png`, `sheets/home-1280-1.png`.
- **Evidencia:** `site/build/build.mjs:261`, `site/src/pages/index.html:14` y `:211`: `href="#" data-todo="app-store-url"`. Probado: al hacer clic la URL pasa a `/#` y la página salta arriba. Son 19 enlaces en el HTML publicado. En las páginas de ayuda, el botón del header también hace eso.
- **Arreglo:** mientras no exista la ficha, apuntar a algo que funcione. Dos opciones, a elegir por Facundo:
  1. `href="mailto:hello@tiersaver.com?subject=TierSaver%20early%20access"` y cambiar el texto a `Request early access` (el CTA aprobado "Run my free list audit" promete algo que hoy no se puede hacer).
  2. Mantener el texto y apuntar a `/#list-check` con una línea debajo del botón del hero: `The app is in review. Until it is listed, try the list health check below.`
  Cuando exista la ficha: `https://apps.shopify.com/<handle>`. El test `site.test.ts:314` exige hoy que el placeholder exista; hay que invertirlo para que falle si queda algún `data-todo`.

### X-2 · Las casillas hello@ y support@ no existen
- **Dónde:** 12 enlaces a `hello@tiersaver.com` y 4 a `support@tiersaver.com` (landing, ayuda, términos, privacidad).
- **Evidencia:** `docs/STATUS.md:216` ("Las casillas todavía no existen"). Los términos dan `hello@` como canal de notificaciones legales (`site/src/pages/terms.html:154`) y la privacidad como canal para ejercer derechos (`privacy.html:120`).
- **Arreglo:** crear o reenviar las dos casillas antes de publicar y probar ida y vuelta. Es tarea de Facundo (crear cuentas es freno).

### X-3 · Términos y privacidad: el cartel dice "not in effect" y el texto dice "Effective date: November 26, 2026"
- **Dónde:** `/terms` y `/privacy`, todos los anchos. `sheets/terms-1280-1.png`, `sheets/terms-390-1.png`.
- **Evidencia:** `site/build/build.mjs:318-320` (cartel: "has not been reviewed by a lawyer, is not final and is not in effect") contra `terms.html:12` y `privacy.html:12` ("Effective date: November 26, 2026"). La app registra `TERMS_VERSION = "2026-11-26"` (`shopify/app/legal.ts:6`) como la versión que el merchant acepta al aprobar: **la versión coincide con la fecha del sitio**, pero el merchant estaría aceptando un documento que arriba dice que no rige.
- Además el cartel dice "Text in [BRACKETS] is still to be filled in" y **ya no queda ningún corchete** en ninguna de las dos páginas.
- **Arreglo:** antes de que un merchant real apruebe una limpieza, sacar el cartel y el "(draft)" del título, del `nav` y del footer, con el ok del abogado (`docs/16-LEGALES-PARA-ABOGADO.md`). Mientras siga el borrador, cartel coherente:
  `Draft, pending legal review. This text is the version the app currently shows, dated November 26, 2026. It may change after review.`
  y quitar la frase de los corchetes.

### X-4 · La ayuda promete un mail que la app no manda
- **Dónde:** `/help/simulation-and-approval`, sección "Monthly cleanups". `help-simulation-1280.png`.
- **Evidencia:** `site/src/pages/help/simulation-and-approval.html:35` ("TierSaver runs a new simulation and emails you a summary") y `:38` ("you still receive the summary"). La política de privacidad dice lo contrario: `privacy.html:52` ("On the effective date of this policy the app sends no email"). En `shopify/app` y `shopify/workers` no hay ningún envío de mail ni proveedor.
- Consecuencia práctica: en modo "approval required" la simulación espera 24 horas y el merchant no se entera si no abre la app.
- **Arreglo (texto exacto):**
  - Línea 35: `Before each monthly cleanup TierSaver runs a new simulation. It appears on the app's home page; the app does not send email yet, so open the app around your scheduled day. There are two modes:`
  - Línea 38: `<li><strong>Automatic.</strong> An explicit opt-in, available only with the default criteria. The cleanup runs on the scheduled day using the new simulation. The result is listed under History.</li>`
  - Agregar después de la lista: `If a simulation is not approved within {{sim.ttlHours}} hours it expires, nothing is suppressed and nothing is charged. You can run a new audit and approve it at any time.` (confirmar con quien revise la app que ese es el comportamiento).

---

## Altos

### A-1 · "The audit is read-only / changes nothing in your Klaviyo account" no es cierto: la auditoría crea un segmento
- **Dónde:** landing (hero y paso 01), `/help/how-the-audit-works`, tarjeta del índice de ayuda. `sheets/home-1280-1.png`, `help-audit-1280.png`.
- **Evidencia:** `site/src/pages/index.html:17` y `:76`; `help/how-the-audit-works.html:22` ("it does not change anything in your Klaviyo account"). La app crea y mantiene el segmento "TierSaver: long-term inactive profiles (managed, do not edit)" durante la auditoría (`shopify/app/klaviyo/api.ts:750-779`, `config.ts:219`; las instrucciones al revisor en `docs/15-LANZAMIENTO-MATERIALES.md` lo dicen). Los términos y la privacidad sí lo cuentan.
- **Arreglo:**
  - Hero (`index.html:17`): `The audit is free and does not change any profile. Nothing is suppressed until you approve a simulation.`
  - Paso 01 (`index.html:76`): `Connect Klaviyo and run a free audit. It changes no profile: it adds one segment to your account, which Klaviyo uses to evaluate the criteria, and shows how many active profiles you have and how many meet them.`
  - `how-the-audit-works.html:21-22`: título `The audit changes no profile` y texto `The audit does not suppress, tag or edit any profile. It makes one change in your Klaviyo account: it creates a segment named "TierSaver: long-term inactive profiles (managed, do not edit)", which Klaviyo uses to evaluate the cleanup criteria. Do not edit or delete it while you use the app. Suppression only happens later, after you <a href="/help/simulation-and-approval">approve a simulation</a>.`
  - Front matter del mismo archivo: `description` y `summary` sin "read-only" ("free and changes no profile").

### A-2 · Afirmaciones absolutas que el modo automático y los términos desmienten
- **Dónde:** landing y ayuda.
- **Evidencia y arreglo:**
  - `index.html:83`: "Nothing runs without a simulation you approved in the last 24 hours." y `help/simulation-and-approval.html` (lead, front matter línea 6): "Nothing is suppressed without a simulation that you approved. There is no path past that step, in the app or behind it." El modo automático corre sin aprobación por corrida (`shopify/app/settings/settings.ts:64,104`, `terms.html:23-24`). Texto: `Nothing is suppressed without a simulation. You approve each one, unless you later turn on automatic mode for the monthly cleanups.`
  - `index.html:154`: "No one who buys is touched." Los términos admiten que los datos pueden estar incompletos (`terms.html:41`). Texto: `Buyers are kept. By default a profile is only a candidate if it has no purchase in your Shopify orders or in Klaviyo, and has never opened, clicked or visited.`
  - `index.html:49`: "Anyone who has ever bought, opened, clicked or visited is kept." Texto: `A profile with a recorded purchase, open, click or visit is kept. So is any profile with incomplete data.`
  - `help/undo.html` (lead): "Every run can be undone." Los términos dicen que el undo puede no restaurar todos y que necesita la app instalada (`terms.html:45,108`). Ver A-5.

### A-3 · El list check muestra dos precios de lista de Klaviyo lado a lado, sin la palabra "estimated"
- **Dónde:** landing, `#list-check`, todos los anchos. `sheets/home-1280-4.png`, `calc-big-1280.png`.
- **Evidencia:** `site/src/check/check.ts:182` genera "Up to 12,500 profiles ($275/mo list price)" para "Today" y "Up to 10,000 profiles ($150/mo list price)" para "After the cleanup". El módulo no resta, pero la pantalla deja la resta servida. `docs/03-MARCA.md` (Voz) y el checklist de `brand/messaging.md` exigen que cualquier plan mostrado sea secundario, salga de datos del merchant **y diga "estimated"**. Con 1.000.000 / 999.999 muestra "custom pricing" → "$20/mo".
- **Arreglo (recomendado):** dejar solo el tamaño de plan y sacar el monto: `Up to ${formatCount(tier.maxProfiles)} profiles` y rotular el bloque `For reference · Estimated Klaviyo plan size`. La letra chica pasa a: `An estimate from the numbers you typed and the plan sizes Klaviyo published on {{prices.capturedOn}}. Suppressed profiles do not count toward your Klaviyo email plan, according to Klaviyo's help center. Whether you change plans is your decision, made in Klaviyo's billing settings.` Si Facundo quiere conservar los montos, como mínimo agregar "Estimated" y la fecha en la misma fila. Es una decisión de cumplimiento (`docs/12-CUMPLIMIENTO-KLAVIYO.md` 3.2), no de diseño. Ajustar los tests `site.test.ts:114` y `:222`.

### A-4 · La página de precios no dice las reglas que más importan al cobrar
- **Dónde:** `/help/pricing` y sección `#pricing`. `help-pricing-1280.png`.
- **Evidencia:** `site/src/pages/help/pricing.html` no menciona: que el precio es el completo aunque se suprima un solo perfil; que hay como máximo un cargo cada 28 días; el tope de US$ 149 por ciclo de Shopify; que el cargo se crea después de la limpieza, cuando Klaviyo confirma; que deshacer no reembolsa; impuestos. Todo eso está en `terms.html:66-72` y en `packages/core/src/charge.ts`.
- **Arreglo:** agregar a `help/pricing.html` una sección:
  ```html
  <h2>When a charge is created</h2>
  <ul>
    <li>Only after a cleanup that suppressed at least one profile, once Klaviyo confirms the suppressions.</li>
    <li>The charge is the full price for your list size, whether the cleanup suppressed one profile or many.</li>
    <li>At most one charge in any 28-day period, even if more than one cleanup runs.</li>
    <li>Never more than $149 in a 30-day Shopify billing cycle.</li>
    <li>Undoing a cleanup does not refund its charge. See <a href="/help/undo">undo</a>.</li>
  </ul>
  <p>Prices exclude taxes, which Shopify may add.</p>
  ```
  (los números 28, 149 y 30 deberían salir de `DEFAULT_FEE_POLICY` con tokens nuevos en `src/data.ts`). En la landing, cambiar el lead de precios (`index.html`, sección pricing) a: `The audit is free. You are charged only in a month when a cleanup suppresses profiles.` Es lo que dice la app (`home-screen.tsx:300`) y es más exacto que "A month in which no cleanup runs is not charged".

### A-5 · La ayuda de "Undo" no cuenta sus límites
- **Dónde:** `/help/undo`. `help-undo-1280.png`.
- **Evidencia:** `site/src/pages/help/undo.html` no dice dónde está el botón (en la app se llama "Restore", en History → la corrida), ni que el undo requiere la app instalada y conectada, ni que no devuelve el cargo, ni que no recupera los mails no enviados, ni que puede no restaurar todos los perfiles. Todo eso está en `terms.html:43-46,72,108`.
- **Arreglo:** agregar:
  ```html
  <h2>How to undo a cleanup</h2>
  <ol>
    <li>Open TierSaver and go to History.</li>
    <li>Open the cleanup you want to correct.</li>
    <li>Click Restore and confirm.</li>
  </ol>
  <h2>Limits of undo</h2>
  <ul>
    <li>It needs the app installed and connected to Klaviyo. After you uninstall, remove suppressions in Klaviyo instead.</li>
    <li>It does not send the emails those profiles missed while they were suppressed.</li>
    <li>It does not refund the charge for that cleanup. See <a href="/help/pricing">how pricing works</a>.</li>
    <li>A profile that was deleted or changed in Klaviyo in the meantime may not be restored. The cleanup's page shows what Klaviyo confirmed.</li>
  </ul>
  ```
  y cambiar el lead a `A cleanup can be undone from the app. Undo exists to correct a mistake: it restores the profiles that cleanup suppressed, and nothing else.`

### A-6 · Faltan artículos de ayuda para pantallas y preguntas básicas
- **Dónde:** `/help/`. Hay 9 artículos; ninguno cubre conectar Klaviyo, permisos, Settings, History, errores de conexión ni contacto. Detalle y esquemas en la sección "Artículos que faltan".

### A-7 · "A sample of the candidates" contra "download the full list"
- **Dónde:** `/help/simulation-and-approval` y landing.
- **Evidencia:** `help/simulation-and-approval.html:16` ("A sample of the candidates") contra `index.html:83` ("lets you download the full list"). La app entrega la lista completa en CSV, por partes (`shopify/app/routes/app.simulation_.candidates.tsx`).
- **Arreglo (`:16`):** `<li>The full list of candidates as a CSV file you can download, so you can check it before you approve.</li>`

### A-8 · Los borradores legales quedan indexables en producción
- **Dónde:** `/terms`, `/privacy`.
- **Evidencia:** ambas están en `sitemap.xml`, tienen canonical y título "(draft)". `site.test.ts:292` prohíbe `meta robots`. En tiersaver.com no hay `X-Robots-Tag`.
- **Arreglo:** se resuelve con X-3 (publicar la versión final). Si el dominio se conecta antes de la revisión legal, agregar en `_headers`:
  ```
  /terms
    X-Robots-Tag: noindex
  /privacy
    X-Robots-Tag: noindex
  ```
  y poner `sitemap: no` en los dos front matter hasta que sean definitivas.

---

## Medios

### M-1 · Menú móvil: "Help" queda cortado y no hay señal de que se desplaza
- **Dónde:** todas las páginas, 390 px. `sheets/home-390-1.png` (se lee "He"), `sheets/help-index-390-1.png`.
- **Evidencia:** `site/styles/site.css:86-99` (`overflow-x: auto`, `gap: 1.75rem`, `white-space: nowrap`).
- **Arreglo:** que entren los cinco enlaces: en `.site-nav ul` usar `gap: clamp(0.75rem, 4vw, 1.75rem); justify-content: space-between;` y en `.site-nav a` `font-size: 0.875rem;` por debajo de 62rem. Alternativa: acortar "How it works" a "How".

### M-2 · Tercera tarjeta de prueba huérfana a 768 px
- **Dónde:** landing, 768 px. `sheets/home-768-1.png`: dos tarjetas arriba y la tercera sola a media anchura.
- **Evidencia:** `site.css:258-260` (`auto-fit, minmax(18rem, 1fr)`).
- **Arreglo:** `@media (min-width: 40rem) and (max-width: 61.99rem) { .proof .grid { grid-template-columns: 1fr; } .proof .card { min-height: 0; } }` o, mejor, tres columnas desde 48rem con `minmax(0, 1fr)` y título a 1.375rem.

### M-3 · Tablas de 4 columnas en móvil: la última columna queda fuera sin aviso
- **Dónde:** `/guides/suppress-vs-delete-vs-unsubscribe`, 390 px. `sheets/guide-svd-390-1.png`: no se ve la columna "Unsubscribe".
- **Evidencia:** `site.css:785-791` y `:1059-1062` (`min-width: 7rem` por celda).
- **Arreglo:** sombra de borde como pista de scroll, sin inline styles:
  ```css
  .table-scroll { background: linear-gradient(to right, var(--surface-1) 30%, transparent), linear-gradient(to left, var(--surface-1) 30%, transparent) 100% 0, linear-gradient(to right, rgba(20,20,20,.12), transparent), linear-gradient(to left, rgba(20,20,20,.12), transparent) 100% 0; background-repeat: no-repeat; background-size: 2.5rem 100%, 2.5rem 100%, 0.75rem 100%, 0.75rem 100%; background-attachment: local, local, scroll, scroll; background-color: var(--surface-1); }
  ```
  y primera columna fija: `.data-table th[scope="row"] { position: sticky; left: 0; background: var(--surface-1); }`.

### M-4 · El list check anuncia el panel entero en cada tecla
- **Dónde:** landing, `#list-check`.
- **Evidencia:** `site/src/partials/list-check.html:35`: `aria-live="polite" aria-atomic="true"` sobre todo `.calc__result`, incluida la letra chica y el enlace.
- **Arreglo:** quitar ambos atributos de `.calc__result` y envolver solo cifra y mensaje: `<div aria-live="polite" aria-atomic="true"><p class="calc__figure" …></p><p class="calc__message" …></p></div>`.

### M-5 · Errores del list check: no dicen qué campo, y un valor mayor que la lista se recorta en silencio
- **Dónde:** landing. `calc-invalid-1280.png`.
- **Evidencia:** `check.ts:192-196` (un único mensaje genérico); `criteriaCount` (`check.ts:88-92`) recorta: con 5.000 activos y 6.000 "que cumplen" muestra "5,000 of 5,000" sin marcar el campo. `main.ts` pone `aria-invalid` pero ningún texto asociado al campo.
- **Arreglo:** tratar `meetingCriteria > activeProfiles` (unidad "profiles") como inválido en `isUsable`, y agregar bajo cada input un `<p class="field__error" id="check-…-error" hidden>` referenciado en `aria-describedby`, con textos: `Enter a whole number, for example 12,500.` / `This cannot be larger than your active profiles.` / `Enter a percentage from 0 to 100.`

### M-6 · Concordancia en singular
- **Evidencia:** `check.ts:211,213-214`: "1 of 10,001 profiles meet the cleanup criteria", "1 stay active", "1 meet the cleanup criteria".
- **Arreglo:** `const meet = n === 1 ? "meets" : "meet"`, `stay`/`stays`; "They would be suppressed" → "It would be suppressed" cuando es 1.

### M-7 · Sin datos estructurados
- **Dónde:** todas las páginas (0 bloques `ld+json`).
- **Arreglo:** en `head()` de `build.mjs` agregar JSON-LD: `Organization` (name TierSaver, url, logo `/assets/apple-touch-icon.png`, email de contacto) en la landing; `FAQPage` con las 7 preguntas; `BreadcrumbList` en páginas `doc`. No poner `AggregateRating` ni `Offer` con precios inventados; los precios pueden ir como `Offer` solo si salen de `FLAT_PRICE_TIERS`. Un bloque `<script type="application/ld+json">` no se ejecuta, así que la CSP no lo bloquea, pero el test `site.test.ts:259` hoy lo rechaza: hay que exceptuar ese `type`.

### M-8 · Descripciones y títulos largos
- **Evidencia:** descripciones de más de 160 caracteres: landing (202), `help/monthly-schedule…` (205), `help/uninstalling` (201), `help/cleanup-criteria` (200), `guides/klaviyo-list-hygiene` (194), `terms` (184). Títulos de más de 60: `guides/klaviyo-list-hygiene` (87), `help/what-suppress-means` (83), `guides/suppress-vs-delete…` (75), `help/cleanup-criteria` (72).
- **Arreglo:** permitir un `seoTitle` opcional en el front matter (el `title` sigue siendo el h1). Propuestas: landing description `TierSaver keeps your Klaviyo list clean by suppressing profiles that never engaged. Simulated first, approved by you, reversible. Nothing is deleted.` (150). `seoTitle`: `Klaviyo list hygiene by hand: a step-by-step guide`, `What "suppress" means in Klaviyo`, `Suppress vs delete vs unsubscribe in Klaviyo`, `Cleanup criteria: who is kept and who is not`.

### M-9 · El footer no tiene contacto y lista solo 5 de 9 artículos
- **Dónde:** todas las páginas. `sheets/home-1280-6.png`.
- **Evidencia:** `build.mjs:53` (`FOOTER_HELP_LINKS = 5`), `:278-309`. Faltan en el footer justo "How pricing works", "What happens on uninstall" y "Data and privacy". No hay enlace a soporte.
- **Arreglo:** en la columna Legal agregar `<li><a href="/help/data-and-privacy">Data and privacy</a></li>` y una columna o línea "Contact": `<a href="/help/#contact">Contact support</a>` y `hello@tiersaver.com`. Shopify pide URL de soporte visible para la ficha.

### M-10 · Áreas vacías en escritorio
- **Dónde:** landing 1280 y 1920. `sheets/home-1280-2.png` (columna izquierda de "How it works": unos 600 px vacíos bajo el título), `sheets/home-1280-5.png` (columna izquierda del FAQ: unos 450 px vacíos), `sheets/home-1280-3.png` (el formulario del list check queda centrado con 130 px vacíos arriba y abajo).
- **Arreglo:** ver "Riqueza visual", puntos 3, 5 y 6. Para el formulario: `site.css:915-917`, cambiar `align-self: center` por `align-self: start`.

### M-11 · Header no fijo: el CTA desaparece en una landing de 6.300 px
- **Evidencia:** `site.css:65-67`.
- **Arreglo:** `.site-header { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); }` solo desde 62rem (en móvil ocupa dos filas) y subir `scroll-padding-top` a `5.5rem`.

### M-12 · La ayuda de criterios omite ajustes que la app sí tiene
- **Evidencia:** `shopify/app/routes/app.settings.tsx:196,200,226`: se puede cambiar la cantidad mínima de mails recibidos, hay una casilla "Ignore opens that Klaviyo flags as automatic (Apple Mail Privacy Protection)", y solo se muestran las primeras 50 listas y 50 segmentos. `help/cleanup-criteria.html:38` afirma sin matices "TierSaver counts those opens as engagement". El modo automático solo existe con los criterios por defecto (`settings.ts:104`) y la ayuda no lo dice.
- **Arreglo (`cleanup-criteria.html:38`):** `By default TierSaver counts those opens as engagement, which is the cautious choice: a flagged open keeps the profile. The wider mode has an option to ignore them.` (confirmar con quien revise la app en qué modo aplica la casilla). Agregar al final de "The wider mode": `Automatic monthly cleanups are only available with the default criteria.`

### M-13 · Números escritos a mano pese a la regla del propio sitio
- **Evidencia:** `src/data.ts:9` dice "No page types one of these numbers by hand", pero: `help/monthly-schedule…html:16` ("24 hours", existe `{{sim.ttlHours}}`); `terms.html:44` ("365 days", existe `{{criteria.undoLockDays}}`), `:67` ("28-day"), `:68` ("$149", "30-day"); descripciones del front matter de `help/cleanup-criteria.html:4` y `help/undo.html:4` ("365 days"); `privacy.html` y `help/data-and-privacy.html` ("7 days", "24 hours", "10 minutes", "48 hours").
- **Arreglo:** usar los tokens existentes, agregar `fee.minDays`, `fee.capUsd` desde `DEFAULT_FEE_POLICY`, y pasar `fill()` también por los campos del front matter.

### M-14 · `brand/README.md` se contradice
- **Evidencia:** arriba dice que Facundo eligió el logo B; más abajo siguen "Recomendación: C · Dropped T", "Pendiente: Elegir logo (Facundo)" y "Aprobar los mensajes". `brand/messaging.md` dice "Open decision for the owner… change it to 'TierSaver: List Hygiene for Klaviyo'" cuando ese ya es el descriptor decidido.
- **Arreglo:** dejar la recomendación como historia ("se recomendó C; se eligió B") y borrar los dos pendientes ya resueltos. Queda sin resolver, y conviene decirlo ahí, que el concepto del logo ("bajar un escalón") va contra el posicionamiento de higiene (`docs/03-MARCA.md`, sección Logo).

### M-15 · Tamaños de toque por debajo de 24 px
- **Dónde:** 390 px. Enlaces del menú (alto 19 px), del footer (19 px) y enlaces en línea (17–20 px). Datos en `report.json` (`small`).
- **Nota:** WCAG 2.1 AA no fija mínimo (2.5.5 es AAA); WCAG 2.2 AA pide 24 px o separación equivalente, que el footer cumple justo (19 + 8 de margen).
- **Arreglo:** `.site-nav a, .site-footer__col a { display: inline-block; padding-block: 0.375rem; }` y bajar `.site-footer__col li + li { margin-top: 0.125rem; }`.

---

## Bajos

- **B-1 · Sin `/favicon.ico`** (404). Agregar un `.ico` de 32 px en la raíz; algunos rastreadores y Slack lo piden sin leer el `<link>`.
- **B-2 · Sin `_redirects`.** No hay regla `www → apex` ni alias obvios (`/pricing`, `/faq`, `/support`, `/contact`). Sugerido: `/pricing /#pricing 302`, `/faq /#faq 302`, `/support /help/#contact 302`, `/contact /help/#contact 302`. El `www` se resuelve al conectar el dominio.
- **B-3 · HSTS sin `includeSubDomains`** (`_headers:11`). Agregarlo cuando el dominio esté en la cuenta; `preload` solo si Facundo lo decide. Opcional: `Cross-Origin-Resource-Policy: same-origin`.
- **B-4 · CSS y JS sin política de caché propia.** `/fonts/*` tiene `immutable` (bien, aunque los nombres no llevan hash: si se cambia una fuente hay que renombrarla). Para `/styles/*` y `/assets/*` alcanza el ETag por defecto de Workers; si se quiere, `Cache-Control: public, max-age=3600`.
- **B-5 · Tres hojas de estilo bloqueantes** (`build.mjs:233-235`): 29 KB sin comprimir en tres requests. Concatenarlas en el build ahorra dos viajes. Impacto chico.
- **B-6 · `og:image` y canonical apuntan a tiersaver.com**, que todavía no sirve el sitio: en el staging las vistas previas al compartir salen sin imagen. Esperable; se corrige solo al conectar el dominio. Falta `og:locale` (`en_US`) y `twitter:title`/`twitter:description` (caen en los `og:`; no es obligatorio).
- **B-7 · Sin `manifest.webmanifest`** aunque la CSP lo permite. Opcional.
- **B-8 · Los `h2` de los artículos no tienen `id`**: soporte no puede enlazar a una sección. Generar `id` desde el texto en `docMain()`.
- **B-9 · Columnas del footer con `<h2>`** (`build.mjs:281-303`): cuatro encabezados de nivel 2 que no son contenido. Pasarlos a `<p class="label">` con `<nav aria-label="…">`.
- **B-10 · Las fechas "Last updated" van en ISO** (2026-11-25) y la fecha efectiva en inglés largo. Unificar en "November 25, 2026" para lo que lee el merchant.
- **B-11 · Enlaces externos a Klaviyo** con `rel="noopener noreferrer"` y misma pestaña: correcto. Sus URL no llevan slug; verificar que resuelvan (no se pudo desde acá).
- **B-12 · Sin modo oscuro.** Si se decide no hacerlo, declarar `color-scheme: light` en `:root` para que el navegador no pinte controles oscuros. Si se hace, los tokens ya están centralizados en `tokens.css`.

---

## Accesibilidad (WCAG 2.1 AA): detalle

Contraste calculado desde `site/styles/tokens.css`:

| Par | Uso | Ratio | Resultado |
| --- | --- | --- | --- |
| `muted` #5f5e59 sobre `bg` #eeeeec | etiquetas, notas | 5,59 | Pasa |
| `muted` sobre `surface-2` #e4e4e1 | letra chica del list check | 5,10 | Pasa |
| `muted` sobre `surface-3` #dadad6 | etiqueta de la tarjeta de énfasis | 4,64 | Pasa, justo |
| `faint` #7f7c76 sobre `bg` | mitad gris de los titulares (≥ 24 px) | 3,58 | Pasa solo como texto grande. No usar en texto chico |
| `alert` #b34a23 sobre `bg` | "Draft, pending review." | 4,61 | Pasa, justo |
| `line-strong` #85827b sobre `surface-deep` | etiqueta del panel oscuro | 4,96 | Pasa |
| `accent-warm` sobre `surface-deep` | titular del panel oscuro | 12,06 | Pasa |
| `line-strong` sobre blanco / `bg` | borde de inputs / botón secundario | 3,83 / 3,30 | Pasa (3:1 no textual) |
| `surface-3` sobre blanco | tramo "never engaged" de la barra | 1,40 | No llega a 3:1, pero la leyenda da los dos números en texto: aceptable |

- Encabezados: un `h1` por página, sin saltos (`report.json`, campo `heads`). En la landing los tres `h2` de las tarjetas de prueba son frases completas: válido.
- Landmarks: `header`, `nav aria-label="Main"`, `main#main`, `footer`, `aside > nav` con etiqueta, migas con `aria-current`. Bien.
- Imágenes: logo con `alt="TierSaver"`, marca decorativa con `alt=""`, SVG de la barra con `aria-hidden`. Bien.
- Formulario: `label for` en el primer campo; el segundo usa `legend` + `aria-label` + `aria-describedby`; los radios van dentro de `fieldset`. El grupo "Profiles / % of list" no tiene nombre propio: agregar `role="group" aria-label="Unit"` al `.segmented`.
- Teclado: orden lógico, foco de 2 px en todo (`focus-skiplink-1280.png`), radios con foco en la píldora (`site.css:437-440`), FAQ con `details/summary`, tablas desplazables con `tabindex="0"` y `role="region"`. Enter en un input no recarga la página.
- Reflow: sin scroll horizontal a 320 px (`home-320.png`).
- Movimiento: `prefers-reduced-motion` anula transiciones y scroll suave.
- Sin JavaScript (`calc-nojs-1280.png`): el ejemplo se ve, los campos quedan deshabilitados y hay aviso en `<noscript>`. Bien.
- Pendientes: M-4, M-5, M-15, M-3.

## Rendimiento y seguridad: detalle

- Landing: 10 requests, todos same-origin. HTML 5,8 KB gz; CSS 7,5 KB gz (3 archivos); JS 2,9 KB gz (`defer`); fuentes 59 KB (3 woff2, dos con `preload`, `font-display: swap`); logo SVG 2,2 KB gz. Total ≈ 78 KB.
- Fuentes: Inter Tight e IBM Plex Mono, subset latin, autoalojadas, con sus licencias SIL OFL 1.1 publicadas en `/fonts/OFL-*.txt`. Uso correcto.
- Imágenes: solo SVG y tres PNG de íconos/OG (57 KB el OG, no se carga en la página). Cuando se sumen imágenes, usar AVIF/WebP con `width`/`height`, `loading="lazy"` bajo el pliegue y nombres con hash si van a `immutable`.
- Headers (`site/_headers`): CSP `default-src 'none'` con todo en `'self'`, `frame-ancestors 'none'`, `form-action 'none'`, `base-uri 'none'`; `nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` restrictiva; COOP; HSTS de un año. Bien. Ver B-3.
- `noindex` solo en workers.dev: la intención es correcta (`_headers:17-18`); falta comprobar en el staging real con `curl -sI` que el header sale y que **no** sale en el dominio propio.
- Archivos internos no publicados: `/src/*`, `/build/*`, `/test/*`, `/package.json`, `/wrangler.jsonc`, `/styleguide.html`, `/_headers` devuelven 404. Bien.
- 404: status 404 real con página propia, sin canonical, fuera del sitemap. Bien.
- Redirecciones: `/index.html → /`, `/help → /help/`, `/privacy.html → /privacy`, `/terms/ → /terms` (307, igual que Workers).
- `robots.txt`: `Allow: /` + sitemap. `sitemap.xml`: 16 URL, todas con canonical coincidente, sin `lastmod` (agregarlo desde `updated` es fácil y útil).
- Cookies y terceros: ninguno. Coincide con lo que afirman `privacy.html:115` y `help/data-and-privacy.html:64`.

---

## Riqueza visual: dónde y cómo

Diagnóstico mirando `sheets/home-1280-*.png`: la página es correcta pero es una sola superficie gris (#eeeeec) de arriba abajo, con tarjetas blancas del mismo peso y ninguna imagen salvo la marca en el panel final. Todo el ritmo depende de la tipografía. No hay ni una vista del producto.

Dos condiciones antes de sumar nada:

1. **Regla de marca.** `docs/03-MARCA.md` dice "interfaz neutra: el color aparece poco y con significado", "sin sombras" y "accent-warm: único acento, sobre paneles oscuros". Orbes de gradiente sobre el fondo claro cambian esa regla. Es decisión de Facundo; la propuesta de abajo usa solo tokens existentes y opacidad baja para que el cambio sea mínimo.
2. **Técnica.** La CSP es `img-src 'self'; style-src 'self'` y los tests prohíben `style=""` y `<style>`: todo va como archivo en `site/assets/` y clases en `site.css`. Los orbes se hacen con `radial-gradient` en CSS (cero peso). Nada de imágenes de stock con personas ni logos de terceros.

Propuestas, en orden de impacto:

1. **Hero: orbes + captura real del producto.** (`sheets/home-1280-1.png`)
   - CSS: `.hero { position: relative; isolation: isolate; overflow: clip; }` y
     `.hero::before { content: ""; position: absolute; z-index: -1; inset: -20% -10% auto 45%; height: 46rem; background: radial-gradient(closest-side, rgba(232,201,162,.55), rgba(232,201,162,0) 70%); }`
     `.hero::after { content: ""; position: absolute; z-index: -1; inset: 30% 55% auto -15%; height: 34rem; background: radial-gradient(closest-side, rgba(218,218,214,.9), rgba(218,218,214,0) 70%); }`
   - Imagen: `assets/hero-review.avif` + `.webp` (1280 × 800, objetivo < 70 KB), la pantalla "Review and approve" de la app con datos de ejemplo (base: `docs/launch/screenshots/03-review-and-approve.png`, rehacer sin datos reales). Va detrás y a la derecha de la tarjeta `.sim`, con radio 20 px y hairline, y la tarjeta `.sim` superpuesta abajo a la izquierda (`margin: -6rem 0 0 -2rem` desde 62rem). Alt: `The review screen in TierSaver, showing example numbers.` Con `fetchpriority="high"` y dimensiones fijas para no mover el layout.
2. **Tarjetas de prueba: una ilustración de línea por tarjeta.** (`sheets/home-1280-1.png`) Tres SVG de 56 × 56, trazo 1,5 px en `ink` con un punto en `accent-warm` solo en la tarjeta de énfasis: `assets/art-orders.svg` (recibo con tilde), `assets/art-simulate.svg` (lista con lupa), `assets/art-archive.svg` (caja con historial). Slot: `<img class="card__art" alt="" width="56" height="56">` antes de la etiqueta; `.card__art { margin-bottom: auto; }`. Arregla de paso el hueco interno de las tarjetas 02 y 03.
3. **"How it works": llenar la columna fija.** (`sheets/home-1280-2.png`) Bajo el lead, un diagrama vertical `assets/flow-steps.svg` (320 × 420): cinco nodos unidos por una línea (Audit → Simulate → Protect → Suppress → Undo), con el nodo "Simulate/approve" resaltado. Alternativa con más producto: una miniatura de captura por paso en una tercera columna desde 70rem (`.steps > li { grid-template-columns: 9rem minmax(0,1fr) 14rem; }`, imágenes 448 × 280 webp, `loading="lazy"`).
4. **Bandas de superficie para cortar el gris.** Alternar fondo a todo el ancho: `.section--band { background: var(--surface-1); }` en "List health check" (el panel pasa a `surface-2`/`bg`) y `.section--deep` (fondo `surface-deep`, texto claro) para la sección de precios o las tres pruebas. Es el cambio más barato y el que más ritmo da.
5. **FAQ: tarjeta de contacto bajo el título.** (`sheets/home-1280-5.png`) En la columna izquierda vacía, una `.tile` fija: etiqueta `Still unsure?`, texto `Write to support@tiersaver.com. A person answers.` y la marca chica. Sin imagen.
6. **Precios: glifo de tamaño de lista.** (`sheets/home-1280-4.png`) En cada `.plan`, arriba a la derecha, un SVG de 4 barras donde se llenan 1, 2, 3 o 4 según el tramo (`assets/tier-1.svg` … `tier-4.svg`, 40 × 40, `alt=""`). Da lectura inmediata de "crece con la lista" sin sumar color.
7. **Panel de cierre: orbe cálido detrás de la marca.** (`sheets/home-1280-6.png`) `.closing .panel::after { content: ""; position: absolute; inset: -30% -10% -30% 50%; background: radial-gradient(closest-side, rgba(232,201,162,.28), transparent 70%); }` y subir la marca a 18rem. Es el único lugar donde el acento ya está permitido.
8. **Índice de ayuda y 404.** (`sheets/help-index-1280-1.png`, `404-1280.png`) Ilustración de línea a la derecha del `h1` desde 62rem (`assets/art-help.svg`, 280 × 200) y la marca grande en `surface-3` en el 404. Íconos de 24 px en las tarjetas del índice, opcionales.
9. **OG por página.** Hoy todas comparten `og-image.png`. Generar una variante por guía con su título (`images.mjs` ya compone la tarjeta).

Lo que no conviene: fotos de stock, logos de Klaviyo o Shopify, "trusted by" con marcas, contadores animados, capturas con números que parezcan resultados de clientes (toda captura lleva el rótulo "Example" como ya hace `.sim`).

---

## Texto: coherencia y exactitud

Cruzado con `docs/04-PRECIO-Y-COBRO.md`, `packages/core` y `shopify/app`.

| Tema | Sitio | App / docs | Estado |
| --- | --- | --- | --- |
| Tramos y precios | 15 / 29 / 79 / 149; más de 150.000 "Contact us" | `FLAT_PRICE_TIERS` | Coincide (sale de core) |
| Base del precio | Perfiles activos antes de la limpieza | `charge.ts` (`activeProfiles` de la auditoría) | Coincide; el list check también usa el conteo previo |
| Cuándo se cobra | "A month in which no cleanup runs is not charged" | Solo si suprimió ≥ 1 perfil; 1 cargo cada 28 días; tope 149 | Incompleto: A-4 |
| Auditoría | "free and read-only" | Crea un segmento | Inexacto: A-1 |
| Lista de candidatos | "full list" / "a sample" | CSV completo | Contradicción interna: A-7 |
| Aviso mensual | "emails you a summary" | No hay envío de mail | Falso: X-4 |
| Vigencia de la simulación | 24 horas | `SIMULATION_TTL_MS` | Coincide |
| Días antes de la renovación | 5 | `DEFAULT_SCHEDULE.leadDays` | Coincide |
| Bloqueo tras undo | 365 días | `reactivationLockDays` | Coincide |
| Desinstalar | Tokens al instante, resto a las 48 h | `webhooks.app.uninstalled.tsx`, webhooks de cumplimiento | Coincide |
| Qué se guarda | IDs, hashes, tokens cifrados | Coincide con privacidad; no se auditó el esquema (otro revisor) | Coincide en lo visto |
| Nombres en la app | "undo", "run" | La app dice "Restore", "cleanup", "History" | Unificar: usar "cleanup" (no "run") y nombrar el botón "Restore" donde se explica cómo hacerlo |

Términos mezclados a unificar: "run" / "cleanup" (la app usa "cleanup"); "list health check" / "List check" (menú) / "list audit" (CTA) son tres cosas con nombres parecidos: el chequeo público del sitio y la auditoría de la app. Sugerido: menú "List check", sección "List health check", y que el CTA quede como "Run my free list audit" solo cuando lleve a la app.

Sin errores de tipeo encontrados. Sin signos de exclamación. Sin palabras de la lista prohibida de `brand/messaging.md`. "always" aparece en "always kept" y "The first cleanup is always manual" (ambas ciertas en el código); "never deletes" es cierto.

Marcas: "Klaviyo" y "Shopify" solo como texto descriptivo; sin logos, colores ni "partner/official". El aviso de no afiliación está en el footer de todas las páginas y en los términos. La etiqueta del hero "Works with Klaviyo" es aceptable como compatibilidad.

Entidad legal: el footer y los legales nombran "Digital Solvers LLC, 153 E Flagler St, Miami". No es ninguna de las tres marcas vetadas; confirmar con Facundo que es la entidad que quiere mostrar.

## Páginas legales: presentación

- Legibles: columna de 42rem, 17 px, jerarquía clara, tabla de precios y de subencargados con scroll propio. Las secciones 11 y 12 en mayúsculas y negrita son densas pero intencionales.
- Fechadas: "Last updated · Draft of 2026-11-26" y "Effective date: November 26, 2026".
- Cartel de borrador: presente en ambas, con `role="note"`. Texto incoherente con la fecha efectiva y con los corchetes: X-3.
- Versión: coincide con `TERMS_VERSION = "2026-11-26"`.
- Contacto: entidad, dirección postal, `hello@` y `support@` en términos (sección 18) y privacidad (secciones 1 y 14). Las casillas no existen: X-2.
- `docs/15-LANZAMIENTO-MATERIALES.md` (puntos 2 a 5) dice que faltan cláusulas que el sitio ya tiene redactadas (sección 12, ley aplicable, retención). El documento quedó atrás del sitio.

---

## Artículos que faltan en el centro de ayuda

Existen 9: auditoría, criterios, simulación y aprobación, qué es suprimir, undo, calendario y plan, precios, desinstalar, datos y privacidad. Faltan:

1. **Getting started: install and connect Klaviyo** (`/help/getting-started`, orden 0)
   - What you need (tienda Shopify, cuenta de Klaviyo con rol Owner o Admin).
   - Install from the Shopify App Store.
   - Connect Klaviyo: clic en "Connect Klaviyo", iniciar sesión, aprobar; se vuelve a la app con "Klaviyo is connected".
   - Run the free audit; cuánto tarda.
   - What to do next (enlaces a simulación y precios).

2. **Permissions TierSaver asks for, and why** (`/help/permissions`)
   - Shopify: `read_orders` (y el acceso al historial completo y a datos protegidos cuando se pida), con el porqué de cada uno.
   - Klaviyo, uno por uno con su motivo (`shopify/app/klaviyo/config.ts:39-63`): accounts:read, profiles:read, profiles:write, subscriptions:read, subscriptions:write, lists:read, segments:read, segments:write, metrics:read.
   - What it does not ask for (events, campaigns, flows, billing).
   - The one segment it creates, con su nombre exacto.
   - How to revoke access (Disconnect en la app; en Klaviyo, Settings → Integrations).

3. **What suppression changes in your campaigns, flows and SMS** (`/help/after-a-cleanup`)
   - Campaigns and flows: Klaviyo omite a los suprimidos al enviar; las métricas de envío bajan en esa cantidad.
   - Segments and lists: los perfiles siguen como miembros; los conteos no cambian.
   - SMS and push: sin cambios (ya está en `what-suppress-means.html:18`).
   - Transactional email: **verificar en la documentación vigente de Klaviyo antes de escribirlo**; no afirmarlo de memoria.
   - Sign-up forms: qué pasa si un suprimido vuelve a suscribirse.
   - The banner "Profiles from an earlier cleanup are active again" (`home-screen.tsx:142`): qué significa y qué hacer.

4. **Settings: criteria, protected lists and the monthly schedule** (`/help/settings`)
   - Who counts as inactive: modo por defecto y modo amplio, con cada campo de la pantalla.
   - Protected lists and segments: cómo marcarlos; límite de 50 listas y 50 segmentos mostrados.
   - Monthly schedule: día de renovación, días de anticipación (por defecto 5, mínimo 4), encender y apagar.
   - Automatic mode: qué autoriza, requisitos (criterios por defecto, calendario encendido), cómo apagarlo.
   - Changing a setting discards pending simulations.

5. **History: reading a cleanup's page** (`/help/history`)
   - Estados: queued, running, completed, completed with errors, stopped.
   - "Check jobs in Klaviyo": qué confirma.
   - Quién lo inició y con qué criterios.
   - Restore (enlace a undo).

6. **Troubleshooting** (`/help/troubleshooting`)
   - "Reconnect Klaviyo": el acceso venció o fue revocado.
   - "The last audit could not finish": causas y qué hacer.
   - The audit found no candidates (tienda nueva, sin acceso al historial de pedidos, datos incompletos).
   - "Your rules or protected lists changed after this audit".
   - The simulation expired or is out of date.
   - A cleanup stopped or finished with errors.
   - The CSV "could not be prepared".
   - Klaviyo's count has not changed yet (hasta 72 horas).
   - Two segments with TierSaver's name (la app no usa ninguno: `api.ts:731`).
   - Qué mandar a soporte.

7. **Billing questions** (ampliar `/help/pricing` o `/help/billing`)
   - When a charge is created; the 28-day rule; the cap (A-4).
   - Approving the charge in Shopify ("Review pricing in Shopify").
   - Where the charge appears on the Shopify invoice.
   - Undo and refunds; charged in error.
   - Lists above 150,000; price changes.
   - How to stop being charged (apagar el calendario o desinstalar).

8. **Contact support** (`/help/contact`; hoy es solo un ancla en el índice)
   - `support@tiersaver.com`, qué incluir, qué no mandar (mails de clientes, claves).
   - Horario y tiempo de respuesta, **solo si Facundo se compromete a uno** (los términos dicen que no hay compromiso).
   - Privacidad y legales: `hello@tiersaver.com`.

9. **Disconnecting Klaviyo without uninstalling** (puede ir dentro de `uninstalling`)
   - Qué hace "Disconnect Klaviyo", qué queda guardado, cómo reconectar, qué pasa con el calendario.

---

## Orden sugerido

1. X-1, X-2, X-4, A-1, A-2, A-7 (textos y enlaces; una tarde).
2. A-4, A-5, artículos 1, 2, 6 y 8.
3. Decisión de Facundo sobre A-3 (montos de Klaviyo en el list check) y sobre la regla de marca para los orbes.
4. X-3 y A-8 cuando vuelva el abogado.
5. M-1, M-2, M-3, M-10 y la tanda visual.
6. Verificar contra el staging: header `noindex`, enlaces a Klaviyo, precios de lista.
