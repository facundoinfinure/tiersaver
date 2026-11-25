# Estado del proyecto

Bitácora viva. La sesión la actualiza al cerrar cada fase.

## Resumen

| Fase | Estado | Fecha |
| --- | --- | --- |
| 0 · Base | Desplegada en Cloudflare; falta instalar en la tienda de desarrollo y sembrar Klaviyo (dependen de cuentas de Facundo; pasos en `13-INSTRUCTIVO-CUENTAS.md`) | 2026-11-25 |
| 1 · Teardown | No iniciada (depende de Facundo) | |
| 2 · Marca | Logo B elegido y aplicado. Mensajes revisados tras el análisis de políticas: esperan nueva aprobación | 2026-11-25 |
| 3 · Construcción | En curso: capa de Klaviyo, ingesta de pedidos, motor de corridas y gateway hechos y probados offline. Faltan rutas de OAuth, orquestación de auditoría y simulación, interfaz, programación, deshacer y cobro | 2026-11-25 |
| 4 · Sitio y soporte | Sitio construido en `site/`, sin publicar. Faltan datos legales, URL de la ficha y bot de soporte | 2026-11-25 |
| 5 · Lanzamiento | No iniciada | |

## Cómo se verificó (importante)

Al inicio, la red de la sesión no llegaba a klaviyo.com, help.klaviyo.com, developers.klaviyo.com, shopify.dev ni vercel.com. Fuentes usadas:

- **Spec OpenAPI oficial de Klaviyo** (`github.com/klaviyo/openapi`, `openapi/stable.json`, commit del 2026-11-20, revisión `2026-10-15`): confianza alta.
- **Docs oficiales de Supabase** (búsqueda del conector) y **código de pg-boss** publicado en npm: confianza alta.
- **Extractos de búsqueda** de páginas oficiales de Klaviyo, Shopify y Vercel que no se pudieron abrir: confianza media. Se marcan "(extracto)".

Después se creó el entorno de red `tiersaver` con esos hosts habilitados; con eso se leyeron directo la AUP y el slider de precios. Pendiente: releer las demás páginas marcadas "(extracto)".

## Dudas técnicas (`02-ARQUITECTURA.md`)

