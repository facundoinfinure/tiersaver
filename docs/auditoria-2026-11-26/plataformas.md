# Revisión de plataformas: cumplimiento y preparación para revisión

Fecha de la revisión y de todas las lecturas: **2026-11-26**. Rama `claude/hopeful-mayer-5ubt01`, commit `f240583`. Solo lectura: no se tocó el repo ni ninguna cuenta. Toda la documentación se leyó por un extractor automático que resume; las citas cortas son textuales, el resto es paráfrasis. Donde una página no dijo algo, queda marcado "no verificado".

Estados: **cumple**, **parcial**, **no cumple**, **no verificado**, **n/a**.

## 0. Lo más importante

1. La página raíz `/` de la app sigue siendo la de la plantilla ("A short heading about [your app]") y muestra un formulario para escribir el dominio `myshopify.com`. Viola el requisito 2.3.1 de Shopify y es motivo de rechazo directo.
2. Sin `read_all_orders` ni acceso a datos protegidos (email), la app no suprime a nadie en una tienda real. Ninguno de los dos está pedido. El revisor de Shopify no podría completar el flujo principal.
3. Shopify App Pricing es "the default option when you submit a new public app"; la Billing API quedó como "Manual pricing (legacy)" para "outlier pricing models". No pude confirmar en la documentación cómo elige manual pricing una app nueva al enviarla. El cobro nunca se probó contra Shopify.
4. Klaviyo exige 5 instalaciones reales con actividad de producción antes de revisar, logs retenidos 365 días, y firmar el Technology Partner Agreement (que prohíbe productos "similar to or competing with" los de Klaviyo). Hoy no se cumple ninguna de las tres. La app puede operar sin estar listada, con el cartel de "no revisada".
5. Workers Free no alcanza para producción: 10 ms de CPU, 50 subrequests por request, 1.024 pasos por Workflow, logs de 3 días.

## 1. Shopify App Store

Fuentes (todas leídas el 2026-11-26):
- R: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- C: https://shopify.dev/docs/apps/launch/app-requirements-checklist
- BP: https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- PR: https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- SUB: https://shopify.dev/docs/apps/store/review/app-submission
- PCD: https://shopify.dev/docs/apps/launch/protected-customer-data
- PRIV: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- SC: https://shopify.dev/docs/api/usage/access-scopes
- BILL: https://shopify.dev/docs/apps/launch/billing
- SAP: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- USG: https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-usage-based-subscriptions
- No se pudo leer (404): https://shopify.dev/docs/apps/launch/app-store-review/app-listing

