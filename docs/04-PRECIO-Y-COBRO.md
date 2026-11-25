# Precio y cobro

## Modelo decidido

- 20% del ahorro estimado en cada limpieza.
- Tope de US$ 149 por mes.
- Si no hay ahorro, no se cobra.
- Auditoría siempre gratis.

Ejemplos (con precios del plan Email de Klaviyo de noviembre de 2026; los tramos de 20.000 y 50.000 son aproximados):

| Caso | Ahorro mensual | Cargo |
| --- | --- | --- |
| Baja de 12.500 a 10.000 perfiles | US$ 125 | US$ 25 |
| Baja de 50.000 a 20.000 perfiles | ~US$ 345 | ~US$ 69 |
| Ahorro de US$ 1.000 | US$ 1.000 | US$ 149 (tope) |

## Definición de "ahorro estimado"

Ahorro = precio del tramo en el que la cuenta habría quedado sin la limpieza − precio del tramo resultante, según la tabla de precios versionada, al momento de la simulación que el merchant aprueba.

- Se cobra sobre la simulación aprobada, no sobre la factura real de Klaviyo, que no vemos.
- Si la ejecución suprime menos de lo simulado y el tramo resultante es más alto, se recalcula hacia abajo antes de cobrar.
- Un cargo por ciclo de facturación de Klaviyo, no por cada corrida.
- El merchant ve el cálculo completo antes de aprobar.

## Implementación en Shopify

Verificado el 25 de noviembre de 2026 en shopify.dev:

- Shopify exige que las apps del App Store cobren por Shopify App Pricing o por la Billing API; no se permite cobro por fuera.
- Para apps públicas Shopify indica Shopify App Pricing como camino preferido; la Billing API sigue disponible para modelos que App Pricing no cubre.
- Con la Billing API, el cobro por uso funciona así: `appSubscriptionCreate` con un `cappedAmount` (el máximo a facturar en el ciclo de 30 días) y términos que el merchant aprueba; después cada cargo se crea con `appUsageRecordCreate`, con descripción, precio y una clave de idempotencia. Si un cargo supera el tope, la mutación devuelve error.
- El merchant puede cambiar el tope desde su admin. Hay webhooks para cambios de suscripción y para cuando se acerca al tope.

## A verificar antes de programar el cobro

| # | Duda | Si la respuesta es no |
| --- | --- | --- |
| 1 | ¿Shopify App Pricing admite un cargo variable calculado por la app (20% de un ahorro)? | Usar la Billing API con suscripción por uso y `cappedAmount` de US$ 149 |
| 2 | ¿La revisión acepta un precio expresado como porcentaje de un ahorro estimado? | Volver a tramos fijos (US$ 29 / 79 / 149 según tamaño de lista) y avisar a Facundo |
| 3 | ¿El ciclo de 30 días de Shopify y el ciclo de Klaviyo del merchant pueden desfasarse y generar dos cargos en un mismo ciclo de Shopify? | Limitar por lógica propia a un cargo cada 28 días |
| 4 | ¿Cómo se muestra el precio en la ficha del App Store para un modelo por uso? | Redactar los términos con el ejemplo de US$ 125 → US$ 25 |

Si la duda 2 obliga a cambiar el modelo, frenar y consultar: es una decisión de Facundo.

## Economía (estimaciones)

- Shopify: 0% de revenue share hasta US$ 1 M acumulado, más 2,9% de procesamiento. Confirmar la cifra vigente.
- Infraestructura: US$ 60 a 150 por mes con clientes.
- Ticket promedio supuesto: US$ 49. Con eso: ~21 cuentas para US$ 1.000, ~102 para US$ 5.000, ~204 para US$ 10.000 por mes.
- Margen estimado: 88% con US$ 1.000 por mes, 94% con US$ 5.000.

## Programa para agencias

- A elegir por la agencia: 25% de comisión recurrente, o TierSaver gratis para sus clientes durante 3 meses.
- La comisión se paga por fuera de Shopify; verificar que el acuerdo de partners lo permita antes de ofrecerlo por escrito.
