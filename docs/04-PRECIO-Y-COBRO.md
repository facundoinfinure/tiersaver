# Precio y cobro

## Modelo decidido

Decisión de Facundo del 2026-11-26. Reemplaza el cargo por limpieza del 2026-11-25. Tabla de precios en `packages/core/src/charge.ts`; todo lo que habla con Shopify está en `shopify/app/billing/billing.ts`.

Plan mensual fijo según el tamaño de la lista:

| Perfiles activos en Klaviyo | Precio por mes |
| --- | --- |
| Hasta 10.000 | US$ 9 |
| Hasta 25.000 | US$ 19 |
| Hasta 75.000 | US$ 39 |
| Hasta 150.000 | US$ 79 |
| Más de 150.000 | No se vende automáticamente: se escribe a hello@tiersaver.com |

Reglas:

- **Gratis hasta la primera limpieza.** Conectar Klaviyo, la auditoría y la simulación no cuestan nada y no piden plan. Reemplaza la regla de producto 6 "si no hay limpieza, no se cobra".
- El plan empieza cuando el merchant aprueba su primera limpieza (y aprueba el plan en la pantalla de Shopify). Desde ahí Shopify lo cobra cada 30 días, **haya o no limpieza ese mes**, hasta que el merchant lo cancela.
- Se cancela desde Configuración ("Cancel plan", con confirmación) o desinstalando la app. Cancelar corta las limpiezas y apaga el modo automático; no devuelve el período ya pago. Las auditorías siguen gratis.
- No hay cargo por limpieza, ni retención de 72 horas, ni regla de 28 días, ni registro de limpiezas impagas. Deshacer una limpieza no devuelve el mes.
- Una limpieza, manual o automática, solo arranca si la tienda tiene un plan **activo** cuyo precio mensual es al menos el del tramo del tamaño de lista de la simulación que se aprueba. Se le pregunta a Shopify en el momento (`planGate`); si Shopify no responde, la limpieza no arranca.
- Si la lista subió de tramo, el merchant aprueba el precio nuevo en Shopify antes de la próxima limpieza. El modo automático no lo hace solo: la limpieza queda esperando revisión con el motivo a la vista.
- Si la lista bajó de tramo, la app lo dice en la pantalla de aprobación y en Configuración y ofrece pasar al plan menor. Nunca se sigue cobrando de más sin avisar.
- Por encima de 150.000 perfiles activos no se puede aprobar ni arrancar una limpieza desde la app. **Pendiente de decisión**: cómo se le habilita el servicio a quien acuerde un precio por escrito (hoy no hay mecanismo).
- El precio nunca depende de la factura de Klaviyo, del plan de Klaviyo ni de `usage_max`.
- El tamaño de lista es la cantidad de perfiles activos antes de la limpieza, tomada de la auditoría que respalda la simulación.
- Las tiendas de desarrollo usan cargos de prueba (`test: true`), que Shopify no factura.

### Recorrido

1. El merchant revisa la simulación. Ve: "Free until you approve your first cleanup. Then US$X/month for lists up to N active profiles, charged by Shopify every 30 days until you cancel. Restoring a cleanup does not refund it."
2. Aprueba con "Approve and start plan (US$X/month)". La app registra la aprobación (quién, cuándo, versión de los términos) y lo manda a la pantalla de aprobación de Shopify.
3. Shopify lo devuelve a la revisión. Con el plan activo aparece "Start cleanup". Si lo rechaza en Shopify, la simulación queda aprobada pero no puede arrancar, y la pantalla ofrece "Start plan".
4. Con un plan que ya cubre la lista, el botón dice "Approve cleanup" y no se le pide nada a Shopify.
5. Queda en la bitácora: `plan.requested`, `plan.started`, `plan.ended`, `plan.frozen`. El estado conocido del plan se guarda en `shop_plans` (migración 0012) para el aviso de la página de inicio; la verdad es siempre Shopify.

Las tablas `usage_charges` y `unpaid_cleanups` quedan en el esquema como historia sin uso. No se borran.

## Implementación en Shopify

Verificado el 2026-11-26 en shopify.dev (GraphQL Admin API 2026-10):