| Requisito | Fuente | Estado | Evidencia | Arreglo |
| --- | --- | --- | --- | --- |
| 2.3.1 La instalación arranca en una superficie de Shopify; la app "must not request the manual entry of a myshopify.com URL" | R | **no cumple** | `shopify/app/routes/_index/route.tsx:24-38` (texto de plantilla y `<input name="shop">`); `shopify/app/routes/auth.login/route.tsx:33-43` (formulario "Shop domain"). `login` existe porque la distribución es AppStore (`shopify/app/shopify.server.ts:26`) | Reemplazar `/` por una página propia sin formulario (o redirigir al sitio) y quitar el formulario de `/auth/login` |
| 2.1.1 / 2.1.2 Sin errores ni defectos de UI, ni menores | R | **parcial** | Misma página de plantilla. `docs/STATUS.md` (2026-11-26): un despliegue mientras se usa la app deja una página que solo dice "200". Consola dentro del admin sin revisar (`docs/15-LANZAMIENTO-MATERIALES.md:49`) | Arreglar `/`; revisar el caso de recarga tras despliegue; recorrer la app dentro del admin mirando la consola |
| 2.3.2 a 2.3.4 OAuth inmediato al instalar y al reinstalar; redirección a la UI | R, PR | **parcial** | Instalación administrada por Shopify (no hay `use_legacy_install_flow` en `shopify/shopify.app.toml`), `authenticate.admin` en `shopify/app/routes/app.tsx:10`. Desinstalar y reinstalar en tienda nueva: sin probar (`docs/15-LANZAMIENTO-MATERIALES.md:47`) | Probar instalar, desinstalar y reinstalar en una tienda de desarrollo nueva |
| 1.1.1 Tokens de sesión; funciona sin cookies de terceros ni local storage | R | **cumple** | Librería `@shopify/shopify-app-react-router` 3.x con `AppProvider` (`app.tsx:19`); no hay `localStorage` ni cookies en `app/`. La única cookie es la del OAuth de Klaviyo, en navegación de primer nivel (`shopify/app/klaviyo/flow.server.ts:73`) | Probar en Chrome incógnito |
| 2.2.3 App Bridge más nuevo (script `app-bridge.js` antes que los demás) | R | **cumple** (por la librería; no verificado en el HTML servido) | `shopify/app/routes/app.tsx:19` | Confirmar en el HTML real que el script va primero en `<head>` |
| 2.2.4 Solo GraphQL Admin API | R | **cumple** | Cuatro operaciones, todas GraphQL: `shopify/app/orders/purchases.ts:98`, `shopify/app/billing/billing.ts:35,98,132` | — |
| 2.2.1 / 2.2.2 Usa APIs de Shopify; experiencia embebida | R | **cumple** | `embedded = true` (`shopify.app.toml:8`); todo el flujo vive en `/app/*`. El consentimiento de Klaviyo sale con `target="_top"` (`shopify/app/components/home-screen.tsx:114`), no en pop-up | — |
| 3.1.1 TLS válido | R | **cumple** | `*.workers.dev` y dominio en Cloudflare | — |
| 3.1.2 Tokens offline con vencimiento | R | **cumple** | `expiringOfflineAccessTokens: true` (`shopify.server.ts:44`); tokens cifrados (`shopify/app/session-storage.server.ts`) | — |
| 3.2 Scopes mínimos | R, C | **cumple hoy / parcial para lanzar** | Pedido: `read_orders` (`shopify.app.toml:16`, `wrangler.jsonc` `SCOPES`). Usado: consulta `orders` (`purchases.ts:98-115`). Las mutaciones de cobro y `currentAppInstallation` no necesitan scope. No hay scopes sin usar | Ver las dos filas siguientes |
| 3.2.1 `read_all_orders`: "must demonstrate the need for this scope"; se pide en Access requests y se declara junto a `read_orders` | R, SC | **no cumple todavía** | No está pedido ni declarado (`shopify.app.toml:14-16`). Sin él Shopify devuelve 60 días y la regla de compras protege a todos (`purchases.ts:20`, `docs/02-ARQUITECTURA.md:60`) | Pedirlo (`docs/14-PASOS-DASHBOARD.md` paso 2), declararlo en el toml y en `SCOPES`, y mostrar en el screencast por qué hace falta ("never purchased") |
| Datos protegidos de clientes: pedir acceso antes de enviar; email es nivel 2 y se pide por campo; "You can't apply while the app is under review" | PCD, SUB | **no cumple todavía** | No pedido. La consulta lee `Order.email` y `customer { id }` (`purchases.ts:101-107`). Sin aprobación, el campo llega con `errors` y la app lo trata como falla (`shopify/app/billing/billing.server.ts:10`, mismo patrón en `shopify/workers/orders-backfill.ts:38`): el backfill no termina y nadie es candidato | Elegir distribución pública, pedir "Protected customer data" con el campo Email y completar el formulario de protección de datos, antes del envío |
| Nivel 1 y 2 de datos protegidos (mínimo de datos, retención, cifrado, backups cifrados, separar prueba y producción, log de accesos, política de incidentes, acceso de personal limitado) | PCD | **parcial** | A favor: solo hashes SHA-256, tokens cifrados, borrado por webhooks. En contra: prueba y producción comparten la misma D1 y el mismo Worker (`shopify/wrangler.jsonc`: una sola base; `KLAVIYO_SEEDED_ACCOUNT_ID` en la config de producción); no hay política de incidentes escrita ni log de accesos a datos protegidos; política de privacidad en borrador (`site/privacy.html:51`) | Base y Worker separados para pruebas; escribir la política de incidentes; publicar la política de privacidad definitiva |
| Webhooks de cumplimiento: tres temas, 200 al recibir, 401 con HMAC inválido, acción en 30 días | PRIV | **cumple** | `shopify.app.toml` (bloque `compliance_topics`); `shopify/app/routes/webhooks.compliance.tsx:15-33`; borrado en `shopify/app/data/privacy.ts:34-87` | — |
| `customers/data_request`: entregar al dueño los datos del cliente | PRIV | **parcial** | No hace nada (`webhooks.compliance.tsx:27-30`). Hay datos derivados del cliente: hash del mail, fecha del último pedido, y filas de `run_profiles` con ID de perfil de Klaviyo | Aceptable si la política lo explica; decidirlo con el abogado y dejarlo escrito |
| 1.2.1 Todo cobro por Shopify (App Pricing o Billing API) | R, BILL | **cumple** | `shopify/app/billing/billing.ts` (único camino de cobro) | — |
| App Pricing es "the default option when you submit a new public app"; manual pricing es "the legacy method"; la Billing API sigue "for existing apps and outlier pricing models Shopify App Pricing doesn't cover"; App Pricing: "Usage caps aren't currently supported" | BILL, SAP, USG | **no verificado (riesgo)** | Decisión vigente: Billing API con tope (`docs/00-HANDOVER.md:30`). La doc no dice cómo una app nueva selecciona "Manual pricing (legacy)" al enviarla | Antes de enviar, mirar en el Partner Dashboard (Settings > Pricing method) si la opción está disponible para esta app. Plan B: App Pricing con un medidor de uso de un evento por limpieza y precio por tramo (sin tope) |
| 1.2.2 Aceptar o rechazar el cargo; volver a pedir aprobación al reinstalar | R | **parcial** | La app consulta la suscripción activa antes de cada limpieza (`shopify/app/routes/app.simulation.tsx:111-135`). Nunca probado contra Shopify (`docs/15-LANZAMIENTO-MATERIALES.md:51`) | Probar aceptar, rechazar y reinstalar en la tienda de desarrollo |
| 1.2.3 Cambiar de plan sin soporte; cargos visibles en el historial | R | **cumple** (un solo plan; el tope se cambia en el admin) | `billing.ts:98-130` | — |
| Cargos de prueba: `test: true` al probar y `false` para cobrar de verdad | PR | **cumple** | `test: billing.developmentStore` (`app.simulation.tsx:116`) | — |
| Webhooks de suscripción (`APP_SUBSCRIPTIONS_UPDATE`, `..._APPROACHING_CAPPED_AMOUNT`) | USG | **parcial** (recomendado, no obligatorio) | No suscriptos. La app consulta el estado en cada uso, así que no es un error | Opcional |
| El cargo falla si supera el tope ("Failed to create usage charge") | https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appUsageRecordCreate | **cumple** | Tope US$ 149 = tramo más alto; un cargo cada 28 días; `idempotencyKey` (máx. 255) en `billing.ts:266` | — |
| 4.2.1 a 4.2.3 Precios exactos y completos, solo en la sección de precios | R, BP | **parcial** | El texto de aprobación sale de la tabla de precios (`billing.ts:30-33`), coincide con el borrador de ficha (`docs/07-LANZAMIENTO.md`, "Pricing") y con el sitio (`site/index.html:247-264`). Pero la primera función del borrador dice "Free, read-only list audit": es información de precio fuera de la sección de precios | Quitar "Free" de las funciones y del resto de la ficha; dejarlo en precios |
| 4.1.1 / 4.1.2 Nombre único, que empiece por la marca propia; "Don't lead with... the name of a platform or business that you integrate with"; se puede nombrar la plataforma si "your brand name must come first"; máx. 30 | R, BP | **cumple** | "TierSaver for Klaviyo" (21 caracteres), `shopify.app.toml:6`. Búsqueda de nombres parecidos en el App Store: pendiente (`docs/00-HANDOVER.md:51`) | Hacer esa búsqueda; el nombre del toml y el de la ficha tienen que coincidir |
| 4.3.3 / 4.3.4 Sin estadísticas, datos ni superlativos en la ficha | R | **parcial** | El borrador no tiene cifras de resultado. "created at least a year ago" es un criterio, no una estadística; un revisor estricto podría objetarlo | Menor; dejarlo como está o decir "long-standing profiles" |
| Campos de la ficha: introducción 100, detalles 500, funciones 80 | BP | **no cumple** | "Details" del borrador mide 762 caracteres (`docs/07-LANZAMIENTO.md`, "Details"). Introducción 99 y subtítulo 57: bien | Recortar "Details" a 500 |
| 4.3.6 / 4.3.7 Sin reseñas ni testimonios | R | **cumple** | Borrador | — |
| 4.4.3 a 4.4.5 Imágenes reales, distintas, sin precios ni garantías; 3 a 6 capturas de 1600 × 900 | R, BP | **no cumple todavía** | Solo hay capturas del entorno local (`docs/15-LANZAMIENTO-MATERIALES.md:7`) | Capturas reales en la tienda de desarrollo |
| 4.5.3 Screencast del onboarding y las funciones, en inglés | R | **no cumple todavía** | "Video: sin hacer" (`docs/15-LANZAMIENTO-MATERIALES.md:55`) | Grabarlo |
| 4.5.4 / 4.5.5 Credenciales de prueba que funcionen, sin 2FA/OTP/SSO, también para servicios de terceros ("valid test credentials that grant full access") | R, BP | **no cumple todavía** | Marcador "[CREDENTIALS, sent separately]" (`docs/15-LANZAMIENTO-MATERIALES.md:20`). Klaviyo suele pedir verificación al entrar: hay que resolverlo. Además la supresión está apagada en producción (`SUPPRESSION_ENABLED`, `shopify/app/runs/gateway.server.ts:59`) | Cuenta de Klaviyo para el revisor con acceso sin segundo factor o códigos fijos; encender la supresión para esa cuenta |
| 4.5.6 Contacto de emergencia en la cuenta de Partner | R, SUB | **no verificado** | Vive en el dashboard | Cargar mail y teléfono |
| Política de privacidad (obligatoria) y soporte | BP, SUB | **no cumple todavía** | Términos y privacidad en borrador con marcadores (`site/terms.html:51`, `site/privacy.html:51`); casillas support@ y hello@ inexistentes; el sitio solo está en workers.dev con `noindex` | Publicar las páginas definitivas en tiersaver.com y crear las casillas |
| URLs sin "Shopify" ni "Example"; ícono 1200 × 1200 | SUB | **cumple** | `shopify.app.toml:7`; `brand/logo/final/app-icon.png` (falta subirlo) | Subir el ícono |
| Límites de envío: una app nueva en revisión por organización; cada app publicada con 10 o más instalaciones pagas | SUB | **cumple** | Organización sin apps publicadas | — |
| Verificaciones automáticas previas al envío | SUB | **no verificado** | La página no las enumera | Correrlas desde la página de envío |
| Desinstalación: borrar datos; `shop/redact` llega a las 48 h | PRIV | **cumple** | `shopify/app/routes/webhooks.app.uninstalled.tsx:14-21` (revoca Klaviyo y borra tokens); `privacy.ts:20-39` | — |
| 1.1.4 Solo información real | R | **cumple** | Los números salen de datos del merchant | — |
| Rendimiento: no bajar Lighthouse de la tienda más de 10 puntos | C | **n/a** | La app no toca la tienda online | — |
| Webhook `orders/create` | — | **parcial** (funcional, no de política) | Comentado en `shopify.app.toml:31-34`; la ruta existe (`webhooks.orders.create.tsx`). Sin él, los compradores nuevos no entran a `purchase_hashes` hasta el próximo backfill | Reactivarlo cuando se apruebe el acceso a datos protegidos |

