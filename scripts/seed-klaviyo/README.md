# seed-klaviyo

Carga una cuenta de Klaviyo **de prueba** con 2.000 a 5.000 perfiles ficticios, repartidos en cohortes que ejercitan cada regla de `packages/core/src/rules.ts`. Sirve para las pruebas de integración de TierSaver.

Las cohortes siguen las reglas decididas el 2026-11-25: por defecto, los criterios que Klaviyo publica para sus recomendaciones de supresión (perfil creado hace 365 días o más, 5 o más mails recibidos en unas 72 semanas, y ninguna apertura, clic, visita, checkout ni compra, nunca). El modo ampliado, opt-in, usa ventanas con piso. Cada perfil lleva la decisión esperada en los dos modos. El porqué está en `docs/12-CUMPLIMIENTO-KLAVIYO.md`, secciones 2.7 y 3.1.

Estado al 2026-11-25: escrito contra la documentación vigente y probado offline (138 tests con un Klaviyo falso). **Nunca corrió contra la API real**: todavía no hay cuenta de prueba ni clave. Antes de la primera corrida real leé "Antes de la primera corrida real" y "Lo que no se pudo verificar".

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
- Propiedades de perfil: `ts_seed_run`, `ts_seed_cohort`, `ts_seed_index`, `ts_seed_now`, `ts_seed_created_at` (antigüedad pretendida), `ts_seed_emails_received` (mails recibidos sembrados dentro de la ventana de 504 días), `ts_seed_expected` (decisión esperada con las reglas por defecto, por ejemplo `protected:recent_click`) y `ts_seed_expected_wide` (decisión esperada en el modo ampliado, por ejemplo `candidate:lapsed`).
- Eventos: métricas "Received Email", "Opened Email", "Clicked Email", "Placed Order", "Active on Site" y "Started Checkout", con `unique_id` determinista y propiedades `ts_seed_run` y `ts_seed_cohort`. Las aperturas llevan la propiedad booleana `Machine Open`.

### Mails recibidos

La regla nueva `minEmailsReceived` necesita saber cuántos mails recibió cada perfil en los últimos 504 días (`EMAILS_RECEIVED_WINDOW_DAYS`, las "72 semanas" de Klaviyo). El seed crea esa historia con eventos "Received Email", el nombre de la métrica nativa de Klaviyo para un mail entregado. Casi todos los perfiles reciben entre 5 y 9; las cohortes de historial de envíos reciben 0, de 1 a 4, o 6 anteriores a la ventana.

- Cada evento cae después de la creación pretendida del perfil y a más de una hora del borde de la ventana, para que el conteo no dependa de cómo redondee la app.
- Son eventos creados por API, así que quedan en una métrica "Received Email" de la integración **API**, distinta de la nativa (hallazgo 2). La app tiene que contar esa métrica en la cuenta de prueba.
- Son unos 19.000 eventos para 3.000 perfiles. El plan usa 22 requests de eventos (más 6 del resto), todos bajo 1.000 eventos y 5 MB.
- La ventana se mueve con la fecha de evaluación: evaluando semanas después de `ts_seed_now`, algunos mails salen de la ventana y perfiles con 5 quedan con menos.

### Modos de reglas

- **Por defecto**: `DEFAULT_RULE_SETTINGS` de core. Las cuatro ventanas de actividad valen `null` ("alguna vez"), antigüedad mínima 365 días, 5 mails recibidos, 365 días de bloqueo después de una restauración.
- **Ampliado**: `WIDE_RULE_SETTINGS`, exportado por este paquete. Es el modo opt-in en sus pisos (`RULE_LIMITS`): compra 365 días, clic, apertura y sitio 182, antigüedad 180, 5 mails recibidos, bloqueo 365.

### Cohortes

Porcentaje fijo de cada una. Las decisiones valen con cobertura de datos completa, evaluando **en el instante `ts_seed_now`** y con la antigüedad de `ts_seed_created_at`. Salvo aclaración, todos tienen 400 días o más y entre 5 y 9 mails recibidos.