| # | Respuesta | Fuente | Fecha |
| --- | --- | --- | --- |
| 1 | **Sí, a medias.** Nuevo `GET /api/billing-usage` (GA en `2026-10-15`, scope `usage:read`, 10/s · 150/m) devuelve por tipo de uso `usage_used`, `usage_max` (máximo del plan actual), `period_start`, `period_end`. No devuelve nombre ni precio del plan. El ID del tipo para perfiles activos de email no figura en el spec: leerlo en la cuenta de prueba. `usage_max` permite **verificar el tramo** antes y después de la limpieza | Spec OpenAPI `list_billing_usage` | 2026-11-25 |
| 2 | **Sí, indirecto**: `period_start` / `period_end` del uso de perfiles. Klaviyo cuenta los perfiles "poco antes de renovar el ciclo" y la actualización tras una limpieza puede tardar hasta 72 h (extracto). Sin billing-usage, el merchant carga el día | Spec + help.klaviyo.com/115000976672 (extracto) | 2026-11-25 |
| 3 | **No hay API, pero sí dato oficial.** Se leyó el slider de klaviyo.com/pricing con navegador headless: 49 tramos de 500 a 150.000 perfiles para el plan **Email** y para el plan nuevo **Marketing** (email + móvil). Cargados en `packages/core/src/price-tables/klaviyo.ts` como verificados. Más de 150.000: precio a medida. Se cruza con `usage_max` de la Billing Usage API: si el tramo real de la cuenta no coincide con la tabla, no se estima ahorro. Refrescar mensualmente | klaviyo.com/pricing, leído el 2026-11-25 | 2026-11-25 |
| 4 | **Sí (confianza media).** Una app OAuth no listada se instala con la URL de autorización directa; la revisión aplica solo para listarse en el marketplace (pide 5 instalaciones activas). PKCE obligatorio, `accounts:read` obligatorio, access token ~1 h, refresh token vence si no se usa 90 días. Crean y autorizan: Owner, Admin o Manager | developers.klaviyo.com/en/docs/set_up_oauth y create_a_public_oauth_app (extracto) | 2026-11-25 |
| 5 | **Riesgo real, no bloqueo explícito.** La Acceptable Use Policy (actualizada el 9 de abril de 2026, leída directo) prohíbe usar los servicios "in a manner designed to avoid or circumvent bills, invoices, or other fees that Klaviyo would otherwise be entitled to collect"; los API Terms permiten revocar acceso "at our sole discretion". La propia ayuda de Klaviyo dice que los perfiles suprimidos no cuentan para el plan y Klaviyo recomienda suprimir. Requiere opinión de abogado (tarea humana 12). Ver decisión A | klaviyo.com/legal/acceptable-use-policy (leída) y /api-terms (extracto) | 2026-11-25 |
| 6 | Cada evento "Opened Email" trae la propiedad "Machine Open" (en la UI "Apple Privacy Open"); Klaviyo aclara que indica que *pudo* ser automática. Se puede filtrar en condiciones de segmento (`metric_filters`) y en `GET /api/events`. Diseño: aperturas cuentan como protección por defecto; el merchant puede optar por ignorar las automáticas | help.klaviyo.com/4416791883163 (extracto) + spec | 2026-11-25 |
| 7 | **Vigente con matiz.** Tras una des-supresión manual hay que esperar 90 días **desde la supresión original** para volver a suprimir (otras fuentes dicen desde la des-supresión). La API no lo documenta; se presume que el job lo cuenta en `skipped_count`. Las reglas protegen 90 días desde la reactivación (conservador). Probar en la cuenta de prueba | help.klaviyo.com/24263920096027 (extracto) | 2026-11-25 |
| 8 | Hobby: máx. 300 s por función, cron solo una vez por día, y **uso comercial prohibido**. Pro: 800 s (1.800 s en beta), cron por minuto. Diseño elegido: tabla de jobs en Postgres con lease y cursor, tick por cron cada minuto procesando ~4 min por tick; sin worker dedicado ni pg-boss. Requiere Vercel Pro (ver decisión D) | vercel.com/docs (vía buscador de docs de Vercel) | 2026-11-25 |
| 9 | Admin API estable: **2026-10** (la plantilla ya la usa). Pedidos: `read_orders` da 60 días; 365 días requiere **`read_all_orders` con aprobación de Shopify**. Ver decisión C | shopify.dev/docs/api/usage/versioning y changelog de read_all_orders (extracto) | 2026-11-25 |
| 10 | Leer mails de pedidos o clientes es **protected customer data nivel 2** (pedido por campo, revisión de protección de datos). En tiendas de desarrollo funciona al pedirlo, antes de la revisión (foro). Ver decisión C | shopify.dev/docs/apps/launch/protected-customer-data (extracto) | 2026-11-25 |

Datos extra verificados en el spec de Klaviyo:

- Bulk Suppress: **solo por mail** (100 por request) o por lista/segmento completo; si el mail no existe, Klaviyo crea el perfil suprimido. Bulk Unsuppress **solo quita `USER_SUPPRESSED`**: nunca reactiva a quien se dio de baja ni rebotes. 75/s · 750/m. Scopes `profiles:write`, `subscriptions:write`, `subscriptions:read`.
- `POST /api/segments` admite condición "Opened Email 0 veces en los últimos N días" con `metric_filters`; límite 1/s, 15/m y **100 por día**.
- `GET /api/profiles` con `additional-fields[profile]=subscriptions` expone consentimiento SMS y motivos de supresión de email. `last_event_date` se puede leer pero no filtrar. `predictive_analytics` no trae última apertura ni clic.

## Dudas de cobro (`04-PRECIO-Y-COBRO.md`)