- `appSubscriptionCreate` con `appRecurringPricingDetails` (precio e intervalo `EVERY_30_DAYS`, que es el valor por defecto). El merchant aprueba en `confirmationUrl` y vuelve a `returnUrl`. No hay restricción sobre el momento: la suscripción se puede crear cuando se aprueba la primera limpieza. Si no se aprueba en dos días queda `EXPIRED`; si se rechaza, `DECLINED`. Fuentes: https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing/create-time-based-subscriptions y https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
- "An app can have only one active subscription for each merchant. The existing subscription is canceled and replaced by the new subscription after the merchant approves it." Con el comportamiento por defecto (`STANDARD`), el cambio entre dos planes de 30 días se aplica en el momento y Shopify prorratea: al subir cobra la diferencia por los días que quedan; al bajar da un crédito. Fuente: https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing
- `appSubscriptionCancel(id, prorate)` corta los ciclos futuros; `prorate` es `false` por defecto (sin crédito). Desinstalar cancela la suscripción sin crédito. Fuente: https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCancel
- Webhook `APP_SUBSCRIPTIONS_UPDATE` (`app_subscriptions/update`): avisa cuando cambia el estado de una suscripción. Declarado en `shopify.app.toml`; ruta `webhooks.app.subscriptions_update.tsx`.
- **Billing API o Shopify App Pricing.** Shopify dice que Shopify App Pricing (antes "managed pricing") es "the default option when you submit a new public app for approval" y llama a la Billing API ("Manual Pricing") el método "legacy", "still supported for existing apps and outlier pricing models Shopify App Pricing doesn't cover". El requisito 1.2.1 del App Store acepta las dos: "Your app must use Shopify App Pricing or the Shopify Billing API for any app charges". La documentación **no dice** que una app nueva esté obligada a usar App Pricing, ni explica en qué condiciones se puede elegir "Manual pricing (legacy)" al enviar la app. Fuentes: https://shopify.dev/docs/apps/launch/billing , https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing , https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- El requisito 1.2.3 pide que el merchant pueda subir y bajar de plan sin escribir a soporte ni reinstalar: lo cubren la aprobación del plan mayor en la revisión y "Switch to the lower plan".

Decisión vigente: Billing API, que es lo que se puede probar hoy en la tienda de desarrollo.

### Si hubiera que pasar a Shopify App Pricing

Pendiente de decisión de Facundo; conviene confirmarlo al preparar el envío a revisión. Cambiaría solo `shopify/app/billing/billing.ts`:

- Los cuatro planes se cargan en el Partner Dashboard (precios de la tabla, cada 30 días, sin prueba gratis) y se elige "Shopify App Pricing" como método de cobro.
- `requestPlan` deja de llamar a `appSubscriptionCreate` (Shopify lo rechaza una vez hecho el cambio) y manda al merchant a la página de planes de Shopify: `https://admin.shopify.com/store/<tienda>/charges/<app>/pricing_plans`. Esa página no se puede abrir en un plan determinado: el merchant elige y `planGate` controla que alcance.
- `getBillingStatus` lee `activeSubscription(appId, shopId)` de la Partner API (hace falta una credencial de Partner API como secreto).
- No hay webhooks de suscripción desde el 2026-04-28: el estado llega por parámetros del redirect y por consultas a la Partner API.
- Límite a revisar: App Pricing muestra los planes desde la instalación; "gratis hasta la primera limpieza" tendría que resolverse con un plan gratis o no mandando a la página de planes hasta la primera aprobación.

## Dudas de cobro

| # | Duda | Estado |
| --- | --- | --- |
| 1 | ¿Una app nueva puede enviarse con Billing API? | Abierta. La documentación la admite pero pone App Pricing por defecto. Se confirma en el Partner Dashboard al preparar el envío |
| 2 | ¿La revisión acepta el modelo? | El requisito es información "accurate and complete" de precios, solo en la sección de precios de la ficha (4.2), y poder cambiar de plan sin soporte (1.2.3) |
| 3 | ¿Cómo se muestra el precio en la ficha? | Los cuatro planes mensuales y "free to install; the plan starts when you approve your first cleanup". Sin cifras en el resto de la ficha |
| 4 | Prorrateo al cambiar de plan | Documentado por Shopify, no probado en una tienda real |

