# Arquitectura

Todo lo técnico de este documento es punto de partida. Confirmalo contra la documentación vigente antes de programar.

## Stack propuesto

| Capa | Elección | Nota |
| --- | --- | --- |
| App | Plantilla oficial de app de Shopify (React Router) | Embebida en el admin |
| UI | Polaris | Requisito de calidad del App Store |
| Base de datos | Postgres en Supabase | Sesiones, tiendas, reglas, ejecuciones, bitácora |
| Deploy | Vercel | App y sitio |
| Jobs | Cola sobre Postgres (por ejemplo pg-boss) o Supabase Queues + cron | Evaluar límites de tiempo de las funciones de Vercel; si no alcanzan, mover los workers a un proceso dedicado |
| Mail transaccional | Proveedor a elegir (Resend o similar) | Reportes y avisos |
| Sitio | Carpeta `site/` en el mismo repo | Landing, calculadora, ayuda, legales |
| Errores | Sentry o equivalente en plan gratis | |

Costo objetivo de infraestructura: US$ 60 a 150 por mes cuando haya clientes; cerca de cero antes.

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
| 2 | ¿Expone la fecha de facturación? | Programar la limpieza | El merchant la carga a mano |
| 3 | ¿Hay una tabla de precios oficial consumible? | Calcular el ahorro | Tabla propia versionada, tomada del calculador público de Klaviyo, con fecha y rótulo de estimación |
| 4 | ¿OAuth de Klaviyo sirve para una app que no está listada en su marketplace? | Método de conexión del MVP | Clave privada de API pegada por el merchant, cifrada en reposo |
| 5 | ¿Los términos de la API de Klaviyo permiten una app cuyo fin es reducir la factura de Klaviyo? | Riesgo de que revoquen el acceso | Posicionar como higiene de lista; consultar con un abogado |
| 6 | ¿Cómo distinguir aperturas reales de aperturas automáticas de Apple Mail? | Reglas de inactividad | Dar más peso a clics y compras |
| 7 | Bloqueo de 90 días tras reactivar: ¿sigue vigente y cómo responde la API? | Reactivación y deshacer | Avisar en la interfaz y registrar el rechazo |
| 8 | Límites de tiempo de ejecución en Vercel para jobs largos (150.000 perfiles ≈ 1.500 requests) | Arquitectura de workers | Worker dedicado fuera de Vercel |
| 9 | ¿Qué versión de la Admin API de Shopify es la estable vigente y qué scopes mínimos hacen falta para leer pedidos y clientes? | Permisos y revisión | — |
| 10 | Acceso a datos protegidos de clientes en Shopify (protected customer data): ¿hace falta pedir aprobación para leer mails y pedidos? | Puede demorar la revisión | Pedir el nivel mínimo y justificarlo |

## Datos de Shopify (decidido el 2026-11-25)

- Scopes: `read_orders` y `read_all_orders` (requiere aprobación de Shopify en el Dev Dashboard) para ver 365 días de pedidos.
- Datos protegidos de clientes: nivel 2, solo el campo email. Se pide con justificación: "match recent buyers to Klaviyo profiles so they are never suppressed".
- Minimización: el mail de cada pedido se normaliza (minúsculas, sin espacios) y se guarda solo su SHA-256 junto con la fecha del último pedido. El cruce con Klaviyo compara hashes. No se guardan mails en claro.
- Reactivación: webhook `orders/create`. Si el hash del comprador coincide con un perfil suprimido por TierSaver, se reactiva (si el merchant activó la opción).
- Mientras la aprobación de `read_all_orders` no llegue, la cobertura de pedidos es de 60 días y la regla de compra protege a todos (`insufficient_purchase_history`): la app funciona, pero no suprime.

## Verificación de tramo con Klaviyo

- `GET /api/billing-usage` (scope `usage:read`): `usage_max` del tipo de uso de perfiles activos da el tramo real. Se guarda al conectar, antes de cada corrida y después de cada renovación.
- Si `usage_max` no coincide con un tramo de la tabla oficial, no se estima ni se cobra ahorro.

## Modelo de datos (borrador)

- `shops`: dominio, token de Shopify cifrado, estado de instalación, zona horaria.
- `klaviyo_connections`: shop, credenciales cifradas, revisión de API, estado.
- `settings`: umbrales de reglas, segmentos protegidos, fecha de facturación, modo (aprobación o automático), reactivación on/off.
- `audits`: fecha, conteos, tramo actual, tramo posible, ahorro estimado, versión de la tabla de precios.
- `simulations`: reglas usadas, cantidad por regla, vencimiento, aprobada por, aprobada cuándo.
- `runs`: simulación, origen, estado, contadores, errores.
- `run_profiles`: run, identificador del perfil (ID de Klaviyo; mail solo si es imprescindible), regla aplicada, estado.
- `usage_charges`: run, ahorro estimado, monto cobrado, ID del cargo en Shopify, clave de idempotencia.
- `events_log`: bitácora de auditoría de acciones.

## Seguridad

- Tokens cifrados en reposo con clave fuera de la base.
- Verificación de HMAC en todos los webhooks de Shopify; los de cumplimiento responden 401 ante HMAC inválido.
- Row Level Security en Supabase aunque el acceso sea solo desde el servidor.
- Sin datos personales en logs.
- Borrado completo ante `shop/redact`.

## Pruebas

- Unitarias: reglas de inactividad, selección de tramo, cálculo de ahorro y de cargo, idempotencia.
- Integración: contra la cuenta de Klaviyo de prueba, con perfiles sembrados que cubran cada regla.
- Punta a punta: instalar, auditar, simular, suprimir, deshacer, desinstalar.
- Prueba de corte: matar el worker a mitad de una ejecución y verificar que reanuda bien.