| # | Respuesta | Fuente | Fecha |
| --- | --- | --- | --- |
| 1 | Shopify App Pricing (ex Managed Pricing) **ahora admite uso** (medidores vía App Events API) y es el camino indicado para apps públicas nuevas, pero **no admite tope de uso**. La Billing API (ahora "Manual Pricing", legacy) sigue soportada para "outlier pricing models" y sí tiene `cappedAmount`. Ver decisión B | shopify.dev changelog 2026-05-12 y docs de billing (extracto) | 2026-11-25 |
| 2 | **No se encontró ninguna regla** contra cobrar un % del ahorro. Requisitos: todo por Shopify, precios solo en la sección de precios de la ficha, condiciones claras. La revisión es la palabra final | shopify.dev app-store-requirements (extracto) | 2026-11-25 |
| 3 | Con Billing API el tope aplica por ciclo de 30 días de Shopify; los ciclos pueden desfasarse con el de Klaviyo. Se limita por lógica propia a un cargo cada 28 días (`minDaysBetweenCharges`, implementado y testeado) | shopify.dev create-usage-based-subscriptions (extracto) | 2026-11-25 |
| 4 | La ficha muestra nombre de plan, precio y descripción de cargos adicionales; con Billing API el uso se describe en texto libre (inferido). Usar el ejemplo US$ 125 → US$ 25 | shopify.dev (extracto) | 2026-11-25 |

Otros datos de Shopify: revenue share 0% hasta US$ 1 M acumulado y luego 15%; 2,9% de procesamiento; registro de US$ 19. Nombre de app: máx. 30 caracteres y debe empezar con la marca propia (requisito 4.1.2, julio 2026): "TierSaver for Klaviyo" (21) cumple. El Dev Dashboard reemplazó al Partner Dashboard para desarrollo; el CLI crea la app ahí. Polaris React está deprecado: se usan Polaris web components (la plantilla ya los usa).

## Diferencias entre este paquete y la documentación vigente

1. **Klaviyo sí expone uso de facturación** (`/api/billing-usage`): el paquete asumía que no.
2. **La baja de plan no es automática**: el auto-downgrade está apagado por defecto y solo Owner/Admin lo activa; si no, el merchant baja de plan a mano. Sin eso no hay ahorro (help.klaviyo.com/4405883690651, extracto).
3. **Descuento de "appreciation"** para clientes viejos: limita la suba al 25% y se achica o pierde al bajar de plan. El ahorro real puede ser menor que la diferencia de precios de lista.
4. **Klaviyo ya tiene "Suppress inactive profiles"** en la supresión en bloque (protege clics y compras de 182 días; no disponible con más de 120.000 perfiles; no se repite sola) además de las recomendaciones de marzo de 2026. Sigue sin programación automática al 10/11/2026.
5. **Shopify App Pricing es el camino preferido y no tiene tope**; la Billing API pasó a "legacy".
6. **365 días de pedidos exige `read_all_orders`** con aprobación, y el mail exige datos protegidos nivel 2.
7. **Vercel Hobby no permite uso comercial.**
8. **Supabase free: 2 proyectos gratis en total** entre todas las organizaciones donde Facundo es Owner/Admin; ya están ocupados por dos proyectos existentes.
9. **Klaviyo tiene dos planes pagos** (Email y Marketing); el paquete solo contemplaba Email. Los ejemplos del paquete se confirman con precios oficiales: 12.500 → 10.000 ahorra US$ 125; 50.000 → 20.000 ahorra US$ 345.
10. Las pautas de nombres de Klaviyo para terceros no aparecen; competidores usan "Marca: Klaviyo …" sin problema visible.
11. Rama de trabajo: cada sesión solo puede empujar a su propia rama (`claude/gallant-knuth-51pv2e`, después `claude/practical-brown-zm2uss`), no a ramas por fase.
12. **Workflows: el plan gratis admite 1.024 pasos por instancia** (10.000 en Workers Paid, configurable hasta 25.000). Con un paso por lote de 100, una corrida de más de ~100.000 perfiles necesita Workers Paid (developers.cloudflare.com/workflows/reference/limits, leído el 2026-11-25).
13. **D1 admite 100 parámetros por consulta**: las consultas por lote filtran por `run_id` + `batch_index`, no por lista de IDs.

## Decisiones de Facundo (2026-11-25)

| Tema | Decisión |
| --- | --- |
| A · Términos de Klaviyo | Reposicionar como higiene de lista automática; el ahorro es resultado, no titular. Abogado adelantado |
| B · Cuándo se cobra | 20% del ahorro verificado con `usage_max` de la Billing Usage API tras la renovación; onboarding pide activar el auto-downgrade |
| C · Cobro en Shopify | Billing API con `cappedAmount` US$ 149 |
| D · Datos de compras | Mantener el cruce con pedidos de Shopify: `read_orders` + `read_all_orders` + email nivel 2, guardando solo hashes |
| E · Stack | Cloudflare (Workers + D1 + Workflows + Cron), aprobado junto con el spike. Cuenta de Cloudflare dedicada a TierSaver |

