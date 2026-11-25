# Handoff entre sesiones · 2026-11-25 (segunda sesión, cierre)

Para la sesión que sigue. Leé también `CLAUDE.md`, `docs/00-HANDOVER.md` (decisiones vigentes) y `docs/STATUS.md` (bitácora, dudas resueltas y hallazgos).

## Dónde está el trabajo

- Rama: `claude/practical-brown-zm2uss` (todo empujado). Incluye lo de `claude/gallant-knuth-51pv2e`. Cada sesión solo puede empujar a su propia rama.
- Entorno de Claude Code: **"tiersaver"** (red con Klaviyo, Shopify, Cloudflare y `tiersaver-app.tiersaver.workers.dev`; variable `CLOUDFLARE_API_TOKEN`).
- Fase 0: desplegada; faltan la instalación en la tienda de desarrollo y el seed real (dependen de cuentas de Facundo). Fase 2: logo aplicado, mensajes a re-aprobar. Fase 3: en curso. Fase 4: sitio construido, sin publicar. Fases 1 y 5 sin empezar.

## Qué hay desplegado

- Worker `tiersaver-app` en la cuenta TierSaver: https://tiersaver-app.tiersaver.workers.dev (plan Workers Free; alcanzó, sin errores de CPU).
- D1 `tiersaver` con migraciones `0000` a `0002`.
- Workflows `tiersaver-suppression-run` y `tiersaver-orders-backfill`.
- `SUPPRESSION_ENABLED` no está definido: ninguna corrida puede suprimir.
- Secretos: `TOKEN_ENCRYPTION_KEY` real (no está guardado en ningún otro lado: si se pierde, hay que reinstalar las tiendas). `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET` son **provisorios y aleatorios**; la sesión que los creó ya no los tiene. Para el smoke test hay que volver a cargar un secreto provisorio o usar los reales.

## Decisiones de Facundo del 2026-11-25 (segunda parte)

Logo B; precio fijo por tamaño de lista (US$ 15 / 29 / 79 / 149, confirmado); sin reactivación por compra; reglas por defecto = criterios de Klaviyo; rigen las reglas de texto de `12-CUMPLIMIENTO-KLAVIYO.md` 3.2. Detalle en `STATUS.md`.

## Qué hay en el repo

- `packages/core/`: lógica pura, 83 tests. Cargo fijo en `charge.ts`, reglas en `rules.ts`.
- `shopify/`: app React Router en Workers, 196 tests en `workerd`. Esquema y migraciones (`drizzle/0000` a `0002`), privacidad, pedidos (`app/orders/`), capa de Klaviyo (`app/klaviyo/`), motor de corridas y gateway (`app/runs/`), Workflows (`workers/`).
- `scripts/seed-klaviyo/`: seed de la cuenta de prueba, 138 tests offline. Leé su README antes de correrlo.
- `site/`: sitio público generado desde `site/src` (`npm run build` dentro de `site/`), 291 tests. Sin publicar.
- `brand/`: logo final en `brand/logo/final/`; `messaging.md` aprobada.
- `docs/12-CUMPLIMIENTO-KLAVIYO.md` (políticas; secciones 3.1 y 3.2 son obligatorias) y `docs/13-INSTRUCTIVO-CUENTAS.md` (pasos de Shopify y Klaviyo).

## Comandos

- `npm ci && npm test && npm run typecheck` en la raíz.
- Deploy: `npm run deploy:worker -w @tiersaver/shopify`. Migraciones: `npx wrangler d1 migrations apply DB --remote` desde `shopify/`.
- Smoke: `NODE_USE_ENV_PROXY=1 node shopify/scripts/smoke-worker.mjs https://tiersaver-app.tiersaver.workers.dev <api secret>` (el `fetch` de Node no usa el proxy sin esa variable).

## Próximos pasos

1. Cuando Facundo entregue Client ID, Client secret, token de service account y dominio de la tienda (`13-INSTRUCTIVO-CUENTAS.md` A3): completar `client_id` en `shopify.app.toml`, `shopify app deploy` con `SHOPIFY_SERVICE_ACCOUNT_TOKEN`, cargar las claves reales en el Worker, y pedirle que instale la app. Cierra la Fase 0.
2. Cuando exista la cuenta de Klaviyo de prueba: correr el seed con `--email-domain seed.tiersaver.com` (aprobado) y las primeras verificaciones reales de la capa de Klaviyo (lista en `STATUS.md`, "Abierto / no verificado").
3. Fase 3, lo que falta: rutas de OAuth de Klaviyo (inicio y callback con la cookie de vínculo), orquestación de auditoría y simulación como pasos reanudables, interfaz embebida, programación mensual, creación de corridas de deshacer, consulta de jobs, cobro en Shopify, y los guardarraíles pendientes de `12-CUMPLIMIENTO-KLAVIYO.md` 3.1.
4. Sitio: completar placeholders y publicar cuando el dominio esté en la cuenta TierSaver (después del 2026-12-05). Publicar es un freno: lo aprueba Facundo.

## Pendiente de Facundo

Crear la app en el Dev Dashboard de Shopify (la tienda `tiersaver.myshopify.com` ya existe) y la cuenta de Klaviyo según `13-INSTRUCTIVO-CUENTAS.md`; elegir la versión corta del nombre para la ficha de Shopify y decidir si se contacta a Klaviyo (`10-TAREAS-HUMANAS.md`, tareas 17 a 20); datos legales del sitio; mover el dominio desde el 2026-12-05; restringir y rotar el token de Cloudflare.

## Cosas a saber del entorno

- No subas `.env`, `.dev.vars` ni secretos. Nunca imprimas tokens.
- El token de Cloudflare ve tres cuentas; usá siempre el `account_id` de TierSaver (fijado en `wrangler.jsonc`).
- Si un token se carga como *network secret* de `api.cloudflare.com`, el proxy pisa el header `Authorization` y rompe la subida de assets de wrangler. Por eso va como variable de entorno.
- D1 admite 100 parámetros por consulta, y los números enlazados llegan como REAL: usar `CAST(? AS INTEGER)` en divisiones enteras.
- `drizzle` no acepta `db.run(sql)` dentro de `db.batch` en D1: para transacciones con SQL crudo, `db.$client.batch`.
- `npm run lint -w @tiersaver/shopify` está roto desde el scaffold (busca `shopify/.gitignore`).
- El recordatorio del 2026-12-05 para mover el dominio vive en la primera sesión, no en esta.
