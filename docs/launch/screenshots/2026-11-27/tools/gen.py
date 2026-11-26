import textwrap
L='/home/user/tiersaver/docs/launch/'
def c(s): return len(s)
def field(name, text, limit=None, verified=True):
    n=c(text)
    if limit:
        tag=f"{n} / {limit} caracteres" + ("" if verified else " (límite sin verificar)") + (" — **EXCEDE**" if n>limit else "")
    else: tag=f"{n} caracteres (sin límite publicado)"
    return f"**{name}** · {tag}\n\n```\n{text}\n```\n"
out=[]
A=out.append
# ---------------- Shopify
name="TierSaver for Klaviyo"
subtitle="Automatic list hygiene for Klaviyo, with preview and undo"
intro="Keep your Klaviyo list clean: suppress profiles that never engaged, after you approve a simulation."
details="Run an audit to see how many profiles meet the criteria Klaviyo publishes for suppressing unengaged profiles: never opened, clicked, visited or purchased. Every profile is checked against your Shopify orders. SMS subscribers and the lists you protect are always kept. You review and approve a simulation before anything changes. Profiles are suppressed, never deleted, and a cleanup can be restored from the app. TierSaver is not affiliated with or endorsed by Klaviyo."
features=["List audit that changes no profile","The criteria Klaviyo publishes, by default","Buyers protected with your Shopify order data","Simulation and approval before every cleanup","A log of every cleanup, with restore"]
terms=["Klaviyo list cleanup","list hygiene","suppress profiles","inactive profiles","unengaged profiles"]
title_tag="TierSaver for Klaviyo: list hygiene with review and restore"
meta="Suppress the Klaviyo profiles that never engaged, after you review and approve a simulation. Buyers are checked against your Shopify orders. Nothing is deleted."
plans=[("Audit and simulation","Free",["Connect Klaviyo","List audit","Simulation with downloadable candidate list","No cleanups"]),
("Up to 10,000 profiles","$9 / month",["Lists up to 10,000 active profiles","Manual and scheduled cleanups","Log and restore"]),
("Up to 25,000 profiles","$19 / month",["Lists up to 25,000 active profiles","Manual and scheduled cleanups","Log and restore"]),
("Up to 75,000 profiles","$39 / month",["Lists up to 75,000 active profiles","Manual and scheduled cleanups","Log and restore"]),
("Up to 150,000 profiles","$79 / month",["Lists up to 150,000 active profiles","Manual and scheduled cleanups","Log and restore"])]
addl="Free to install. The plan starts when you approve your first cleanup. Connecting Klaviyo, the audit and the simulation need no plan. The plan is set by the size of your list and billed by Shopify every 30 days, whether or not a cleanup runs that month, until you cancel in Settings or uninstall. A higher price only applies after you approve it in Shopify. Lists above 150,000 active profiles: write to hello@tiersaver.com."
alts=[("00-feature-image.png","Feature image","TierSaver for Klaviyo: the list audit card with example data, next to the line 'Suppress profiles that never engaged. After you approve.'"),
("01-audit.png","Screenshot 1","The list audit in TierSaver: active profiles, profiles that meet the criteria, and the profiles kept active, with example data."),
("02-review-and-approve.png","Screenshot 2","The review screen: download the candidate list and read what suppressing does before approving."),
("03-cleanup-running.png","Screenshot 3","A cleanup in progress, with the count of profiles sent to Klaviyo and a Stop cleanup button."),
("04-cleanup-log-and-restore.png","Screenshot 4","A completed cleanup: who approved it, the rule used, and the Restore button."),
("05-settings.png","Screenshot 5","Settings: the inactivity criteria, protected lists and segments, and the monthly schedule.")]
testing='''TierSaver for Klaviyo keeps a merchant's Klaviyo list clean by suppressing profiles that never engaged,
after the merchant reviews and approves a simulation. Nothing is deleted, and a cleanup can be restored
from the app. The app sends no email.

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
- Uninstalling deletes the store's data from our systems (on Shopify's shop/redact, or 10 days after
  the uninstall if that request does not arrive). It does not unsuppress profiles in Klaviyo.
- Screencast: [URL, added by the owner]. Support during the review: support@tiersaver.com.'''
A("# Ficha del Shopify App Store · lista para copiar y pegar\n")
A("Preparada el 2026-11-26 (carpeta de capturas fechada 2026-11-27). **Nada se cargó ni se envió**: el envío a revisión lo dispara Facundo. La app todavía no está publicada; ningún texto dice que lo esté. Reemplaza los borradores de ficha de `docs/15-LANZAMIENTO-MATERIALES.md` y de `docs/07-LANZAMIENTO.md` (los textos de Introduction, Details y Features son los mismos, sin cambios).\n")
A("Los conteos de caracteres los imprime `gen.py` (copiado en `screenshots/2026-11-27/tools/`); no están contados a mano.\n")
A("## Qué se verificó en shopify.dev el 2026-11-26\n")
A('''| Dato | Valor | Fuente |
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
''')
A("## 1. Marca\n")
A(field("App name",name,30))
A("**App icon**: `brand/logo/final/app-icon.png` (1200 × 1200 px, PNG, sin transparencia y sin texto). Cumple el formato verificado.\n")
A("## 2. Contenido de la ficha\n")
A("**Feature media**: imagen `screenshots/2026-11-27/listing/00-feature-image.png` (1600 × 900). El video de 60 a 90 segundos de `video.md` es una grabación de pantalla completa, y Shopify pide que el screencast no pase del 25 % del video destacado: por eso va la imagen y no el video. Decisión de Facundo si prefiere otra.\n")
A("**Demo store URL**: dejar vacío por ahora. Si se arma una tienda de demostración, el link va directo a la página de la app.\n")
A("**Screenshots** (cinco, 1600 × 900, en este orden) y su alt text:\n")
for f,n,a in alts: A(f"- {n}: `screenshots/2026-11-27/listing/{f}` · alt ({c(a)} caracteres): `{a}`")
A("\nLas cinco de `listing/` no muestran precios (requisito 4.2.2). Las de `raw/` sí muestran el plan y **no van en la ficha**. Detalle en `screenshots/2026-11-27/INDEX.md`.\n")
A(field("App introduction",intro,100))
A(field("App details",details,500))
A("**Feature list** (80 por ítem)\n\n```")
for f in features: A(f)
A("```\n")
for f in features: A(f"- {c(f)} / 80 · {f}")
A("\n**Integrations** (hasta 6): `Klaviyo`\n")
A("## 3. Precio\n")
A("Método principal: **Recurring charge**, con un plan marcado como Free (así lo indica Shopify para apps con uso gratis y planes pagos). Sin prueba gratis por días: lo gratis es todo lo anterior a la primera limpieza. Si el formulario no admite un plan Free sin funciones de limpieza, se sacan ese plan y sus ítems y queda solo el texto de cargos adicionales. **A confirmar por Facundo al cargar**, junto con el largo máximo del nombre del plan.\n")
A("| Plan | Precio | Ítems del plan |\n| --- | --- | --- |")
for n,p,fs in plans: A(f"| {n} ({c(n)}) | {p} | "+" · ".join(f"{x} ({c(x)})" for x in fs)+" |")
A("\nNombres cortos de reserva si el campo no admite los de arriba: `Audit`, `10K profiles`, `25K profiles`, `75K profiles`, `150K profiles`.\n")
A(field("Description of additional charges",addl))
A("Precios y tramos: `FLAT_PRICE_TIERS` en `packages/core/src/charge.ts` (decisión de Facundo del 2026-11-26).\n")
A("## 4. Descubrimiento\n")
A(field("App card subtitle",subtitle,62,False))
A("**Search terms** (hasta 5; largo por término sin verificar, supuesto 20)\n")
for t in terms: A(f"- `{t}` · {c(t)}")
A("\nSe sacó `sunset flow` del borrador anterior: la app no arma un flujo de sunset.\n")
A("**Categoría y tags** (árbol sin verificar; elegir lo más cercano en el formulario): principal *Marketing and conversion → Marketing → Email marketing*; secundaria, si se permite, *Store management → Operations → Workflow automation*. Structured features: marcar solo lo que la app hace (limpieza o segmentación de listas, si existe la opción); nada de envío de mails, pop-ups ni SMS.\n")
A(field("Title tag",title_tag,60,False))
A(field("Meta description",meta,160,False))
A("**Languages**: English (la app solo está en inglés; requisito 4.3.2).\n")
A("## 5. Soporte y links\n")
A('''Los dominios todavía no existen: son los definitivos, y cada uno corresponde a una página que ya está en `site/src/pages/` (el sitio sirve URLs sin `.html`).

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

Términos, privacidad y DPA siguen como borrador hasta el visto bueno del abogado (`docs/16-LEGALES-PARA-ABOGADO.md`).
''')
A("## 6. Requisitos de instalación\n")
A("Sin requisito de canal de venta ni geográfico. Aclarar en el campo de requisitos, si lo hay: `Requires a Klaviyo account.`\n")
A("## 7. Revisión: instrucciones de prueba\n")
A(f"Texto para el campo de instrucciones ({c(testing)} caracteres; límite sin verificar). Cada etiqueta entre comillas se comparó con el código de `shopify/app/routes/` y `shopify/app/components/` y con las capturas del 2026-11-26.\n\n```\n{testing}\n```\n")
A('''Qué se corrigió respecto del borrador de `docs/15-LANZAMIENTO-MATERIALES.md` para que coincida con la UI real:

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

Pendiente para que las instrucciones sean verdad: credenciales de una cuenta de Klaviyo de prueba sin 2FA, supresión encendida en producción, cobro probado contra Shopify, acceso a `read_all_orders` y a datos protegidos, y el link del screencast (`video.md`, parte B).
''')
A("## 8. Antes de pegar\n")
A("- Releer en el formulario los límites marcados como sin verificar y ajustar.\n- Confirmar que ninguna imagen subida muestra precios.\n- Pasar el control de frases prohibidas (`screenshots/2026-11-27/tools/banned.py`) si se toca algún texto.\n")
open(L+'listing-shopify.md','w').write("\n".join(out)+"\n")
shop_fields={"name":name,"subtitle":subtitle,"intro":intro,"details":details,"title_tag":title_tag,"meta":meta,"addl":addl}
for k,v in shop_fields.items(): print("shopify",k,c(v))
for f in features: print("feature",c(f))
for t in terms: print("term",c(t),t)