Aplicado en `00-HANDOVER.md`, `01-PRD.md`, `02-ARQUITECTURA.md`, `03-MARCA.md`, `04-PRECIO-Y-COBRO.md`, `08-RIESGOS-Y-METRICAS.md`, `10-TAREAS-HUMANAS.md` y en `packages/core` (`verifiedSavings`, `billableSavingsCents`, `hashEmail`).

## Bitácora

### 2026-11-25
- Paquete de handover creado. Sin código todavía.
- Nombre TierSaver elegido; tiersaver.com registrado en Cloudflare.
- USPTO sin resultados para "Tiersaver".
- Sesión: paquete copiado al repo; monorepo con `shopify/` (plantilla oficial React Router, API 2026-10, build y typecheck OK) y `packages/core/` (tablas oficiales de precios de Klaviyo, tramos, ahorro, cargo, reglas de protección, compuerta de simulación, programación por fecha de facturación, lotes y rate limit) con 63 tests unitarios pasando (69 tras aplicar las decisiones).
- Dudas de `02` y `04` resueltas con las salvedades de arriba. Fase 0 frenada en el corte de `08-RIESGOS-Y-METRICAS.md` hasta que Facundo decida A–E.
- Bloqueantes humanas sin hacer: no hay `.env` en la sesión, ni Shopify Partner / Dev Dashboard, ni tienda de desarrollo, ni cuenta de Klaviyo de prueba. Vercel y Supabase están conectados pero sin proyectos de TierSaver.
- Facundo aprobó A–E. Docs actualizados; `packages/core` suma ahorro verificado, hash de mails y cifrado de tokens (73 tests).
- Spike de Cloudflare: la app corre en `workerd` con D1, sesiones cifradas y webhooks de cumplimiento; 8 de 8 chequeos de humo pasan. Pendiente: instalación real en la tienda de desarrollo (requiere cuenta de Shopify y deploy).
- Pendiente de Facundo: cuenta de Cloudflare nueva para TierSaver y mover tiersaver.com (pasos en `10-TAREAS-HUMANAS.md`).
- Cloudflare: cuenta "TierSaver" creada y `tiersaver.com` agregado ahí (zona en estado *pending*, plan Free, DNSSEC apagado). API token cargado como network secret y verificado (activo).
- tiersaver.com se registró el 2026-11-25 05:17 UTC en la cuenta de Infinure. Cloudflare exige más de 10 días para moverlo entre cuentas: el move recién se puede pedir desde el **2026-12-05 05:18 UTC**. Hasta entonces la app se despliega en `*.workers.dev`.
- El token ve las tres cuentas (Alupont, Infinure, TierSaver) a nivel cuenta; conviene restringir "Account resources" a TierSaver.
- Cuenta TierSaver: D1 `tiersaver` creada (región ENAM) con la migración aplicada; subdominio `tiersaver.workers.dev` creado; `wrangler.jsonc` fija el `account_id` de TierSaver.
- Deploy bloqueado por el entorno: el proxy de la sesión reemplaza el header `Authorization` en todo api.cloudflare.com, y la subida de assets de wrangler usa su propio JWT en ese header (401). Solución: pasar el token de *network secret* a variable de entorno `CLOUDFLARE_API_TOKEN` del entorno "tiersaver".
- Recordatorio programado para el 2026-12-05 09:00 (Buenos Aires) para mover el dominio.


### 2026-11-25 (segunda sesión, rama `claude/practical-brown-zm2uss`)

**Primer deploy (hecho y verificado)**
- Token de Cloudflare verificado sin imprimirlo (53 caracteres, prefijo `cfut_`, `wrangler whoami` ve la cuenta TierSaver).
- Worker `tiersaver-app` desplegado en la cuenta TierSaver: https://tiersaver-app.tiersaver.workers.dev
- Secretos cargados con `wrangler secret bulk` por stdin: `TOKEN_ENCRYPTION_KEY` (32 bytes aleatorios, no guardado en ningún lado), `SHOPIFY_API_KEY` y `SHOPIFY_API_SECRET` **provisorios** (aleatorios; hay que reemplazarlos cuando exista la app de Shopify).
- Host `tiersaver-app.tiersaver.workers.dev` agregado a la red del entorno "tiersaver".
- Smoke test contra la URL real: 8 de 8, dos veces (antes y después de sumar el Workflow). Sin errores 1102 de CPU: **el plan Workers Free alcanza por ahora**; no se contrató nada.
- Para correr el smoke desde la sesión hay que usar `NODE_USE_ENV_PROXY=1` (el `fetch` de Node no usa el proxy por defecto).

