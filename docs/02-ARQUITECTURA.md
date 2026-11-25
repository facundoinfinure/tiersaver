# Arquitectura

Todo lo técnico de este documento es punto de partida. Confirmalo contra la documentación vigente antes de programar.

## Stack (decidido el 2026-11-25)

| Capa | Elección | Nota |
| --- | --- | --- |
| App | Plantilla oficial de Shopify (React Router) sobre Cloudflare Workers | Vite plugin de Cloudflare, adaptador `cf-worker` de `@shopify/shopify-api`, `renderToReadableStream` |
| UI | Polaris web components | Polaris React está deprecado |
| Base de datos | D1 (SQLite) con Drizzle | Sesiones de Shopify con `DrizzleSessionStorageSQLite`, tokens cifrados con AES-GCM |
| Corridas de supresión | Cloudflare Workflows | Cada lote es un paso: reintenta y reanuda sin duplicar |
| Programación | Cron Triggers | Revisión diaria por tienda |
| Mail transaccional | Cloudflare Email Service | 3.000 mails/mes incluidos en Workers Paid |
| Sitio | Carpeta `site/`, Workers static assets | tiersaver.com en la misma cuenta |
| Errores | Workers Observability | |

Plan: Workers Paid (US$ 5/mes) recién al desplegar. El plan gratis no alcanza en producción (10 ms de CPU y 50 subrequests por invocación). Desarrollo local con `workerd` vía `vite preview`/`wrangler`, sin costo.

Spike del 2026-11-25: la app compila y corre en `workerd`; SSR, login, inicio de OAuth, webhooks con HMAC válido (200) e inválido (401) y assets verificados con `npm run smoke:worker -w @tiersaver/shopify`. Falta verificar instalación real en la tienda de desarrollo.

## Integración con Klaviyo (verificado el 25 de noviembre de 2026 en developers.klaviyo.com)

- Existe el endpoint de supresión masiva (Bulk Suppress Profiles) y su inverso (Bulk Unsuppress Profiles). Recurso: `profile-suppression-bulk-create-jobs` y `profile-suppression-bulk-delete-jobs`.
- Se puede suprimir por lista de mails (límite de 100 mails por request) o indicando el ID de un segmento o lista para suprimir a todos sus miembros actuales.
- Límites publicados: ráfaga de 75 por segundo, sostenido de 750 por minuto.
- Scopes: `profiles:write` y `subscriptions:write` para suprimir; `subscriptions:read` para consultar el estado de los jobs.
- Los jobs se consultan con filtros por `status`, `list_id` y `segment_id`, y exponen `total_count`, `completed_count` y `skipped_count`.
- La revisión de API más nueva vista es `2026-10-15`. Fijar la revisión en un solo lugar del código.
- Las apps públicas del marketplace de Klaviyo requieren OAuth; `accounts:read` es obligatorio en los scopes y Klaviyo exige el conjunto mínimo de permisos.

### Diseño sugerido de la supresión

1. La app crea en Klaviyo un segmento "TierSaver · candidates" con las condiciones de inactividad, o arma la lista de mails del lado nuestro cruzando con pedidos de Shopify.
2. Aplica las reglas de protección que dependen de Shopify (compras) del lado nuestro.
3. Suprime por lotes de mails (hasta 100 por request), no por segmento completo, para poder excluir protegidos y registrar exactamente a quién se suprimió.
4. Guarda el conjunto suprimido por ejecución para poder deshacer.

## Dudas técnicas a verificar antes de programar

