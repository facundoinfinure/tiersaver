# Handoff entre sesiones · 2026-11-25 (tercera sesión, cierre)

Para la sesión que sigue. Leé también `CLAUDE.md`, `docs/00-HANDOVER.md` (decisiones vigentes) y `docs/STATUS.md` (bitácora; la entrada "tercera sesión" tiene el detalle de todo lo de abajo).

## Dónde está el trabajo

- Rama: `claude/lucid-brahmagupta-ss214o` (todo empujado; parte de `main`). Cada sesión solo puede empujar a su propia rama.
- Entorno de Claude Code: **"tiersaver"**. Variables: `CLOUDFLARE_API_TOKEN`, `SHOPIFY_API_SECRET`, `SHOPIFY_SERVICE_ACCOUNT_TOKEN`, `KLAVIYO_TEST_PRIVATE_KEY`. Red: se agregaron `destinations.shopifysvc.com` y `app.shopify.com` (los usa el CLI de Shopify).
- Fase 0: lista salvo la instalación en la tienda, que hace Facundo. Fase 2: cerrada. Fase 3: en curso. Fase 4: sitio construido, sin publicar, **sin scripts de build en el repo**. Fases 1 y 5 sin empezar.

## Qué hay desplegado

- Worker `tiersaver-app`: https://tiersaver-app.tiersaver.workers.dev, con `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET` **reales**. Smoke 8 de 8.
- Configuración de Shopify publicada: versión `tiersaver-for-klaviyo-2`. La suscripción a `orders/create` está comentada en `shopify.app.toml` hasta que la app tenga acceso a datos protegidos de clientes.
- D1 `tiersaver` con migraciones `0000` a `0003`.
- Workflows `tiersaver-suppression-run`, `tiersaver-orders-backfill` y `tiersaver-scan`.
- `SUPPRESSION_ENABLED` no está definido: ninguna corrida puede suprimir. Solo Facundo lo enciende.
- Faltan los secretos `KLAVIYO_CLIENT_ID` y `KLAVIYO_CLIENT_SECRET` (no existe la app OAuth de Klaviyo): la app muestra "Connecting to Klaviyo is not available yet".
- Variable `KLAVIYO_SEEDED_ACCOUNT_ID = SGKvLG` (modo cuenta sembrada; ver `STATUS.md`).

## Cuenta de Klaviyo de prueba (SGKvLG)

- Sembrada y verificada: 3.000 perfiles, 21.526 eventos, `--verify` 39 de 39. El estado del seed (`scripts/seed-klaviyo/.state/`) no se guarda en git: para `--verify` desde otra sesión hay que volver a correr `--execute` con los mismos argumentos (es idempotente) o confiar en el resultado anotado.
- La cohorte `sms_consented` quedó sin consentimiento SMS (la cuenta no tiene número emisor).
- Hay un perfil extra de diagnóstico, `ts-probe-1@seed.tiersaver.com`, con dos eventos "TS Probe". No molesta a ninguna regla.
- La clave actual **no tiene** `metrics:read`, `segments:read` ni `segments:write`.

## Comandos

- `npm ci && npm test && npm run typecheck` en la raíz. (`npm test` falla hoy solo por `site/test/site.test.ts`, que necesita los scripts de build perdidos.)
- Deploy del Worker: `npm run deploy:worker -w @tiersaver/shopify`. Migraciones: `npx wrangler d1 migrations apply DB --remote` desde `shopify/`.
- Deploy de la configuración de Shopify, desde `shopify/`:
  `NODE_USE_ENV_PROXY=1 SHOPIFY_HTTP_PROXY="$HTTPS_PROXY" SHOPIFY_HTTPS_PROXY="$HTTPS_PROXY" npx shopify app deploy --allow-updates`
- Smoke: `NODE_USE_ENV_PROXY=1 node shopify/scripts/smoke-worker.mjs https://tiersaver-app.tiersaver.workers.dev "$SHOPIFY_API_SECRET"`.
- Capa de Klaviyo contra la cuenta de prueba, desde `shopify/` (solo lectura; `--write-segment` crea o actualiza el segmento administrado):
  `NODE_USE_ENV_PROXY=1 node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-ts.mjs scripts/klaviyo-live-check.ts --account-id SGKvLG`

## Próximos pasos