**Esquema completo de D1 (hecho y verificado)**
- `shopify/app/db/schema.ts` y migración `shopify/drizzle/0001_domain.sql`, aplicada en local y en la D1 remota: `shops`, `klaviyo_connections`, `settings`, `audits`, `simulations`, `simulation_candidates`, `runs`, `run_profiles`, `purchase_hashes`, `usage_charges`, `events_log`.
- Se agregó `simulation_candidates` (no estaba en la lista): guarda el conjunto exacto de perfiles que la simulación suprimiría, para que la corrida ejecute eso y nada más.
- No se guardan mails: los perfiles se identifican por ID de Klaviyo y el mail se resuelve contra Klaviyo en el momento de cada lote (a implementar en Fase 3). Para reactivación y cruce con pedidos, solo SHA-256.
- Reglas de producto en la base: una corrida de supresión no puede existir sin simulación (CHECK); una simulación respalda una sola corrida (índice único); aprobación exige aprobador; umbrales por debajo de los mínimos de `RULE_LIMITS` son rechazados; sin ahorro facturable no hay cargo; un cargo por tienda por ciclo de Klaviyo.
- Todo cuelga de `shops` con borrado en cascada. Webhooks: `shop/redact` borra todo; `customers/redact` borra los hashes del cliente; `app/uninstalled` borra tokens al instante y deja el historial hasta `shop/redact`.

**Esqueleto del Workflow (hecho y verificado, sin Klaviyo real)**
- `shopify/app/runs/engine.ts`: `createSuppressionRun` (compuerta de simulación en una sola transacción atómica, además del chequeo en memoria) y `executeRun` (un paso por lote de hasta 100, reanudable).
- `shopify/workers/suppression-run.ts`: `SuppressionRunWorkflow`, desplegado como `tiersaver-suppression-run`. El ID de instancia es el ID de la corrida, así que no puede haber dos ejecuciones de la misma.
- `shopify/app/runs/gateway.server.ts`: el gateway de Klaviyo es un stub que rechaza todo lote (error no reintentable). Hoy ninguna ruta crea corridas y, si alguna arrancara, termina en `failed` sin tocar a nadie.
- Política ante fallas: si un lote agota reintentos, la corrida se detiene y el resto queda sin tocar.
- Pruebas (`npm test -w @tiersaver/shopify`, 57, en `workerd` con D1 local y el motor real de Workflows): esquema = migraciones, compuerta (no aprobada, vencida, reemplazada, otra tienda, concurrencia), corte a mitad de corrida con y sin estado del Workflow, lote que muere después de llegar a Klaviyo, reintentos, cancelación, privacidad.

**Fase 2 · Marca (borrador)**
- `brand/`: tres opciones de logo (A Step Line, B Lower Step, C Dropped T) con marca, logo claro y oscuro e ícono 1200 × 1200; comparativa en `brand/options.png`; tokens; `messaging.md` (borrador).
- `site/`: estilos base, fuentes Inter Tight e IBM Plex Mono auto-hospedadas (licencia OFL incluida) y `styleguide.html`.
- Ningún logo está aplicado. Sin verificar: búsqueda de marcas parecidas, reglas vigentes de ícono del App Store, contraste formal.

**`scripts/seed-klaviyo` (escrito y probado offline; nunca corrió contra Klaviyo)**
- 3.000 perfiles por defecto (2.000 a 5.000), deterministas, en 26 cohortes que cubren cada regla y sus bordes (89/91, 179/181, 364/366 días). Un test pasa los datos generados por `evaluateProfile` de core y exige que coincidan con la decisión esperada. 123 tests con un Klaviyo falso.
- Por defecto solo imprime el plan (sin red). La corrida real exige `--execute`, clave solo por `KLAVIYO_TEST_PRIVATE_KEY`, que la cuenta coincida con `--account-id` / `--expect-account-name` y que Klaviyo la marque `test_account: true`.
- Verificado en el spec OpenAPI `2026-10-15` y la ayuda de Klaviyo (detalle y URLs en `scripts/seed-klaviyo/README.md`): import masivo de 10.000 perfiles por request; eventos masivos de 1.000 por request con `time` retroactivo y `backfill: true` (no dispara flows); suscripción masiva de hasta 1.000 perfiles, que además **quita `USER_SUPPRESSED`**.

