# Ficha del Shopify App Store · lista para copiar y pegar

Preparada el 2026-11-26 (carpeta de capturas fechada 2026-11-27). **Nada se cargó ni se envió**: el envío a revisión lo dispara Facundo. La app todavía no está publicada; ningún texto dice que lo esté. Reemplaza los borradores de ficha de `docs/15-LANZAMIENTO-MATERIALES.md` y de `docs/07-LANZAMIENTO.md` (los textos de Introduction, Details y Features son los mismos, sin cambios).

Los conteos de caracteres los imprime `gen.py` (copiado en `screenshots/2026-11-27/tools/`); no están contados a mano.

## Qué se verificó en shopify.dev el 2026-11-26

| Dato | Valor | Fuente |
| --- | --- | --- |
| App name | 30 caracteres máx.; empieza con la marca propia | https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices (5.A.1) y requisito 4.1.2 |
| App icon | 1200 × 1200 px, JPEG o PNG, sin texto, con margen (Shopify redondea las esquinas) | best-practices 5.A.2; https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review |
| Feature media | Video promocional de 2 a 3 minutos (screencast: 25 % del video como máximo) **o** imagen de 1600 × 900 px (16:9), un solo foco, fondo sólido, sin logos de Shopify, sin repetir el subtítulo, con alt text | best-practices 5.B.1 |
| Screenshots | 1600 × 900 px (16:9); de 3 a 6 de escritorio, al menos una de la UI; sin marco de navegador ni fondo de escritorio; sin precios, reseñas ni garantías de resultado; con alt text; cada imagen distinta | best-practices 5.B.3; requisitos 4.2.2, 4.4.4, 4.4.5 |
| App introduction | 100 caracteres | best-practices 5.B.4 |
| App details | 500 caracteres; sin links, soporte ni testimonios | best-practices 5.B.5; requisito 4.4.2 |
| Feature list | hasta 80 caracteres por ítem | best-practices 5.B.6 |
| Integrations | hasta 6 | best-practices 5.B.7 |
| Pricing | un método principal (Free to install, Recurring charge u One-time payment); con plan gratis y pagos se elige Recurring charge y se marca un plan como Free; lo demás va en "Description of additional charges"; precios solo en esta sección | best-practices 5.C; requisitos 4.2.1 a 4.2.3 |
| Search terms | hasta 5, palabras completas, una idea por término | best-practices 5.E |
| App card subtitle | sin datos ni estadísticas, sin relleno de palabras clave | requisito 4.4.1 |
| Privacy policy URL | obligatoria; Terms of Service URL opcional | best-practices 5.E |
| Screencast para la revisión | obligatorio, en inglés o con subtítulos en inglés, mostrando la configuración y las funciones; **la documentación no fija una duración** | requisito 4.5.3; best-practices 5.G |
| Credenciales de prueba | en las instrucciones, sin 2FA, y tienen que seguir funcionando después de publicar | requisitos 4.5.4 y 4.5.5 |
| Sin estadísticas, "the first / the best / the only", ni testimonios | en textos e imágenes | requisitos 4.3.3, 4.3.4, 4.3.6 |

Páginas leídas: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements · https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices · https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review (las tres el 2026-11-26).

**Sin verificar** (la documentación pública no lo dice; se ve recién en el formulario del Partner Dashboard): el límite del subtítulo (trabajo con 62 como supuesto), el largo máximo de cada search term (supuesto: 20), los límites de title tag y meta description (supuestos: 60 y 160), el largo del nombre de cada plan y de sus ítems, el árbol exacto de categorías y tags, y el orden exacto de los campos. Donde un campo dice "límite sin verificar", ese número es el supuesto de trabajo.

## 1. Marca

**App name** · 21 / 30 caracteres

```
TierSaver for Klaviyo
```

**App icon**: `brand/logo/final/app-icon.png` (1200 × 1200 px, PNG, sin transparencia y sin texto). Cumple el formato verificado.

