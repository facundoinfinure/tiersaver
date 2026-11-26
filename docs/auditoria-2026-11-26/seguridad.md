# TierSaver · Revisión de seguridad previa al lanzamiento

Fecha: 2026-11-26. Alcance: `shopify/` (rutas, workers, billing, Klaviyo, webhooks), `packages/core`, configuración y build. Revisión de solo lectura: no se editó código, no se llamó a ninguna API en vivo de Shopify, Klaviyo ni Cloudflare, y no se leyó ni imprimió ningún secreto.

Rutas relativas a `/home/user/tiersaver`.

## Qué se corrió

- `npm test` en `shopify/`: 13 archivos, 268 tests pasan, 1 salteado (el de Klaviyo en vivo).
- `npm test -w @tiersaver/core`: 5 archivos, 83 tests pasan.
- `npm audit --omit=dev`: 2 vulnerabilidades moderadas. `npm audit` completo (con dependencias de desarrollo): 28 (6 moderadas, 22 altas). Detalle en S-16.
- Lectura de código de la librería instalada (`@shopify/shopify-app-react-router` 3.0.2, `@shopify/shopify-api` 15.1.2) para confirmar el comportamiento de `authenticate.webhook`.
- Inspección del build existente en `shopify/build/` (nombres y cadenas, sin valores secretos).

## Resumen

| # | Severidad | Tema |
| --- | --- | --- |
| S-01 | Alto (bloquea el lanzamiento si se confirma en vivo) | Los webhooks de desinstalación y de privacidad fallan con 500 cuando el token offline de Shopify está vencido |
| S-02 | Alto | Limpiezas gratis usando una tienda de desarrollo conectada a la cuenta real de Klaviyo |
| S-03 | Alto | Limpieza gratis desinstalando antes de que salga el cargo; `shop/redact` borra el historial de cargos |
| S-04 | Medio | Un cargo pendiente o fallido que nunca se cobró bloquea los cargos de los 28 días siguientes |
| S-05 | Medio | El reintento de cargos por cron se puede trabar: 3 por hora, los más viejos primero, y se abandona a los 7 días |
| S-06 | Medio | Un `app/uninstalled` atrasado, o un `shop/redact` después de reinstalar, borra una instalación viva |
| S-07 | Medio | La pasarela de supresión saltea la verificación del mail cuando no hay hash guardado |
| S-08 | Bajo | `confirmRunJobs` usa el `runId` de la URL antes de verificar que la corrida es de la tienda |
| S-09 | Bajo | Los hashes de mail son SHA-256 sin clave: seudónimos, reversibles por diccionario |
| S-10 | Bajo | Cifrado de tokens: sin datos asociados, con camino de texto plano y sin rotación de clave |
| S-11 | Bajo | La página pública `/` es la plantilla sin editar y pide el dominio de la tienda |
| S-12 | Bajo | Arnés de preview: no está en el build de producción, pero no tiene ninguna traba propia |
| S-13 | Bajo | Cabeceras de seguridad mínimas; valores de un solo uso quedan en los logs de requests |
| S-14 | Bajo | Excepciones de la cuenta de prueba (`KLAVIYO_SEEDED_ACCOUNT_ID`) activas en la configuración de producción |
| S-15 | Bajo | Sin límite de frecuencia para auditorías manuales; dos cargos cotizados a la vez |
| S-16 | Bajo | Dependencias y otros detalles (esquema de la base en el bundle del cliente, preview URLs) |

No encontré ningún camino que suprima sin una simulación aprobada y vigente, ni ninguna consulta que le muestre a una tienda datos de otra, ni secretos en el repo o en su historial.

---

## Hallazgos

### S-01 · Alto · Los webhooks de desinstalación y de privacidad fallan con 500 cuando el token offline está vencido

**Dónde**
- `shopify/app/shopify.server.ts:43-45` (`future.expiringOfflineAccessTokens: true`)
- `shopify/app/routes/webhooks.app.uninstalled.tsx:9`, `shopify/app/routes/webhooks.compliance.tsx:15`, `shopify/app/routes/webhooks.app.scopes_update.tsx:7`, `shopify/app/routes/webhooks.orders.create.tsx:16` (todas llaman `authenticate.webhook`)
- Librería: `node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/webhooks/authenticate.mjs` (llama `ensureValidOfflineSession` después de validar el HMAC y antes de devolver el control), `.../helpers/ensure-offline-token-is-not-expired.mjs`, `.../helpers/refresh-token.mjs`

**Qué pasa**
Con tokens offline que vencen, `authenticate.webhook` carga la sesión offline de la tienda y, si le quedan menos de 5 minutos de vida y tiene refresh token, la renueva contra Shopify. Si la renovación falla, `refresh-token.mjs` lanza (un error o un `Response` 500) y el handler de la ruta nunca se ejecuta. Según la documentación de Shopify, el access token offline que vence dura 1 hora.