## Economía (estimaciones)

Son estimaciones propias, sin datos de clientes. No hay todavía ninguna cuenta paga.

- Shopify: 0% de revenue share hasta US$ 1 M acumulado, más 2,9% de procesamiento. Confirmar la cifra vigente.
- Infraestructura: US$ 60 a 150 por mes con clientes. Es la estimación anterior al cambio a Cloudflare; rehacerla con uso real.
- Cuentas con plan activo necesarias, como aritmética sobre los precios (cada columna supone todas las cuentas en un mismo tramo):

| Ingreso mensual | Todas a US$ 9 | Todas a US$ 19 | Todas a US$ 39 | Todas a US$ 79 |
| --- | --- | --- | --- | --- |
| US$ 1.000 | 112 cuentas | 53 cuentas | 26 cuentas | 13 cuentas |
| US$ 5.000 | 556 cuentas | 264 cuentas | 129 cuentas | 64 cuentas |
| US$ 10.000 | 1.112 cuentas | 527 cuentas | 257 cuentas | 127 cuentas |

- La mezcla real entre tramos no se conoce: no se supone un ticket promedio.
- El margen estimado del modelo anterior ya no vale y no se rehízo: depende de la infraestructura con uso real.

Lo que no se sabe y puede cambiar la cuenta:

- **Cuántos meses dura un plan.** Con los criterios por defecto la primera limpieza es la más grande y las siguientes encuentran pocos candidatos. Ahora el plan se cobra igual, pero el merchant puede cancelarlo después de la primera limpieza. Hay que medir la permanencia en la beta antes de proyectar.
- **Conversión de auditoría a primera limpieza.** Sin datos.
- **Precio frente a las apps comparables.** ListSweep publica un plan Pro a US$ 7 por mes y ShopiDeck planes desde US$ 9 (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.10). El tramo de entrada de TierSaver queda en ese rango. No hay datos de disposición a pagar.

## Programa para agencias

- A elegir por la agencia: 25% de comisión recurrente, o TierSaver gratis para sus clientes durante 3 meses.
- La comisión se paga por fuera de Shopify; verificar que el acuerdo de partners lo permita antes de ofrecerlo por escrito.

## Modelo anterior: cargo por limpieza (reemplazado el 2026-11-26)

Del 2026-11-25 al 2026-11-26 el modelo era un cargo por uso por cada limpieza que suprimía perfiles (US$ 15 / 29 / 79 / 149 según tamaño de lista), con `cappedAmount` de US$ 149, como máximo un cargo cada 28 días, enviado 72 horas después de terminar la limpieza para que un deshacer completo dentro de ese plazo fuera gratis, y un registro de limpiezas impagas si la tienda desinstalaba en ese plazo. Facundo lo reemplazó por el plan mensual. El código de ese modelo se quitó; quedan las tablas `usage_charges` y `unpaid_cleanups` como historia.

## Modelo anterior: porcentaje del ahorro (descartado el 2026-11-25)

Hasta el 2026-11-25 el modelo era un porcentaje (20%) de la diferencia de precio de Klaviyo entre un ciclo y el siguiente, comprobada con la Billing Usage API de Klaviyo, con tope de US$ 149 por mes y sin cargo si la cuenta no cambiaba de plan.

Se descartó por lo que encontró `12-CUMPLIMIENTO-KLAVIYO.md` (secciones 2.1 y 3.3):

- Convertía el ingreso de TierSaver en una fracción de lo que Klaviyo dejaba de cobrar. Es la mejor prueba posible de un uso "designed to avoid or circumvent bills", que la Acceptable Use Policy de Klaviyo prohíbe, y encaja en "detrimental to us" del acuerdo de partners.
- Alineaba el incentivo de TierSaver con suprimir más, contra la regla de producto de defaults conservadores.
- Obligaba a pedir `usage:read` para calcular el cargo.

El precio fijo era el plan B ya documentado en este archivo. La regla de producto 6 pasó de "si no hay ahorro, no se cobra" a "si no hay limpieza, no se cobra" (2026-11-25) y después a "gratis hasta la primera limpieza" (2026-11-26).