| Cohorte | % | Por defecto | Modo ampliado |
| --- | --- | --- | --- |
| `never_engaged` (sin ninguna actividad) | 14,8 | candidato: `never_engaged` | igual |
| `opened_long_ago` (apertura humana hace 200 a 1.000 días) | 5 | protegido: `recent_open` | candidato: `lapsed` |
| `clicked_long_ago` (clic hace 200 a 1.000 días) | 5 | protegido: `recent_click` | candidato: `lapsed` |
| `purchased_long_ago` (compra hace 400 a 1.000 días) | 5 | protegido: `recent_purchase` | candidato: `lapsed` |
| `site_activity_long_ago` (sitio o checkout hace 200 a 1.000 días) | 4 | protegido: `recent_site_activity` | candidato: `lapsed` |
| `engaged_long_ago_mixed` (las cuatro cosas, todas viejas) | 4 | protegido: las cuatro razones | candidato: `lapsed` |
| `recent_purchaser` (compra hace 3 a 330 días) | 5 | protegido: `recent_purchase` | igual |
| `recent_clicker` (clic hace 3 a 170 días) | 4 | protegido: `recent_click` | igual |
| `recent_opener_human` | 4 | protegido: `recent_open` | igual |
| `recent_clicker_and_opener` | 3 | protegido: `recent_click` + `recent_open` | igual |
| `recent_site_activity` | 4 | protegido: `recent_site_activity` | igual |
| `machine_open_only_recent` (solo aperturas automáticas, la última hace 3 a 170 días) | 4 | protegido: `recent_open` | igual |
| `machine_open_only_long_ago` (solo una apertura automática vieja) | 3 | protegido: `recent_open` | candidato: `lapsed` |
| `machine_open_recent_human_open_long_ago` | 2 | protegido: `recent_open` | igual |
| `no_emails_received` (0 mails; sin ningún evento) | 4 | protegido: `not_enough_emails_received` | igual |
| `few_emails_received` (1 a 4 mails) | 3 | protegido: `not_enough_emails_received` | igual |
| `emails_received_before_window` (6 mails, todos de hace más de 504 días) | 2 | protegido: `not_enough_emails_received` | igual |
| `new_profile` (14 a 170 días) | 4 | protegido: `new_profile` | igual |
| `profile_180_to_364_days` (185 a 360 días) | 5 | protegido: `new_profile` | candidato: `never_engaged` |
| `sms_consented` | 4 | protegido: `sms_consent` | igual |
| `protected_group` | 3 | protegido: `protected_group` | igual |
| `restored` (suprimido y des-suprimido por el seed) | 1 | protegido: `recently_reactivated` | igual |
| `already_suppressed` | 4 | omitido: `already_suppressed` | igual |
| 16 cohortes de borde, 0,2 % cada una | 3,2 | ver abajo | ver abajo |

Con 3.000 perfiles: 456 candidatos por defecto y 1.428 en modo ampliado; 120 omitidos en los dos.

Core todavía llama `recently_reactivated` a la razón del bloqueo y `reactivatedAt` a la fecha: es la última des-supresión, hecha por quien sea. La app ya no reactiva a nadie por compra; lo único que des-suprime es deshacer una corrida.

Bordes. La ventana de core es `ahora - fecha < N días`: N-1 días queda adentro y exactamente N queda afuera.

| Par | Umbral | Por defecto | Modo ampliado |
| --- | --- | --- | --- |
| `boundary_created_364d` / `_365d` | antigüedad 365 (defecto) | protegido `new_profile` / candidato | candidato / candidato |
| `boundary_created_179d` / `_180d` | antigüedad 180 (ampliado) | protegido / protegido | protegido `new_profile` / candidato |
| `boundary_emails_received_4` / `_5` | 5 mails recibidos | protegido `not_enough_emails_received` / candidato | igual |
| `boundary_click_181d` / `_182d` | clic 182 | protegido / protegido | protegido `recent_click` / candidato `lapsed` |
| `boundary_open_181d` / `_182d` | apertura 182 | protegido / protegido | protegido `recent_open` / candidato `lapsed` |
| `boundary_machine_open_181d` / `_182d` | apertura automática 182 | protegido / protegido | protegido `recent_open` / candidato `lapsed` |
| `boundary_site_181d` / `_182d` | sitio 182 | protegido / protegido | protegido `recent_site_activity` / candidato `lapsed` |
| `boundary_purchase_364d` / `_365d` | compra 365 | protegido / protegido | protegido `recent_purchase` / candidato `lapsed` |

