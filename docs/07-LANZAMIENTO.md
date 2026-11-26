# Lanzamiento en el Shopify App Store

Los requisitos cambian. Antes de preparar el envío, leer la página vigente: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements

## Lo verificado el 25 de noviembre de 2026

- Cobro: solo por Shopify App Pricing o la Billing API. Sin cobro por fuera.
- Webhooks de cumplimiento obligatorios para toda app del App Store: `customers/data_request`, `customers/redact`, `shop/redact`. Deben verificar el HMAC y responder 401 si es inválido. Si faltan o no responden bien, la app se rechaza.
- `shop/redact` llega 48 horas después de la desinstalación: ahí se borran los datos de la tienda.
- Ícono: 1200 × 1200 px, JPEG o PNG.
- La app debe estar libre de errores, incluso menores, para completar la revisión.
- Desde el 4 de noviembre de 2026 hay límites de envío de apps nuevas por organización (una sola app nueva en revisión a la vez, más un segundo requisito). Leer el detalle en la página de envío antes de planificar fechas: https://shopify.dev/docs/apps/store/review/app-submission
- El mail de contacto del envío es donde Shopify escribe durante la revisión.

## Checklist previo al envío

Funcional
- [ ] Instala y desinstala limpio en una tienda de desarrollo nueva.
- [ ] OAuth de Shopify sin pantallas intermedias propias antes de autenticar.
- [ ] Todas las pantallas en Polaris, sin errores de consola.
- [ ] Estados vacíos y de error diseñados.
- [ ] Cobro probado en modo test: aprobar el plan en la primera limpieza, rechazarlo (la limpieza no arranca), segunda limpieza en el mismo mes (sin cargo nuevo), lista que sube de tramo (pide aprobar el precio nuevo), lista que baja (ofrece el plan menor), cancelar desde Settings (corta las limpiezas y apaga el modo automático) y plan congelado por Shopify.
- [ ] Webhooks de cumplimiento respondiendo y verificando HMAC.
- [ ] Scopes mínimos; cada uno justificado por escrito.
- [ ] Si se leen datos protegidos de clientes: solicitud de acceso completada.

Contenido
- [ ] Nombre y subtítulo sin promesas que no se puedan probar, y toda la ficha revisada contra `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2.
- [ ] Límites de tamaño de lista del precio confirmados por Facundo.
- [ ] Capturas reales de la app (no mockups).
- [ ] Video corto de demostración.
- [ ] Política de privacidad y términos publicados en tiersaver.com, con las cláusulas de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.1.
- [ ] Avisos de la sección 4.1 visibles en la app antes de la primera aprobación.
- [ ] Mail y URL de soporte funcionando.
- [ ] Instrucciones de prueba para el revisor, con credenciales de una cuenta de Klaviyo de prueba si hacen falta.

Operación
- [ ] Monitoreo de errores activo.
- [ ] Centro de ayuda con: cómo funciona, qué es suprimir, cómo deshacer, cómo se cobra, qué pasa al desinstalar.
- [ ] Bot de soporte respondiendo con esos artículos y escalando a Facundo lo que toque dinero o datos.

## Ficha (borrador en inglés)

Reescrita el 2026-11-25 con las reglas de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2; Details, Features y Pricing actualizados el 2026-11-26 (plan mensual; Details de 500 caracteres como máximo, sin precios). Sigue siendo un borrador: la revisa Facundo antes del envío.

**Name**: TierSaver for Klaviyo

Decidido por Facundo el 2026-11-25. El nombre completo del producto es "TierSaver: List Hygiene for Klaviyo" (35 caracteres; el campo admite 30), así que "list hygiene" va en el subtítulo.

**Subtitle**: Automatic list hygiene for Klaviyo, with preview and undo

**Introduction**: Keep your Klaviyo list clean: suppress profiles that never engaged, after you approve a simulation.

**Details** (máx. 500 caracteres, sin precios ni "free"; tiene 469): Run an audit to see how many profiles meet the criteria Klaviyo publishes for suppressing unengaged profiles: never opened, clicked, visited or purchased. Every profile is checked against your Shopify orders. SMS subscribers and the lists you protect are always kept. You review and approve a simulation before anything changes. Profiles are suppressed, never deleted, and a cleanup can be restored from the app. TierSaver is not affiliated with or endorsed by Klaviyo.

**Features**
- List audit that changes no profile
- The criteria Klaviyo publishes, by default
- Buyers protected with your Shopify order data
- Simulation and approval before every cleanup
- A log of every cleanup, with restore

**Pricing** (solo en la sección de precios de la ficha, requisito 4.2). Free to install; the plan starts when you approve your first cleanup. Cuatro planes mensuales, uno por tamaño de lista:

| Plan (nombre en la ficha) | Precio | Qué cubre |
| --- | --- | --- |
| Up to 10,000 profiles | $9 / month | Lists up to 10,000 active profiles |
| Up to 25,000 profiles | $19 / month | Lists up to 25,000 active profiles |
| Up to 75,000 profiles | $39 / month | Lists up to 75,000 active profiles |
| Up to 150,000 profiles | $79 / month | Lists up to 150,000 active profiles |

Texto que acompaña a los planes (el mismo en los cuatro): Free to install; the plan starts when you approve your first cleanup. Connecting Klaviyo, the audit and the simulation need no plan. Billed by Shopify every 30 days until you cancel in Settings or uninstall. Lists above 150,000 active profiles: write to hello@tiersaver.com.

Precios y límites decididos por Facundo el 2026-11-26 (`00-HANDOVER.md`, fila "Precio"); salen de `FLAT_PRICE_TIERS` en `packages/core/src/charge.ts`. Reemplazan los US$ 15 / 29 / 79 / 149 por limpieza del 2026-11-25 y la frase "a billing cycle with no cleanup is not charged", que ya no es cierta. No hay prueba gratis con días: lo gratis es todo lo anterior a la primera limpieza. Antes de cargar la ficha, releer en la documentación vigente de Shopify cómo se declaran en la sección de precios los planes de una app que cobra con la Billing API.

**Palabras clave**: Klaviyo list cleaning, list hygiene, suppress inactive profiles, unengaged profiles, sunset flow.

Reglas para cualquier cambio de la ficha:

- Ninguna cifra, porcentaje, estadística ni garantía en el texto, el subtítulo ni las imágenes (requisito 4.3.3 de Shopify: "Do not use any statistics or data in your app's listing content"). Los precios van solo en la sección de precios.
- No encabezar con la factura de Klaviyo ni usarla como palabra clave principal. No presentar el momento de la corrida respecto de la facturación como función.
- "Klaviyo" solo como texto descriptivo. Sin su logo, y sin "official", "certified", "recommended by" ni "partner".
- Las capturas tampoco muestran montos ni planes de Klaviyo como resultado prometido.

## Video

Opción: skill brag (github.com/latent-spaces/brag), que arma un video corto de lanzamiento a partir del proyecto. Pide Node 22, FFmpeg y la CLI de Hyperframes. No fue probado. Alternativa: grabación de pantalla del flujo real con subtítulos.

## Después del envío

- La revisión suele tardar una o dos semanas (estimación; no es un plazo garantizado).
- Responder las observaciones el mismo día.
- Mientras tanto: beta con las tiendas que lleguen por agencias, usando el link de instalación directo.