| # | Duda | Por qué importa | Plan B |
| --- | --- | --- | --- |
| 1 | ¿La API de Klaviyo expone la cantidad de perfiles activos facturables y el plan o tramo de la cuenta? | La auditoría necesita el tramo actual | Contar perfiles no suprimidos por API y que el merchant confirme su plan |
| 2 | ¿Expone la fecha de renovación del plan? | Programar la limpieza | El merchant la carga a mano |
| 3 | ¿Hay una tabla de precios oficial consumible? | Informar el plan de Klaviyo estimado (dato secundario) | Tabla propia versionada, con fecha y rótulo de estimación. La actualiza una persona a mano: sin lectura automática de klaviyo.com (`12-CUMPLIMIENTO-KLAVIYO.md`, secciones 1.4 y 3.1, regla 13) |
| 4 | ¿OAuth de Klaviyo sirve para una app que no está listada en su marketplace? | Método de conexión del MVP | Clave privada de API pegada por el merchant, cifrada en reposo |
| 5 | ¿Los términos de Klaviyo permiten una app que automatiza la supresión de inactivos? | Riesgo de que revoquen el acceso | Analizado en `12-CUMPLIMIENTO-KLAVIYO.md` (2026-11-25): la supresión permanente con los criterios de Klaviyo está del lado permitido; se adoptaron precio fijo, criterios de Klaviyo, ninguna reactivación automática y textos de higiene. Queda el riesgo de revocación discrecional (`08-RIESGOS-Y-METRICAS.md`) |
| 6 | ¿Cómo distinguir aperturas reales de aperturas automáticas de Apple Mail? | Reglas de inactividad | Dar más peso a clics y compras |
| 7 | Bloqueo de 90 días para volver a suprimir un perfil al que se le quitó la supresión (se cuenta desde la supresión anterior, según la ayuda de Klaviyo leída el 2026-11-25): ¿cómo responde la API? | Deshacer | Avisar en la interfaz y registrar el rechazo |
| 8 | Límites de tiempo de ejecución en Vercel para jobs largos (150.000 perfiles ≈ 1.500 requests) | Arquitectura de workers | Worker dedicado fuera de Vercel |
| 9 | ¿Qué versión de la Admin API de Shopify es la estable vigente y qué scopes mínimos hacen falta para leer pedidos y clientes? | Permisos y revisión | — |
| 10 | Acceso a datos protegidos de clientes en Shopify (protected customer data): ¿hace falta pedir aprobación para leer mails y pedidos? | Puede demorar la revisión | Pedir el nivel mínimo y justificarlo |

## Datos de Shopify (decidido el 2026-11-25)

- Scopes: `read_orders` y `read_all_orders` (requiere aprobación de Shopify en el Dev Dashboard) para ver pedidos de más de 60 días. Con la regla por defecto ("nunca compró"), la cobertura de pedidos tiene que llegar hasta antes de la creación del perfil; si no llega, el perfil queda protegido (`covers` en `packages/core/src/rules.ts`).
- Datos protegidos de clientes: nivel 2, solo el campo email. Se pide con justificación: "match recent buyers to Klaviyo profiles so they are never suppressed".
- Minimización: el mail de cada pedido se normaliza (minúsculas, sin espacios) y se guarda solo su SHA-256 junto con la fecha del último pedido. El cruce con Klaviyo compara hashes. No se guardan mails en claro.
- Webhook `orders/create`: solo mantiene al día los hashes de compradores (`purchase_hashes`), para que la regla de compras proteja a quien compra. No le quita la supresión a nadie: la reactivación automática por compra o checkout se quitó del MVP el 2026-11-25 (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 2.5). Un perfil suprimido que compra sigue suprimido en Klaviyo hasta que vuelve a suscribirse o el merchant quita la supresión a mano.
- Mientras la aprobación de `read_all_orders` no llegue, la cobertura de pedidos es de 60 días y la regla de compra protege a todos (`insufficient_purchase_history`): la app funciona, pero no suprime.

## Lectura del plan de Klaviyo (solo informativa)

Cambiado el 2026-11-25. Antes esta lectura decidía el cargo; ya no.

