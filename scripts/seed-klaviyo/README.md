# seed-klaviyo

Carga una cuenta de Klaviyo **de prueba** con 2.000 a 5.000 perfiles ficticios, repartidos en cohortes que ejercitan cada regla de `packages/core/src/rules.ts`. Sirve para las pruebas de integración de TierSaver.

Estado al 2026-11-25: escrito contra la documentación vigente y probado offline (123 tests con un Klaviyo falso). **Nunca corrió contra la API real**: todavía no hay cuenta de prueba ni clave. Antes de la primera corrida real leé "Antes de la primera corrida real" y "Lo que no se pudo verificar".

## Uso

```bash
# Plan (default): no usa la red, no necesita clave
npm run seed -w @tiersaver/seed-klaviyo
npm run seed -w @tiersaver/seed-klaviyo -- --count 5000 --seed 42 --now 2026-11-25T12:00:00Z

# Corrida real: clave solo por variable de entorno, cuenta esperada explícita
export KLAVIYO_TEST_PRIVATE_KEY=...   # nunca por argumento
npm run seed -w @tiersaver/seed-klaviyo -- --execute \
  --account-id <id de 6 caracteres> --expect-account-name "<nombre de la organización>" \
  --email-domain <dominio propio sin correo>

# Chequeo de solo lectura después de la corrida (esperar unos minutos: los eventos se procesan asincrónicamente)
npm run seed -w @tiersaver/seed-klaviyo -- --verify --account-id <id>

npm test -w @tiersaver/seed-klaviyo
npm run typecheck -w @tiersaver/seed-klaviyo
```

`--help` lista todas las opciones. Códigos de salida: 0 bien, 1 error, 2 rechazado por un control de seguridad o argumentos inválidos, 3 terminó con advertencias.

En esta sesión en la nube, `fetch` de Node necesita `NODE_USE_ENV_PROXY=1` para salir por el proxy. En una máquina normal no hace falta.

### Cómo corre

Cero dependencias de runtime. El script `seed` usa Node 22 con `--experimental-transform-types` y el hook `register.mjs`. Hacen falta las dos cosas porque `@tiersaver/core` exporta su fuente TypeScript: sus imports relativos terminan en `.js` (el hook los resuelve a `.ts`) y `TokenBucket` usa parameter properties, que el type stripping simple no acepta. El código de este paquete sí es de sintaxis borrable.

## Seguridad

- La clave se lee **solo** de `KLAVIYO_TEST_PRIVATE_KEY`. Cualquier argumento que parezca una clave (`pk_...`, `--api-key`, `--token`) se rechaza sin imprimir su valor. Todo lo que se loguea o se guarda pasa por un filtro que reemplaza la clave por `[REDACTED]`.
- Sin `--execute` no hay ningún request.
- Con `--execute`, lo primero es `GET /api/accounts`. La corrida se niega si el `id` de la cuenta no coincide con `--account-id`, si el nombre de la organización no coincide con `--expect-account-name` (sin distinguir mayúsculas), o si no se pasó ninguno de los dos. Si se pasan los dos, tienen que coincidir los dos.
- Control adicional: también se niega si Klaviyo no marca la cuenta como de prueba (`test_account: false`). Se puede forzar con `--allow-non-test-account`.
- Los eventos van con `backfill: true` (no disparan flows) y el consentimiento SMS con `historical_import: true` (no manda mensaje de confirmación). El script no envía nada a nadie.
- No borra perfiles. Ver "Limpieza".

## Datos generados

Deterministas: misma `--seed`, `--count`, `--now`, `--email-domain` y `--run-tag` dan exactamente los mismos perfiles, eventos y payloads.