Escenario:
1. Un merchant usa la app y deja de abrirla. Una hora después su access token está vencido.
2. Desinstala. Shopify manda `app/uninstalled`. La librería intenta renovar un token de una app ya desinstalada, la renovación falla, la ruta responde 500. Shopify reintenta y vuelve a fallar.
3. `disconnect` y `handleUninstall` no corren nunca: quedan en D1 la sesión de Shopify y los tokens de Klaviyo (cifrados), no se revoca el acceso en Klaviyo, y `shops.status` sigue en `installed`.
4. Como la tienda sigue "instalada" y "conectada", `scheduleDecisions` (`shopify/app/schedule/schedule.ts:63-75`) la sigue eligiendo: el cron sigue lanzando auditorías que leen la cuenta de Klaviyo de un merchant que desinstaló. (No llega a suprimir: el modo automático consulta billing por la Admin API y eso también falla.)
5. 48 horas después llega `shop/redact`. La fila de sesión sigue ahí con el token vencido, la renovación falla otra vez, 500. `deleteShopData` no corre. Los datos no se borran.

Lo mismo le pasa a `customers/redact` de una tienda instalada que no abrió la app en más de 90 días (vida del refresh token).

Esto rompe la regla de producto 7 ("borrar todo al desinstalar") y los webhooks de cumplimiento obligatorios del App Store.

**Por qué no lo detectó el smoke test**: `scripts/smoke-worker.mjs:78` prueba el webhook sin ninguna fila de sesión. Sin sesión la librería devuelve el contexto sin renovar nada, y da 200.

**Verificado**: el flujo de la librería, leyendo el código instalado. **No verificado** (requiere una prueba en vivo en la tienda de desarrollo): que Shopify rechaza la renovación después de desinstalar. Es lo esperable, pero la documentación que leí no lo dice de forma explícita.

**Arreglo propuesto**
- Para `app/uninstalled` y `/webhooks/compliance`, no depender de la sesión: verificar el HMAC directamente (HMAC-SHA256 del cuerpo crudo con `SHOPIFY_API_SECRET`, comparado con `X-Shopify-Hmac-Sha256` usando `crypto.subtle.verify`) y tomar tienda y topic de `X-Shopify-Shop-Domain` y `X-Shopify-Topic`. Esas rutas no necesitan Admin API.
- Alternativa más corta: clonar el request, llamar `authenticate.webhook` dentro de un `try`, y si lanza algo que no sea 401/400/405, caer a la verificación manual de HMAC sobre el clon.
- Revisar si una versión más nueva de `@shopify/shopify-app-react-router` ya lo corrige antes de escribir el arreglo propio.

**Test de regresión**: sembrar una fila en `session` con `expires` en el pasado y `refreshToken` presente, hacer que el fetch a `/admin/oauth/access_token` devuelva 400, y enviar `app/uninstalled` y `shop/redact` con HMAC válido. Esperado: 200, sesión y conexión borradas, y para `shop/redact` ninguna fila de la tienda.

**Puerta de lanzamiento**: desinstalar en la tienda de desarrollo más de una hora después del último uso y comprobar en D1 que se borraron sesión y conexión; esperar el `shop/redact` (o dispararlo con `shopify app webhook trigger`) y comprobar el borrado total.

---

### S-02 · Alto · Limpiezas gratis usando una tienda de desarrollo conectada a la cuenta real de Klaviyo

**Dónde**
- `shopify/app/routes/app.simulation.tsx:113-117` (`test: billing.developmentStore`)
- `shopify/app/routes/app.simulation.tsx:126-139` (el inicio solo exige que exista una suscripción activa; una de prueba sirve)
- `shopify/app/billing/billing.ts:77-96` (`getBillingStatus` acepta suscripciones con `test: true`)
- `shopify/app/db/schema.ts:72-90` (`klaviyo_connections`: sin unicidad sobre `klaviyo_account_id`)

**Qué pasa**
Cualquiera puede crear gratis una cuenta de Partner y una tienda de desarrollo. Ahí la app pide la suscripción con `test: true`, que no cobra nada. Nada impide conectar esa tienda a una cuenta de Klaviyo real: la app no relaciona la cuenta de Klaviyo con la tienda de la que vienen los perfiles.

Escenario: un merchant instala TierSaver en una tienda de desarrollo, conecta su Klaviyo de producción, acepta el cargo de prueba, audita, aprueba y limpia. Los cargos por uso son de prueba. Lo repite todos los meses sin pagar.

Agravante de seguridad de datos: en esa tienda vacía el backfill de pedidos termina con cero pedidos y marca la cobertura como completa, así que la regla de compras de Shopify no protege a nadie. Queda solo el cruce con "Placed Order" de Klaviyo.