Con `countMachineOpens: false` cambian las cohortes de apertura automática: las que solo tienen aperturas automáticas pasan a candidato `lapsed` en los dos modos (core las cuenta como `lapsed` porque `lastOpenAt` existe); `machine_open_recent_human_open_long_ago` sigue protegida por defecto (la apertura humana vieja cuenta como "alguna vez") y es candidato `lapsed` en modo ampliado. `expectedIgnoringMachineOpens` lo declara para cada perfil.

No se pueden sembrar desde Klaviyo:

- **Borde del bloqueo por restauración (364 / 365 días).** La fecha de restauración es el momento en que corre el seed: el endpoint de des-supresión no acepta fecha, y un perfil des-suprimido no conserva ninguna marca (`subscriptions.email.marketing.suppression` queda vacío). Además esa fecha la tiene que guardar la app en su propio registro. El borde se prueba offline con `evaluateSeedProfile(perfil, dataset, { restoredAt })`; `test/generate.test.ts` lo hace.
- `unknown_send_history`: aparece cuando la app no pudo leer el historial de envíos, no por algo del perfil. Se simula con `{ emailsReceived: null }`.
- `no_email` (no lo intentamos), `unknown_profile_age` e `insufficient_*_history` (dependen de la cobertura de datos de la app). Con las reglas por defecto la cobertura tiene que llegar hasta la creación de cada perfil; si no, core protege.

### Para las pruebas

`src/index.ts` exporta lo necesario:

- `generateDataset(opciones)` y `expectedDecisions(dataset)`: por perfil, `expected.default` y `expected.wide` (y lo mismo en `expectedIgnoringMachineOpens`), declarados en el catálogo de cohortes.
- `WIDE_RULE_SETTINGS`, `RULE_SETTINGS_BY_MODE` y `RULE_MODES`.
- `toProfileSignals(perfil, dataset)`: las señales que la app debería derivar al leer el perfil, incluido `emailsReceived`. `countEmailsReceived(perfil, fecha)` da ese conteo solo.
- `evaluateSeedProfile(perfil, dataset, { at, settings, createdAt, restoredAt, emailsReceived })`: corre el motor real de reglas. Usalo cuando la expectativa declarada no aplica tal cual (otra fecha de evaluación, otros umbrales, o el `created` real de Klaviyo).

`test/generate.test.ts` pasa las señales generadas por `evaluateProfile` de `@tiersaver/core` con los dos juegos de reglas y exige que coincidan con lo declarado: si cambian las reglas o las cohortes sin actualizar la otra parte, el test falla.

Tres cosas que las pruebas de integración tienen que tener en cuenta:

1. **`created` no se puede antedatar** (hallazgo 1). Las pruebas tienen que leer la antigüedad de `ts_seed_created_at`. Con la regla de 365 días esto ya no es un detalle: sin eso no hay ningún candidato durante un año.
2. **El dataset envejece.** Todo es relativo a `ts_seed_now`. Un día después, los bordes "de adentro" ya salieron de su ventana, y con las semanas se corre la ventana de mails recibidos. Evaluá con `now = ts_seed_now` (el motor recibe `now` por parámetro) o recalculá con `evaluateSeedProfile(..., { at })`. Si no, volvé a sembrar con otro `--run-tag`.
3. **Las métricas sembradas son las de la integración API** (hallazgo 2), incluida "Received Email".

## Hallazgos que afectan a TierSaver