## 2. Contenido de la ficha

**Feature media**: imagen `screenshots/2026-11-27/listing/00-feature-image.png` (1600 × 900). El video de 60 a 90 segundos de `video.md` es una grabación de pantalla completa, y Shopify pide que el screencast no pase del 25 % del video destacado: por eso va la imagen y no el video. Decisión de Facundo si prefiere otra.

**Demo store URL**: dejar vacío por ahora. Si se arma una tienda de demostración, el link va directo a la página de la app.

**Screenshots** (cinco, 1600 × 900, en este orden) y su alt text (el formulario limita el alt text a 64 caracteres; visto en el formulario el 2026-11-27):

- Feature image: `screenshots/2026-11-27/listing/00-feature-image.png` · alt (137 caracteres): `TierSaver for Klaviyo: the list audit card with example data, next to the line 'Suppress profiles that never engaged. After you approve.'`
- Screenshot 1: `screenshots/2026-11-27/listing/01-audit.png` · alt (61 caracteres): `List audit with example data: profiles that meet the criteria`
- Screenshot 2: `screenshots/2026-11-27/listing/02-review-and-approve.png` · alt (60 caracteres): `Review screen: download candidates and read before approving`
- Screenshot 3: `screenshots/2026-11-27/listing/03-cleanup-running.png` · alt (49 caracteres): `A cleanup in progress, with a Stop cleanup button`
- Screenshot 4: `screenshots/2026-11-27/listing/04-cleanup-log-and-restore.png` · alt (56 caracteres): `Completed cleanup: who approved it, the rule and Restore`
- Screenshot 5: `screenshots/2026-11-27/listing/05-settings.png` · alt (59 caracteres): `Settings: inactivity criteria, protected lists and schedule`

Las cinco de `listing/` no muestran precios (requisito 4.2.2). Las de `raw/` sí muestran el plan y **no van en la ficha**. Detalle en `screenshots/2026-11-27/INDEX.md`.

**App introduction** · 99 / 100 caracteres

```
Keep your Klaviyo list clean: suppress profiles that never engaged, after you approve a simulation.
```

**App details** · 469 / 500 caracteres

```
Run an audit to see how many profiles meet the criteria Klaviyo publishes for suppressing unengaged profiles: never opened, clicked, visited or purchased. Every profile is checked against your Shopify orders. SMS subscribers and the lists you protect are always kept. You review and approve a simulation before anything changes. Profiles are suppressed, never deleted, and a cleanup can be restored from the app. TierSaver is not affiliated with or endorsed by Klaviyo.
```

**Feature list** (80 por ítem)

```
List audit that changes no profile
The criteria Klaviyo publishes, by default
Buyers protected with your Shopify order data
Simulation and approval before every cleanup
A log of every cleanup, with restore
```

- 34 / 80 · List audit that changes no profile
- 42 / 80 · The criteria Klaviyo publishes, by default
- 45 / 80 · Buyers protected with your Shopify order data
- 44 / 80 · Simulation and approval before every cleanup
- 36 / 80 · A log of every cleanup, with restore

**Integrations** (hasta 6): `Klaviyo`

## 3. Precio

Método principal: **Recurring charge**, con un plan marcado como Free (así lo indica Shopify para apps con uso gratis y planes pagos). Sin prueba gratis por días: lo gratis es todo lo anterior a la primera limpieza. Si el formulario no admite un plan Free sin funciones de limpieza, se sacan ese plan y sus ítems y queda solo el texto de cargos adicionales. **A confirmar por Facundo al cargar**, junto con el largo máximo del nombre del plan.