- Mails: `<run-tag>-<nnnnn>@<dominio>`, con `run-tag` = `ts-seed-<seed>` por defecto.
- Nombres: alfabeto de la OTAN + `Seed-<nnnnn>`. Teléfonos (solo cohorte SMS): rango ficticio norteamericano `+1 <área> 555-01XX`.
- Propiedades de perfil: `ts_seed_run`, `ts_seed_cohort`, `ts_seed_index`, `ts_seed_now`, `ts_seed_created_at` (antigüedad pretendida) y `ts_seed_expected` (por ejemplo `protected:recent_click`).
- Eventos: métricas "Opened Email", "Clicked Email", "Placed Order", "Active on Site" y "Started Checkout", con `unique_id` determinista y propiedades `ts_seed_run` y `ts_seed_cohort`. Las aperturas llevan la propiedad booleana `Machine Open`.

### Cohortes

Porcentaje fijo de cada una. La decisión esperada vale con `DEFAULT_RULE_SETTINGS`, cobertura de datos completa y evaluando **en el instante `ts_seed_now`**.

| Cohorte | % | Decisión esperada |
| --- | --- | --- |
| `recent_purchaser` | 11 | protegido: `recent_purchase` |
| `recent_clicker` (clic hace 100 a 170 días, apertura fuera de ventana) | 10 | protegido: `recent_click` |
| `recent_opener_human` | 10 | protegido: `recent_open` |
| `recent_opener_machine_only` | 8 | protegido: `recent_open`. Con `countMachineOpens: false`: candidato `lapsed` |
| `recent_clicker_and_opener` | 6 | protegido: `recent_click` + `recent_open` |
| `purchased_long_ago_clicked_recently` | 4 | protegido: `recent_click` |
| `site_activity_only` | 6 | protegido: `recent_site_activity` |
| `new_profile` (menos de 90 días) | 7 | protegido: `new_profile` |
| `sms_consented` | 5 | protegido: `sms_consent` |
| `protected_group` | 3 | protegido: `protected_group` |
| `reactivated` (suprimido y des-suprimido por el seed) | 1 | protegido: `recently_reactivated` |
| `lapsed` | 12,6 | candidato: `lapsed` |
| `never_engaged` | 10 | candidato: `never_engaged` |
| `already_suppressed` | 4 | omitido: `already_suppressed` |
| 12 cohortes de borde, 0,2 % cada una | 2,4 | ver abajo |

Bordes, un día adentro y un día afuera de cada ventana: `boundary_open_89d` / `_91d`, `boundary_machine_open_89d` / `_91d`, `boundary_click_179d` / `_181d`, `boundary_purchase_364d` / `_366d`, `boundary_site_179d` / `_181d`, `boundary_created_89d` / `_91d`. El de adentro queda protegido por su regla; el de afuera es candidato.

No se pueden sembrar desde Klaviyo: `no_email` (no lo intentamos), `unknown_profile_age` e `insufficient_*_history` (dependen de la cobertura de datos de la app, no del perfil).

### Para las pruebas

`src/index.ts` exporta lo necesario:

- `generateDataset(opciones)` y `expectedDecisions(dataset)`: la decisión esperada de cada perfil, declarada en el catálogo de cohortes.
- `toProfileSignals(perfil, dataset)`: las señales que la app debería derivar al leer el perfil.
- `evaluateSeedProfile(perfil, dataset, { at, settings, createdAt })`: corre el motor real de reglas. Usalo cuando la expectativa declarada no aplica tal cual (otra fecha de evaluación, otros umbrales, o el `created` real de Klaviyo).

`test/generate.test.ts` pasa las señales generadas por `evaluateProfile` de `@tiersaver/core` y exige que coincidan con lo declarado: si cambian las reglas o las cohortes sin actualizar la otra parte, el test falla.

Dos cosas que las pruebas de integración tienen que tener en cuenta:

1. **El dataset envejece.** Todo es relativo a `ts_seed_now`. Un día después, los bordes "de adentro" ya salieron de su ventana; a los pocos días también lo hacen las cohortes recientes. Evaluá con `now = ts_seed_now` (el motor recibe `now` por parámetro) o recalculá con `evaluateSeedProfile(..., { at })`. Si no, volvé a sembrar con otro `--run-tag`.
2. **`created` no se puede antedatar** (ver hallazgo 1).

