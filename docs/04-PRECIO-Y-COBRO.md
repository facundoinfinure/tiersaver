# Precio y cobro

## Modelo decidido

Actualizado el 2026-11-25 (decisión de Facundo, tomada después de leer `12-CUMPLIMIENTO-KLAVIYO.md`). Implementado en `packages/core/src/charge.ts`.

Precio fijo mensual según el tamaño de la lista:

| Perfiles activos en Klaviyo | Precio por mes |
| --- | --- |
| Hasta 10.000 | US$ 15 |
| Hasta 25.000 | US$ 29 |
| Hasta 75.000 | US$ 79 |
| Hasta 150.000 | US$ 149 |
| Más de 150.000 | Por acuerdo. Nunca se cobra automáticamente |

Precios y límites confirmados por Facundo el 2026-11-25. El tramo de entrada (hasta 10.000 perfiles, US$ 15) se agregó ese día porque US$ 29 equivalía al 19% a 29% de lo que una lista de 5.000 a 10.000 perfiles paga a Klaviyo a precio de lista, contra 7% a 11% en los demás tramos.

Reglas:

- **Si no hay limpieza, no se cobra.** Un ciclo en el que no corrió ninguna limpieza, o en el que la limpieza no suprimió a nadie, no genera cargo.
- Como máximo un cargo cada 28 días, aunque haya más de una corrida.
- La auditoría es siempre gratis.
- El cargo nunca depende de la factura de Klaviyo, del plan de Klaviyo ni de `usage_max`. La app no lee la facturación de Klaviyo para cobrar.
- El tamaño de lista es la cantidad de perfiles activos antes de la limpieza, tomada de la auditoría que respalda la simulación aprobada.

### Cuándo se cobra

1. El merchant aprueba la simulación. Antes de aprobar ve el precio que corresponde a su tamaño de lista y la regla de "sin limpieza no se cobra".
2. Corre la limpieza. Si suprimió al menos un perfil, se crea un cargo por el precio de su tramo de tamaño de lista.
3. No se crea cargo, y queda registrado el motivo en `usage_charges`, si: no se suprimió a nadie (`no_cleanup`), ya hubo un cargo en los últimos 28 días (`already_charged_this_cycle`), se alcanzó el tope de la suscripción (`cap_reached`) o la lista supera el último tramo (`above_price_tiers`).
4. Cada corrida produce como máximo un cargo: la clave de idempotencia sale de la tienda y de la corrida.

El cálculo está implementado y testeado en `packages/core`. Falta conectar la creación del cargo con la Billing API de Shopify (Fase 3).

## Implementación en Shopify

Verificado el 25 de noviembre de 2026 en shopify.dev:

- Shopify exige que las apps del App Store cobren por Shopify App Pricing o por la Billing API; no se permite cobro por fuera.
- Para apps públicas Shopify indica Shopify App Pricing como camino preferido; la Billing API sigue disponible para modelos que App Pricing no cubre.
- Con la Billing API, el cobro por uso funciona así: `appSubscriptionCreate` con un `cappedAmount` (el máximo a facturar en el ciclo de 30 días) y términos que el merchant aprueba; después cada cargo se crea con `appUsageRecordCreate`, con descripción, precio y una clave de idempotencia. Si un cargo supera el tope, la mutación devuelve error.
- El merchant puede cambiar el tope desde su admin. Hay webhooks para cambios de suscripción y para cuando se acerca al tope.

Decisión vigente: Billing API con suscripción por uso y `cappedAmount` de US$ 149, igual al precio del tramo más alto. Cada cargo es un `appUsageRecordCreate` por el precio fijo del tramo. Esta parte de la decisión anterior se mantiene hasta que se revise.

Pregunta de seguimiento, no decidida: con precio fijo, Shopify App Pricing (el camino que Shopify prefiere) pasa a ser posible. Hay que ver si admite "el ciclo sin limpieza no se cobra", que hoy se resuelve cobrando por uso. Se había elegido la Billing API porque App Pricing no admite tope de uso.

## Dudas de cobro

Resueltas el 2026-11-25 (ver `STATUS.md`) y actualizadas con el modelo nuevo.

