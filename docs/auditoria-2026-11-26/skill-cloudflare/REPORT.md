# TierSaver: auditoría de seguridad (skill `security-audit`, corrida 1)

## 1. Estado de la corrida: INCOMPLETA, pasada parcial

**Esta corrida no terminó como la define la skill.** La sesión que la ejecutó no tiene herramienta de delegación (Agent/Task), así que:

- el reconocimiento y la única ola de búsqueda los hizo el coordinador solo, sin los cuatro agentes de reconocimiento ni cazadores separados;
- **no corrió el crítico final de cobertura**, por lo que no se afirma cobertura limpia;
- **no corrió ningún verificador independiente**, y la skill prohíbe dar por confirmado, o anotar como `needs_validation`, algo que no pasó por uno.

Por eso `findings.json` está vacío y los dos candidatos de abajo **no son hallazgos**: son hipótesis con traza en el código, sin validar.

| Dato | Valor |
| --- | --- |
| Perfil | `quick` (una ola, alcance acotado) |
| Alcance | `shopify/app`, `shopify/workers`, `shopify/drizzle`, `shopify/wrangler.jsonc`, `shopify/shopify.app.toml`, `packages/core/src`, `site/_headers`, `site/build` |
| Fuente | commit `414c5fe`, árbol limpio |
| Presupuesto | 16 invocaciones de agentes como máximo. Planeadas: 4 de reconocimiento, cazadores, 1 crítico, verificadores. **Usadas: 0** |
| Ejecución | Ninguna. El entorno no tiene el sandbox del sistema operativo que exige la skill: no se ejecutó código, build ni tests del repositorio. Solo lectura estática. Sin llamadas a Shopify, Klaviyo ni Cloudflare |
| Corridas previas | No existe ninguna para este repositorio |
| `run_status` | `incomplete` |
| `incomplete_reason` | `independent_verification_unavailable` (texto completo en `run-metadata.json`) |
| Validadores | `validate-findings.cjs`: PASS (0 registros). `validate-coverage-ledger.cjs`: PASS (24 unidades) |

### Candidatos sin validar (no son hallazgos)

| Fingerprint | Unidad del ledger |
| --- | --- |
| `tiersaver/billing/charge-confirmation-fails-open` | superficie `shopify/workers/suppression-run.ts#SuppressionRunWorkflow.run`, frontera `shopify/app/billing/billing.ts#settleRunCharge`, clase Business logic |
| `tiersaver/billing/open-charges-head-of-line` | superficie `shopify/workers/app.ts#scheduled`, frontera `shopify/app/billing/billing.ts#runsWithOpenCharges`, clase Poison-record and head-of-line blocking |

No se les asigna severidad. Lo que sigue es lo que se leyó en el código, para que un verificador (o una prueba local) lo confirme o lo descarte.

#### Candidato A. El cargo de una limpieza queda sin cobrar si Klaviyo no se puede consultar

- **Principal de menor confianza**: el merchant de una tienda instalada, con suscripción aceptada.
- **Control esperado**: una limpieza que suprimió perfiles se cobra cuando Klaviyo confirma sus jobs y pasan las 72 horas, salvo que se haya deshecho entera.
- **Traza**:
  1. `shopify/app/billing/billing.ts:252`: mientras no haya confirmación, `settleRunCharge` devuelve `estimated` y no escribe nada.
  2. `shopify/app/runs/confirm.ts:49`: la confirmación lee cada job en Klaviyo con la conexión de la propia tienda.
  3. `shopify/app/routes/app._index.tsx:95`: el merchant puede desconectar Klaviyo en cualquier momento; no hay control por corridas en curso ni cargos abiertos. `shopify/app/klaviyo/connection.server.ts:245` hace fallar toda lectura sin conexión. También puede revocar la app desde Klaviyo o reconectar otra cuenta (`connection.server.ts:143` reemplaza la fila).
  4. `shopify/workers/suppression-run.ts:67` y `:89`: si un paso de confirmación falla tras sus 2 reintentos, el `catch` exterior cierra el Workflow y ya no vuelve a intentar.
  5. `shopify/workers/app.ts:106`: el Cron convierte cualquier fallo en `null` y vuelve a `estimated`.
  6. `shopify/app/runs/confirm.ts:69`: con más de 10 jobs (más de 1.000 perfiles) el Cron devuelve `null` siempre, aunque la conexión haya vuelto.
  7. `shopify/app/billing/billing.ts:354`: a los 30 días la corrida sale de la ventana de reintento.
