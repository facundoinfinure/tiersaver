# Riesgos y métricas

## Cortes

Se construye sin validación previa. Estos cortes son el freno de mano: si no se cumplen, se para y se le avisa a Facundo antes de seguir.

| Momento | Métrica | Corte |
| --- | --- | --- |
| Fase 0 | Dudas técnicas 1 a 5 de `02-ARQUITECTURA.md` | Si la API o los términos de Klaviyo impiden el producto, frenar antes de construir |
| Fase 0 | Duda 2 de `04-PRECIO-Y-COBRO.md` | Si Shopify no acepta el modelo por % de ahorro, decidir precio antes de seguir |
| Semana 5 | Respuestas de agencias de prioridad A | Menos de 3 de 9: revisar el mensaje |
| Semana 5 | Auditorías de la beta con ahorro de US$ 100 por mes o más | Menos del 40%: el dolor es menor al estimado |
| Semana 8 | Tiendas beta que ven bajar el tramo en su factura | Menos de 2: el producto no cumple la promesa |
| Mes 3 | Cuentas pagas | Menos de 15: replantear canal o precio |
| Mes 6 | Ingreso mensual | Menos de US$ 1.000: cerrar o vender |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
| --- | --- | --- |
| Klaviyo automatiza la supresión de forma nativa | Alta | Diferenciarse por timing de facturación, cruce con pedidos de Shopify y reporte de ahorro; revisar klaviyo.com/whats-new cada mes |
| El App Store no trae instalaciones | Alta | Agencias y calculadora como canales principales |
| Klaviyo restringe o revoca el acceso a la API para este uso | Media | Leer términos en la Fase 0; posicionar como higiene de lista; no depender de endpoints no documentados |
| Se suprime a quien no correspondía | Media | Simulación obligatoria, defaults conservadores, deshacer, términos revisados por abogado |
| El cobro por % del ahorro genera disputas o no pasa la revisión | Media | Cobrar sobre la simulación aprobada, con tope; plan B de tramos fijos |
| Clones | Media | Reseñas y relación con agencias antes que funciones |
| Clientes viejos de Klaviyo con suba limitada al 25% sienten menos dolor | Media | Apuntar a cuentas nuevas y a las que crecen rápido |
| El nombre se confunde con apps de descuentos "Tier…" | Baja | Subtítulo explícito con "Klaviyo bill" |
| Mercado acotado | Certeza | El techo estimado es de pocos miles de cuentas; alcanza para la meta y no para más. Expansión a otras herramientas recién con clientes pagos |

## Qué medir desde el día uno

Instalaciones, auditorías completadas, simulaciones aprobadas, ejecuciones, ejecuciones deshechas, ahorro estimado por cuenta, cargos, desinstalaciones con motivo, tickets de soporte por tema. Instrumentar con una herramienta de analítica de producto en plan gratis.