# ---------------- Klaviyo
out=[];A=out.append
k_name="TierSaver"
k_dev="Digital Solvers LLC"
k_short="List hygiene: suppress never-engaged profiles once you approve a simulation"
k_full="TierSaver audits your list, finds the profiles that meet the criteria Klaviyo publishes for suppressing unengaged profiles, checks them against your Shopify orders, and suppresses them only after you approve a simulation. Nothing is deleted. Each cleanup is logged and can be restored from the app."
k_feats=[("List audit that changes no profile","Counts the profiles that never opened, clicked, visited or purchased. The audit changes no profile; it creates one segment in your account, which TierSaver manages."),
("Simulation and approval before every cleanup","See how many profiles a cleanup would suppress and why the others are kept, download the candidate list as a CSV file, and approve it yourself. The first cleanup is always started by hand."),
("Buyers checked against Shopify orders","Each profile is matched against your store's order history before it becomes a candidate. Profiles with SMS consent and profiles in the lists and segments you protect are always kept active."),
("Suppress, never delete","TierSaver suppresses profiles and does not delete or edit them. Their history stays in your account, and a person who subscribes again is unsuppressed."),
("A log of every cleanup, with restore","Every cleanup records who approved it, when, which criteria and how many profiles. Restore removes the suppression that cleanup added."),
("Optional monthly schedule","Run the audit every month and review the simulation when it is ready. Automatic cleanups are off by default and can be turned off at any time.")]
k_arts=[("Getting started with TierSaver","Connect your account, run the list audit, review the simulation and start your first cleanup, step by step.","https://tiersaver.com/help/getting-started","site/src/pages/help/getting-started.html","user guide"),
("What suppressing a profile means","What changes for a suppressed profile, what does not, and how suppressing differs from deleting and unsubscribing.","https://tiersaver.com/help/what-suppress-means","site/src/pages/help/what-suppress-means.html","user guide"),
("How to restore a cleanup","What Restore does, what it leaves as it is, and the limits that apply after a profile is unsuppressed.","https://tiersaver.com/help/undo","site/src/pages/help/undo.html","user guide"),
("Permissions TierSaver asks for","Each permission the app requests in Shopify and in your Klaviyo account, and what it is used for.","https://tiersaver.com/help/permissions","site/src/pages/help/permissions.html","user guide")]
A("# Ficha de Klaviyo (App Marketplace) y pantalla de consentimiento OAuth · lista para copiar y pegar\n")
A("Preparada el 2026-11-26. **Nada se cargó ni se envió.** Conteos impresos por `gen.py`.\n")
A("## Qué se verificó el 2026-11-26\n")
A('''Fuentes: https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements y https://developers.klaviyo.com/en/docs/submit_your_app_for_review (leídas el 2026-11-26).

| Campo | Regla |
| --- | --- |
| Developer name | 30 caracteres máx. |
| Primary category | una sola |
| Short description | 75 caracteres máx. (texto de vista previa en la búsqueda) |
| Full description | 300 caracteres máx. |
| Features | de 2 a 6; título 65 máx.; descripción 225 máx. |
| Articles | de 1 a 4, al menos una guía de uso; título 100 máx.; descripción 200 máx. |
| Logo | SVG de 48 × 48 px, sin scripts |
| Galería | "Multi-media": de 4 a 8 imágenes y, opcional, un video como URL de YouTube; o una sola imagen de portada. La página no da medidas para las imágenes de galería |
| URLs | OAuth installation URL (tiene que iniciar el flujo OAuth), Settings URL (página de ajustes específica de la integración), Pricing information URL, Website, Privacy policy, Support email |
| Reglas de texto | la ficha no puede sugerir respaldo de Klaviyo sin aprobación escrita; ni la app ni su documentación pueden presentarse como la opción "preferred" o "recommended" de Klaviyo, ni como "top performing", "best" o similares; material de demo con información real y sin datos de clientes |
| Para listarse | al menos 5 instalaciones con actividad de API de producción; el menor conjunto de scopes posible; términos y privacidad enlazados; contacto de soporte |

**Sin verificar**: los campos exactos de la pantalla de creación de la app OAuth (nombre y descripción que ve quien conecta) y las pautas de marca para terceros: el 2026-11-25 no se encontró una guía de marca pública (`docs/12-CUMPLIMIENTO-KLAVIYO.md`, 1.7). Por eso el nombre de la app no lleva "Klaviyo", no se usa su logo, tipografía ni colores, y su nombre aparece solo como texto descriptivo.

**No se puede enviar todavía**: faltan las 5 instalaciones con actividad de producción. Hasta la aprobación, quien conecte ve el aviso de Klaviyo de que la app no fue revisada.
''')
A("## 1. App OAuth (lo que se ve al conectar)\n")
A(field("App name",k_name))
A("Sin \"for Klaviyo\" dentro de Klaviyo: ahí el contexto ya está dado, y así el nombre no usa su marca.\n")
A(field("Developer name",k_dev,30))
A("**Logo**: `brand/logo/final/klaviyo-app-logo.svg` (SVG, 48 × 48, sin scripts; es la marca de TierSaver, no usa ningún elemento de Klaviyo).\n")
A("**Scopes** (los que usa el MVP; detalle y justificación en `site/src/pages/help/permissions.html`): `accounts:read profiles:read profiles:write subscriptions:read subscriptions:write lists:read segments:read segments:write metrics:read usage:read`. Confirmar contra `shopify/app/klaviyo/config.ts` al cargar.\n")
A("## 2. Información de la ficha\n")
A("**Primary category**: `Workflow automation` (no hay una categoría de higiene de lista; es la más cercana de las 24 publicadas).\n")
A(field("Short description",k_short,75))
A(field("Full description",k_full,300))
A("## 3. Features (6)\n")
for t,d in k_feats: A(f"**{t}** · título {c(t)} / 65" + (" — **EXCEDE**" if c(t)>65 else "") + f" · descripción {c(d)} / 225" + (" — **EXCEDE**" if c(d)>225 else "") + f"\n\n```\n{d}\n```\n")
A("## 4. Articles (4 guías de uso)\n")
A("| Título (car.) | Descripción (car.) | URL | Página en el repo | Tipo |\n| --- | --- | --- | --- | --- |")
for t,d,u,p,ty in k_arts: A(f"| {t} ({c(t)} / 100) | {d} ({c(d)} / 200) | `{u}` | `{p}` | {ty} |")
A("\nSin casos de éxito: no hay ninguno real, y no se inventan.\n")
A("## 5. URLs\n")
A('''| Campo | Valor | Nota |
| --- | --- | --- |
| OAuth installation URL | `[URL de la ficha de TierSaver en el Shopify App Store, cuando exista]` | La conexión con Klaviyo empieza dentro de la app embebida de Shopify (`/klaviyo/oauth/start` necesita la sesión de Shopify), así que no hay una URL pública que abra el flujo OAuth directo. Klaviyo pide que el link lleve al flujo de instalación: **consultarlo con Klaviyo antes de enviar** |
| Settings URL | `[sin definir]` | Klaviyo pide una página de ajustes propia de la integración. Los ajustes viven en la app embebida (`Settings`, ruta `/app/settings`), cuya URL depende de la tienda (`https://admin.shopify.com/store/<tienda>/apps/<handle>/app/settings`). Opciones: una página pública `https://tiersaver.com/help/settings` (existe: `site/src/pages/help/settings.html`) que explique cómo llegar, o un redirector propio. **Decisión pendiente de Facundo** |
| Pricing information URL | `https://tiersaver.com/help/pricing` | `site/src/pages/help/pricing.html` |
| Website URL | `https://tiersaver.com/` | `site/src/pages/index.html` |
| Privacy policy URL | `https://tiersaver.com/privacy` | `site/src/pages/privacy.html` |
| Terms of Service | `https://tiersaver.com/terms` | `site/src/pages/terms.html` |
| Support team email | `support@tiersaver.com` | casilla todavía sin crear |
''')
A("## 6. Galería\n")
A("Tipo \"Multi-media\": las cinco imágenes de `screenshots/2026-11-27/listing/` (`01` a `05`) más `00-feature-image.png` (seis en total; se piden de 4 a 8). Son 1600 × 900; Klaviyo no publica medidas para la galería. Video: la URL de YouTube del video final de `video.md`, cuando esté grabado y subido (subirlo es publicar: lo decide Facundo).\n")
A("## 7. Control de texto\n")
A("Ningún texto de esta ficha usa \"recommended\", \"preferred\", \"best\", \"top performing\", \"official\", \"certified\" ni \"partner\"; ninguno habla de la factura ni promete un resultado; ninguno llama \"read-only\" a la auditoría. Los criterios se nombran como \"the criteria Klaviyo publishes for suppressing unengaged profiles\".\n")
open(L+'listing-klaviyo.md','w').write("\n".join(out)+"\n")
print("klaviyo short",c(k_short),"full",c(k_full),"dev",c(k_dev))
for t,d in k_feats: print("kfeat",c(t),c(d))
for t,d,*_ in k_arts: print("kart",c(t),c(d))