| Plan | Precio | Ítems del plan |
| --- | --- | --- |
| Audit and simulation (20) | Free | Connect Klaviyo (15) · List audit (10) · Simulation with downloadable candidate list (43) · No cleanups (11) |
| Up to 10,000 profiles (21) | $9 / month | Lists up to 10,000 active profiles (34) · Manual and scheduled cleanups (29) · Log and restore (15) |
| Up to 25,000 profiles (21) | $19 / month | Lists up to 25,000 active profiles (34) · Manual and scheduled cleanups (29) · Log and restore (15) |
| Up to 75,000 profiles (21) | $39 / month | Lists up to 75,000 active profiles (34) · Manual and scheduled cleanups (29) · Log and restore (15) |
| Up to 150,000 profiles (22) | $79 / month | Lists up to 150,000 active profiles (35) · Manual and scheduled cleanups (29) · Log and restore (15) |

Nombres cortos de reserva si el campo no admite los de arriba: `Audit`, `10K profiles`, `25K profiles`, `75K profiles`, `150K profiles`.

**Description of additional charges** · 423 caracteres (sin límite publicado)

```
Free to install. The plan starts when you approve your first cleanup. Connecting Klaviyo, the audit and the simulation need no plan. The plan is set by the size of your list and billed by Shopify every 30 days, whether or not a cleanup runs that month, until you cancel in Settings or uninstall. A higher price only applies after you approve it in Shopify. Lists above 150,000 active profiles: write to hello@tiersaver.com.
```

Precios y tramos: `FLAT_PRICE_TIERS` en `packages/core/src/charge.ts` (decisión de Facundo del 2026-11-26).

## 4. Descubrimiento

**App card subtitle** · 57 / 62 caracteres (límite sin verificar)

```
Automatic list hygiene for Klaviyo, with preview and undo
```

**Search terms** (hasta 5; largo por término sin verificar, supuesto 20)

- `Klaviyo list cleanup` · 20
- `list hygiene` · 12
- `suppress profiles` · 17
- `inactive profiles` · 17
- `unengaged profiles` · 18

Se sacó `sunset flow` del borrador anterior: la app no arma un flujo de sunset.

**Categoría y tags** (árbol sin verificar; elegir lo más cercano en el formulario): principal *Marketing and conversion → Marketing → Email marketing*; secundaria, si se permite, *Store management → Operations → Workflow automation*. Structured features: marcar solo lo que la app hace (limpieza o segmentación de listas, si existe la opción); nada de envío de mails, pop-ups ni SMS.

**Title tag** · 59 / 60 caracteres (límite sin verificar)

```
TierSaver for Klaviyo: list hygiene with review and restore
```

**Meta description** · 160 / 160 caracteres (límite sin verificar)

```
Suppress the Klaviyo profiles that never engaged, after you review and approve a simulation. Buyers are checked against your Shopify orders. Nothing is deleted.
```

**Languages**: English (la app solo está en inglés; requisito 4.3.2).

## 5. Soporte y links

Los dominios todavía no existen: son los definitivos, y cada uno corresponde a una página que ya está en `site/src/pages/` (el sitio sirve URLs sin `.html`).

| Campo | URL | Página en el repo |
| --- | --- | --- |
| Privacy policy URL (obligatoria) | `https://tiersaver.com/privacy` | `site/src/pages/privacy.html` |
| Terms of Service URL (opcional) | `https://tiersaver.com/terms` | `site/src/pages/terms.html` |
| Developer website | `https://tiersaver.com/` | `site/src/pages/index.html` |
| FAQ URL | `https://tiersaver.com/help/` | `site/src/pages/help/index.html` |
| Support portal | `https://tiersaver.com/help/contact` | `site/src/pages/help/contact.html` |
| Tutorial | `https://tiersaver.com/help/getting-started` | `site/src/pages/help/getting-started.html` |
| Additional documentation | `https://tiersaver.com/help/what-suppress-means` | `site/src/pages/help/what-suppress-means.html` |
| Pricing (para citar en respuestas) | `https://tiersaver.com/help/pricing` | `site/src/pages/help/pricing.html` |
| Data processing addendum | `https://tiersaver.com/dpa` | `site/src/pages/dpa.html` |
| Support email | `support@tiersaver.com` | casilla todavía sin crear |
| App submission email | `hello@tiersaver.com` (o la que Facundo lea a diario) | casilla todavía sin crear |