- `GET /api/billing-usage` (scope `usage:read`): `usage_used` y `usage_max` del tipo de uso de perfiles activos dan el conteo y el límite del plan según Klaviyo. Alimentan la auditoría y el reporte mensual como dato informativo.
- `usage:read` es un scope opcional (`KLAVIYO_OPTIONAL_SCOPES` en `shopify/app/klaviyo/config.ts`): una conexión sin él está completa, y ninguna corrida ni ningún cargo depende de él. Se pide solo si el reporte lo necesita (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.1, regla 10).
- El cargo de TierSaver nunca depende de `usage_max` ni de la factura de Klaviyo: sale del tamaño de lista de la simulación aprobada y de que la limpieza haya suprimido perfiles (`packages/core/src/charge.ts`).
- Si `usage_max` no coincide con un tramo de la tabla de precios versionada, no se muestra estimación de plan.
- La app nunca cambia el plan del merchant ni su auto-downgrade.

## Modelo de datos (borrador)

- `shops`: dominio, token de Shopify cifrado, estado de instalación, zona horaria.
- `klaviyo_connections`: shop, credenciales cifradas, revisión de API, estado.
Esquema real en `shopify/app/db/schema.ts`; la migración `shopify/drizzle/0002_flat_pricing_and_klaviyo_criteria.sql` aplica las decisiones del 2026-11-25.

- `settings`: ventanas de las reglas (`NULL` = "nunca, en toda la historia del perfil"; los pisos del modo ampliado están como `CHECK`), mínimo de mails recibidos, días sin ser candidato tras ser restaurado (365), listas y segmentos protegidos, día de renovación del plan y margen, modo (aprobación o automático). Ya no hay opción de reactivación.
- `audits`: fecha, conteos, datos informativos de la Billing Usage API, plan actual y plan estimado, diferencia estimada de precio de lista (dato secundario, siempre rotulado como estimación), versión de la tabla de precios, reglas usadas.
- `simulations`: reglas usadas, cobertura de datos, cantidad por motivo, tamaño de lista, cargo estimado de TierSaver, vencimiento, aprobada por, aprobada cuándo.
- `simulation_candidates`: los perfiles exactos que una simulación suprimiría (ID de Klaviyo, motivo `never_engaged` o `lapsed`, hash del mail). Se copian a `run_profiles` cuando arranca la corrida: lo que se aprueba es lo que se suprime.
- `runs`: simulación, tipo (supresión o deshacer), origen, estado, contadores, errores.
- `run_profiles`: run, identificador del perfil (ID de Klaviyo; nunca el mail en claro), motivo, estado.
- `usage_charges`: una fila por corrida, cobrada o no. Guarda el tamaño de lista sobre el que se calculó el precio (`active_profiles`), el tope del tramo de precio aplicado (`price_tier_max`; `NULL` por encima de los tramos públicos), los perfiles suprimidos, el monto, el motivo cuando no se cobra (`no_cleanup`, `already_charged_this_cycle`, `cap_reached`, `above_price_tiers`), el estado, el ID del cargo en Shopify y la clave de idempotencia. Un `CHECK` impide un monto mayor a cero si no se suprimió a nadie. Ya no guarda ningún ahorro.
- `events_log`: bitácora de auditoría de acciones.

## Seguridad

- Tokens cifrados en reposo con clave fuera de la base.
- Verificación de HMAC en todos los webhooks de Shopify; los de cumplimiento responden 401 ante HMAC inválido.
- Row Level Security en Supabase aunque el acceso sea solo desde el servidor.
- Sin datos personales en logs.
- Borrado completo ante `shop/redact`.

## Pruebas

- Unitarias: reglas de inactividad (criterios por defecto y pisos del modo ampliado), precio por tamaño de lista y reglas de cargo (sin limpieza no se cobra, un cargo cada 28 días, tope), estimación informativa del plan, idempotencia.
- Integración: contra la cuenta de Klaviyo de prueba, con perfiles sembrados que cubran cada regla.
- Punta a punta: instalar, auditar, simular, suprimir, deshacer, desinstalar.
- Prueba de corte: matar el worker a mitad de una ejecución y verificar que reanuda bien.