## Hallazgos que afectan a TierSaver

1. **La fecha de creación del perfil es siempre la del import.** La API no tiene campo para fijarla y la ayuda de Klaviyo dice que "Profile created" es la fecha en que Klaviyo creó el perfil; lo que se antedata con eventos históricos es "First active". Consecuencia: durante 90 días después de sembrar, la app verá todos los perfiles como `new_profile` y no habrá ningún candidato si usa el `created` de Klaviyo. `newProfileDays` tiene mínimo 30, así que no se desactiva por configuración. Opciones: que las pruebas de integración tomen `createdAt` de `ts_seed_created_at` mediante un hook solo de test, o sembrar y esperar 90 días (pero entonces también envejecen los eventos). Hay que decidirlo antes de escribir esas pruebas. El test "predicts that every profile is protected as new" deja esto documentado en código.
2. **Los eventos creados por API son métricas distintas de las nativas.** La doc de métricas dice que los eventos "collected or sent via the same mechanism (a given integration or our APIs)" comparten métrica, y que cada métrica tiene su `integration` (`Klaviyo`/`Internal`, `API`/`API`, `Shopify`/`eCommerce`). Un "Opened Email" sembrado queda en una métrica "Opened Email" de la integración **API**, con otro `id` que la nativa. Qué implica:
   - La app tiene que resolver métricas por nombre **e** integración, no solo por nombre. En producción usa las de `Klaviyo` (aperturas, clics) y las de la plataforma de e-commerce; contra la cuenta de prueba, las de `API`. Conviene que el mapeo de métricas sea configurable.
   - Las condiciones de segmento referencian `metric_id`. Un segmento "Opened Email 0 veces en N días" armado sobre la métrica nativa **no ve** los eventos sembrados. Para probar segmentos en la cuenta de prueba hay que usar los ids de las métricas API (`GET /api/metrics?filter=equals(integration.name,"API")`).
   - El filtro de segmento "Apple Privacy Open" de la interfaz aplica a la métrica nativa. En los eventos sembrados la marca es una propiedad común llamada `Machine Open`.
   - La única forma documentada de tener eventos nativos sin enviar mails es la herramienta de datos de muestra de Klaviyo (10 perfiles, 5 "Opened Email"; una sola vez por cuenta). Sirve para leer el nombre real de la propiedad de apertura automática.
3. **Klaviyo descarta en silencio los eventos de direcciones `@example.com`, `@test.com` "o similares"** (responde 202 igual). Por eso `example.com` es el default solo para el plan y `--execute` lo rechaza. Hace falta un dominio propio que no reciba correo, por ejemplo un subdominio sin registros MX (o con MX nulo, RFC 7505) de un dominio de Facundo. Elegirlo y crear ese DNS es decisión de Facundo. `--allow-reserved-domain` existe por si se quiere probar igual.
4. **Una cuenta de prueba es una cuenta normal en plan gratis**: 250 perfiles activos y 500 envíos. Sembrar 3.000 perfiles la deja 12 veces por encima. Según la ayuda, pasar el límite bloquea los envíos hasta bajar de 250 o pagar; no encontramos nada que diga que cobra o sube de plan sola desde el plan gratis, pero tampoco está dicho explícitamente (ver "Lo que no se pudo verificar"). Además `usage_max` de `billing-usage` será 250 en esa cuenta, lo que condiciona las pruebas de tramo.

## Verificado contra la documentación (2026-11-25)

Fuente principal: spec OpenAPI oficial, `https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable.json` (`info.version` 2026-10-15), descargado completo en esta sesión. Las páginas de `developers.klaviyo.com` se leyeron en su versión Markdown (`<url>.md`).