**Arreglo propuesto**
- En el `intent === "start"` y en el camino automático (`shopify/workers/scan.ts:55-56`): si la tienda es `partnerDevelopment`, permitir la limpieza solo cuando Klaviyo marca la cuenta conectada como cuenta de prueba (el campo `test_account` que ya lee `getAccount`). En cualquier otro caso, auditoría y simulación sí, supresión no.
- Índice único sobre `klaviyo_connections.klaviyo_account_id` (una cuenta de Klaviyo, una tienda), o como mínimo aplicar la regla de los 28 días y el libro de cargos por cuenta de Klaviyo y no solo por tienda.
- No tratar como válida para producción una suscripción `test: true` en una tienda que no es de desarrollo.

**Test de regresión**: con el stub de billing devolviendo `partnerDevelopment: true` y una cuenta de Klaviyo con `test_account: false`, `intent=start` debe devolver un error y no crear ninguna corrida.

---

### S-03 · Alto · Limpieza gratis desinstalando antes de que salga el cargo; `shop/redact` borra el historial de cargos

**Dónde**
- `shopify/app/billing/billing.ts:228-284` (el cargo real recién se crea cuando los jobs de Klaviyo confirman; sin suscripción activa queda en `failed`)
- `shopify/app/billing/billing.ts:287-301` (`runsWithOpenCharges`: solo la última semana)
- `shopify/app/data/privacy.ts:31-37` (`deleteShopData` borra `shops` y por cascada `usage_charges`, `runs`, `run_profiles`)
- `shopify/workers/suppression-run.ts:51-78`

**Qué pasa**
El cobro es posterior a la supresión. Al desinstalar, Shopify cancela la suscripción y ya no se puede crear el registro de uso.

Escenario: el merchant acepta el precio, inicia la limpieza, espera a que termine de enviar los lotes y desinstala. El cargo queda `failed` (`no_active_subscription`). Los perfiles quedan suprimidos en Klaviyo. A las 48 horas `shop/redact` borra todo, incluido el cargo impago. Reinstala el mes siguiente y repite. Aunque no llegue `shop/redact`, a los 7 días el cron deja de reintentar.

Hoy la ventana es de minutos a un par de horas (lo que tarda la confirmación de jobs). **Con la retención de 72 horas que se está agregando en `shopify/app/billing/`, la ventana pasa a ser de tres días** y el abuso queda al alcance de cualquiera. Aviso para quien está haciendo ese cambio.

Segundo efecto de la misma regla: "una limpieza deshecha entera antes del cargo no se cobra" (`billing.ts:238-250`). Con 72 horas de retención, un merchant puede limpiar justo antes de la renovación de Klaviyo, dejar que Klaviyo cuente el número bajo y deshacer todo antes del cargo: gratis, y es exactamente el patrón que `docs/12-CUMPLIMIENTO-KLAVIYO.md` quiere evitar. La casilla de confirmación de `createUndoRun` es la única traba.

Además, el borrado por `shop/redact` elimina el bloqueo de 365 días de los perfiles restaurados (`run_profiles.reactivated_at`), que se reinicia al reinstalar.

**Arreglo propuesto** (son decisiones de producto: van a Facundo)
- Conservar después de `shop/redact` un libro mínimo de cargos sin datos de clientes (dominio de la tienda, fecha, monto, estado). Es un registro contable del merchant, no dato de sus clientes; hay que declararlo en la política de privacidad. Al reinstalar, un cargo impago se cobra al aceptar la suscripción nueva y antes de permitir otra limpieza.
- Limitar la exención por deshacer: que valga solo si el deshacer ocurre dentro de un plazo corto y sin renovación de Klaviyo en el medio (`renewalSince` ya calcula eso).
- Si se mantiene la retención de 72 horas, registrar en `events_log` y avisar al dueño cada desinstalación con cargo abierto, para medir cuánto se pierde.

**Test de regresión**: corrida completada con cargo `pending`; simular desinstalación y `shop/redact`; reinstalar; `settleRunCharge` de una corrida nueva debe encontrar el cargo anterior.

---

### S-04 · Medio · Un cargo pendiente o fallido que nunca se cobró bloquea los cargos de los 28 días siguientes

**Dónde**: `shopify/app/billing/billing.ts:180-193`

```ts
where: and(eq(schema.usageCharges.shop, run.shop), inArray(schema.usageCharges.status, ["charged", "pending", "failed"])),
...
lastChargeAt: billable[0]?.createdAt ?? null,
```

**Qué pasa**
La regla "un cargo cada 28 días" cuenta como cargo anterior cualquier fila con monto mayor a cero, incluidas las `pending` y `failed`, y toma su fecha de creación. Si ese cargo nunca llega a cobrarse (Shopify lo rechaza, la suscripción cambió, el cron lo abandonó a los 7 días), todas las limpiezas de los 28 días siguientes quedan en `not_charged` con motivo `already_charged_this_cycle`, y ese estado es definitivo (`billing.ts:175`).