1. **La fecha de creación del perfil es siempre la del import.** La API no tiene campo para fijarla y la ayuda de Klaviyo dice que "Profile created" es la fecha en que Klaviyo creó el perfil; lo que se antedata con eventos históricos es "First active". Con las reglas nuevas pesa mucho más que antes: leyendo el `created` de Klaviyo, la app verá todos los perfiles sembrados como `new_profile` durante **365 días** con las reglas por defecto (180 en modo ampliado), y no habrá ningún candidato. `newProfileDays` tiene piso 180, así que no se desactiva por configuración. Esperar tampoco sirve: en un año los mails recibidos sembrados ya salieron casi todos de la ventana de 504 días. Las pruebas de integración reales tienen que tomar `createdAt` de `ts_seed_created_at`, con un hook solo de test. El test "predicts that every profile is protected as new" deja esto documentado en código, para los dos modos.
2. **Los eventos creados por API son métricas distintas de las nativas.** La doc de métricas dice que los eventos "collected or sent via the same mechanism (a given integration or our APIs)" comparten métrica, y que cada métrica tiene su `integration` (`Klaviyo`/`Internal`, `API`/`API`, `Shopify`/`eCommerce`). Un "Opened Email" sembrado queda en una métrica "Opened Email" de la integración **API**, con otro `id` que la nativa. Qué implica:
   - La app tiene que resolver métricas por nombre **e** integración, no solo por nombre. En producción usa las de `Klaviyo` (aperturas, clics) y las de la plataforma de e-commerce; contra la cuenta de prueba, las de `API`. Conviene que el mapeo de métricas sea configurable.
   - Las condiciones de segmento referencian `metric_id`. Un segmento "Opened Email 0 veces en N días" armado sobre la métrica nativa **no ve** los eventos sembrados. Para probar segmentos en la cuenta de prueba hay que usar los ids de las métricas API (`GET /api/metrics?filter=equals(integration.name,"API")`).
   - El filtro de segmento "Apple Privacy Open" de la interfaz aplica a la métrica nativa. En los eventos sembrados la marca es una propiedad común llamada `Machine Open`.
   - La única forma documentada de tener eventos nativos sin enviar mails es la herramienta de datos de muestra de Klaviyo (10 perfiles, 5 "Opened Email"; una sola vez por cuenta). Sirve para leer el nombre real de la propiedad de apertura automática.
   - "Received Email" sigue la misma regla: los mails recibidos sembrados quedan en la métrica de la integración API. En producción `emailsReceived` sale de la métrica nativa (`Klaviyo`); contra la cuenta de prueba, de la de `API`. El mapeo de métricas de la app (`shopify/app/klaviyo/config.ts`) todavía no tiene una entrada para mails recibidos.
   - Las recomendaciones de supresión de Klaviyo usan sus métricas nativas, así que en la cuenta sembrada no van a coincidir con los candidatos de TierSaver. No sirve como comparación.
3. **Klaviyo descarta en silencio los eventos de direcciones `@example.com`, `@test.com` "o similares"** (responde 202 igual). Por eso `example.com` es el default solo para el plan y `--execute` lo rechaza. Hace falta un dominio propio que no reciba correo, por ejemplo un subdominio sin registros MX (o con MX nulo, RFC 7505) de un dominio de Facundo. Elegirlo y crear ese DNS es decisión de Facundo. `--allow-reserved-domain` existe por si se quiere probar igual.
4. **Una cuenta de prueba es una cuenta normal en plan gratis**: 250 perfiles activos y 500 envíos. Sembrar 3.000 perfiles la deja 12 veces por encima. Según la ayuda, pasar el límite bloquea los envíos hasta bajar de 250 o pagar; no encontramos nada que diga que cobra o sube de plan sola desde el plan gratis, pero tampoco está dicho explícitamente (ver "Lo que no se pudo verificar"). Además `usage_max` de `billing-usage` será 250 en esa cuenta, lo que condiciona las pruebas de tramo.
5. **La fecha de restauración no se puede sembrar ni leer de Klaviyo.** Ver "No se pueden sembrar". La app tiene que registrar ella misma cuándo des-suprimió cada perfil; para una des-supresión hecha por otro (a mano en Klaviyo) no encontramos ninguna fecha en la API.

## Verificado contra la documentación (2026-11-25)

Fuente principal: spec OpenAPI oficial, `https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable.json` (`info.version` 2026-10-15), descargado completo en esta sesión. Las páginas de `developers.klaviyo.com` se leyeron en su versión Markdown (`<url>.md`).

Para el cambio de reglas se volvió a bajar el spec el mismo día y se releyó lo que toca a los mails recibidos y a los límites. Lo releído está marcado con (R) en la tabla.

