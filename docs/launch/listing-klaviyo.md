# Ficha de Klaviyo (App Marketplace) y pantalla de consentimiento OAuth · lista para copiar y pegar

Preparada el 2026-11-26. **Nada se cargó ni se envió.** Conteos impresos por `gen.py`.

## Qué se verificó el 2026-11-26

Fuentes: https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements y https://developers.klaviyo.com/en/docs/submit_your_app_for_review (leídas el 2026-11-26).

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

## 1. App OAuth (lo que se ve al conectar)

**App name** · 9 caracteres (sin límite publicado)

```
TierSaver
```

Sin "for Klaviyo" dentro de Klaviyo: ahí el contexto ya está dado, y así el nombre no usa su marca.

**Developer name** · 19 / 30 caracteres

```
Digital Solvers LLC
```

**Logo**: `brand/logo/final/klaviyo-app-logo.svg` (SVG, 48 × 48, sin scripts; es la marca de TierSaver, no usa ningún elemento de Klaviyo).

**Scopes** (los que usa el MVP; detalle y justificación en `site/src/pages/help/permissions.html`): `accounts:read profiles:read profiles:write subscriptions:read subscriptions:write lists:read segments:read segments:write metrics:read usage:read`. Confirmar contra `shopify/app/klaviyo/config.ts` al cargar.

## 2. Información de la ficha

**Primary category**: `Workflow automation` (no hay una categoría de higiene de lista; es la más cercana de las 24 publicadas).

**Short description** · 75 / 75 caracteres

```
List hygiene: suppress never-engaged profiles once you approve a simulation
```

**Full description** · 298 / 300 caracteres

```
TierSaver audits your list, finds the profiles that meet the criteria Klaviyo publishes for suppressing unengaged profiles, checks them against your Shopify orders, and suppresses them only after you approve a simulation. Nothing is deleted. Each cleanup is logged and can be restored from the app.
```

## 3. Features (6)

**List audit that changes no profile** · título 34 / 65 · descripción 164 / 225

```
Counts the profiles that never opened, clicked, visited or purchased. The audit changes no profile; it creates one segment in your account, which TierSaver manages.
```

**Simulation and approval before every cleanup** · título 44 / 65 · descripción 188 / 225

```
See how many profiles a cleanup would suppress and why the others are kept, download the candidate list as a CSV file, and approve it yourself. The first cleanup is always started by hand.
```

**Buyers checked against Shopify orders** · título 37 / 65 · descripción 190 / 225

```
Each profile is matched against your store's order history before it becomes a candidate. Profiles with SMS consent and profiles in the lists and segments you protect are always kept active.
```

**Suppress, never delete** · título 22 / 65 · descripción 151 / 225

```
TierSaver suppresses profiles and does not delete or edit them. Their history stays in your account, and a person who subscribes again is unsuppressed.
```

**A log of every cleanup, with restore** · título 36 / 65 · descripción 134 / 225

```
Every cleanup records who approved it, when, which criteria and how many profiles. Restore removes the suppression that cleanup added.
```

**Optional monthly schedule** · título 25 / 65 · descripción 142 / 225

```
Run the audit every month and review the simulation when it is ready. Automatic cleanups are off by default and can be turned off at any time.
```

## 4. Articles (4 guías de uso)

| Título (car.) | Descripción (car.) | URL | Página en el repo | Tipo |
| --- | --- | --- | --- | --- |
| Getting started with TierSaver (30 / 100) | Connect your account, run the list audit, review the simulation and start your first cleanup, step by step. (107 / 200) | `https://tiersaver.com/help/getting-started` | `site/src/pages/help/getting-started.html` | user guide |
| What suppressing a profile means (32 / 100) | What changes for a suppressed profile, what does not, and how suppressing differs from deleting and unsubscribing. (114 / 200) | `https://tiersaver.com/help/what-suppress-means` | `site/src/pages/help/what-suppress-means.html` | user guide |
| How to restore a cleanup (24 / 100) | What Restore does, what it leaves as it is, and the limits that apply after a profile is unsuppressed. (102 / 200) | `https://tiersaver.com/help/undo` | `site/src/pages/help/undo.html` | user guide |
| Permissions TierSaver asks for (30 / 100) | Each permission the app requests in Shopify and in your Klaviyo account, and what it is used for. (97 / 200) | `https://tiersaver.com/help/permissions` | `site/src/pages/help/permissions.html` | user guide |

Sin casos de éxito: no hay ninguno real, y no se inventan.

## 5. URLs

| Campo | Valor | Nota |
| --- | --- | --- |
| OAuth installation URL | `[URL de la ficha de TierSaver en el Shopify App Store, cuando exista]` | La conexión con Klaviyo empieza dentro de la app embebida de Shopify (`/klaviyo/oauth/start` necesita la sesión de Shopify), así que no hay una URL pública que abra el flujo OAuth directo. Klaviyo pide que el link lleve al flujo de instalación: **consultarlo con Klaviyo antes de enviar** |
| Settings URL | `[sin definir]` | Klaviyo pide una página de ajustes propia de la integración. Los ajustes viven en la app embebida (`Settings`, ruta `/app/settings`), cuya URL depende de la tienda (`https://admin.shopify.com/store/<tienda>/apps/<handle>/app/settings`). Opciones: una página pública `https://tiersaver.com/help/settings` (existe: `site/src/pages/help/settings.html`) que explique cómo llegar, o un redirector propio. **Decisión pendiente de Facundo** |
| Pricing information URL | `https://tiersaver.com/help/pricing` | `site/src/pages/help/pricing.html` |
| Website URL | `https://tiersaver.com/` | `site/src/pages/index.html` |
| Privacy policy URL | `https://tiersaver.com/privacy` | `site/src/pages/privacy.html` |
| Terms of Service | `https://tiersaver.com/terms` | `site/src/pages/terms.html` |
| Support team email | `support@tiersaver.com` | casilla todavía sin crear |

## 6. Galería

Tipo "Multi-media": las cinco imágenes de `screenshots/2026-11-27/listing/` (`01` a `05`) más `00-feature-image.png` (seis en total; se piden de 4 a 8). Son 1600 × 900; Klaviyo no publica medidas para la galería. Video: la URL de YouTube del video final de `video.md`, cuando esté grabado y subido (subirlo es publicar: lo decide Facundo).

## 7. Control de texto

Ningún texto de esta ficha usa "recommended", "preferred", "best", "top performing", "official", "certified" ni "partner"; ninguno habla de la factura ni promete un resultado; ninguno llama "read-only" a la auditoría. Los criterios se nombran como "the criteria Klaviyo publishes for suppressing unengaged profiles".

