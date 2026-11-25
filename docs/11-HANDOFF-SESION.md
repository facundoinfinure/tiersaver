# Handoff entre sesiones · 2026-11-25 (cuarta sesión)

Para la sesión que sigue. Leé también `CLAUDE.md`, `docs/00-HANDOVER.md` (decisiones vigentes) y `docs/STATUS.md` (bitácora; la entrada "tercera sesión" tiene el detalle de todo lo de abajo).

## Dónde está el trabajo

- Rama: `claude/hopeful-mayer-5ubt01` (todo empujado; parte de `main` con la tercera sesión ya mergeada). Cada sesión solo puede empujar a su propia rama.
- Entorno de Claude Code: **"tiersaver"**. Variables: `CLOUDFLARE_API_TOKEN`, `SHOPIFY_API_SECRET`, `SHOPIFY_SERVICE_ACCOUNT_TOKEN`, `KLAVIYO_TEST_PRIVATE_KEY` (con `metrics:read`, `segments:read`, `segments:write`), `KLAVIYO_CLIENT_ID`, `KLAVIYO_CLIENT_SECRET`. Red: se agregaron `destinations.shopifysvc.com` y `app.shopify.com` (los usa el CLI de Shopify).
- Fase 0: cerrada (app instalada en `tiersaver.myshopify.com` el 2026-11-25). Fase 2: cerrada. Fase 3: en curso. Fase 4: sitio construido, sin publicar, **sin scripts de build en el repo**. Fases 1 y 5 sin empezar.

## Qué hay desplegado

- Worker `tiersaver-app`: https://tiersaver-app.tiersaver.workers.dev, con `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET` **reales**. Smoke 8 de 8.
- Configuración de Shopify publicada: versión `tiersaver-for-klaviyo-2`. La suscripción a `orders/create` está comentada en `shopify.app.toml` hasta que la app tenga acceso a datos protegidos de clientes.
- D1 `tiersaver` con migraciones `0000` a `0005`. Cron Trigger horario (`17 * * * *`): programación mensual y reintento de cargos.
- Workflows `tiersaver-suppression-run`, `tiersaver-orders-backfill` y `tiersaver-scan`.
- `SUPPRESSION_ENABLED` no está definido: ninguna corrida puede suprimir. Se encendió (con candado `SUPPRESSION_ALLOWED_ACCOUNT_ID=SGKvLG`) solo para la limpieza real autorizada del 2026-11-25 y se borró al terminar. Solo Facundo lo enciende.
- Secretos `KLAVIYO_CLIENT_ID` y `KLAVIYO_CLIENT_SECRET` cargados (Klaviyo los acepta). La app muestra "Connect Klaviyo". Al cierre de este handoff la tienda todavía no había conectado.
- Segmento administrado creado en SGKvLG por la verificación: `WRvyjd` (984 miembros, correcto).
- Variable `KLAVIYO_SEEDED_ACCOUNT_ID = SGKvLG` (modo cuenta sembrada; ver `STATUS.md`).

## Cuenta de Klaviyo de prueba (SGKvLG)

- Sembrada y verificada: 3.000 perfiles, 21.526 eventos, `--verify` 39 de 39. El estado del seed (`scripts/seed-klaviyo/.state/`) no se guarda en git: para `--verify` desde otra sesión hay que volver a correr `--execute` con los mismos argumentos (es idempotente) o confiar en el resultado anotado.
- La cohorte `sms_consented` quedó sin consentimiento SMS (la cuenta no tiene número emisor).
- Hay un perfil extra de diagnóstico, `ts-probe-1@seed.tiersaver.com`, con dos eventos "TS Probe". No molesta a ninguna regla.
- Esperado en la auditoría real: 984 miembros del segmento y **696 candidatos** sin grupo protegido configurado (606 con la lista protegida del seed). Detalle en `STATUS.md`, cuarta sesión.

## Comandos

- `npm ci && npm test && npm run typecheck` en la raíz. (`npm test` falla hoy solo por `site/test/site.test.ts`, que necesita los scripts de build perdidos.)
- Deploy del Worker: `npm run deploy:worker -w @tiersaver/shopify`. Migraciones: `npx wrangler d1 migrations apply DB --remote` desde `shopify/`.
- Deploy de la configuración de Shopify, desde `shopify/`:
  `NODE_USE_ENV_PROXY=1 SHOPIFY_HTTP_PROXY="$HTTPS_PROXY" SHOPIFY_HTTPS_PROXY="$HTTPS_PROXY" npx shopify app deploy --allow-updates`
- Smoke: `NODE_USE_ENV_PROXY=1 node shopify/scripts/smoke-worker.mjs https://tiersaver-app.tiersaver.workers.dev "$SHOPIFY_API_SECRET"`.
- Capa de Klaviyo contra la cuenta de prueba, desde `shopify/` (solo lectura; `--write-segment` crea o actualiza el segmento administrado):
  `NODE_USE_ENV_PROXY=1 node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-ts.mjs scripts/klaviyo-live-check.ts --account-id SGKvLG`

## Próximos pasos

0. Hecho en la cuarta sesión: limpieza real de punta a punta sobre SGKvLG con el código de la app y la clave privada (`test/live-klaviyo.test.ts` + `scripts/klaviyo-relay.mjs`): 984 / 696, 7 jobs, deshacer, cuenta restaurada. El primer "Connect Klaviyo" real falló (Shopify cancela la primera carga del paso final) y está corregido; **falta que Facundo reintente**. La sesión no puede usar el navegador de Facundo.
1. **Cuando Facundo conecte Klaviyo desde la tienda**: revisar `klaviyo_connections` y `events_log` en la D1, correr "Run the free audit" y comparar con lo esperado (984 / 696). Mirar si `/app/klaviyo/finish` abrió dentro del admin y si el refresh rota el refresh token (comparar `refresh_token_enc` antes y después de un refresh; el access token dura ~1 h).
2. **Recorrer las pantallas nuevas dentro del admin** (nadie las vio todavía): "Review cleanup" (descarga del CSV, aprobación), "History", detalle de corrida, "Settings". Con `SUPPRESSION_ENABLED` ausente el botón de arranque queda deshabilitado.
3. **Con autorización expresa de Facundo y solo sobre SGKvLG**: encender `SUPPRESSION_ENABLED`, correr una limpieza real, consultar jobs, deshacer y volver a apagar.
4. **Cobro contra Shopify real**: aceptar la suscripción de prueba en la tienda de desarrollo y ver el usage record. Puede depender de la distribución pública (A4).
5. **Lo que falta de la Fase 3**: mails (simulación programada lista, resultado de corrida), detector de ciclos (guardarraíl 6), reporte mensual, decidir si se muestra la estimación de plan de Klaviyo.
6. Reactivar `orders/create` en `shopify.app.toml` cuando la app tenga acceso a datos protegidos, y redesplegar la configuración.
7. Sitio: reconstruir los scripts de build (tarea aparte), completar placeholders y publicar cuando el dominio esté en la cuenta TierSaver (después del 2026-12-05). Publicar es un freno.

## Pendiente de Facundo

1. (Hecho) Instalar la app en `tiersaver.myshopify.com`.
2. (Hecho) Clave privada nueva de Klaviyo y app OAuth de Klaviyo.
3. Apretar "Connect Klaviyo" en `tiersaver.myshopify.com` y avisar.
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