- **Resultado que habría que observar**: una fila de `usage_charges` que queda en `pending` sin `confirmed_at` y nunca pasa a `charged`, con los perfiles suprimidos en Klaviyo (desconectar no quita supresiones).
- **Escenario mínimo**: limpieza de más de 1.000 perfiles; al terminar, desconectar Klaviyo unos minutos y volver a conectar. La app sigue usable y ese cargo no sale nunca. Con menos de 1.000 perfiles hace falta quedar desconectado 30 días.
- **También ocurre sin mala intención**: si los jobs de una limpieza grande tardan más que los 12 intentos del Workflow (unas 2 horas), el Cron no puede confirmarla.
- **Diferencia con lo ya conocido**: no es "desinstalar dentro de las 72 horas". Acá la tienda sigue instalada y operando.
- **Arreglo más chico** (toca una regla de cobro: decisión de Facundo): en `shopify/workers/app.ts`, cuando pasó la retención y la confirmación no se puede obtener (sin conexión, cuenta cambiada o más de 10 jobs), confirmar por páginas entre ticks con `confirmJobsPage`, y si la conexión no existe, cerrar el cargo con lo que la corrida envió (`run.processedCount`, que `settleRunCharge` ya usa como tope). Caso de prueba: cargo `pending`, sin conexión, retención vencida → termina en `charged`.
- **Qué falta para validarlo**: un verificador independiente, y una prueba unitaria sobre `settleRunCharge` y el Cron con D1 local dentro de un sandbox.

#### Candidato B. Cargos que no se pueden confirmar bloquean el reintento de los demás

- **Traza**: `shopify/app/billing/billing.ts:355` ordena por `COALESCE(c.last_attempt_at, 0), r.finished_at`; `shopify/workers/app.ts:102` procesa solo los primeros 5 por tick; el camino `estimated` (`billing.ts:252`) no escribe `last_attempt_at` ni `attempts`.
- **Resultado que habría que observar**: con 5 o más cargos `pending` imposibles de confirmar (los del candidato A, de una o varias tiendas), esos ocupan los 5 lugares de cada tick durante hasta 30 días y los cargos `failed` de otras tiendas no se reintentan desde el Cron.
- **Alcance real**: afecta solo al camino de reintento. El camino normal (el Workflow de cada corrida) no pasa por esta cola.
- **Arreglo más chico**: en el camino `estimated` de un cargo ya existente, escribir `last_attempt_at = now`, o ordenar por `COALESCE(c.last_attempt_at, r.finished_at)`. Caso de prueba: 6 cargos inconfirmables más 1 `failed` → el `failed` se reintenta en el segundo tick.

## 2. Postura de seguridad

En lo que se leyó, los controles que protegen a un merchant de otro y la acción de suprimir están bien puestos: toda consulta por id lleva la tienda de la sesión, la aprobación y el consumo de la simulación son actualizaciones atómicas, cada lote se revalida contra Klaviyo, y el flujo OAuth ata el `state` a la tienda autenticada. No apareció ninguna lectura o escritura entre tiendas, ni un camino para suprimir sin simulación aprobada. Lo más débil está en el cobro: depende de una conexión que el merchant puede cortar.

## 3. Hallazgos confirmados

Ninguno. Sin verificación independiente no se confirma nada (regla de la skill).

## 4. NEEDS VALIDATION

Ningún registro. Los dos candidatos quedan solo en el ledger, por la misma regla.