### 1.1 Built for Shopify (lista secundaria)

Fuente: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements (2026-11-26).

| Criterio | Estado | Nota |
| --- | --- | --- |
| 1.2.1 a 1.2.3: 50 instalaciones netas de tiendas pagas, 5 reseñas, puntaje mínimo | no cumple (app nueva) | Es posterior al lanzamiento |
| 2.1 LCP ≤ 2,5 s, CLS ≤ 0,1, INP ≤ 200 ms (p75, 100 llamadas en 28 días) | no verificado | Sin tráfico. SSR en Workers juega a favor |
| 3.1.1 App Bridge en cada documento; 3.1.2 flujos principales dentro del admin | cumple | El consentimiento de Klaviyo es externo por necesidad |
| 3.1.5 Conectar y desconectar sistemas de terceros dentro de la app | cumple | "Connect Klaviyo" y "Disconnect Klaviyo" |
| 3.1.4 / 4.2.3 Métricas y estado en el inicio | cumple | `shopify/app/components/home-screen.tsx` |
| 4.1.4 `s-app-nav`, sin enlace "Home" aparte | **no cumple** | `shopify/app/routes/app.tsx:21` tiene `<s-link href="/app">Home</s-link>` |
| 4.1.5 Contextual Save Bar en formularios | no verificado | Revisar Settings |
| 4.3.1 No prometer resultados | cumple | Textos de higiene, sin ahorros |
| 5.6 Categoría Email marketing (web pixel, segmentos, visitors API) | riesgo de categoría | Si se elige esa categoría, aplican criterios que la app no cumple. Elegir otra |