Hallazgos que cambian el diseño de las pruebas de integración y de la Fase 3:
1. **La fecha de creación de un perfil no se puede retroceder por API.** Durante 90 días todo perfil sembrado es `new_profile` y no hay candidatos. El seed guarda la antigüedad pretendida en la propiedad `ts_seed_created_at`; las pruebas de integración necesitan leerla (solo en modo prueba) o esperar 90 días.
2. **Los eventos creados por API son métricas distintas de las nativas** ("Opened Email" de la integración API ≠ la de Klaviyo). La app tiene que resolver métricas por nombre e integración, y ese mapeo tiene que ser configurable para la cuenta de prueba.
3. **Klaviyo descarta en silencio eventos de direcciones `@example.com`, `@test.com` "o similares"** (responde 202 igual). La corrida real necesita un dominio propio que no reciba correo (`--email-domain`).
4. **Una cuenta de prueba es una cuenta común en plan gratis (250 perfiles activos).** Sembrar 3.000 la deja 12 veces por encima. La ayuda dice que eso bloquea envíos; no se encontró nada que diga que cobra ni que no. Posible gasto: confirmar antes de la primera corrida. `usage_max` ahí va a ser 250, que no es un tramo de la tabla.
5. Sigue abierto el nombre de la propiedad de aperturas automáticas: nuestras notas dicen "Machine Open", la ayuda actual dice "Apple Privacy Open".

**Pendiente / no verificado**
- Instalación real en la tienda de desarrollo (falta cuenta de Shopify).
- `npm run lint -w @tiersaver/shopify` falla desde antes de esta sesión (apunta a un `.gitignore` que no existe en `shopify/`). Sin arreglar.
- No hay Cron Trigger todavía (Fase 3, programación).

### 2026-11-25 (segunda sesión, segunda parte): decisiones de Facundo y avance de fases

**Decisiones de Facundo (reemplazan la B de más arriba y adelantan parte de la A)**

| Tema | Decisión |
| --- | --- |
| Logo | Opción B (Lower Step). Archivos en `brand/logo/final/` |
| Abogado | En lugar de la consulta, análisis de políticas sobre fuentes primarias: `12-CUMPLIMIENTO-KLAVIYO.md`. No es asesoramiento legal |
| Precio | Tramos fijos por tamaño de lista (US$ 29 / 79 / 149); el ciclo sin limpieza no se cobra. Reemplaza el 20% del ahorro. **Los cortes 25.000 / 75.000 / 150.000 son una propuesta de la sesión, sin confirmar** |
| Reactivación por compra | Fuera del MVP. Deshacer queda; un perfil restaurado no vuelve a ser candidato por 365 días |
| Reglas | Por defecto, los criterios publicados por Klaviyo: creado hace 365 días o más, 5 o más mails recibidos en 504 días, nunca abrió, hizo clic, visitó ni compró. Modo ampliado opcional con pisos fijos (compras 365, clics/aperturas/sitio 182, antigüedad 180) |
| Mensajes | Rigen las reglas de texto de `12-CUMPLIMIENTO-KLAVIYO.md` sección 3.2 |

**Aplicado en código (probado)**
- `packages/core`: `charge.ts` (precio fijo, sin cargo sin limpieza, uno por ciclo), `rules.ts` (ventanas `null` = "alguna vez", `emailsReceived`, pisos nuevos, dato desconocido protege también para aperturas automáticas), `simulation.ts`. Se eliminó `billableSavingsCents`. 83 tests.
- `shopify`: migración `0002_flat_pricing_and_klaviyo_criteria.sql` (reconstruye `settings` y `usage_charges`; quita `reactivation_enabled`).
- `scripts/seed-klaviyo`: 39 cohortes para las reglas nuevas, con decisión esperada en modo por defecto y ampliado; siembra eventos "Received Email". 138 tests. Sigue sin haber corrido contra Klaviyo.
- Documentos 00 a 10, `CLAUDE.md` (descripción y regla 6: "si no hay limpieza, no se cobra"), `README.md` y `brand/messaging.md` reescritos según las decisiones.