La auditoría, en cambio, cotiza mirando solo los `charged` (`shopify/app/scans/engine.ts:450-457`), así que la pantalla de revisión puede mostrar un precio que después no se cobra, o al revés.

**Arreglo propuesto**: que solo `charged` cuente para los 28 días y para el tope. Para evitar el doble cargo mientras hay uno `pending`, dejar la corrida nueva en espera (estado `pending` propio) y cotizarla cuando el anterior quede resuelto, en vez de marcarla `not_charged` para siempre. Usar la misma función de cotización en el scan y en `settleRunCharge`.

**Test de regresión**: cargo anterior `failed` de hace 2 días con monto mayor a cero; una corrida nueva con perfiles suprimidos debe cotizar el precio del tramo, no cero.

---

### S-05 · Medio · El reintento de cargos por cron se puede trabar

**Dónde**: `shopify/workers/app.ts:52` (`.slice(0, 3)`), `shopify/app/billing/billing.ts:287-301` (`ORDER BY r.finished_at`, últimos 7 días)

**Qué pasa**
El cron procesa por hora las 3 corridas con cargo abierto más viejas. Si esas 3 fallan siempre (tiendas desinstaladas, sin suscripción, Klaviyo desconectado), se vuelven a elegir las mismas cada hora durante 7 días y ninguna otra tienda recibe reintento. Pasados 7 días un cargo abierto no se reintenta más. Además, una excepción en `settleRunCharge` de una corrida corta el `for` y saltea las demás de ese tick.

Hoy el camino normal es el Workflow, y el cron es solo respaldo. Si la retención de 72 horas pasa el cobro al cron, esto se vuelve el camino principal.

**Arreglo propuesto**: guardar `last_attempt_at` y `attempts` en `usage_charges` y ordenar por el intento más viejo; `try/catch` por corrida; subir el límite por tick; y una alerta cuando un cargo supera N intentos en lugar de abandonarlo en silencio.

---

### S-06 · Medio · Un `app/uninstalled` atrasado, o un `shop/redact` después de reinstalar, borra una instalación viva

**Dónde**: `shopify/app/routes/webhooks.app.uninstalled.tsx:14-20`, `shopify/app/data/privacy.ts:20-37`, `shopify/app/routes/webhooks.compliance.tsx:18-20`

**Qué pasa**
Los handlers son idempotentes, pero no miran cuándo se generó el evento. Si el merchant desinstala y reinstala, y el `app/uninstalled` llega tarde (Shopify reintenta durante horas; con S-01 los reintentos son seguros), el handler revoca el acceso a Klaviyo de la instalación nueva y borra su sesión. `ensureShop` vuelve a marcar la tienda como instalada en la siguiente carga, pero el merchant tiene que reconectar Klaviyo sin saber por qué.

Con `shop/redact` es peor: `deleteShopData` borra todo sin mirar `shops.status`, incluido el historial de corridas que hace falta para deshacer.

**No verificado**: si Shopify manda `shop/redact` cuando la tienda reinstaló dentro de las 48 horas.

**Arreglo propuesto**
- Guardar en `shops` la fecha de la última instalación (hoy `ensureShop` no actualiza `installedAt` al reinstalar, `shopify/app/orders/purchases.ts:41-52`). En `app/uninstalled`, ignorar el evento si `triggeredAt` (lo devuelve `authenticate.webhook`) es anterior a esa fecha.
- En `shop/redact`, si la tienda está `installed` con sesión posterior al evento, no borrar y dejar registro para revisión manual.

**Test de regresión**: instalar, desinstalar, reinstalar, y recién entonces entregar el `app/uninstalled` con `triggeredAt` anterior a la reinstalación. La conexión y la sesión nuevas deben seguir ahí.

---

### S-07 · Medio · La pasarela saltea la verificación del mail cuando no hay hash guardado

**Dónde**: `shopify/app/runs/gateway.server.ts:120-124`

```ts
const expected = approvedHash.get(id);
if (expected && expected !== (await hashEmail(email))) {
```

**Qué pasa**
El comentario del archivo dice "un perfil que no se puede confirmar se saltea". El código hace lo contrario cuando `run_profiles.email_hash` es `NULL`: no compara y manda el mail actual a suprimir. El hash queda en `NULL` en dos casos:
- `customers/redact` lo pone en `NULL` para las corridas existentes (`shopify/app/data/privacy.ts:76-79`), incluida una corrida en cola o en curso.
- El perfil no tenía mail al momento del scan y lo tiene ahora.

En los dos casos se suprime una dirección para la que nunca se evaluó la regla de compras. Contradice la regla de producto 2.

**Arreglo propuesto**: en corridas `suppress`, si no hay hash aprobado para el perfil, saltearlo:

```ts
if (request.kind === "suppress" && (!expected || expected !== (await hashEmail(email)))) { skipped.push(id); continue; }
```

**Test de regresión**: corrida con un perfil cuyo `email_hash` es `NULL` y que en el Klaviyo falso tiene mail. Debe salir en `skippedProfileIds` y no en el job.