Términos, privacidad y DPA adoptados por el dueño sin revisión externa el 2026-11-26 (`docs/16-LEGALES.md`); sin cartel de borrador desde el próximo despliegue del sitio.

## 6. Requisitos de instalación

**Cambio del 2026-11-27 (decisión de Facundo):** TierSaver no se ofrece a tiendas ubicadas en la UE/EEE, el Reino Unido (con Gibraltar, Guernsey, Jersey e Isla de Man) ni Suiza (`docs/16-LEGALES.md` §2.4). La app ya lo hace cumplir del lado del servidor (`shopify/app/markets.ts`): esas tiendas ven una página que lo explica y no pueden conectar Klaviyo, auditar, aprobar, iniciar un plan ni limpiar.

**Requisito geográfico en la ficha (verificado el 2026-11-27):**

- Requisito 4.3.8 de la App Store: "Specify geographic requirements or specific API permissions in your app's listing if they are needed for your app to function. Only merchants in the correct geographic location ... will then be able to install your app." (https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements.md, leído 2026-11-27).
- Centro de ayuda de Shopify: si la tienda no cumple los requisitos de instalación, la app figura como "Not compatible" y no se puede instalar; el requisito geográfico es "The app works with stores with a primary business address in a country that the app supports" (https://help.shopify.com/en/manual/apps/choosing-apps, leído 2026-11-27).
- Es una **lista de países admitidos**, no de excluidos: al cargar la ficha hay que marcar todos los países salvo los de `EXCLUDED_COUNTRY_CODES` en `shopify/app/markets.ts`. El nombre exacto del campo en el formulario no se pudo ver (el changelog de 2019 que lo anunció devuelve 404); **a confirmar por Facundo al cargar**. Hay reportes de la comunidad de tiendas fuera de la lista que igual instalaron (sin verificar), por eso el control del servidor queda como defensa principal.
- Aclarar en el campo de requisitos, si lo hay: `Requires a Klaviyo account. Not available for stores in the European Union, the EEA, the United Kingdom or Switzerland.`

**Texto de la ficha:** "App details" está en 469/500 caracteres y no entra la aclaración; va en el requisito geográfico (que Shopify muestra como "Not compatible") y en las instrucciones de revisión. Si el formulario tiene un campo de requisitos visible para el merchant, usar la frase de arriba.

## 7. Revisión: instrucciones de prueba

**Versión para el formulario (el campo admite 2800 caracteres, visto el 2026-11-27): 2522 caracteres.** Etiquetas comparadas con `shopify/app/routes/` y `shopify/app/components/` el 2026-11-27. Reemplaza al texto largo de abajo, que queda como referencia (su nota sobre la desinstalación se corrigió el 2026-11-27: los datos se borran al desinstalar).

```
TierSaver for Klaviyo suppresses Klaviyo profiles that never engaged, after the merchant reviews and approves a simulation. Nothing is deleted, cleanups can be restored, and the app sends no email.

Availability: not offered to stores in the EU/EEA, the UK or Switzerland. Please use a development store with a US, Canadian or Australian address. In those regions the home page explains it is not available and nothing can be connected, audited or charged.

You need: the Klaviyo test account in "Test account" above (no 2FA).

Steps
1. Open the app. Home shows "Get started" with four steps.
2. Click "Connect Klaviyo" and approve on Klaviyo's screen. You return with "Klaviyo is connected. Nothing has changed in your Klaviyo account."
3. Click "Run the free audit". It changes no profile and takes a minute or two. It creates one segment, "TierSaver: long-term inactive profiles (managed, do not edit)", and nothing else.
4. Click "Review and approve" (or "Review cleanup" in the menu). The page has "Simulation", "Check the candidates" and "Before you approve".
5. In "Check the candidates", click "Download candidates (CSV)".
6. In "Before you approve", tick the box that starts "I have read the notices above" and click "Approve and start plan". Approve the monthly plan on Shopify's screen (test charge on a development store).
7. Click "Start cleanup: suppress N profiles". The "Cleanup" page shows "In progress" and "Stop cleanup". Profiles are checked again right before sending, so fewer may be suppressed than approved.
8. When "Completed", click "Restore N profiles" and confirm with "Restore profiles". If Klaviyo is still applying the cleanup, try again a minute later.
9. "History" lists cleanups and restores. "Settings" has the criteria, protected lists, monthly schedule, automatic cleanups (off by default), "Plan" (with "Cancel plan") and "Customer data requests".
10. On Home, "Disconnect Klaviyo" then "Disconnect" removes the app's access to Klaviyo.

Notes
- By default only profiles that never purchased are suppressed, checked against the store's full order history (read_all_orders). While the history is not fully read, those profiles stay active and the audit says so.
- No charge per cleanup. A cleanup starts only with an active plan that covers the list size. Restoring does not refund the month.
- Uninstalling deletes the store's data from our systems right away. Suppressed profiles stay suppressed in Klaviyo.

Screencast: see the Screencast URL field. Support: support@tiersaver.com.
```


Texto para el campo de instrucciones (3821 caracteres; límite sin verificar). Cada etiqueta entre comillas se comparó con el código de `shopify/app/routes/` y `shopify/app/components/` y con las capturas del 2026-11-26.

```
TierSaver for Klaviyo keeps a merchant's Klaviyo list clean by suppressing profiles that never engaged,
after the merchant reviews and approves a simulation. Nothing is deleted, and a cleanup can be restored
from the app. The app sends no email.

Availability
- TierSaver is offered only to stores located outside the EU, the rest of the EEA, the UK (with Gibraltar,
  Guernsey, Jersey and the Isle of Man) and Switzerland, by the store's address in Shopify. Please review
  with a development store whose address is in the US (or Canada or Australia). In a store located in
  one of those regions the home page says "TierSaver is not available for stores in the European Union,
  the United Kingdom or Switzerland yet", and nothing can be connected, audited or charged.

What you need
- A Klaviyo account. Test account with sample profiles (no 2FA): [KLAVIYO LOGIN + PASSWORD, added by the owner].
- The app's pages in the Shopify admin menu: Home, Review cleanup, History, Settings.

Steps
1. Install the app and open it. The page "TierSaver" shows the card "Get started" with four steps.
2. In step 1, click "Connect Klaviyo" and approve the access request on Klaviyo's screen. You return to
   the app with the banner "Klaviyo is connected. Nothing has changed in your Klaviyo account."
3. In step 2, click "Run the free audit". It changes no profile and usually takes a minute or two. It
   creates one segment in the Klaviyo account, named
   "TierSaver: long-term inactive profiles (managed, do not edit)", and nothing else. When it finishes,
   the card "Your list" shows "Active profiles", "Meet Klaviyo's inactive criteria" and
   "A cleanup would suppress", and a banner says "N profiles are waiting for your review".
4. Click "Review and approve" in that banner (or "Review the simulation" in step 3, or "Review cleanup"
   in the menu). The page "Review cleanup" has three cards: "Simulation", "Check the candidates" and
   "Before you approve".
5. In "Check the candidates", click "Download candidates (CSV)" (with a long list the buttons read
   "Download file 1", "Download file 2", ...).
6. In "Before you approve", tick the box that starts "I have read the notices above" and click
   "Approve and start plan" (the button also shows the monthly price). Shopify's approval screen for
   the monthly plan opens: a test charge on a development store. Approve it.
7. Back on "Review cleanup", click "Start cleanup: suppress N profiles". The page "Cleanup" opens with
   the status "In progress" and a "Stop cleanup" button. Each profile is checked again right before it
   is sent, so the number suppressed can be lower than the number approved.
8. When the status is "Completed", the card "Klaviyo batches" has "Check progress in Klaviyo", and the
   card "Restore this cleanup" has "Restore N profiles". Click it and confirm with "Restore profiles"
   to remove the suppression this cleanup added. Right after a cleanup the app may answer that Klaviyo
   is still applying it; try again a minute later.
9. "History" in the menu lists every cleanup and restore ("Cleanups and restores"); "View" opens one.
10. "Settings" in the menu has the cards "Who counts as inactive", "Protected lists and segments",
    "Monthly schedule", "Automatic cleanups" (off by default), the "Save settings" button, "Plan"
    (with "Cancel plan") and "Customer data requests".
11. On the home page, the card "Klaviyo connection" has "Disconnect Klaviyo"; confirm with "Disconnect".
    It removes the app's access to Klaviyo.

Notes
- With the default criteria the app only suppresses profiles that never purchased, checked against the
  store's order history. While that history cannot be read in full, the audit keeps those profiles
  active and says so ("Part of your Shopify order history is not available yet").
- There is no charge per cleanup. A cleanup only starts while the store has an active plan that covers
  its list size. Restoring a cleanup does not refund the month. Cancelling the plan stops cleanups; the
  audit and the simulation need no plan.
- Uninstalling deletes the store's data from our systems right away. It does not unsuppress profiles
  in Klaviyo.
- Screencast: [URL, added by the owner]. Support during the review: support@tiersaver.com.
```

Qué se corrigió respecto del borrador de `docs/15-LANZAMIENTO-MATERIALES.md` para que coincida con la UI real:

| Borrador anterior | UI real | Dónde está |
| --- | --- | --- |
| "Download the candidate list (CSV)" | `Download candidates (CSV)`; con varias partes, `Download file 1`, `Download file 2` | `routes/app.simulation.tsx` (CandidateDownload) |
| "Start cleanup" | `Start cleanup: suppress N profiles` | `routes/app.simulation.tsx` |
| "Check jobs in Klaviyo" | `Check progress in Klaviyo` (tarjeta `Klaviyo batches`) | `routes/app.runs.$runId.tsx` |
| "Restore" | `Restore N profiles`, y se confirma con `Restore profiles` en el diálogo `Restore N profiles?` | `routes/app.runs.$runId.tsx` |
| "Klaviyo is connected" | `Klaviyo is connected. Nothing has changed in your Klaviyo account.` | `components/home-screen.tsx` |
| "Settings holds the rules, protected lists, the monthly schedule..." | tarjetas `Who counts as inactive`, `Protected lists and segments`, `Monthly schedule`, `Automatic cleanups`, `Plan`, `Customer data requests`; botón `Save settings` | `routes/app.settings.tsx` |
| "Home → Disconnect Klaviyo" | tarjeta `Klaviyo connection`, botón `Disconnect Klaviyo`, confirmación `Disconnect` | `components/home-screen.tsx` |
| (no figuraba) | menú `Home`, `Review cleanup`, `History`, `Settings`; página `Review cleanup` con `Simulation`, `Check the candidates`, `Before you approve` | `routes/app.tsx`, `routes/app.simulation.tsx` |
| "takes one or two minutes" | "usually takes a minute or two" (no hay medición contra una cuenta real) | — |

Pendiente para que las instrucciones sean verdad (al 2026-11-27): usuario de Klaviyo para el revisor sin 2FA en la cuenta de prueba (`docs/18-RUNBOOK-LANZAMIENTO.md`, sección 4), supresión encendida y trabada a esa cuenta, pedido de datos protegidos guardado y el link del screencast (`video.md`, parte B). Ya verificados el 2026-11-27: cobro contra Shopify en la tienda de desarrollo y acceso a `read_all_orders`.

## 8. Antes de pegar

- Releer en el formulario los límites marcados como sin verificar y ajustar.
- Confirmar que ninguna imagen subida muestra precios.
- Pasar el control de frases prohibidas (`screenshots/2026-11-27/tools/banned.py`) si se toca algún texto.