| # | Duda | Estado |
| --- | --- | --- |
| 1 | ¿Shopify App Pricing sirve para este modelo? | Abierta otra vez: con precio fijo podría servir. Pregunta de seguimiento de arriba |
| 2 | ¿La revisión de Shopify acepta el modelo? | Ya no aplica al modelo anterior. Para el precio fijo, el requisito es información "accurate and complete" de precios, solo en la sección de precios de la ficha (requisito 4.2) |
| 3 | ¿El ciclo de 30 días de Shopify y la limpieza mensual pueden desfasarse y generar dos cargos en un mismo ciclo de Shopify? | Resuelta por lógica propia: un cargo cada 28 días como mínimo (`minDaysBetweenCharges`), más el tope |
| 4 | ¿Cómo se muestra el precio en la ficha del App Store? | Los tres tramos y la regla de "sin limpieza no se cobra", en la sección de precios. Sin cifras en el resto de la ficha (requisito 4.3.3) |

## Economía (estimaciones)

Son estimaciones propias, sin datos de clientes. No hay todavía ninguna cuenta paga.

- Shopify: 0% de revenue share hasta US$ 1 M acumulado, más 2,9% de procesamiento. Confirmar la cifra vigente.
- Infraestructura: US$ 60 a 150 por mes con clientes. Es la estimación anterior al cambio a Cloudflare; rehacerla con uso real.
- Cuentas necesarias, como aritmética sobre los precios fijos. Cada fila supone que todas las cuentas están en un mismo tramo y que todas tienen una limpieza con supresiones ese mes:

| Ingreso mensual | Todas a US$ 15 | Todas a US$ 29 | Todas a US$ 79 | Todas a US$ 149 |
| --- | --- | --- | --- | --- |
| US$ 1.000 | 67 cuentas | 35 cuentas | 13 cuentas | 7 cuentas |
| US$ 5.000 | 334 cuentas | 173 cuentas | 64 cuentas | 34 cuentas |
| US$ 10.000 | 667 cuentas | 345 cuentas | 127 cuentas | 68 cuentas |

- La mezcla real entre tramos no se conoce: no se supone un ticket promedio. El ticket de US$ 49 del modelo anterior ya no vale.
- Margen, como aritmética sobre esas mismas estimaciones (ingreso menos 2,9% y menos infraestructura): entre 82% y 91% con US$ 1.000 por mes; entre 94% y 96% con US$ 5.000.

Lo que no se sabe y puede cambiar la cuenta:

- **Qué fracción de los meses tiene limpieza.** Con los criterios por defecto (perfiles de más de un año que nunca interactuaron), es esperable que la primera limpieza sea la más grande y que las siguientes encuentren pocos candidatos o ninguno. Los meses sin supresiones no se cobran, así que el ingreso recurrente por cuenta puede ser bastante menor que doce cargos por año. Hay que medirlo en la beta antes de proyectar.
- **Conversión de auditoría a limpieza paga.** Sin datos.
- **Precio frente a las apps comparables.** ListSweep publica un plan Pro a US$ 7 por mes y ShopiDeck planes desde US$ 9 (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.10). Los precios de TierSaver están por encima. No hay datos de disposición a pagar.

## Programa para agencias

- A elegir por la agencia: 25% de comisión recurrente, o TierSaver gratis para sus clientes durante 3 meses.
- La comisión se paga por fuera de Shopify; verificar que el acuerdo de partners lo permita antes de ofrecerlo por escrito.

## Modelo anterior (descartado el 2026-11-25)

Hasta el 2026-11-25 el modelo era un porcentaje (20%) de la diferencia de precio de Klaviyo entre un ciclo y el siguiente, comprobada con la Billing Usage API de Klaviyo, con tope de US$ 149 por mes y sin cargo si la cuenta no cambiaba de plan.

Se descartó por lo que encontró `12-CUMPLIMIENTO-KLAVIYO.md` (secciones 2.1 y 3.3):

- Convertía el ingreso de TierSaver en una fracción de lo que Klaviyo dejaba de cobrar. Es la mejor prueba posible de un uso "designed to avoid or circumvent bills", que la Acceptable Use Policy de Klaviyo prohíbe, y encaja en "detrimental to us" del acuerdo de partners.
- Alineaba el incentivo de TierSaver con suprimir más, contra la regla de producto de defaults conservadores.
- Obligaba a pedir `usage:read` para calcular el cargo.

El precio fijo era el plan B ya documentado en este archivo (US$ 29 / 79 / 149 según tamaño de lista). La regla de producto 6 pasó de "si no hay ahorro, no se cobra" a "si no hay limpieza, no se cobra". Cuesta el argumento de venta sin riesgo.