---

### S-08 · Bajo · `confirmRunJobs` usa el `runId` de la URL antes de verificar la tienda

**Dónde**: `shopify/app/routes/app.runs.$runId.tsx:52`, `shopify/app/runs/confirm.ts:30-36`

**Qué pasa**
En `intent=undo`, `confirmRunJobs(db, client, runId, 35)` busca los jobs por `run_id` sin filtrar por tienda y los consulta con el cliente de Klaviyo de la tienda de la sesión. Recién después `startUndoRun` verifica la pertenencia y devuelve `not_found`. Con un `runId` ajeno, la app manda ids de jobs de otra tienda a la cuenta de Klaviyo del atacante (Klaviyo responde 404) y la respuesta distingue "todavía procesando" de "no existe".

El impacto real es mínimo: los ids son UUID aleatorios y no se devuelve ningún dato. Es la única consulta que encontré que usa un id de la URL sin acotar por tienda.

**Arreglo propuesto**: cargar la corrida con `and(eq(runs.id, runId), eq(runs.shop, session.shop))` al principio de la acción y devolver `not_found` si no existe; y que `confirmJobsPage` reciba `shop` y filtre por `run_profiles.shop`.

---

### S-09 · Bajo · Los hashes de mail son SHA-256 sin clave

**Dónde**: `packages/core/src/email-hash.ts:9-13`, `shopify/app/data/privacy.ts:9-13`, `shopify/app/routes/webhooks.compliance.tsx:26-29`

**Qué pasa**
`purchase_hashes`, `run_profiles`, `simulation_candidates` y `scan_profiles` guardan `SHA-256(mail normalizado)`. Con una copia de la base, cualquiera con una lista de mails puede confirmar quién compró en qué tienda y a quién se suprimió. Es dato seudonimizado, no anónimo. La respuesta a `customers/data_request` ("nada para exportar") y el texto de privacidad deberían decirlo así; lo dejo para la revisión legal.

**Arreglo propuesto**: HMAC-SHA256 con una clave derivada por HKDF de `TOKEN_ENCRYPTION_KEY` (propósito `email-hash`), idealmente combinada con el dominio de la tienda. Hay que migrar o recalcular los hashes existentes, y el cruce con Klaviyo usa la misma función, así que el cambio es en un solo lugar.

---

### S-10 · Bajo · Cifrado de tokens: endurecimiento

**Dónde**: `packages/core/src/token-crypto.ts:24-46`, `shopify/app/session-storage.server.ts:33-41`, `shopify/app/klaviyo/oauth.ts:103-120`

Lo que está bien: AES-256-GCM, IV aleatorio de 96 bits por cifrado (sin reutilización), clave de 32 bytes validada, clave no extraíble y fuera de la base.

Lo mejorable:
- **Sin datos asociados (AAD)**: un texto cifrado no está atado a su tienda ni a su columna. Quien pueda escribir en D1 puede copiar el token de la tienda A a la fila de la tienda B. Arreglo: `additionalData = "<tabla>:<columna>:<shop>"`.
- **Camino de texto plano**: `decrypt` devuelve tal cual cualquier valor que no empiece con `v1:` (`session-storage.server.ts:40`). Sirve para migrar, pero permite inyectar tokens en claro. Si no hay sesiones viejas sin cifrar, rechazarlos.
- **Una sola clave para todo y sin rotación**: `TOKEN_ENCRYPTION_KEY` cifra tokens y además es la raíz de la firma del `state`, del ticket y del verificador PKCE. La separación por HKDF es correcta, pero no hay identificador de clave en el formato: rotarla invalida todos los tokens de una vez. Arreglo: prefijo `v2:<kid>:` y soporte para dos claves durante la rotación.

---

### S-11 · Bajo · La página pública `/` es la plantilla sin editar

**Dónde**: `shopify/app/routes/_index/route.tsx:24-53`, `shopify/app/routes/auth.login/route.tsx`

`https://tiersaver-app.tiersaver.workers.dev/` muestra "A short heading about [your app]" y un formulario que pide el dominio `myshopify.com`. No es una vulnerabilidad, pero es público, y los requisitos del App Store no permiten pedir el dominio de la tienda a mano durante la instalación. **No verificado** contra el texto vigente de los requisitos.

**Arreglo propuesto**: que `/` sin `?shop=` redirija al sitio (`SITE_URL`) y quitar el formulario; dejar `/auth/login` solo si hace falta para desarrollo.

---

### S-12 · Bajo · Arnés de preview

**Dónde**: `shopify/preview/`, `shopify/vite.preview.config.ts`, `shopify/.wrangler/deploy/config.json`