1. **Con la clave nueva de Klaviyo** (scopes de `13-INSTRUCTIVO-CUENTAS.md` B2): correr `klaviyo-live-check.ts --write-segment`. Verifica nombres e integraciones de las métricas, el cuerpo de creación del segmento, que la definición que devuelve Klaviyo coincide con la enviada (`canonicalDefinition`) y cuántos miembros da. Esperado con las reglas por defecto y las métricas API: unos 456 candidatos más los 120 de `sms_consented`, menos lo que Klaviyo trate distinto. Corregir `app/klaviyo/api.ts` y el Klaviyo falso donde difieran, y anotar en `STATUS.md`.
2. **Con la app OAuth de Klaviyo** (B5): cargar `KLAVIYO_CLIENT_ID` / `KLAVIYO_CLIENT_SECRET` en el Worker (`wrangler secret bulk` por stdin), conectar desde la tienda de desarrollo y correr la auditoría real de punta a punta contra SGKvLG. Mirar: si la URL `admin.shopify.com/store/<tienda>/apps/<client id>/app/klaviyo/finish` abre la app embebida con los parámetros, y si el refresh rota el refresh token.
3. **Fase 3, lo que falta, en orden**: pantalla de simulación (motivos, CSV de candidatos para revisar antes de aprobar, avisos de `12-CUMPLIMIENTO-KLAVIYO.md` 4.1, aprobación), arranque de la corrida desde la interfaz (`startSuppressionRun` ya existe), consulta de jobs de Klaviyo, creación de corridas de deshacer con el aviso del guardarraíl 5, edición de reglas y grupos protegidos (los ids se guardan como `list:<id>` o `segment:<id>`), programación mensual con Cron Trigger, cobro en Shopify, mails, detector de ciclos (guardarraíl 6).
4. Reactivar `orders/create` en `shopify.app.toml` cuando la app tenga acceso a datos protegidos, y redesplegar la configuración.
5. Sitio: reconstruir los scripts de build (tarea sugerida), completar placeholders y publicar cuando el dominio esté en la cuenta TierSaver (después del 2026-12-05). Publicar es un freno.

## Pendiente de Facundo

1. Instalar la app en `tiersaver.myshopify.com` (Dev Dashboard → app → Home → Installs → Install app).
2. Crear otra clave privada en la cuenta de Klaviyo de prueba con los scopes de B2 (suma `metrics:read`, `segments:read`, `segments:write`) y reemplazar `KLAVIYO_TEST_PRIVATE_KEY`.
3. Crear la app OAuth de Klaviyo (B5) y cargar `KLAVIYO_CLIENT_ID` y `KLAVIYO_CLIENT_SECRET` en el entorno.
4. Decidir y pedir en Shopify (A4): distribución pública (no se puede cambiar después), datos protegidos de clientes (solo Email) y `read_all_orders`.
5. Decidir hasta dónde lee la app el historial de pedidos (ver "Abierto" en `STATUS.md`): hoy 1.095 días, y la regla "nunca compró" deja protegidos a los perfiles más viejos que eso.
6. De antes: versión corta del nombre, contacto con Klaviyo (tareas 17 a 20), datos legales del sitio, mover el dominio desde el 2026-12-05, restringir y rotar el token de Cloudflare.

## Cosas a saber del entorno

- No subas `.env`, `.dev.vars` ni secretos. Nunca imprimas tokens ni partes de ellos (el clasificador de la sesión bloquea hasta los prefijos).
- El token de Cloudflare ve tres cuentas; usá siempre el `account_id` de TierSaver (fijado en `wrangler.jsonc`).
- El `fetch` de Node no usa el proxy sin `NODE_USE_ENV_PROXY=1`; el CLI de Shopify además necesita `SHOPIFY_HTTP_PROXY` / `SHOPIFY_HTTPS_PROXY`.
- Klaviyo tarda hasta 30 minutos en mostrar eventos con fecha antigua; `last_event_date` del perfil no se actualiza con eventos creados por API.
- La clave privada de Klaviyo usa `Authorization: Klaviyo-API-Key`; el cliente de la app manda `Bearer` (OAuth). `klaviyo-live-check.ts` hace el cambio de esquema.
- D1 admite 100 parámetros por consulta, y los números enlazados llegan como REAL: usar `CAST(? AS INTEGER)` en divisiones enteras.
- `drizzle` no acepta `db.run(sql)` dentro de `db.batch` en D1: usar el query builder (por ejemplo `insert().select()`) o `db.$client.batch`.
- La regla `build/` del `.gitignore` raíz ignora cualquier carpeta `build/`, también `site/build/` (así se perdieron los scripts del sitio).
- `npm run lint -w @tiersaver/shopify` está roto desde el scaffold (busca `shopify/.gitignore`).
- El recordatorio del 2026-12-05 para mover el dominio vive en la primera sesión, no en esta.