**Fase 3: capa de Klaviyo (`shopify/app/klaviyo/`, probada offline con un Klaviyo falso; nunca llamó a la API real)**
- OAuth con PKCE y estado firmado sin tabla; tokens cifrados; refresco serializado por tienda; `invalid_grant` marca `needs_reauth`; `disconnect` revoca en Klaviyo y se llama al desinstalar.
- Cliente con límite de tasa a la mitad de lo publicado, reintentos con `Retry-After`, errores sin tokens ni mails.
- **Lectura de inactividad por segmento**: la app crea un segmento en la cuenta del merchant con los criterios de Klaviyo y lee sus miembros (unas 360 requests para 150.000 perfiles; leer eventos serían más de 30.000). Pide el scope `segments:write` y deja un segmento visible en la cuenta. Solo los miembros pueden ser candidatos, así que un segmento roto da menos candidatos, nunca más.
- Gateway real de supresión: resuelve IDs a mails en el momento, saltea perfiles que ya no existen, sin mail o cuyo mail cambió desde la simulación.
- **Interruptor `SUPPRESSION_ENABLED`**: ausente por defecto; sin él ninguna corrida suprime. Deshacer no depende del interruptor. Solo Facundo lo enciende.
- Diferencias con lo anotado antes: el tipo de uso de perfiles activos sí está documentado (`active_profiles`); des-suprimir pide solo `subscriptions:write`; la guía de límites dice 700/min (el spec, 750); la ayuda llama "Apple Privacy Open" a la propiedad de aperturas automáticas; los 90 días para volver a suprimir se cuentan desde la supresión original.

**Fase 3: pedidos de Shopify**
- `shopify/app/orders/purchases.ts`: guarda por comprador solo el SHA-256 del mail y la fecha del último pedido. Alta de tienda con settings por defecto al instalar, Workflow `tiersaver-orders-backfill` (una página por paso) y webhook `orders/create`.
- Sin `read_all_orders` la cobertura es de 60 días y, con las reglas nuevas ("nunca compró"), la app no encuentra candidatos: **ese permiso pasa a ser requisito para que el producto haga algo**, salvo que el historial de "Placed Order" de Klaviyo alcance.
- El Workflow de backfill y el hook de instalación no se pudieron probar contra una tienda real.

**Fase 4: sitio (`site/`, sin publicar)**
- Landing, chequeo de salud de lista (reemplaza la calculadora de ahorro; usa la tabla de precios de core), precios, 9 artículos de ayuda, 3 guías, privacidad y términos en borrador, CSP estricta, sin requests externas. 291 tests, verificador de enlaces y pasada en Chromium sin errores.
- Placeholders a completar: URL de la ficha, entidad legal, dirección, mails de contacto y soporte, fecha de vigencia.

**Cuentas**: pasos en `13-INSTRUCTIVO-CUENTAS.md`. Cambios respecto de lo anotado: el CLI de Shopify se autentica con un token de service account (`SHOPIFY_SERVICE_ACCOUNT_TOKEN`); la cuenta gratis de Klaviyo no cobra ni sube de plan por pasarse de 250 perfiles (solo bloquea envíos).

**Abierto / no verificado**
- Nada de la capa de Klaviyo ni del seed se probó contra una cuenta real. Lo primero a mirar: si `subscriptions.sms` viene en perfiles sin teléfono (si no viene, todo queda protegido y no hay candidatos), el cuerpo exacto que acepta la creación de segmentos y los nombres de las métricas nativas.
- Guardarraíles de `12-CUMPLIMIENTO-KLAVIYO.md` 3.1 sin implementar: aviso al deshacer una corrida ya contada en una renovación, detector de ciclos, modo automático solo con criterios estrictos.
- La auditoría todavía guarda una estimación de plan de Klaviyo (`savings.ts`): falta decidir si la app la muestra.
- El cobro no está conectado a Shopify.
- `docs/06-TEARDOWN-REA.md` y `docs/09-FUENTES.md` conservan afirmaciones viejas (competidores gratis, ticket promedio).