## 2. Shopify API

| Requisito | Fuente (2026-11-26) | Estado | Evidencia | Arreglo |
| --- | --- | --- | --- | --- |
| Versión soportada. Estables: 2026-01, 2026-04, 2026-07, 2026-10 (la más nueva, hasta el 2027-10-16). 2027-01 es candidata | https://shopify.dev/docs/api/usage/versioning | **cumple** | `ApiVersion.October26` (`shopify.server.ts:21`) | Revisar otra vez en enero de 2027 |
| Versión de webhooks | idem | **cumple** | `api_version = "2026-10"` (`shopify.app.toml:19`) | — |
| `ShopPlan.partnerDevelopment` | https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopPlan | **cumple** | No deprecado (el único deprecado es `displayName`, que no se usa). `billing.ts:37` | — |
| `appUsageRecordCreate` con `idempotencyKey` | https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appUsageRecordCreate | **cumple** | Sin avisos de deprecación. `billing.ts:132-138` | — |
| `appSubscriptionCreate` con `appUsagePricingDetails` | USG | **cumple** técnicamente; ver el riesgo de "legacy" arriba | `billing.ts:98-130` | — |
| `orders(query:, sortKey: PROCESSED_AT)`, `Order.email`, `Order.test`, `customer.id` | no verificado campo por campo | **no verificado** | `purchases.ts:98-115` | Correr `graphql-codegen` contra 2026-10 o validar la consulta con el esquema antes de enviar |
| "Apps que usan APIs deprecadas dentro de 90 días no se pueden enviar" | C | **cumple** | 2026-10 vence en octubre de 2027 | — |

## 3. Klaviyo