**Verificado**: el build actual (`shopify/build/server/wrangler.json`) es el de producción (`name: tiersaver-app`, `main` generado desde `workers/app.ts`); no aparece `__preview`, `PREVIEW_SHOP` ni el stub en ningún archivo de `build/`. `wrangler.jsonc`, `vite.config.ts` y `workers/app.ts` no referencian la carpeta. `preview:app` usa `react-router dev`, que no escribe `build/`.

**Riesgo residual**: el stub `preview/shopify.server.stub.ts` autentica cualquier request como la tienda de prueba, y `wrangler deploy` despliega lo que apunte `.wrangler/deploy/config.json`. Si alguien corre alguna vez `react-router build --config vite.preview.config.ts`, el siguiente `wrangler deploy` suelto subiría una app sin autenticación. Hoy lo frena solo que `deploy:worker` reconstruye antes.

**Arreglo propuesto**: que `preview/worker.ts` y el stub fallen al cargar si `SHOPIFY_APP_URL` no es `http://localhost:*`, y un chequeo en `deploy:worker` que aborte si `build/` contiene `__preview`.

---

### S-13 · Bajo · Cabeceras y logs de requests

**Dónde**: `shopify/app/entry.server.tsx:14`, `shopify/app/klaviyo/flow.server.ts:89-101`, `shopify/app/routes/app.simulation_.candidates.tsx:31-37`, `shopify/wrangler.jsonc:8`

- `addDocumentResponseHeaders` pone `frame-ancestors` con la tienda y `admin.shopify.com` en los documentos de la app, y `frame-ancestors 'none'` cuando no hay tienda (verificado en la librería). Está bien para una app embebida.
- Las respuestas que arman las rutas a mano (página "link no longer valid", CSV) no llevan `X-Content-Type-Options: nosniff`, y la página HTML tampoco lleva `frame-ancestors 'none'`. No hay `Strict-Transport-Security` ni `Referrer-Policy` global.
- Con `observability.enabled`, los logs de invocación de Workers registran la URL completa. Por ahí pasan el `code` de Klaviyo (un solo uso y atado al verificador PKCE, que nunca sale del servidor), el `state`, el `ticket` (10 minutos) y el `id_token` de Shopify (alrededor de 1 minuto). Ninguno sirve pasado su plazo; conviene saberlo y limitar quién accede a los logs.
- `console.error(error)` en `entry.server.tsx:25` vuelca el error de render entero. No vi que lleve datos personales, pero es el único log sin reducir a un código.

**Arreglo propuesto**: un envoltorio en `workers/app.ts` que agregue `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` y HSTS a toda respuesta; `frame-ancestors 'none'` en `linkNoLongerValid`.

---

### S-14 · Bajo · Excepciones de la cuenta de prueba activas en producción

**Dónde**: `shopify/wrangler.jsonc` (`KLAVIYO_SEEDED_ACCOUNT_ID`), `shopify/app/routes/app.simulation.tsx:22-23` y `:131`, `shopify/app/scans/engine.ts:263` y `:358`

Para esa cuenta, el inicio de la limpieza no exige suscripción (compara solo el id), y el scan da por completa la cobertura de pedidos y lee la antigüedad desde una propiedad del perfil (esto último exige además que Klaviyo marque la cuenta como de prueba). Solo afecta a quien pueda iniciar sesión en esa cuenta de Klaviyo, así que el riesgo es bajo, pero es una puerta de prueba en la configuración de producción.

**Arreglo propuesto**: quitar la variable de `wrangler.jsonc` de producción antes del lanzamiento, o exigir también `test_account === true` en el salto de billing.

---

### S-15 · Bajo · Frecuencia de auditorías y carrera al cotizar

- **Auditorías sin enfriamiento** (`shopify/app/routes/app._index.tsx:70-75`, `shopify/app/scans/engine.ts:180-204`): hay un scan por tienda a la vez, pero ninguna espera entre uno y otro. Un merchant puede encadenar auditorías sin pausa; cada una es un Workflow con cientos de pasos y llamadas a Klaviyo. Arreglo: mínimo de unos minutos entre scans manuales.
- **Dos cargos cotizados a la vez** (`shopify/app/billing/billing.ts:177-211`): la cotización lee los cargos anteriores y después inserta. Dos corridas de la misma tienda que terminen en el mismo instante pueden cotizar las dos como "primer cargo" y cobrarse las dos (claves de idempotencia distintas). Es una ventana angosta. Arreglo: hacer la inserción condicional en una sola sentencia SQL (`INSERT ... SELECT ... WHERE NOT EXISTS (cargo de la tienda en los últimos 28 días)`).

---

### S-16 · Bajo · Dependencias y otros

