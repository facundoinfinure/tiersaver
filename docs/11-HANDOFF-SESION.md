# Handoff entre sesiones · 2026-11-25

Para la sesión que sigue. Leé también `CLAUDE.md`, `docs/00-HANDOVER.md` (decisiones vigentes) y `docs/STATUS.md` (bitácora y dudas resueltas).

## Dónde está el trabajo

- Rama: `claude/gallant-knuth-51pv2e` (todo empujado). La sesión solo puede empujar ahí.
- Entorno de Claude Code: **"tiersaver"** (red con Klaviyo, Shopify, Cloudflare; variable `CLOUDFLARE_API_TOKEN`).
- Fase 0 en curso. Fases 1 a 5 sin empezar.

## Decisiones tomadas el 2026-11-25 (ya aplicadas en los docs)

| Tema | Decisión |
| --- | --- |
| Posicionamiento | Higiene de lista automática; el ahorro es resultado (por la AUP de Klaviyo) |
| Cobro | 20% del ahorro **verificado** con `usage_max` de `GET /api/billing-usage` de Klaviyo tras la renovación; tope US$ 149 con Billing API (`cappedAmount`); onboarding pide activar auto-downgrade |
| Datos de compras | Pedidos de Shopify (`read_orders` + `read_all_orders` con aprobación + email nivel 2) guardando solo SHA-256 del mail, cruzados con "Placed Order" de Klaviyo |
| Stack | Cloudflare: Workers + D1 (Drizzle) + Workflows + Cron + Email Service. Reemplaza Vercel + Supabase |
| Conexión a Klaviyo | OAuth (funciona sin estar listada en el marketplace) |
| Precios de Klaviyo | Tabla oficial leída del slider de klaviyo.com/pricing (49 tramos, planes Email y Marketing) en `packages/core/src/price-tables/klaviyo.ts` |

## Qué hay en el repo

- `packages/core/`: lógica pura con 73 tests (`npm test`): tramos, ahorro estimado y verificado, cargo con tope y 1 por ciclo, reglas de protección conservadoras, compuerta de simulación (aprobada y < 24 h), programación por fecha de facturación, lotes y rate limit, hash de mails, cifrado AES-GCM de tokens.
- `shopify/`: plantilla oficial React Router adaptada a Workers. Sesiones en D1 con tokens cifrados (`app/session-storage.server.ts`), webhooks de cumplimiento (`app/routes/webhooks.compliance.tsx`), migración `drizzle/0000_session.sql`, smoke test `scripts/smoke-worker.mjs` (8 chequeos; pasan en `workerd` local).
- `shopify/wrangler.jsonc`: `account_id` fijado a la cuenta **TierSaver**, D1 `tiersaver` (id real), `SHOPIFY_APP_URL = https://tiersaver-app.tiersaver.workers.dev`.

## Cloudflare: estado

- Cuenta TierSaver: D1 `tiersaver` creada (ENAM) con migración aplicada; subdominio `tiersaver.workers.dev` creado; zona `tiersaver.com` agregada en estado *pending*.
- `tiersaver.com` sigue registrado en la cuenta de Infinure (registrado el 2026-11-25 05:17 UTC). El move entre cuentas se puede pedir desde el **2026-12-05**; lo hace Facundo en el dashboard (pasos en `10-TAREAS-HUMANAS.md`, tarea 5). Hay un recordatorio programado para ese día, pero llega a la sesión anterior, no a esta.
- El token ve las tres cuentas de Facundo (Alupont, Infinure, TierSaver). Usá siempre el `account_id` de TierSaver; nunca toques las otras.

## Próximo paso: primer deploy

1. Verificar el token sin imprimirlo: que `CLOUDFLARE_API_TOKEN` tenga ~40 caracteres y empiece con `cfut_`, y `npx wrangler whoami` desde `shopify/`. En la sesión anterior la variable llegaba con 1 carácter; si pasa de nuevo, avisar a Facundo.
2. `npm ci` en la raíz (`.npmrc` ya tiene `legacy-peer-deps=true`; `package.json` fuerza un solo `vite@7`).
3. Secretos del Worker con `wrangler secret bulk` leyendo de stdin, sin mostrar valores:
   - `TOKEN_ENCRYPTION_KEY`: 32 bytes aleatorios en base64, generados en el momento. No guardarlo en ningún archivo.
   - `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET`: todavía no existen (falta la cuenta de Shopify). Cargar valores provisorios para que la app arranque y reemplazarlos cuando Facundo cree la app.
4. `npm run deploy:worker -w @tiersaver/shopify`.
5. Pedir con `update_environment` el host exacto `tiersaver-app.tiersaver.workers.dev` y correr `node shopify/scripts/smoke-worker.mjs https://tiersaver-app.tiersaver.workers.dev <secret provisorio>`.
6. Si aparecen errores de CPU (1102) en el plan Workers Free, frenar: el plan pago cuesta US$ 5/mes y requiere aprobación de Facundo.
7. Actualizar `docs/STATUS.md`, commit y push.

## Después del deploy (Fase 0 restante y Fase 3 temprana)

- Esquema completo de D1: shops, klaviyo_connections, settings, audits, simulations, runs, run_profiles, purchase_hashes, usage_charges, events_log.
- `scripts/seed-klaviyo`: 2.000 a 5.000 perfiles ficticios de actividad variada para la cuenta de Klaviyo de prueba (cuando exista).
- Esqueleto de Workflow para las corridas de supresión (lote de hasta 100 mails por paso, reanudable, sin duplicar).
- Fase 2 (marca) se puede avanzar en paralelo: tres opciones de logo para Facundo.

## Pendiente de Facundo

1. Cuenta de Shopify Partner/Dev Dashboard y tienda de desarrollo. La app usa como URL `https://tiersaver-app.tiersaver.workers.dev` (después tiersaver.com).
2. Cuenta de Klaviyo de prueba y su clave privada como variable `KLAVIYO_TEST_PRIVATE_KEY` del entorno "tiersaver".
3. Consulta al abogado sobre la AUP de Klaviyo (tarea 12, adelantada).
4. Move del dominio desde el 2026-12-05.
5. Restringir el token de Cloudflare a la cuenta TierSaver y rotarlo (se vio parcialmente en una captura).

## Cosas a saber del entorno

- No subas `.env`, `.dev.vars` ni secretos. Nunca imprimas tokens.
- Si un token se carga como *network secret* de `api.cloudflare.com`, el proxy pisa el header `Authorization` y rompe la subida de assets de wrangler (401). Por eso va como variable de entorno.
- Las variables de entorno nuevas solo llegan a sesiones que arrancan después de guardarlas.
- `vite preview` en local intenta bajar el objeto `Request.cf` y el proxy lo bloquea: es inofensivo.
- El plugin oficial de Cloudflare para Claude Code se instaló en la sesión anterior, pero solo vivía en ese contenedor y su MCP necesita OAuth por navegador, que no funciona en la nube.