| Dato | Valor | Fuente |
| --- | --- | --- |
| Revisión estable más nueva | `2026-10-15`, header `revision` obligatorio en cada endpoint | spec; developers.klaviyo.com/en/reference/api_overview |
| Autenticación | `Authorization: Klaviyo-API-Key <clave>`; las claves privadas empiezan con `pk_` | spec (`securitySchemes`); developers.klaviyo.com/en/docs/authenticate_ |
| Tipo de contenido | `application/vnd.api+json` | spec |
| `GET /api/accounts` | Devuelve 1 cuenta: `id`, `attributes.test_account`, `attributes.contact_information.organization_name`. 1/s, 15/min. Scope `accounts:read` | spec (`get_accounts`) |
| `POST /api/profile-bulk-import-jobs` | Hasta 10.000 perfiles y 5 MB por request, 100 KB por perfil. 10/s, 150/min. Upsert. Un perfil inválido da 400 y no crea el job. Responde 202 con el `id` del job. Scopes `profiles:write`, `lists:write` | spec (`bulk_import_profiles`); developers.klaviyo.com/en/docs/use_klaviyos_bulk_profile_import_api |
| Estado del job de import | `GET /api/profile-bulk-import-jobs/{job_id}`: `status` (`queued`, `processing`, `complete`, `cancelled`), `total_count`, `completed_count`, `failed_count`. Errores en `.../{id}/import-errors`. Los jobs vencen a los 7 días. Scopes `profiles:read`, `lists:read` | spec; guía de bulk import |
| El import no cambia consentimiento; puede agregar a una lista con `relationships.lists` | | guía de bulk import |
| `POST /api/event-bulk-create-jobs` | Hasta 1.000 eventos y 5 MB por request. 10/s, 150/min. Responde 202 sin cuerpo: no hay job que consultar. Scope `events:write` | spec (`bulk_create_events`); developers.klaviyo.com/en/reference/events |
| `POST /api/events` | Un evento por request. 350/s, 3.500/min. No lo usamos | spec (`create_event`) |
| `time` antedatado | Aceptado. Entre 1990 y "ahora" + 1 año. Se trunca al segundo | spec; tabla "Limitations" de developers.klaviyo.com/en/reference/events |
| `backfill: true` | El evento se registra y sirve para segmentar, pero no dispara flows. En bulk va en cada entrada `event-bulk-create` | developers.klaviyo.com/en/reference/events |
| Idempotencia de eventos | Dedup por (perfil, métrica, `unique_id`); el duplicado se descarta en silencio. Un `unique_id` repetido dentro del mismo request bulk da 400 | developers.klaviyo.com/en/reference/events |
| Eventos de `@example.com` / `@test.com` | Descartados en silencio (202) | developers.klaviyo.com/en/reference/events, secciones "Create Event" y "Troubleshooting" |
| Métricas de API vs nativas | Métrica separada por integración | developers.klaviyo.com/en/reference/metrics |
| `POST /api/profile-subscription-bulk-create-jobs` | Hasta 1.000 perfiles. 75/s, 750/min. Con `historical_import: true` saltea el doble opt-in y exige `consented_at` en el pasado. Quita supresiones `UNSUBSCRIBE`, `SPAM_REPORT` y `USER_SUPPRESSED` de los perfiles enviados. Responde 202 sin cuerpo. Scopes `lists:write`, `profiles:write`, `subscriptions:write` | spec (`bulk_subscribe_profiles`); developers.klaviyo.com/en/docs/collect_email_and_sms_consent_via_api |
| Header `X-Klaviyo-Partial-Failure: phone_number` | Indica que el teléfono fue ignorado | guía de consentimiento |
| `POST /api/profile-suppression-bulk-create-jobs` | 100 mails por request. 75/s, 750/min. Responde 202 con job; `GET .../{job_id}` da `status`, `total_count`, `completed_count`, `skipped_count` | spec (`bulk_suppress_profiles`) |
| `POST /api/profile-suppression-bulk-delete-jobs` | Mismo formato y límites | spec (`bulk_unsuppress_profiles`) |
| Rate limits | Ventana fija: 1 s (ráfaga) y 1 min (sostenido), por cuenta. En un 429 viene `Retry-After` en segundos | developers.klaviyo.com/en/docs/rate_limits_and_error_handling |
| `POST /api/data-privacy-deletion-jobs` | Un perfil por request (mail, teléfono o id). 3/s, 60/min. Scope `data-privacy:write` | spec (`request_profile_deletion`) |
| Fecha de creación del perfil | No hay campo en la API; es la fecha en que Klaviyo creó el perfil | spec; help.klaviyo.com/hc/en-us/articles/115005247028 |
| Cuenta de prueba | Cuenta normal con etiqueta; plan gratis y facturación igual que cualquiera | developers.klaviyo.com/en/docs/create_a_test_account |
| Plan gratis | 250 perfiles activos, 500 envíos; pasarse bloquea envíos | help.klaviyo.com/hc/en-us/articles/360050759151 |
| Marca de apertura automática | Los "Opened Email" nativos tienen la propiedad "Apple Privacy Open" (verdadero/falso) desde el 20/11/2021 | help.klaviyo.com/hc/en-us/articles/4416791883163 |