| Dato | Valor | Fuente |
| --- | --- | --- |
| Revisión estable más nueva (R) | `2026-10-15`, header `revision` obligatorio en cada endpoint | spec; developers.klaviyo.com/en/reference/api_overview |
| Autenticación | `Authorization: Klaviyo-API-Key <clave>`; las claves privadas empiezan con `pk_` | spec (`securitySchemes`); developers.klaviyo.com/en/docs/authenticate_ |
| Tipo de contenido | `application/vnd.api+json` | spec |
| `GET /api/accounts` (R) | Devuelve 1 cuenta: `id`, `attributes.test_account`, `attributes.contact_information.organization_name`. 1/s, 15/min. Scope `accounts:read` | spec (`get_accounts`) |
| `POST /api/profile-bulk-import-jobs` (R) | Hasta 10.000 perfiles y 5 MB por request, 100 KB por perfil. 10/s, 150/min. Upsert. Un perfil inválido da 400 y no crea el job. Responde 202 con el `id` del job. Scopes `profiles:write`, `lists:write` | spec (`bulk_import_profiles`); developers.klaviyo.com/en/docs/use_klaviyos_bulk_profile_import_api |
| Estado del job de import | `GET /api/profile-bulk-import-jobs/{job_id}`: `status` (`queued`, `processing`, `complete`, `cancelled`), `total_count`, `completed_count`, `failed_count`. Errores en `.../{id}/import-errors`. Los jobs vencen a los 7 días. Scopes `profiles:read`, `lists:read` | spec; guía de bulk import |
| El import no cambia consentimiento; puede agregar a una lista con `relationships.lists` | | guía de bulk import |
| `POST /api/event-bulk-create-jobs` (R) | Hasta 1.000 eventos y 5 MB por request. 10/s, 150/min. Responde 202 sin cuerpo: no hay job que consultar. Scope `events:write` | spec (`bulk_create_events`); developers.klaviyo.com/en/reference/events |
| `POST /api/events` | Un evento por request. 350/s, 3.500/min. No lo usamos | spec (`create_event`) |
| `time` antedatado (R) | Aceptado. Entre 1990 y "ahora" + 1 año. Se trunca al segundo | spec; tabla "Limitations" de developers.klaviyo.com/en/reference/events |
| `backfill: true` | El evento se registra y sirve para segmentar, pero no dispara flows. En bulk va en cada entrada `event-bulk-create` | developers.klaviyo.com/en/reference/events |
| Idempotencia de eventos | Dedup por (perfil, métrica, `unique_id`); el duplicado se descarta en silencio. Un `unique_id` repetido dentro del mismo request bulk da 400 | developers.klaviyo.com/en/reference/events |
| Eventos de `@example.com` / `@test.com` (R) | Descartados en silencio (202) | developers.klaviyo.com/en/reference/events, secciones "Create Event" y "Troubleshooting" |
| Métricas de API vs nativas (R) | Métrica separada por integración | developers.klaviyo.com/en/reference/metrics |
| `POST /api/profile-subscription-bulk-create-jobs` | Hasta 1.000 perfiles. 75/s, 750/min. Con `historical_import: true` saltea el doble opt-in y exige `consented_at` en el pasado. Quita supresiones `UNSUBSCRIBE`, `SPAM_REPORT` y `USER_SUPPRESSED` de los perfiles enviados. Responde 202 sin cuerpo. Scopes `lists:write`, `profiles:write`, `subscriptions:write` | spec (`bulk_subscribe_profiles`); developers.klaviyo.com/en/docs/collect_email_and_sms_consent_via_api |
| Header `X-Klaviyo-Partial-Failure: phone_number` | Indica que el teléfono fue ignorado | guía de consentimiento |
| `POST /api/profile-suppression-bulk-create-jobs` (R) | 100 mails por request. 75/s, 750/min. Responde 202 con job; `GET .../{job_id}` da `status`, `total_count`, `completed_count`, `skipped_count` | spec (`bulk_suppress_profiles`) |
| `POST /api/profile-suppression-bulk-delete-jobs` (R) | Mismo formato y límites | spec (`bulk_unsuppress_profiles`) |
| Rate limits | Ventana fija: 1 s (ráfaga) y 1 min (sostenido), por cuenta. En un 429 viene `Retry-After` en segundos | developers.klaviyo.com/en/docs/rate_limits_and_error_handling |
| `POST /api/data-privacy-deletion-jobs` | Un perfil por request (mail, teléfono o id). 3/s, 60/min. Scope `data-privacy:write` | spec (`request_profile_deletion`) |
| Fecha de creación del perfil | No hay campo en la API; es la fecha en que Klaviyo creó el perfil | spec; help.klaviyo.com/hc/en-us/articles/115005247028 |
| Cuenta de prueba | Cuenta normal con etiqueta; plan gratis y facturación igual que cualquiera | developers.klaviyo.com/en/docs/create_a_test_account |
| Plan gratis | 250 perfiles activos, 500 envíos; pasarse bloquea envíos | help.klaviyo.com/hc/en-us/articles/360050759151 |
| Marca de apertura automática | Los "Opened Email" nativos tienen la propiedad "Apple Privacy Open" (verdadero/falso) desde el 20/11/2021 | help.klaviyo.com/hc/en-us/articles/4416791883163 |
| Métrica de mails entregados (R) | Se llama `Received Email`: "To get the total number of emails received [...] adding the `Received Email` metric ID" | developers.klaviyo.com/en/docs/using_the_query_metric_aggregates_endpoint; la ayuda la nombra igual: help.klaviyo.com/hc/en-us/articles/115005076787 |
| Criterios de las recomendaciones de supresión (R) | Puede recibir marketing por mail y sin supresión agregada en los últimos 90 días; creado hace 365 días o más; 5 o más mails recibidos en "roughly the last 72 weeks"; nunca abrió ni hizo clic; sin visitas, vistas de producto, checkouts ni compras. Con clics o compras queda excluido "even if that activity was more than 6 months ago" | help.klaviyo.com/hc/en-us/articles/24312135764251 |
| Piso del diálogo de supresión en bloque (R) | Mantiene activos a quienes hicieron clic o compraron "within the last 182 days (about 6 months)" | mismo artículo |
| Tabla de integraciones de métricas (R) | `Klaviyo`/`Internal`, `API`/`API`, `Shopify`/`eCommerce`; el filtro distingue mayúsculas | developers.klaviyo.com/en/reference/metrics_api_overview |
| Límites de un evento (R) | 400 propiedades, strings de 100 KB, `unique_id` de 1 a 255 caracteres, 5 MB de payload | developers.klaviyo.com/en/reference/events_api_overview, "Limitations" |
| Des-supresión (R) | Solo quita supresiones `USER_SUPPRESSED`; el body lleva mails o un id de lista o segmento, sin fecha. Scope `subscriptions:write` | spec (`bulk_unsuppress_profiles`) |
| Supresión en el perfil (R) | `subscriptions.email.marketing.suppression[]` con `reason` y `timestamp` de la supresión. No hay campo para la fecha en que se quitó | spec (`EmailMarketing`, `EmailMarketingSuppression`) |
| Scopes de lectura (R) | `GET /api/events`: `events:read`. `GET /api/profiles`: `profiles:read`. Jobs de import: `lists:read`, `profiles:read`. Jobs de supresión: `subscriptions:read`. `GET /api/metrics`: `metrics:read`. `GET /api/billing-usage/{id}`: `usage:read` | spec |

