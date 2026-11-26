# Pasos en Shopify y Klaviyo que solo puede hacer Facundo

Escrito el 2026-11-25. Los nombres de menú de Shopify vienen de `13-INSTRUCTIVO-CUENTAS.md` (A4), leídos de la documentación ese día; si un nombre no coincide con lo que ves, buscá el equivalente y avisá. Los de Klaviyo no los pude ver: están marcados "(a confirmar)".

Hacelos en este orden. Después de cada bloque, avisale a la sesión: hay trabajo de código que depende de cada uno.

## 1. Distribución pública (Shopify) · no se puede cambiar después

1. https://dev.shopify.com/dashboard → organización **TierSaver** → app **TierSaver for Klaviyo**.
2. **Home** → **Distribution** → **Public distribution** → confirmar.
3. Puede pedir el pago único de registro de Partner (US$ 19) si todavía no está pago. Es un gasto: decidilo vos.

Qué destraba: pedir datos protegidos, la Billing API (cobro) y, más adelante, la ficha del App Store. Elegirla **no** publica la app ni la manda a revisión.

## 2. Datos protegidos de clientes y Read all orders (Shopify)

1. Misma app → **Settings** → **Access requests** (puede llamarse **API access requests**).
2. **Protected customer data** → **Manage** (o **Request access**):
   - Motivo de uso: marcar el que hable de funcionalidad de la app / personalización. Texto, si pide uno: `Match the store's buyers to Klaviyo profiles, by a hash of the email address, so that customers who purchased are never suppressed.`
   - Campos: **solo Email**. No marcar nombre, teléfono ni dirección.
   - El formulario de protección de datos pregunta por cifrado, retención y acceso. Respuestas que corresponden a lo que hace la app: los mails no se guardan (solo un hash SHA-256); tokens cifrados en reposo (AES-GCM); todo se borra con los webhooks de privacidad al desinstalar; acceso del personal limitado al dueño.
3. **Read all orders** → **Request access**. Motivo: `The default cleanup rule is "never purchased". The app needs each buyer's full order history, stored only as a hash of the email, to keep every past customer active.`

Qué destraba: la regla de compras. Sin esto, con las reglas por defecto un merchant real no tiene candidatos.

**Avisá cuando estén pedidos** (aunque no estén aprobados): la sesión agrega el scope `read_all_orders`, reactiva el webhook `orders/create` en `shopify.app.toml` y redespliega la configuración. En la tienda de desarrollo los datos protegidos funcionan apenas se piden; `read_all_orders` puede necesitar la aprobación.

## 3. Ícono de la app (Shopify)

Archivo: `brand/logo/final/app-icon.png` (1200 × 1200, del repo).

1. Misma app → **Settings** (o **App setup** / **Branding**, según la versión del dashboard) → **App icon** → subir el PNG.
2. Es el ícono que se ve en el menú del admin (hoy aparece el genérico) y, después, en la ficha.

## 4. App OAuth de Klaviyo: logo y textos

Según developers.klaviyo.com/en/docs/submit_your_app_for_review (leída el 2026-11-26). Todo esto se **guarda** con el botón **Save** de cada sección; nada se envía a revisión mientras no aprietes **Review submission**. Las revisiones de Klaviyo están en pausa y además piden 5 instalaciones reales, así que hoy esto solo sirve para que el consentimiento y la ficha en borrador muestren la marca.

1. https://www.klaviyo.com/manage-apps → app **TierSaver**.
2. Sección **Logo**: subir `brand/logo/final/klaviyo-app-logo.svg` (SVG de 48 × 48, sin scripts, que es lo que pide Klaviyo) → **Save**.
3. Sección **App listing → Information**:
   - Short description (máx. 75; tiene 61): `Automatic list hygiene: suppress profiles that never engaged.`
   - Full description (máx. 300; tiene 269): `TierSaver keeps your Klaviyo list clean. It finds profiles that never engaged, using Klaviyo's own recommended criteria, shows you exactly who would be suppressed, and runs only after you approve. Profiles are suppressed, never deleted, and every cleanup can be undone.`
4. Pestaña **Company information**: nombre `TierSaver`, sitio `https://tiersaver.com`, descripción: `TierSaver builds list hygiene tools for Shopify brands that use Klaviyo. Operated by Digital Solvers LLC.`
5. Sección **Features** (2 a 6; título máx. 65, descripción máx. 225):
   - `Free, read-only list audit` · `Counts the profiles that meet Klaviyo's criteria for long-term inactive profiles. Nothing changes in your account.`
   - `Simulation you approve` · `See and download the exact profiles a cleanup would suppress. Nothing runs until you approve it.`
   - `Buyers stay active` · `Every profile is checked against your Shopify orders. Customers who purchased are never suppressed.`
   - `Undo and full history` · `Profiles are suppressed, never deleted. Every cleanup is logged and can be undone.`
6. URLs (se pueden dejar para cuando el sitio esté publicado): privacy policy `https://tiersaver.com/privacy.html`, soporte `support@tiersaver.com`. La "OAuth installation URL" y la "Settings URL" todavía no existen como páginas públicas: dejarlas vacías.
7. **No apretar "Review submission".**

## 5. Probar el cobro (después del paso 1)

1. En la tienda de desarrollo: app → correr la auditoría → **Review cleanup** → aprobar → **Review pricing in Shopify**.
2. Shopify tiene que mostrar la pantalla de aprobación con el texto de precios y el tope de US$ 149. En una tienda de desarrollo es un cargo de prueba: no se cobra nada.
3. Aceptar y avisar. La sesión revisa que la suscripción quedó activa.

Para probar un cargo real de punta a punta hace falta además encender la supresión para la cuenta de prueba (lo hace la sesión, con tu ok).

## Lo que NO hay que tocar todavía

- **Submit for review** de la ficha del App Store.
- **Review submission** de la app de Klaviyo.
- Cualquier plan pago de Cloudflare, Shopify o Klaviyo.