Cómo usa esto el cliente: un token bucket por endpoint con la **mitad** del límite publicado de capacidad y de recarga (con ventana fija, un bucket lleno más su recarga podría duplicar el límite); espera `Retry-After` en 429; backoff exponencial con jitter en 5xx y errores de red, hasta 6 intentos; cualquier otro 4xx corta sin reintentar. Los lotes paran en 4,5 MB para dejar margen bajo los 5 MB.

## Lo que no se pudo verificar

Sin cuenta ni clave, nada de esto se probó contra la API real.

1. **Qué dominios caen en "o similares"** del descarte de eventos, y si el import de perfiles acepta esos dominios. Después de sembrar, corré `--verify`: compara lo guardado con lo enviado para un perfil por cohorte.
2. **Consentimiento SMS**: si Klaviyo acepta números `555-01XX`, y si la cuenta necesita SMS configurado (número emisor, país) para registrar el consentimiento. Tampoco está confirmado que `historical_import` evite todo mensaje por SMS, aunque los números no son ruteables. Por eso es el último paso y su rechazo no aborta la corrida: queda como advertencia y se reintenta en la próxima. `--skip-sms` lo saltea.
3. **Nombre real de la propiedad de apertura automática en el payload del evento.** La ayuda la llama "Apple Privacy Open"; `docs/STATUS.md` dice "Machine Open". Usamos `Machine Open` (constante `MACHINE_OPEN_PROPERTY`). Hay que leerlo de un evento nativo en la cuenta de prueba.
4. **Costo de pasar los 250 perfiles en plan gratis.** Lo leído indica solo bloqueo de envíos. Confirmarlo en Billing de la cuenta de prueba antes de sembrar, y confirmar que no haya auto-upgrade activado: es una acción que podría gastar dinero.
5. **Re-supresión dentro de los 90 días** (duda 7 de `STATUS.md`): la cohorte `reactivated` deja perfiles listos para probarlo; el resultado esperado (`skipped_count`) es una suposición.
6. **Tiempos de procesamiento** de los jobs y de los eventos. La duración del plan es una estimación.
7. Si el valor booleano `false` en una propiedad de evento se guarda (la doc dice que `0`, `null` y `""` se ignoran; no menciona `false`).
8. El límite de 200 métricas por cuenta figura en la doc de SFTP; no afecta (creamos 5).

## Diferencias con nuestros documentos