Fuentes (2026-11-26):
- LR: https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements
- SR: https://developers.klaviyo.com/en/docs/submit_your_app_for_review
- OA: https://developers.klaviyo.com/en/docs/create_a_public_oauth_app
- PM: https://developers.klaviyo.com/en/docs/create_promotional_material_for_your_integration
- AT: https://www.klaviyo.com/legal/api-terms (versión del 2026-11-12)
- AUP: https://www.klaviyo.com/legal/acceptable-use-policy (versión del 2026-04-09)
- BS: https://developers.klaviyo.com/en/reference/bulk_suppress_profiles
- RL: https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling
- VP: https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy
- CL: https://developers.klaviyo.com/en/docs/changelog_ (leídos los primeros 100.000 caracteres de 110.742)
- H1: https://help.klaviyo.com/hc/en-us/articles/24312135764251 (actualizado el 2026-10-27)
- H2: https://help.klaviyo.com/hc/en-us/articles/24263920096027 (2026-10-29)
- H3: https://help.klaviyo.com/hc/en-us/articles/4405883690651 (2026-10-25)
- H4: https://help.klaviyo.com/hc/en-us/articles/115000976672 (2026-11-09)
- No leídos en esta revisión: Technology Partner Agreement (https://www.klaviyo.com/legal/technology-partner-agreement), las pautas de marca 2026 (deck de Figma enlazado desde PM) y la guía del programa de partners (PDF). Lo que se dice de ellos viene de `docs/12-CUMPLIMIENTO-KLAVIYO.md` (lectura del 2026-11-25) o de extractos de búsqueda.

| Requisito | Fuente | Estado | Evidencia | Arreglo |
| --- | --- | --- | --- | --- |
| Al menos 5 instalaciones con actividad de producción; no cuentan cuentas de desarrollador, de prueba ni de la empresa | LR, SR | **no cumple** | Una sola conexión, la cuenta de prueba | Juntar 5 merchants reales por el enlace de instalación antes de pedir revisión |
| Mientras no esté revisada, el consentimiento muestra un aviso de app no revisada; se puede instalar y usar igual; SR no fija tope de instalaciones | SR | **cumple** (se puede operar sin listar) | App en Draft | Avisarlo en el onboarding y en la ayuda |
| OAuth con "the least permissive scope set possible"; `accounts:read` obligatorio | LR, OA | **parcial** | Diez scopes (`shopify/app/klaviyo/config.ts:40-84`). Los nueve obligatorios tienen uso: `/api/accounts`, `/api/profiles`, jobs de supresión y des-supresión, `/api/lists`, `/api/segments` (lectura y POST/PATCH), `/api/metrics` (`shopify/app/klaviyo/api.ts`). `events:read` no se pide. **`usage:read` se pide siempre** en el consentimiento aunque el código lo declara opcional y solo informativo (`config.ts:77-84`) | Sacar `usage:read` del pedido por defecto. Es el scope más difícil de justificar en una revisión (lee la facturación) y nada depende de él |
| Código sin uso que necesitaría otro scope | LR | **parcial** | `listEngagementEventsPage` (`api.ts:460`) usa `/api/events` sin que se pida `events:read` | Borrarlo o dejarlo fuera del build; no es un incumplimiento |
| APIs estables | LR, CL | **cumple** | Revisión `2026-10-15` (`config.ts:12`), la GA más nueva en el changelog y la que muestra BS | — |
| Ciclo de vida: estable 1 año, deprecada 1 año, retirada a los 2 | VP | **cumple** | `2026-10-15` se retira en octubre de 2028 | Fijar un recordatorio anual |
| Manejo completo de instalación, desinstalación y errores en OAuth | LR | **cumple** | Tres pasos con estado firmado (`shopify/app/klaviyo/flow.server.ts`), revocación al desinstalar (`webhooks.app.uninstalled.tsx:16`), desconexión en la app | — |
| Settings URL a una página de ajustes específica de Klaviyo; OAuth installation URL directo al flujo | LR, SR | **no cumple todavía** | No existen como páginas públicas (`docs/14-PASOS-DASHBOARD.md:50`). La app solo se instala desde Shopify, así que un enlace directo al OAuth no puede funcionar sin sesión de Shopify | Definir con Klaviyo qué URL aceptan para una app que vive dentro de Shopify (lo usual: la ficha del App Store) |
| Bulk suppress por terceros: "Manually suppress profiles by email address or specify a segment/list ID"; 100 mails por request; 75/s y 750/m; scopes `profiles:write` + `subscriptions:write` | BS | **cumple** | `api.ts:823-880`; lotes de 100 (`config.ts:136`); la app usa 700/m, el valor más bajo (`config.ts:128`) | — |
| Límites y condiciones declarados para la supresión masiva | BS, H1 | **cumple** | La referencia no pone condiciones ni tope diario. La ayuda fija la regla de 90 días para volver a suprimir; la app bloquea 365 días a los restaurados (`packages/core/src/rules.ts:53`) | — |
| Respetar límites; "You agree not to circumvent any limitations"; 429 con `Retry-After`; OAuth tiene cupo propio por cuenta instalada | AT, RL | **cumple** | Cliente con ritmo por endpoint (`shopify/app/klaviyo/client.ts`); una sola credencial por cuenta | — |
| Se puede cobrar: "You may charge for your Integration" | AT | **cumple** | Precio fijo | — |
| No "design or develop a competitive or substantially similar product or service" | AT (y TPA 2.g según `docs/12`) | **riesgo abierto** | Klaviyo tiene "Suppress inactive profiles" y recomendaciones de supresión nativas (H1). TierSaver las repite de forma programada | No se arregla con código. Es el motivo más probable de un rechazo de listado o de una revocación. Tener el plan de contingencia (clave privada, exportar historial) y consultarlo con el abogado antes de firmar el TPA |
| No usar los servicios "in a manner designed to avoid or circumvent bills"; quien ofrece la integración responde por no facilitarlo | AUP | **parcial (riesgo de interpretación)** | A favor: precio fijo, criterios iguales o más estrictos que los de Klaviyo, sin reactivación automática, bloqueo de 365 días. En contra: la marca "TierSaver", y que la programación se ancla a la renovación del plan (`shopify/app/routes/app._index.tsx:42-44`, "finishes before your plan renews" en `site/index.html:150`) | Decisión de Facundo ya tomada; el riesgo queda. No agregar ningún texto nuevo sobre la factura |
| Marca: no sugerir que Klaviyo "sponsors, endorses, or associates"; no decir "preferred", "recommended", "top performing", "best"; cumplir las pautas de marca | AT, LR, PM | **parcial** | No se usa el logo de Klaviyo; hay aviso de no afiliación (`site/index.html:393`). Pero la frase central es "Klaviyo's own recommended criteria" (sitio, ficha, textos del listado de Klaviyo en `docs/14-PASOS-DASHBOARD.md:43-46`). Describe los criterios, no la app, pero pone "Klaviyo" y "recommended" juntos, justo la palabra vetada. Las pautas de marca 2026 no se leyeron | En el listado de Klaviyo, cambiar a "the criteria Klaviyo publishes for its suppression recommendations". Leer el deck de pautas antes de enviar |
| Acuerdo de usuario y política de privacidad propios | AT, LR | **no cumple todavía** | Borradores (`site/terms.html:51`, `site/privacy.html:51`) | Publicar las versiones definitivas |
| Borrar los datos del usuario "immediately" si lo pide o cierra la cuenta | AT | **parcial** | Al desinstalar se borran tokens; el resto queda hasta `shop/redact`, unas 48 h (`privacy.ts:15-29`). Desconectar Klaviyo sin desinstalar no borra el historial | Documentar el plazo en la política y ofrecer borrado a pedido |
| Logs de actividad a prueba de alteraciones, retenidos 365 días como mínimo, con monitoreo en tiempo real | LR | **no cumple** | Workers Logs retiene 3 días en Free y 7 en Paid (ver sección 4). `events_log` se borra en cascada con la tienda (`shopify/app/db/schema.ts:458-460`). Sin alertas (`docs/15-LANZAMIENTO-MATERIALES.md:58`) | Logpush a R2 con retención de 365 días (sin datos personales) y alertas, antes de pedir la revisión |
| MFA en los sistemas que tocan datos; cifrado en reposo tipo AES-256; secretos en un gestor cifrado; rotación | LR | **parcial** | Tokens con AES-GCM y clave en secretos de Workers. MFA en Cloudflare, Shopify, Klaviyo y GitHub: no verificable desde el repo. No hay rotación definida de `TOKEN_ENCRYPTION_KEY`; `docs/STATUS.md` dice que el token de Cloudflare ve tres cuentas | Confirmar MFA en todas las cuentas, limitar el token a la cuenta TierSaver, escribir el procedimiento de rotación |
| Vulnerabilidades: críticas en 3 días, altas en 7 | LR | **no verificado** | Sin proceso | `npm audit` en CI |
| Material de revisión: plantilla de pruebas (Google Doc), endpoints con caso de uso y scope, diagrama de arquitectura, demo grabada, 1 a 4 artículos (uno guía de usuario), galería, URL de precios | LR, SR | **no cumple todavía** | Solo logo y textos (`docs/14-PASOS-DASHBOARD.md` paso 4) | Prepararlo cuando haya 5 instalaciones |
| Sitio con beneficios, visuales al día y video; documentación paso a paso; SLA y aviso de caídas | LR | **parcial** | Sitio y 9 artículos hechos, sin publicar en el dominio; sin video; sin página de estado | — |
| Dónde se guardan los datos y consentimiento para transferencias | LR | **parcial** | D1 en región ENAM (`docs/STATUS.md`); falta decirlo en la política | Agregarlo |
| Firmar Technology Partner Agreement, AUP y API Terms | LR | **no cumple todavía** (decisión de Facundo, freno de `CLAUDE.md`) | — | Revisión del abogado antes de aceptar |
| "Las revisiones de Klaviyo están en pausa" (`docs/14-PASOS-DASHBOARD.md:37`) | SR | **no verificado** | La página leída hoy no dice que estén en pausa | Corregir o citar la fuente |

### 3.1 Lo que el sitio y la app afirman sobre Klaviyo

| Afirmación | Fuente | Estado | Evidencia | Arreglo |
| --- | --- | --- | --- | --- |
| "Suppressed profiles do not count toward your Klaviyo email plan" | H2: "suppressed profiles do not contribute towards your email plan's active profile count"; H1 igual | **cumple** | `site/index.html:230,310` | — |
| Falta el matiz de Advanced KDP: "billing is based on total profiles, including suppressed profiles" | H1, H2 | **parcial** | No aparece en `site/index.html` | Agregar una línea en la FAQ y en la guía de conteo |
| Bajar el conteo no baja la factura sola: "A lower active profile count does not necessarily lower your bill" | H2 | **cumple** | `site/index.html:310` ("Not by itself...") | — |
| Klaviyo revisa el conteo "shortly before your billing cycle renews"; el auto-downgrade lo activa Owner o Admin | H3 | **cumple** | `site/help/monthly-schedule-and-your-klaviyo-plan.html` | — |
| "may take up to 72 hours to refresh after a large cleanup" | H4, textual | **cumple** | `site/help/monthly-schedule-and-your-klaviyo-plan.html:68`, `site/guides/klaviyo-list-hygiene.html:123` | — |
| Criterios por defecto = los de las recomendaciones de supresión: creado hace 365 días o más, 5 o más mails en ~72 semanas, nunca abrió ni hizo clic, sin visitas, vistas de producto, checkouts ni compras, puede recibir mails y sin supresión en los últimos 90 días | H1 | **cumple** | `packages/core/src/rules.ts:38-54` (365, 5, 504 días, ventanas `null` = nunca); segmento con consentimiento de email (`docs/STATUS.md`, 14 grupos de condiciones). TierSaver suma protecciones (SMS, grupos protegidos, pedidos de Shopify) | — |
| Klaviyo publica dos umbrales de antigüedad: 365 días (recomendaciones, H1) y 180 días (segmento sugerido en H2) | H1, H2 | **cumple** | El defecto usa el más estricto; el piso del modo ampliado es 180 (`rules.ts:66`) | — |
| Pisos del modo ampliado: 182 días para clic y compra | H1: "clicked an email or placed an order within the last 182 days" | **cumple** | `rules.ts:60-68` (compra 365, clic 182) | — |
| Modo ampliado: aperturas y actividad en el sitio con ventana de 182 días | H1, H2 | **parcial** | Los dos criterios publicados piden cero aperturas y cero actividad "all time". Con el modo ampliado activo, la app deja de aplicar "Klaviyo's criteria" | El texto de Settings tiene que decir que el modo ampliado va más allá de los criterios de Klaviyo |
| Klaviyo separa "list cleaning" (entregabilidad) de "active profile management" y aconseja un sunset flow antes de suprimir | H2 | **parcial** | El producto se presenta como "list hygiene"; no menciona el sunset flow | Opcional: nombrarlo en la guía |
| Un perfil suprimido que compra sigue suprimido | H2 | **cumple** | `brand/messaging.md:99`, ayuda | — |

## 4. Cloudflare

Fuentes (2026-11-26):
- WL: https://developers.cloudflare.com/workers/platform/limits/
- WF: https://developers.cloudflare.com/workflows/reference/limits/
- D1: https://developers.cloudflare.com/d1/platform/limits/
- LG: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- No verificado hoy: precios (filas leídas y escritas de D1, costo de Workflows), Email Service y reglas para mover dominios entre cuentas.

| Requisito | Fuente | Estado | Evidencia | Arreglo |
| --- | --- | --- | --- | --- |
| CPU por request y por cron: 10 ms en Free; 30 s por defecto en Paid | WL | **no cumple en Free** | SSR de React, AES-GCM y SHA-256 por request. `docs/STATUS.md` dice que no hubo errores 1102 con una tienda, pero no hay margen | Workers Paid antes del primer merchant real |
| Subrequests: 50 por request en Free; 10.000 en Paid | WL, WF | **no cumple en Free** | Un paso de scan pagina Klaviyo; el cron usa `subrequestBudget: 12` por corrida para entrar (`shopify/workers/app.ts:54`) | Workers Paid |
| Workflows: 1.024 pasos por instancia en Free; 10.000 en Paid (hasta 25.000) | WF | **no cumple en Free** | `MAX_PAGES = 1000` (`shopify/workers/orders-backfill.ts:11`): con más de ~250.000 pedidos la cobertura no se marca y nadie es candidato. Una corrida de 150.000 perfiles son 1.500 lotes | Workers Paid y subir `MAX_PAGES` |
| Workflows: CPU por paso 10 ms en Free | WF | **no cumple en Free** | Cada paso hashea hasta 250 mails y escribe en D1 | Workers Paid |
| Workflows: 100 instancias concurrentes en Free; estado retenido 3 días (7 en Paid) | WF | **parcial** | Alcanza para la beta | — |
| D1: 500 MB por base en Free, 10 GB en Paid; 50 consultas por invocación en Free, 1.000 en Paid; 100 parámetros por consulta | D1 | **parcial** | Lotes de 50 sentencias (`purchases.ts:88`) cuentan como una consulta. 10 GB es un techo real si crecen `run_profiles` y `purchase_hashes` | Workers Paid; medir el tamaño por tienda en la beta |
| D1 Time Travel: 7 días en Free, 30 en Paid | D1 | **parcial** | Es el único respaldo | Paid; exportación periódica |
| Cron Triggers: 5 por cuenta en Free | WL | **cumple** | Uno, horario (`wrangler.jsonc:45`) | — |
| Requests: 100.000 por día en Free | WL | **parcial** | Alcanza para la beta; al pasarlo la app devuelve error 1027 | Paid |
| Logs: 3 días en Free, 7 en Paid | LG | **no cumple** frente a los 365 días que pide Klaviyo | `observability.enabled` (`wrangler.jsonc:7`) | Logpush a R2 |
| Dominio propio | — | **no cumple todavía** | App y sitio en `*.workers.dev`; `SITE_URL` y `SHOPIFY_APP_URL` apuntan ahí (`wrangler.jsonc:53-54`); el sitio no tiene `routes` (`site/wrangler.jsonc`). El dominio se puede mover desde el 2026-12-05 (`docs/STATUS.md`) | Mover la zona, poner `app.tiersaver.com` y `tiersaver.com`, y actualizar `application_url`, `redirect_urls`, el redirect de Klaviyo y las URLs legales **antes** de enviar a revisión: cambiar la URL después obliga a redesplegar la config y a tocar la app de Klaviyo |
| Separar prueba y producción | PCD (Shopify) | **no cumple** | Un Worker y una D1 para todo | Segundo Worker y segunda D1 para desarrollo |

## 5. Bloqueantes, por prioridad

### (a) Revisión de Shopify

1. Página `/` de plantilla con formulario de dominio, y formulario en `/auth/login` (requisito 2.3.1; `shopify/app/routes/_index/route.tsx:24-38`).
2. `read_all_orders` y datos protegidos (email) sin pedir. Sin ellos el flujo principal no se puede mostrar. No se puede pedir mientras la app está en revisión.
3. Cobro sin probar contra Shopify, y sin confirmar que una app nueva puede elegir "Manual pricing (legacy)". Requiere elegir distribución pública.
4. Términos y privacidad en borrador; sin casillas de soporte; sin dominio propio.
5. Material de revisión: screencast, capturas reales, credenciales de Klaviyo para el revisor sin segundo factor, supresión encendida para esa cuenta.
6. Ficha: "Details" de 762 caracteres (máximo 500); "Free" fuera de la sección de precios.
7. Desinstalar y reinstalar sin probar; consola sin revisar dentro del admin; página "200" tras un despliegue.
8. Contacto de emergencia e ícono por cargar.
9. Separar datos de prueba y de producción, y política de incidentes (formulario de datos protegidos nivel 2).

### (b) Revisión de Klaviyo

1. 5 instalaciones reales con actividad de producción.
2. Logs de 365 días a prueba de alteraciones, con monitoreo.
3. Riesgo de fondo, sin arreglo de código: cláusula de producto "competitive or substantially similar" y la de evadir cargos. Abogado antes de firmar el Technology Partner Agreement.
4. `usage:read` pedido por defecto: sacarlo.
5. "Klaviyo's own recommended criteria" en los textos del listado: reformular; leer las pautas de marca 2026.
6. Settings URL y OAuth installation URL sin definir para una app que vive dentro de Shopify.
7. Material de pruebas, diagrama, demo, artículos, términos y privacidad publicados.
8. MFA confirmado en todas las cuentas, rotación de claves, proceso de vulnerabilidades.

### (c) Producción

1. Workers Paid antes del primer merchant real (CPU, subrequests, pasos de Workflow). Es un gasto: lo decide Facundo.
2. Dominio propio y actualización de todas las URLs antes de cualquier revisión.
3. Entorno de pruebas separado (Worker y D1).
4. Reactivar el webhook `orders/create` al aprobarse los datos protegidos.
5. Alertas de errores y respaldo de D1 más allá de Time Travel.
6. `MAX_PAGES` del backfill de pedidos para tiendas grandes.
7. Mostrar el matiz de Advanced KDP en el sitio.

## 6. Notas para la sesión principal

- `docs/14-PASOS-DASHBOARD.md:37` dice que las revisiones de Klaviyo están en pausa; la página de envío leída hoy no lo dice.
- `docs/04-PRECIO-Y-COBRO.md` tiene abierta la pregunta de App Pricing. Dato de hoy: App Pricing admite uso con medidores (hasta 5 por plan, 6 tramos por medidor, facturación mensual) y no admite topes.
- La memoria del usuario estaba vacía; nada de este informe viene de ahí.