- `npm audit --omit=dev`: 2 moderadas, `minimatch` (GHSA-g3hv-75wg-m249, denegación de servicio por patrones) vía `@react-router/fs-routes`. Se usa al construir las rutas, no con entrada de usuarios. Sin arreglo disponible; seguir la actualización.
- `npm audit` completo: 28 (6 moderadas, 22 altas), en `@graphql-tools/utils`, `lodash`, `minimatch` y `esbuild`. Por los paquetes afectados son herramientas de desarrollo y de build (codegen de GraphQL, eslint, bundler) que no van al Worker desplegado; **no revisé una por una** las 28 rutas de dependencia. Conviene correr `npm audit` en CI y actualizar lo que tenga arreglo.
- El bundle del cliente incluye el esquema completo de la base (`shopify/build/client/assets/schema-*.js`, 27 KB, con nombres de tablas y columnas como `refresh_token_enc`), porque `app.settings.tsx` y `app.simulation.tsx` importan en el componente constantes de módulos que importan `db/schema`. No expone datos ni secretos, pero publica el modelo de datos. Arreglo: mover `CSV_PART_SIZE`, `CANDIDATE_REASON_LABELS`, `MAX_PROTECTED_GROUPS`, `LEAD_DAYS_LIMITS` e `isKlaviyoRecommended` a un módulo sin imports de servidor.
- **No verificado**: si la cuenta de Cloudflare tiene activas las preview URLs de `workers.dev`. Si lo están, las versiones viejas del Worker siguen públicas con los mismos secretos y la misma base. Conviene fijar `"preview_urls": false` en `shopify/wrangler.jsonc`.
- `SUPPRESSION_ENABLED` no está en `wrangler.jsonc` a propósito. Si se la carga como variable simple desde el panel, el siguiente `wrangler deploy` la borra (queda apagada, que es el lado seguro). Cargarla como secreto si tiene que sobrevivir a los despliegues.

---

## Observación fuera de mi alcance (para quien revisa reglas)

**Los datos de compras de Shopify quedan congelados al día de la instalación.** El webhook `orders/create` está comentado en `shopify/shopify.app.toml` (hasta tener aprobado el acceso a datos protegidos) y el único lugar que lanza el backfill es `afterAuth` (`shopify/app/shopify.server.ts:28-35`). `shops.purchases_covered_since` dice desde cuándo hay datos, pero nada dice hasta cuándo. Un scan hecho meses después trata la cobertura como completa aunque falten todos los pedidos posteriores. Queda el cruce con "Placed Order" de Klaviyo como única protección para compradores recientes. Verificado por lectura; no evalué el impacto en las reglas.

---

## Qué revisé y encontré bien

**Autenticación de Shopify en las rutas**
- Todas las rutas bajo `/app` llaman `authenticate.admin` en su propio loader y en su propia acción (`app.tsx`, `app._index.tsx`, `app.klaviyo.finish.tsx`, `app.runs._index.tsx`, `app.runs.$runId.tsx`, `app.settings.tsx`, `app.simulation.tsx`, `app.simulation_.candidates.tsx`). Ninguna depende de la autenticación del layout padre.
- Las rutas sin `authenticate.admin` son las esperadas: `/` y `/auth/login` (plantilla), `/klaviyo/oauth/start` y `/klaviyo/oauth/callback` (firmadas, ver abajo), y los webhooks (HMAC).
- La tienda siempre sale de la sesión, nunca de la URL ni del formulario. Un POST forjado desde otro origen no tiene token de sesión válido, así que no puede aprobar ni iniciar nada.
- La descarga de CSV exige sesión, acota la simulación por tienda, solo sirve simulaciones en estado `open`, y registra quién bajó qué sin datos de perfiles.
- No hay redirecciones abiertas: `embeddedAppUrl` valida el dominio con un patrón estricto, los demás destinos son rutas fijas, y la URL de confirmación de billing viene de Shopify.

**Aislamiento entre tiendas**
- Revisé cada consulta de rutas, vistas, motor de corridas, scans, settings, privacidad y schedule. Todo id que viene de la URL o del formulario (`simulationId`, `runId`) se busca junto con `shop = session.shop`. La única excepción es S-08.
- Los Workflows reciben solo un id, y la pasarela se crea atada a la tienda de la corrida y rechaza cualquier lote de otra tienda (`gateway_shop_mismatch`).

**La compuerta de supresión**
- `createSuppressionRun` es el único lugar que crea corridas `suppress`, y la condición real es una sola sentencia SQL atómica: simulación de la tienda, aprobada, con aprobador, de menos de 24 horas, no ejecutada, no reemplazada, con la misma versión de settings, y sin otra corrida para esa simulación (más el índice único `runs_simulation_unique`).
- El Workflow vuelve a verificar la simulación al arrancar (`suppressGateError`).
- La aprobación manual exige un usuario de Shopify identificado (`user:<id>` del token de sesión) y la casilla de aceptación, y es un `UPDATE` atómico con todas las condiciones.
- `SUPPRESSION_ENABLED` se compara contra `"true"` exacto en la pasarela, antes de cualquier llamada de red, y otra vez en la ruta y en el modo automático. `SUPPRESSION_ALLOWED_ACCOUNT_ID` se verifica contra la conexión actual dentro de la pasarela. Los dos fallan hacia "no suprimir".
- El modo automático exige: modo automático y schedule activos, criterios recomendados, una limpieza manual anterior completada y aprobada por una persona, simulación de origen programado, switch habilitado y suscripción activa. La primera ejecución no puede ser automática.
- Deshacer está exento del switch a propósito y solo opera sobre los perfiles `submitted` de una corrida propia de la tienda.
- Las instancias de Workflow solo se crean por binding; no hay endpoint HTTP que las dispare. El cron no suprime nada por sí mismo.