- `docs/STATUS.md` (duda 6) nombra la propiedad "Machine Open" y dice que en la interfaz se llama "Apple Privacy Open". La ayuda vigente solo la llama "Apple Privacy Open" (punto 3 de arriba). No es contradicción firme, pero el nombre de la clave sigue sin confirmar.
- `docs/STATUS.md` y `docs/02-ARQUITECTURA.md` dicen 75/s y 750/min para supresión: coincide con el spec. La guía general de rate limits de Klaviyo dice 700/min para el nivel "L"; el spec y la referencia del endpoint dicen 750. Inconsistencia de Klaviyo, sin efecto para nosotros (vamos a la mitad).
- `docs/02-ARQUITECTURA.md` prevé "perfiles sembrados que cubran cada regla" para las pruebas de integración. Con los hallazgos 1 y 2 eso no alcanza por sí solo: la regla de perfil nuevo tapa todo durante 90 días y las métricas sembradas no son las nativas. No contradice una decisión, pero cambia cómo hay que escribir esas pruebas.
- Dato nuevo, no estaba en nuestras notas: Bulk Subscribe admite hasta 1.000 perfiles y quita `USER_SUPPRESSED`. La app no debería suscribir a nadie, pero conviene saberlo.

## Reanudar e idempotencia

- Cada paso terminado se anota en `.state/<run-tag>.json` (ignorado por git, sin la clave). Al volver a correr el mismo comando se saltean los pasos hechos; si un job quedó enviado pero sin terminar, se consulta ese job en lugar de enviarlo de nuevo.
- El archivo guarda el `now` de la primera corrida y lo reutiliza, para que al reanudar días después el dataset sea el mismo.
- Si cambian `--count`, `--email-domain`, `--now`, `--protected-list-id` o la cuenta para un `run-tag` ya empezado, la corrida se niega. Para otro dataset, usá otro `--run-tag` o `--seed`.
- Aunque se pierda el archivo, repetir con la misma semilla y el mismo `--now` no duplica: el import es upsert por mail, los eventos se deduplican por `unique_id`, y supresión y consentimiento son idempotentes.
- Los teléfonos ficticios se repiten entre corridas. Si sembrás un segundo `run-tag` en la misma cuenta, usá `--skip-sms` para no pisar los teléfonos del primero.

## Grupo protegido

Sin `--protected-list-id`, la cohorte `protected_group` no entra a ninguna lista: en las pruebas, marcá como protegido un segmento con `ts_seed_cohort = "protected_group"`. Con `--protected-list-id <id>` (una lista ya creada en la cuenta de prueba), esa cohorte se importa en un job aparte que la agrega a la lista sin cambiar su consentimiento.

## Antes de la primera corrida real

1. Crear la cuenta de prueba y convertirla en test account (Settings > Account > Testing).
2. Revisar Billing: plan gratis, sin auto-upgrade (hallazgo 4).
3. Crear una clave privada con los scopes mínimos: `accounts:read`, `profiles:read`, `profiles:write`, `lists:read`, `lists:write`, `events:read`, `events:write`, `subscriptions:read`, `subscriptions:write`. (`events:read` y `profiles:read` son para `--verify` y para consultar jobs.)
4. Definir el dominio de los mails (hallazgo 3).
5. Correr el plan, después `--execute`, esperar unos minutos y correr `--verify`.
6. Anotar en `docs/STATUS.md` lo que resulte de los puntos de "Lo que no se pudo verificar".

## Limpieza

No está implementada, a propósito: la app no borra perfiles y este script tampoco.

En Klaviyo, borrar un perfil por API es un pedido de privacidad: `POST /api/data-privacy-deletion-jobs`, un perfil por request (identificado por mail, teléfono o id, solo uno de los tres), 3/s y 60/min, scope `data-privacy:write`. Es asincrónico, irreversible, y el perfil queda listado en la página de perfiles borrados. Para 3.000 perfiles son unos 50 minutos como mínimo.

Si algún día hace falta:

- Lo más simple es descartar la cuenta de prueba y crear otra.
- Para dejar de contar perfiles sin borrar nada: suprimir por segmento con `ts_seed_run = <run-tag>` (los suprimidos no cuentan como activos).
- Si se implementa el borrado: comando separado, con los mismos controles de cuenta que `--execute`, limitado a los mails del `run-tag` regenerados con la misma semilla (nunca por segmento ni por comodín), con una confirmación explícita adicional y nunca como default. Las métricas creadas por API no se borran por API.
