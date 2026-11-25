# Handoff entre sesiones · 2026-11-25 (segunda sesión)

Para la sesión que sigue. Leé también `CLAUDE.md`, `docs/00-HANDOVER.md` (decisiones vigentes) y `docs/STATUS.md` (bitácora, dudas resueltas y hallazgos).

## Dónde está el trabajo

- Rama: `claude/practical-brown-zm2uss` (todo empujado). Incluye lo de `claude/gallant-knuth-51pv2e`. Cada sesión solo puede empujar a su propia rama.
- Entorno de Claude Code: **"tiersaver"** (red con Klaviyo, Shopify, Cloudflare y `tiersaver-app.tiersaver.workers.dev`; variable `CLOUDFLARE_API_TOKEN`).
- Fase 0: desplegada; faltan la instalación en la tienda de desarrollo y el seed real (dependen de cuentas de Facundo). Fase 2: borrador a la espera de decisiones. Fases 1, 3, 4 y 5 sin empezar.

## Qué hay desplegado

- Worker `tiersaver-app` en la cuenta TierSaver: https://tiersaver-app.tiersaver.workers.dev (plan Workers Free; alcanzó, sin errores de CPU).
- D1 `tiersaver` con migraciones `0000_session` y `0001_domain`.
- Workflow `tiersaver-suppression-run`.
- Secretos: `TOKEN_ENCRYPTION_KEY` real (no está guardado en ningún otro lado: si se pierde, hay que reinstalar las tiendas). `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET` son **provisorios y aleatorios**; la sesión que los creó ya no los tiene. Para el smoke test hay que volver a cargar un secreto provisorio o usar los reales.

## Qué hay en el repo

- `packages/core/`: lógica pura, 73 tests.
- `shopify/`: app React Router en Workers. Esquema completo (`app/db/schema.ts`, `drizzle/0001_domain.sql`), privacidad (`app/data/privacy.ts`), motor de corridas (`app/runs/engine.ts`), Workflow (`workers/suppression-run.ts`), gateway de Klaviyo stub (`app/runs/gateway.server.ts`). 57 tests en `workerd` (`npm test -w @tiersaver/shopify`).
- `scripts/seed-klaviyo/`: seed de la cuenta de prueba, 123 tests offline. Leé su README antes de correrlo.
- `brand/` y `site/`: borrador de marca. Ningún logo aplicado.

## Comandos

- `npm ci && npm test && npm run typecheck` en la raíz.
- Deploy: `npm run deploy:worker -w @tiersaver/shopify`. Migraciones: `npx wrangler d1 migrations apply DB --remote` desde `shopify/`.
- Smoke: `NODE_USE_ENV_PROXY=1 node shopify/scripts/smoke-worker.mjs https://tiersaver-app.tiersaver.workers.dev <api secret>` (el `fetch` de Node no usa el proxy sin esa variable).

## Próximos pasos

1. Cuando Facundo cree la app de Shopify: cargar `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` reales con `wrangler secret bulk`, completar `shopify.app.toml`, instalar en la tienda de desarrollo. Cierra la Fase 0.
2. Cuando exista la cuenta de Klaviyo de prueba: resolver antes los hallazgos 1 a 4 del seed en `STATUS.md` (fecha de creación, métricas de API, dominio de mails, límite de 250 perfiles) y recién entonces correr el seed.
3. Fase 3 en el orden del handover. Lo primero que reemplaza un stub: el cliente de Klaviyo detrás de `SuppressionGateway` (resolver IDs a mails en el momento, suprimir de a 100, consultar jobs) y la creación de corridas de deshacer.
4. Aplicar el logo elegido y los mensajes aprobados (Fase 2).

## Pendiente de Facundo

Ver el mensaje de cierre de la sesión y `10-TAREAS-HUMANAS.md`. En corto: elegir logo y aprobar mensajes; cuenta de Shopify y tienda de desarrollo; cuenta de Klaviyo de prueba y decisiones del seed; abogado por la AUP; mover el dominio desde el 2026-12-05; restringir y rotar el token de Cloudflare.

## Cosas a saber del entorno

- No subas `.env`, `.dev.vars` ni secretos. Nunca imprimas tokens.
- El token de Cloudflare ve tres cuentas; usá siempre el `account_id` de TierSaver (fijado en `wrangler.jsonc`).
- Si un token se carga como *network secret* de `api.cloudflare.com`, el proxy pisa el header `Authorization` y rompe la subida de assets de wrangler. Por eso va como variable de entorno.
- D1 admite 100 parámetros por consulta, y los números enlazados llegan como REAL: usar `CAST(? AS INTEGER)` en divisiones enteras.
- `drizzle` no acepta `db.run(sql)` dentro de `db.batch` en D1: para transacciones con SQL crudo, `db.$client.batch`.
- `npm run lint -w @tiersaver/shopify` está roto desde el scaffold (busca `shopify/.gitignore`).
- El recordatorio del 2026-12-05 para mover el dominio vive en la primera sesión, no en esta.