## 5. Notas de endurecimiento (no son hallazgos)

1. `shopify/app/shopify-webhook.server.ts:35-36`: `shop` y `topic` salen de cabeceras que el HMAC no cubre (igual que en la librería de Shopify). No se encontró forma de que un merchant consiga un cuerpo firmado: el único HMAC del secreto que recibe es el token de sesión, cuyo contenido firmado no es JSON y cae en 400. Aun así conviene comparar la tienda de la cabecera con `shop_domain` / `myshopify_domain` del cuerpo en `shop/redact` y `app/uninstalled`.
2. `packages/core/src/token-crypto.ts`: AES-GCM sin datos adicionales autenticados. Pasar la tienda como `additionalData` impide mover un token cifrado a la fila de otra tienda (solo lo podría hacer quien ya escribe en D1).
3. `shopify/app/data/privacy.ts` (`redactCustomer`): no borra el hash del cliente en `scan_profiles` de un scan en curso; una simulación que termine después puede volver a listarlo hasta 7 días.
4. `shopify/app/shopify-webhook.server.ts:23`: lee el cuerpo entero antes de verificar la firma; un tope de tamaño previo acota el trabajo sin autenticar.
5. `shopify/app/routes/app._index.tsx:93-95`: desconectar con una limpieza en curso la corta a la mitad (`klaviyo_not_connected`). Es daño propio, pero es parte del candidato A.
6. Observación de producto, no de seguridad: el CSV de candidatos (con mails) se puede bajar antes de aprobar y antes de aceptar el precio.

Patrones positivos: errores reducidos a códigos sin datos personales; logs de invocación apagados por los códigos de un solo uso en la URL; claves separadas por HKDF para `state`, PKCE y ticket; cookie `__Host-`; interruptor `SUPPRESSION_ENABLED` comparado con el texto exacto en tres lugares; hashes de mail con clave por tienda y sin alternativa sin clave; neutralización de fórmulas en el CSV; id del Workflow igual al id de la corrida; CSP estricta en el sitio.

## 6. Cobertura (del ledger)

| Estado | Unidades |
| --- | --- |
| `covered` | 16 |
| `candidate` | 2 |
| `blocked` | 0 |
| `deferred` | 3 |
| `out_of_scope` | 3 |

**Cubierto por lectura de código**: OAuth de Klaviyo (ticket, `state`, cierre); firma y orden de entrega de los webhooks; aislamiento por tienda en rutas de corridas, simulación, CSV y pedido de datos; autenticación de rutas; puerta de aprobación y modo automático; gateway de supresión y deshacer; desinstalación, `shop/redact`, `customers/redact` y limpieza horaria; cifrado y secretos; inyección en filtros de Klaviyo, SQL y CSV; XSS en la interfaz; variables de `wrangler.jsonc`; trabajo previo a la autenticación; `site/_headers` y `site/build`.

**Diferido (no revisado, no se afirma nada)**:
- motor de scan completo y reglas: `shopify/app/scans/engine.ts` (leído en parte), `shopify/app/klaviyo/signals.ts`, `packages/core/src/{rules,simulation,schedule,pricing,savings}.ts`, `shopify/app/scans/view.server.ts`;
- sincronización de pedidos y cupos fijos por tick (`shopify/app/orders/sync.ts`, 40 tiendas, 500 filas, 20 scans);
- cabecera `frame-ancestors` de la app, que produce la librería de Shopify.

**Fuera de alcance**: dependencias, `package-lock.json` y `node_modules` (incluidas las librerías de Shopify de las que depende la autenticación); `shopify/scripts`, `shopify/test` y `shopify/app/klaviyo/testing`; páginas y scripts del sitio fuera de `site/build`.

**Crítico final**: no corrió. **Corridas previas**: ninguna. Una sola pasada, parcial, no agota el repositorio.

Hechos que el código no muestra y nadie observó: valores desplegados de los secretos y de `SUPPRESSION_ENABLED`, y la lista de redirecciones permitidas en la app de Klaviyo.