Cómo usa esto el cliente: un token bucket por endpoint con la **mitad** del límite publicado de capacidad y de recarga (con ventana fija, un bucket lleno más su recarga podría duplicar el límite); espera `Retry-After` en 429; backoff exponencial con jitter en 5xx y errores de red, hasta 6 intentos; cualquier otro 4xx corta sin reintentar. Los lotes paran en 4,5 MB para dejar margen bajo los 5 MB.

## Lo que no se pudo verificar

Sin cuenta ni clave, nada de esto se probó contra la API real.

1. **Qué dominios caen en "o similares"** del descarte de eventos, y si el import de perfiles acepta esos dominios. Después de sembrar, corré `--verify`: compara lo guardado con lo enviado para un perfil por cohorte.
2. **Consentimiento SMS**: si Klaviyo acepta números `555-01XX`, y si la cuenta necesita SMS configurado (número emisor, país) para registrar el consentimiento. Tampoco está confirmado que `historical_import` evite todo mensaje por SMS, aunque los números no son ruteables. Por eso es el último paso y su rechazo no aborta la corrida: queda como advertencia y se reintenta en la próxima. `--skip-sms` lo saltea.
3. **Nombre real de la propiedad de apertura automática en el payload del evento.** La ayuda la llama "Apple Privacy Open"; `docs/STATUS.md` dice "Machine Open". Usamos `Machine Open` (constante `MACHINE_OPEN_PROPERTY`). Hay que leerlo de un evento nativo en la cuenta de prueba.
4. **Costo de pasar los 250 perfiles en plan gratis.** Lo leído indica solo bloqueo de envíos. Confirmarlo en Billing de la cuenta de prueba antes de sembrar, y confirmar que no haya auto-upgrade activado: es una acción que podría gastar dinero.
5. **Re-supresión dentro de los 90 días** (duda 7 de `STATUS.md`): la cohorte `restored` deja perfiles listos para probarlo; el resultado esperado (`skipped_count`) es una suposición.
6. **Tiempos de procesamiento** de los jobs y de los eventos. La duración del plan es una estimación.
7. Si el valor booleano `false` en una propiedad de evento se guarda (la doc dice que `0`, `null` y `""` se ignoran; no menciona `false`).
8. El límite de 200 métricas por cuenta figura en la doc de SFTP; no afecta (creamos 5).
9. **Qué cuenta la métrica nativa "Received Email".** No encontramos una definición escrita: si incluye mails transaccionales, si excluye rebotes, ni qué propiedades trae el evento. Core define `emailsReceived` como mails de marketing; cómo separarlos queda por resolver con un evento nativo a la vista.
10. **Que Klaviyo acepte por API un evento con el nombre "Received Email".** La doc no reserva nombres de métricas nativas y ya contábamos con eso para "Opened Email", pero no se probó. `--verify` lo delata: compara eventos guardados contra enviados.
11. **Cómo cuenta Klaviyo "roughly the last 72 weeks"**: el borde exacto de la ventana no está publicado. Usamos 504 días, como core, y ningún mail sembrado cae a menos de una hora de ese borde.
12. **Tiempo de proceso de unos 21.500 eventos** en 22 requests. Están dentro de los límites publicados (1.000 por request, 150 requests por minuto), pero cuánto tarda Klaviyo en dejarlos visibles no está documentado.
13. Si `GET /api/events` filtra por `metric_id` una métrica creada por API. El spec dice que las "Custom metrics" no se pueden usar en ese filtro; entendemos que habla de las métricas compuestas de la Custom Metrics API y no de las creadas con eventos, pero hay que probarlo.

