# Riesgos y métricas

Actualizado el 2026-11-25 con las decisiones posteriores a `12-CUMPLIMIENTO-KLAVIYO.md`.

## Cortes

Se construye sin validación previa. Estos cortes son el freno de mano: si no se cumplen, se para y se le avisa a Facundo antes de seguir.

| Momento | Métrica | Corte |
| --- | --- | --- |
| Fase 0 | Dudas técnicas 1 a 5 de `02-ARQUITECTURA.md` | Si la API o los términos de Klaviyo impiden el producto, frenar antes de construir |
| Semana 5 | Respuestas de agencias de prioridad A | Menos de 3 de 9: revisar el mensaje |
| Semana 5 | Auditorías de la beta que encuentran perfiles que cumplen los criterios por defecto en cantidad que justifique una limpieza | Umbral a definir por Facundo. El corte anterior estaba definido sobre el ahorro en dólares y ya no aplica. Si pocas cuentas tienen candidatos con los criterios de Klaviyo, el dolor es menor al estimado |
| Semana 8 | Tiendas beta que completan una limpieza aprobada y la mantienen (sin deshacer) | Menos de 2: el producto no cumple la promesa |
| Mes 3 | Cuentas pagas | Menos de 15: replantear canal o precio |
| Mes 6 | Ingreso mensual | Menos de US$ 1.000: cerrar o vender |

El corte de Fase 0 sobre el precio como porcentaje quedó sin efecto: el precio es fijo desde el 2026-11-25.

## Riesgos

| Riesgo | Probabilidad | Mitigación |
| --- | --- | --- |
| **Residual: Klaviyo revoca o restringe el acceso a la API a su sola discreción** | Baja para una revocación dirigida, según la estimación de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 5 (sin datos de casos reales). No se puede eliminar | Los API Terms dicen "We may terminate your access to our APIs at any time for any reason". Ningún diseño lo evita. Lo que baja la probabilidad ya está adoptado: precio fijo, criterios de Klaviyo, ninguna reactivación automática, textos de higiene, scopes mínimos, solo endpoints documentados. Plan de contingencia abajo. El riesgo sube con el éxito: una app que crezca afecta ingresos de Klaviyo aunque cumpla la letra |
| Klaviyo considera el producto "competitive or substantially similar" a su función nativa | Baja a media | Los API Terms lo prohíben salvo permiso escrito, y Klaviyo ya tiene recomendaciones de supresión. Casi todas las apps del ecosistema extienden funciones nativas. Decidir si se consulta a Klaviyo (tarea 19 de `10-TAREAS-HUMANAS.md`) |
| Klaviyo automatiza la supresión de forma nativa | Alta | El producto quedaría redundante. Diferenciarse por el cruce con pedidos de Shopify, la simulación con aprobación y el registro; revisar klaviyo.com/whats-new cada mes |
| El merchant pierde su cuenta de Klaviyo o se le suspende por cómo usa la app | Baja | Los términos de Klaviyo lo hacen responsable de lo que haga una app en su cuenta. Pisos de reglas que no se pueden bajar, sin ayuda para escribirles a los suprimidos, términos propios con uso prohibido (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.1) |
| El App Store no trae instalaciones | Alta | Agencias y chequeo de salud de lista como canales principales |
| Se suprime a quien no correspondía | Media | Criterios de Klaviyo por defecto, simulación obligatoria, datos incompletos protegen, deshacer, términos con limitación de responsabilidad revisados por abogado |
| Con los criterios por defecto, después de la primera limpieza quedan pocos candidatos y muchos meses no se cobran | Sin datos | Es consecuencia directa de "si no hay limpieza, no se cobra". Medir en la beta qué fracción de los meses tiene limpieza antes de proyectar ingresos (`04-PRECIO-Y-COBRO.md`) |
| El precio queda muy por encima de las apps comparables (US$ 7 y US$ 9 por mes, contra US$ 29 a 149) | Sin datos | Medir conversión de auditoría a limpieza paga en la beta; los límites de tamaño de lista siguen provisionales |
| Clones | Media | Reseñas y relación con agencias antes que funciones |
| Clientes viejos de Klaviyo con suba limitada al 25% tienen menos urgencia por limpiar la lista | Media | Apuntar a cuentas nuevas y a las que crecen rápido |
| El nombre "TierSaver" contradice el posicionamiento de higiene y se confunde con apps de descuentos "Tier…" | Media | Subtítulo y titular que dicen qué hace el producto (higiene de lista para Klaviyo). El descriptor del nombre es una decisión abierta de Facundo (tarea 18 de `10-TAREAS-HUMANAS.md`) |
| Mercado acotado | Certeza | El techo estimado es de pocos miles de cuentas; alcanza para la meta y no para más. Expansión a otras herramientas recién con clientes pagos |

Salió de la tabla el 2026-11-25 el riesgo del cobro por porcentaje: ese modelo ya no existe.

## Contingencia si Klaviyo revoca el acceso

De `12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.4.

- **El mismo día:** frenar corridas y cargos, cancelar las suscripciones de Shopify y avisar a todos los merchants con un texto preparado de antemano. Los perfiles quedan suprimidos y se manejan desde Klaviyo; no hace falta quitar ninguna supresión.
- **Con Klaviyo:** escribirles para pedir el motivo y qué habría que cambiar. No crear otra app ni otra cuenta para volver a entrar: sería esquivar la revocación.
- **Modo degradado sin API:** guía paso a paso para armar el segmento de inactividad y usar "Suppress inactive profiles" a mano, con recordatorio antes de la renovación. Vale mucho menos.
- **Diseño previo:** el motor de reglas y de corridas con el proveedor detrás de una interfaz (ya hay un gateway en `shopify/app/runs/gateway.server.ts`), para que sumar otro proveedor no sea reescribir todo.
- **Financiero:** no comprometer gastos fijos que dependan de este ingreso mientras exista un solo proveedor que puede cortarlo sin aviso.

Enviar el aviso a merchants y escribirle a Klaviyo son frenos de `CLAUDE.md`: los hace Facundo. Falta redactar el texto de aviso.

## Qué monitorear

De `12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.3.

- Cada mes: la fecha de actualización de la Acceptable Use Policy, los API Terms, los términos de servicio y el Technology Partner Agreement de Klaviyo; los artículos de ayuda sobre perfiles activos, supresión y facturación; klaviyo.com/whats-new.
- Señales de Klaviyo: mails de su equipo de marketplace o de legal, `invalid_grant` en varias cuentas a la vez, errores 403 nuevos, cambios en los endpoints de supresión o en la regla de 90 días.
- Señales propias: tasa de deshacer, perfiles restaurados a mano por merchants, merchants con las reglas en el piso del modo ampliado, tickets que pregunten cómo volver a activar perfiles después de la renovación.

## Qué medir desde el día uno

Instalaciones, auditorías completadas, simulaciones aprobadas, ejecuciones, ejecuciones deshechas, perfiles suprimidos por limpieza, ciclos con cargo y ciclos sin cargo (con el motivo), cuentas en modo ampliado, desinstalaciones con motivo, tickets de soporte por tema. Instrumentar con una herramienta de analítica de producto en plan gratis.