**Webhooks**
- HMAC verificado por la librería; HMAC inválido da 401 (confirmado en el código de la librería y por el smoke test del repo).
- Los handlers son idempotentes ante reentregas (`MAX` de fecha en compras, borrados repetibles).
- `customers/redact` borra por mail y por id de cliente, acotado a la tienda; `shop/redact` borra por cascada desde `shops` (hay test que verifica que no toca otras tiendas).

**OAuth de Klaviyo**
- `state` firmado con HMAC, con vencimiento de 10 minutos, nonce y atado al navegador por una cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`. La verificación de firma es de tiempo constante.
- El verificador PKCE se deriva del `state` con otra clave y nunca pasa por el navegador.
- El paso final exige sesión de Shopify y que el `state` haya sido emitido para esa misma tienda; por eso un link de inicio enviado a un tercero no conecta su Klaviyo a la tienda de otro.
- El `state` es de un solo uso (tabla `klaviyo_oauth_attempts`, que guarda solo su hash), y el código se canjea una sola vez aunque Shopify cargue la página varias veces.
- Si falla algo después del canje, se revoca el token recién emitido.
- Renovación de tokens serializada por tienda con un `UPDATE` condicional (lease de 30 segundos, mayor que el timeout de 10); contempla rotación del refresh token y `invalid_grant`.

**Tokens, secretos y logs**
- Sin secretos en el repo, en `wrangler.jsonc`, en `shopify.app.toml` ni en el historial de git (busqué nombres de archivo y patrones de claves). Los `.env` y `.dev.vars` están ignorados y no existen en el árbol. Los valores de `preview/wrangler.preview.jsonc` son ficticios.
- Los errores de la capa de Klaviyo son solo códigos: nunca llevan tokens, mails, URLs ni el texto libre de Klaviyo. Los 8 `console.*` del código de producción registran nombres de error y conteos.
- No se guardan mails en claro: se leen de Klaviyo para el lote o el CSV y se descartan.
- El relay de pruebas escucha solo en `127.0.0.1` y se niega a arrancar si la cuenta no es la de prueba.

**CSV y XSS**
- `csvCell` entrecomilla todo y neutraliza celdas que empiezan con `=`, `+`, `-`, `@`, tabulador o retorno de carro. La respuesta va como adjunto con `Cache-Control: no-store`.
- No hay `dangerouslySetInnerHTML` ni HTML armado con datos. Los nombres de listas y segmentos de Klaviyo se muestran escapados por React. El parámetro `klaviyo=` de la home se limita a cuatro valores fijos.
- Las referencias a grupos protegidos se validan con un patrón estricto antes de guardarse.

**Idempotencia de cargos**
- Una fila de `usage_charges` por corrida (índices únicos por `run_id` y por clave), y la misma clave determinista en cada intento hacia Shopify. Un reintento después de una respuesta perdida no duplica. **No verificado en vivo**: que Shopify aplique la clave de idempotencia como dice su documentación.

## Lo que no pude verificar

- Que Shopify rechaza la renovación del token offline después de desinstalar (S-01). Requiere una prueba en la tienda de desarrollo.
- Si Shopify envía `shop/redact` cuando la tienda reinstaló dentro de las 48 horas (S-06).
- El comportamiento real de la clave de idempotencia de `appUsageRecordCreate`.
- Que las 22 vulnerabilidades altas del `npm audit` completo sean todas de desarrollo: lo deduje de los nombres de los paquetes, no de cada ruta de dependencia.
- La configuración real de la cuenta de Cloudflare (preview URLs, quién accede a los logs, cómo está cargado `SUPPRESSION_ENABLED`).
- El texto vigente de los requisitos del App Store sobre el formulario de dominio (S-11).
- `shopify/app/billing/` está siendo modificado por otra persona: lo revisado es el estado del árbol a las 01:30 del 2026-11-26.

## Fuentes externas consultadas

- Shopify, "Use expiring offline access tokens": https://shopify.dev/docs/apps/build/security/credentials-and-data/use-expiring-offline-access-tokens
- Shopify, "Offline access tokens": https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens
- Shopify changelog, "Offline access tokens now support expiry and refresh": https://shopify.dev/changelog/offline-access-tokens-now-support-expiry-and-refresh
- GitHub advisory GHSA-g3hv-75wg-m249 (minimatch): https://github.com/advisories/GHSA-g3hv-75wg-m249