## Diferencias con nuestros documentos

- `docs/STATUS.md` (duda 6) nombra la propiedad "Machine Open" y dice que en la interfaz se llama "Apple Privacy Open". La ayuda vigente solo la llama "Apple Privacy Open" (punto 3 de arriba). No es contradicción firme, pero el nombre de la clave sigue sin confirmar.
- `docs/STATUS.md` y `docs/02-ARQUITECTURA.md` dicen 75/s y 750/min para supresión: coincide con el spec. La guía general de rate limits de Klaviyo dice 700/min para el nivel "L"; el spec y la referencia del endpoint dicen 750. Inconsistencia de Klaviyo, sin efecto para nosotros (vamos a la mitad).
- `docs/02-ARQUITECTURA.md` prevé "perfiles sembrados que cubran cada regla" para las pruebas de integración. Con los hallazgos 1 y 2 eso no alcanza por sí solo: la regla de perfil nuevo tapa todo durante 365 días y las métricas sembradas no son las nativas. No contradice una decisión, pero cambia cómo hay que escribir esas pruebas.
- `docs/12-CUMPLIMIENTO-KLAVIYO.md` 3.1 pide para el modo ampliado "nunca por debajo de 182 días para clic y compra". `RULE_LIMITS` es más estricto con la compra (365) y aplica 182 también a apertura y sitio. El seed sigue a core.
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
3. Crear una clave privada. Las claves no se pueden editar después de creadas, así que conviene decidir los scopes de entrada:
   - Para sembrar: `accounts:read`, `profiles:write`, `lists:write`, `events:write`, `subscriptions:write`, más `profiles:read`, `lists:read` y `subscriptions:read` para consultar los jobs.
   - Para `--verify`: `profiles:read` y `events:read`.
   - Opcionales, para las pruebas de la app con la misma clave: `usage:read` (uso de facturación) y `metrics:read` (resolver los ids de las métricas sembradas).
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
