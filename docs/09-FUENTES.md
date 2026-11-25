# Fuentes

Consultadas el 25 de noviembre de 2026 salvo indicación.

## Verificado en fuente primaria

| Dato | Fuente |
| --- | --- |
| Klaviyo: más de 211.000 clientes en el tercer trimestre de 2026 | https://www.sec.gov/Archives/edgar/data/0001835830/000183583026000045/confidentialfiscalq32026ea.htm |
| Recomendaciones de supresión, 18 de marzo de 2026 | https://www.klaviyo.com/whats-new |
| La supresión en bloque alcanza solo a los miembros actuales | https://help.klaviyo.com/hc/en-us/articles/360044054732 |
| Supresión en bloque e inactivos | https://help.klaviyo.com/hc/en-us/articles/24312135764251 |
| Endpoint Bulk Suppress Profiles: límites, scopes, 100 mails por request | https://developers.klaviyo.com/en/reference/bulk_suppress_profiles |
| Estado de jobs de supresión | https://developers.klaviyo.com/en/reference/get_bulk_suppress_profiles_jobs |
| Bulk Unsuppress Profiles | https://developers.klaviyo.com/en/reference/bulk_unsuppress_profiles |
| OAuth para apps públicas de Klaviyo | https://developers.klaviyo.com/en/docs/create_a_public_oauth_app |
| Cobro por uso en Shopify, `cappedAmount` | https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-usage-based-subscriptions |
| `appUsageRecordCreate` | https://shopify.dev/docs/api/admin-graphql/latest/mutations/appUsageRecordCreate |
| Requisitos del App Store | https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements |
| Webhooks de cumplimiento | https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance |
| Envío a revisión y límites de envío | https://shopify.dev/docs/apps/store/review/app-submission |
| ListSweep sin reseñas | https://apps.shopify.com/listsweep/reviews |
| Nae sin reseñas, gratis, lanzada el 25/02/2026 | https://apps.shopify.com/ghost-profile-auditor |
| USPTO sin resultados para "Tiersaver" | Búsqueda de wordmark en tmsearch.uspto.gov hecha por Facundo |

## Políticas de Klaviyo y de Shopify (agregado el 2026-11-25)

La lista completa, con qué se leyó entero y qué no se pudo leer, está en `12-CUMPLIMIENTO-KLAVIYO.md` ("Fuentes leídas" y "No se pudo leer"). Las que sostienen las decisiones del 2026-11-25:

| Dato | Fuente |
| --- | --- |
| Cláusula sobre evadir cargos y responsabilidad de quien ofrece integraciones | https://www.klaviyo.com/legal/acceptable-use-policy |
| Se puede cobrar por la integración; revocación del acceso a la API sin causa | https://www.klaviyo.com/legal/api-terms |
| Los perfiles suprimidos no cuentan para el plan; a quién corresponde suprimir; un suprimido que compra sigue suprimido | https://help.klaviyo.com/hc/en-us/articles/24263920096027 |
| Criterios de las recomendaciones de supresión (365 días, 5 o más mails en ~72 semanas, sin actividad); regla de 90 días | https://help.klaviyo.com/hc/en-us/articles/24312135764251 |
| Klaviyo revisa el conteo poco antes de renovar el ciclo; auto-downgrade | https://help.klaviyo.com/hc/en-us/articles/4405883690651 |
| Sin estadísticas ni datos en la ficha (requisito 4.3.3); precios solo en la sección de precios (4.2) | https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements |
| ListSweep: plan gratis y Pro a US$ 7 por mes, sin reseñas | https://apps.shopify.com/listsweep |
| ShopiDeck: auditoría gratis y planes desde US$ 9 por mes, sin reseñas | https://apps.shopify.com/shopideck-klaviyo-botcleaner |

## De terceros (útil, pero confirmar antes de mostrar a un merchant)

| Dato | Fuente |
| --- | --- |
| Tramos de noviembre de 2026: US$ 20 a 500 perfiles, US$ 150 a 10.000, US$ 275 a 12.500, US$ 1.955 a 150.000; demora de 72 horas | https://topgrowthmarketing.com/klaviyo-pricing/ |
| El cobro por perfiles activos sigue vigente en 2026 | https://www.engagelab.com/blog/real-cost-of-klaviyo |
| Costos reales de 11+ cuentas | https://bsandco.us/blog-post/what-does-klaviyo-cost |
| Tramos de ~US$ 375 a 20.000 y ~US$ 720 a 50.000 | Blogs de terceros citados en el research inicial; sin verificar |

## Del research inicial (no reverificado)

- Quejas con montos (US$ 25 a 400, US$ 100 a 860, US$ 45 a 600+): reseñas de 1 estrella de la ficha de Klaviyo en el Shopify App Store.
- Bloqueo de 90 días tras reactivar; el conteo se toma al inicio del ciclo; la baja automática de plan es opcional.
- Descuento que limita la suba al 25% para clientes existentes.
- Shopify: 0% de revenue share hasta US$ 1 M acumulado, más 2,9% de procesamiento.

## Estimaciones propias

Ticket promedio de US$ 49, cuentas necesarias por nivel de ingreso, costos de infraestructura, márgenes, plazos de construcción y de revisión, metas de go-to-market.

## Herramientas

- REA: https://github.com/morluto/rea
- Modern Web Guidance: https://github.com/GoogleChrome/modern-web-guidance-src
- brag: https://github.com/latent-spaces/brag

Leídas desde su página de GitHub; ninguna instalada ni probada.

## Artefactos previos

- One-pager de la oportunidad: https://claude.ai/artifact/VEPvgkEZhqn5wT7ZJi1JkA
- Plan de lanzamiento: https://claude.ai/artifact/1ZS8KVspaML7vdjPKTMF9R

Son privados de Facundo; la sesión nueva no necesita abrirlos porque este paquete contiene lo mismo.
