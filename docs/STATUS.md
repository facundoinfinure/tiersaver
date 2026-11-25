# Estado del proyecto

Bitácora viva. La sesión la actualiza al cerrar cada fase.

## Resumen

| Fase | Estado | Fecha |
| --- | --- | --- |
| 0 · Base | **Cerrada**: app desplegada en Cloudflare, instalada en `tiersaver.myshopify.com` y cuenta de Klaviyo de prueba sembrada | 2026-11-25 |
| 1 · Teardown | No iniciada (depende de Facundo) | |
| 2 · Marca | Cerrada: logo B aplicado, mensajes aprobados, descriptor del nombre decidido. Queda la versión corta del nombre para la ficha | 2026-11-25 |
| 3 · Construcción | En curso: capa de Klaviyo (perfiles, uso y supresión verificados contra la API real), ingesta de pedidos, motor de corridas, gateway y rutas de OAuth de Klaviyo hechos y probados. Faltan orquestación de auditoría y simulación, el resto de la interfaz, programación, deshacer y cobro | 2026-11-25 |
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

### 2026-11-25 (tercera tanda de decisiones de Facundo)

- `brand/messaging.md` (versión revisada tras el análisis de políticas): aprobada.
- Dominio de los mails ficticios del seed: `seed.tiersaver.com`.
- Descriptor del nombre: "TierSaver: List Hygiene for Klaviyo". Aplicado en documentos y guía de mensajes. **No entra en el campo de nombre de la ficha de Shopify** (35 caracteres; el límite anotado es 30, dato de extracto a confirmar): `shopify.app.toml` y el borrador de ficha siguen con "TierSaver for Klaviyo" hasta que Facundo elija la versión corta (tarea 18).
- Siguen abiertos: cortes de precio (25.000 / 75.000 / 150.000), cuentas de Shopify y Klaviyo, datos legales del sitio.

### 2026-11-25 (cuarta tanda)

- Nombre en la ficha de Shopify: "TierSaver for Klaviyo", con "list hygiene" en el subtítulo. El nombre completo de producto sigue siendo "TierSaver: List Hygiene for Klaviyo".
- Entidad legal para el sitio y los legales: Digital Solvers LLC, 153 E Flagler St, Miami, FL 33131. Facundo escribió "153 e Flaggler st, Miami 33131"; la sesión normalizó la calle a "Flagler" y agregó "FL": **a confirmar por Facundo**, junto con si lleva número de suite.
- Cortes de precio: siguen sin confirmar. Facundo preguntó si están bien; la sesión le pasó la comparación con el precio de lista de Klaviyo por tamaño.
- Siguen como placeholders en el sitio: mail de contacto, mail de soporte, fecha de vigencia y URL de la ficha.

### 2026-11-25 (quinta tanda)

- **Precios confirmados por Facundo**, con un tramo de entrada nuevo: US$ 15 hasta 10.000 perfiles activos, US$ 29 hasta 25.000, US$ 79 hasta 75.000, US$ 149 hasta 150.000; por encima, por acuerdo. En `packages/core/src/charge.ts` (`FLAT_PRICE_TIERS`); el sitio los lee de ahí.
- Tienda de desarrollo creada por Facundo: `tiersaver.myshopify.com`. La organización de Partner se llama TierSaver. Falta crear la app en el Dev Dashboard (enlace "Crear app"; **no** correr `npm init @shopify/app@latest`, que crea un proyecto nuevo) y entregar Client ID, Client secret y token de service account.
- App creada por Facundo en el Dev Dashboard. Client ID cargado en `shopify/shopify.app.toml` y como `SHOPIFY_API_KEY` del Worker. `SHOPIFY_API_SECRET` del Worker sigue provisorio: la app todavía no puede autenticar contra Shopify. Faltan el Client secret y el token de service account como variables del entorno "tiersaver" (`SHOPIFY_API_SECRET`, `SHOPIFY_SERVICE_ACCOUNT_TOKEN`); después, `shopify app deploy` y la instalación en `tiersaver.myshopify.com`.
- Mails del sitio: contacto `hello@tiersaver.com`, soporte `support@tiersaver.com` (aplicados en `site/`). **Las casillas todavía no existen**: el dominio sigue en la otra cuenta de Cloudflare; hay que crearlas (o reenviarlas) antes de publicar el sitio. Placeholders que quedan: fecha de vigencia, ley aplicable y jurisdicción, y un punto de la política de privacidad sobre mails de notificación.
- Facundo cargó `SHOPIFY_API_SECRET` y `SHOPIFY_SERVICE_ACCOUNT_TOKEN` en el entorno "tiersaver". No llegan a esta sesión (solo a sesiones nuevas): el deploy de la configuración de Shopify y la carga del secret real quedan para la sesión siguiente.

### 2026-11-25 (tercera sesión, rama `claude/lucid-brahmagupta-ss214o`)

Las tres variables llegaron a la sesión (`SHOPIFY_API_SECRET`, `SHOPIFY_SERVICE_ACCOUNT_TOKEN`, `KLAVIYO_TEST_PRIVATE_KEY`), verificadas sin imprimirlas.

**Shopify (hecho y verificado)**
- `SHOPIFY_API_SECRET` real cargado en el Worker con `wrangler secret bulk` por stdin. Worker redesplegado desde `main` (versión `30f06afe`). Smoke test con el secret real: 8 de 8.
- `shopify app deploy` con el token de service account: versión **`tiersaver-for-klaviyo-2`** publicada (URL de la app, redirect, scope `read_orders`, webhooks de desinstalación, scopes y cumplimiento).
- **La suscripción al webhook `orders/create` quedó comentada en `shopify.app.toml`.** Shopify rechaza la versión entera mientras la app no tenga aprobado el acceso a datos protegidos de clientes ("This app is not approved to subscribe to webhook topics containing protected customer data"). Se vuelve a activar cuando Facundo pida ese acceso (`13-INSTRUCTIVO-CUENTAS.md`, A4). Mientras tanto no se guardan compradores y la regla de compras protege a todos.
- Para que el CLI de Shopify funcione desde la sesión: `NODE_USE_ENV_PROXY=1` y `SHOPIFY_HTTP_PROXY` / `SHOPIFY_HTTPS_PROXY` con el proxy de la sesión, y los hosts `destinations.shopifysvc.com` y `app.shopify.com` en la red del entorno "tiersaver" (agregados con aprobación de Facundo). El CLI no está en `package.json`: se usa `npx shopify` (paquete oficial `shopify` 5.1.0).
- Pendiente: que Facundo instale la app en `tiersaver.myshopify.com` (Dev Dashboard → app → Home → Installs → Install app). Con eso cierra la Fase 0.

**Seed de Klaviyo (corrido y verificado sobre la cuenta de prueba SGKvLG)**
- Antes de escribir: `GET /api/accounts` devolvió `id: SGKvLG`, organización "TierSaver", `test_account: true`.
- Plan mostrado y después ejecutado con `--email-domain seed.tiersaver.com`: 3.000 perfiles, 21.526 eventos, 150 supresiones, 30 des-supresiones. 65 requests, unos 70 segundos de envío.
- El import de perfiles por encima de 250 no fue frenado (duda 7 del instructivo). `billing-usage` sigue en plan gratis: `active_profiles` con `usage_max` 250.
- **El consentimiento SMS fue rechazado** (400: "Phone number is valid but is not in a supported region for this account. Please configure a sending number for this region"). La cohorte `sms_consented` (120 perfiles) quedó sin consentimiento SMS: en esta cuenta evalúa como candidata, no como protegida. Para probar esa regla contra Klaviyo real hace falta configurar SMS en la cuenta de prueba (puede tener costo: no se hizo).
- **Los eventos con fecha antigua tardan.** Los eventos con fecha del día aparecieron en uno o dos minutos; los históricos empezaron a verse recién a los 12 minutos, a los 18 faltaba menos del 1% (seguían entrando, en tandas de perfiles contiguos) y a los 30 estaban los 21.526. El primer `--verify`, a los 3 minutos, dio 38 de 39 perfiles sin eventos: no era descarte, era demora. El último, a los 30 minutos: **39 de 39 perfiles de muestra coinciden** y la comparación por `$event_id` contra el dataset no encontró ningún evento faltante. Esperar 30 minutos antes de `--verify` y antes de leer segmentos.
- `seed.tiersaver.com` no entra en los dominios que Klaviyo descarta: perfiles y eventos se guardaron.

**Capa de Klaviyo contra la API real** (`shopify/scripts/klaviyo-live-check.ts`, que corre el código de `app/klaviyo/api.ts` con la clave privada de prueba; solo lectura salvo `--write-segment`)

| Punto abierto | Resultado | Cambio en código |
| --- | --- | --- |
| ¿Viene `subscriptions.sms` en perfiles sin teléfono? | **Sí.** Los 3.004 perfiles traen `subscriptions.sms.marketing` con `can_receive_sms_marketing: false` y `consent: "NEVER_SUBSCRIBED"`. Nadie queda protegido por falta de dato | Ninguno |
| Lectura de perfiles (`fields[profile]` con subcampos de `subscriptions`, `additional-fields`, `sort=created`, 100 por página) | Funciona tal cual: 3.004 perfiles en 31 páginas, sin repetidos. Suprimidos: `can_receive_email_marketing: false` con `suppression: [{reason: "USER_SUPPRESSED", timestamp}]` (120). Des-suprimidos: `suppression: []`, sin ninguna marca. Sin consentimiento explícito: `consent: "NEVER_SUBSCRIBED"` con `can_receive_email_marketing: true` | Ninguno |
| `any(id,[...])` con 50 ids | Funciona; un id inexistente simplemente no vuelve | Ninguno |
| Billing usage | `active_profiles` existe también en plan gratis (unidad `profiles`, `usage_max` 250, período mensual). Otros ids vistos: `email_sends`, `sms_credits` (unidad USD), `ai_credits`, `reviews_orders`. `usage_used` seguía en 0 veinte minutos después del import (se refresca un par de veces por día) | Ninguno |
| Estado de un job de supresión | `status`, `total_count`, `completed_count`, `skipped_count`, `completed_at` como en el spec. El `POST` responde `total_count: 0` y `skipped_count: null`; los valores reales aparecen al completar (15 s para 1 perfil, 25 s para 100) | Ninguno |
| Volver a suprimir dentro de los 90 días (duda 7) | **La API no aplica el bloqueo.** Un perfil suprimido y des-suprimido por API minutos antes se volvió a suprimir sin problema (`completed_count: 1`, `skipped_count: 0`). El bloqueo de 365 días de TierSaver es entonces la única barrera contra la puerta giratoria: no se puede contar con que Klaviyo saltee a nadie. (Probado con un solo perfil de la cohorte `restored`, que se volvió a des-suprimir) | Ninguno; corrige el supuesto anotado en la duda 7 |
| Nombres aceptados para eventos por API | "Received Email", "Opened Email", "Clicked Email", "Placed Order", "Active on Site" y "Started Checkout" fueron aceptados y quedaron en seis métricas propias | Ninguno |
| Valor booleano `false` en una propiedad de evento | Se guarda (`"Machine Open": false`) | Ninguno |
| `GET /api/events` filtrando por `metric_id` de una métrica creada por API | Funciona | Ninguno |
| `last_event_date` del perfil | **Queda en `null`** después de eventos creados por API, con y sin `backfill` (mirado a los 20 minutos). La app no lo usa para decidir; no usarlo como señal | Ninguno |
| Listas | La cuenta nueva trae tres: "Email List", "Text Messaging List", "Preview List". Además de los 3.000 sembrados hay 4 perfiles propios de la cuenta | Ninguno |
| **Cuerpo que acepta la creación de segmentos** | **Sin verificar: la clave no tiene `segments:read` ni `segments:write`** (403 `permission_denied`) | Pendiente |
| **Nombres e integraciones de las métricas** | **Sin verificar: la clave no tiene `metrics:read`** (403). `13-INSTRUCTIVO-CUENTAS.md` B2 no pedía esos tres scopes; corregido | Pendiente |

Sigue abierto, además: nombre real de la propiedad de apertura automática y qué cuenta la métrica nativa "Received Email" (hacen falta eventos nativos); rotación del refresh token y todo el flujo OAuth real (hace falta la app OAuth de Klaviyo).

**Fase 3: rutas de OAuth de Klaviyo (hechas, probadas con el Klaviyo falso; sin probar contra Klaviyo real porque no existe la app OAuth)**
- Tres pasos (`shopify/app/klaviyo/flow.server.ts`): `/klaviyo/oauth/start` (navegación de nivel superior, con un ticket firmado de 10 minutos que arma la página embebida; pone la cookie de vínculo `__Host-ts_klaviyo_oauth`), `/klaviyo/oauth/callback` (verifica `state` contra la cookie y reenvía `code` y `state` a la app embebida, sin canjear ni guardar nada) y `/app/klaviyo/finish` (autenticado por Shopify; canjea el código y guarda la conexión solo si el `state` fue emitido para esa misma tienda).
- Motivo del tercer paso: la app corre en un iframe de terceros, donde nuestra cookie no viaja, y un enlace de inicio se le puede mandar a cualquiera. Sin ese paso, alguien engañado para abrir el enlace de otro y aprobar en Klaviyo conectaría su cuenta a la tienda ajena.
- Pantalla de inicio: conectar, estado de la conexión, aviso de reconexión y **desconectar** (requisito de revisión de Klaviyo, guardarraíl 12). Conectar, fallar y desconectar quedan en `events_log` con el usuario de Shopify (`sub` del session token).
- URL de redirección a cargar en la app OAuth de Klaviyo: `https://tiersaver-app.tiersaver.workers.dev/klaviyo/oauth/callback`.
- 206 tests en `shopify/` (10 nuevos en `test/klaviyo-flow.test.ts`).

**Fase 3: auditoría y simulación como pasos reanudables (hecho, probado con el Klaviyo falso y desplegado; sin correr contra Klaviyo real)**
- Un solo recorrido, el "scan" (`shopify/app/scans/engine.ts`, Workflow `tiersaver-scan`, migración `0003_scans.sql` aplicada en la D1 remota). Pasos: cargar reglas → confirmar que el token sigue siendo de la cuenta conectada → asegurar el segmento administrado → esperar a que Klaviyo lo procese → leer miembros de a 100 → marcar los que están en grupos protegidos → pasar cada miembro por las reglas de `core` (antigüedad, SMS, compras de Shopify por hash, bloqueo de 365 días tras restaurar) → volver a comprobar que el segmento no cambió → contar perfiles activos → cierre en una sola transacción.
- El cierre escribe la auditoría, la simulación **sin aprobar** y sus candidatos, reemplaza cualquier simulación abierta anterior y borra los datos de trabajo. Si algo falla, no queda ninguna simulación. No se guarda ningún mail (solo IDs y hashes).
- Todo dato desconocido protege: grupo protegido ilegible → todos protegidos; sin historial completo de pedidos de Shopify → nadie es candidato con las reglas por defecto; cuenta sin métricas nativas → nadie evaluado; acceso revocado → falla sin reintentar y la conexión queda en `needs_reauth`.
- **Perfiles activos**: se usa el conteo de facturación de Klaviyo (`usage_used`) si la conexión tiene `usage:read` y el dato no está atrasado; si no, la app cuenta los perfiles con mail y sin supresión. La pantalla dice cuál de los dos es.
- **Modo cuenta sembrada**: solo si la cuenta conectada es exactamente `KLAVIYO_SEEDED_ACCOUNT_ID` (`SGKvLG`, variable en `wrangler.jsonc`) **y** Klaviyo la marca como test account, el scan usa las métricas de la integración API, la antigüedad de `ts_seed_created_at` y no exige historial de pedidos. Sin las dos condiciones se comporta como con cualquier merchant.
- Límites para Workers Free (1.024 pasos por instancia): hasta 500 páginas de miembros (50.000 candidatos) por scan; más que eso falla con un mensaje claro en lugar de quedarse sin pasos.
- Pantalla de inicio: botón "Run the free audit", progreso y resultado (perfiles activos, cuántos cumplen los criterios de Klaviyo, cuántos quedan activos y por qué, cuántos suprimiría una limpieza, precio de TierSaver para ese tamaño). Textos según `12-CUMPLIMIENTO-KLAVIYO.md` 3.2. **No hay todavía aprobación ni ejecución desde la interfaz.**
- Se dejó fuera de la pantalla la estimación de plan de Klaviyo (se calcula y se guarda; sigue pendiente decidir si se muestra).
- 230 tests en `shopify/` (20 nuevos en `test/scan.test.ts`). Arreglada una prueba intermitente de OAuth (cambiaba el último carácter de la firma, que a veces decodifica a los mismos bytes).

**Encontrado en el camino**
- **Los scripts de build del sitio no están en el repo.** `site/package.json` llama a `site/build/build.mjs` (y `images.mjs`, `serve.mjs`, `check-links.mjs`), pero la regla `build/` del `.gitignore` raíz los dejó afuera y la sesión que los escribió ya no existe. Las páginas generadas y `site/src` sí están. Efecto: no se puede regenerar el sitio y `site/test/site.test.ts` no corre (el otro archivo de tests del sitio pasa: 273). Queda una tarea sugerida para reconstruirlos.
- El supuesto de `02-ARQUITECTURA.md` / duda 7 de que Klaviyo saltea a quien no se puede volver a suprimir no vale por API (ver tabla).

**Abierto / no verificado al cierre de esta sesión**
- Cuerpo de creación de segmentos y nombres de métricas contra la API real (falta una clave con `metrics:read`, `segments:read`, `segments:write`). Hasta entonces el scan no está probado contra Klaviyo real.
- Flujo OAuth real de Klaviyo (falta la app OAuth: `13-INSTRUCTIVO-CUENTAS.md` B5).
- Instalación en `tiersaver.myshopify.com`, hook de instalación y backfill de pedidos contra una tienda real.
- Acceso a datos protegidos de clientes y `read_all_orders` (A4): sin eso, con las reglas por defecto un merchant real no tiene candidatos. **Aun con `read_all_orders`, la app lee 1.095 días de pedidos, y la regla "nunca compró" exige cobertura desde antes de la creación de cada perfil: los perfiles de más de tres años quedan protegidos.** Hay que decidir si el backfill lee todo el historial de la tienda o si alcanza con la métrica "Placed Order" de Klaviyo para los más viejos.
- Fase 3, lo que falta: pantalla de simulación con aprobación y avisos, CSV de candidatos, arranque de la corrida desde la interfaz, consulta de jobs, deshacer, reglas y grupos protegidos editables, programación mensual (Cron), cobro en Shopify, mails, y los guardarraíles 5, 6 y 9 de `12-CUMPLIMIENTO-KLAVIYO.md` 3.1.

**Instalación en la tienda de desarrollo (hecha por Facundo, verificada; cierra la Fase 0)**
- Facundo instaló la app en `tiersaver.myshopify.com` el 2026-11-25 17:43 UTC. La app embebida carga y muestra la pantalla de conexión con "Connecting to Klaviyo is not available yet" (lo esperado: falta la app OAuth de Klaviyo).
- En la D1: fila en `shops` (`installed`) y sesión offline con scope `read_orders`, token cifrado.
- **Bug encontrado y corregido**: el backfill de pedidos no arrancó al instalar. El id de la instancia del Workflow llevaba el dominio de la tienda, y los ids de Workflows no admiten puntos; el error quedaba tragado por el `catch`. Ahora los puntos se reemplazan y el fallo se registra. El backfill arranca en la próxima autenticación; igual no va a traer mails hasta que la app tenga acceso a datos protegidos de clientes.

### 2026-11-25 (cuarta sesión, rama `claude/hopeful-mayer-5ubt01`)

Llegaron `KLAVIYO_CLIENT_ID`, `KLAVIYO_CLIENT_SECRET` y la `KLAVIYO_TEST_PRIVATE_KEY` nueva, verificadas sin imprimirlas.

**Clave nueva de Klaviyo contra la API real (cuenta de prueba SGKvLG; `klaviyo-live-check.ts`, primero en solo lectura y después con `--write-segment`)**

`GET /api/accounts`: `id: SGKvLG`, organización "TierSaver", `test_account: true`. Las dos pasadas terminaron sin fallas.

| Punto abierto | Resultado | Cambio en código |
| --- | --- | --- |
| Nombres e integraciones de las métricas (`metrics:read`) | 28 métricas. Nativas de Klaviyo: integración **"Klaviyo"**, categoría "Internal" ("Received Email", "Opened Email", "Clicked Email", "Bounced Email", "Dropped Email", "Skipped Send", "Marked Email as Spam", "Clicked email to unsubscribe", "Manually Suppressed / Unsuppressed from Email Marketing", "Subscribed to Back in Stock"). De Shopify: integración **"Shopify"**, categoría "eCommerce" ("Placed Order", "Ordered Product", "Checkout Started", "Viewed Product", "Added to Cart", "Fulfilled / Cancelled / Refunded Order"). Las sembradas: integración **"API"**, categoría "API". `DEFAULT_METRIC_SPECS` resuelve las nativas tal cual y `SEEDED_METRIC_SPECS` las sembradas. La cuenta tiene **dos** métricas "Active on Site" de API (el segmento incluye las dos, que es lo que protege) | Ninguno |
| La cuenta de prueba ahora tiene la integración de Shopify conectada (aparecieron las métricas "Shopify / eCommerce"); en la sesión anterior no estaban | Dato, no problema: no hay eventos de Shopify para los perfiles sembrados | Ninguno |
| Cuerpo que acepta la creación de segmentos (`segments:write`) | `POST /api/segments` aceptó el cuerpo de `ensureCandidateSegment` sin cambios: 14 grupos de condiciones (consentimiento de email, "Received Email" ≥ 5 en 504 días y "cero veces, siempre" para cada métrica de apertura, clic, pedido, checkout, sitio y producto visto, nativas y de API). Segmento `WRvyjd`, creado | Ninguno |
| La definición que devuelve Klaviyo coincide con la enviada | **Sí** (`canonicalDefinition`). Klaviyo devuelve los opcionales como `null` (`metric_filters: null`, `consent_status.filters: null`), que es lo que la comparación ya descartaba. Terminó de procesar a los 32 s; `is_active: true` | El Klaviyo falso ahora devuelve la definición con esos `null`, como la API real |
| Miembros del segmento | **984**, y es lo correcto. Cruzados uno por uno con el dataset del seed (por mail, sin imprimirlos): coinciden exactamente con los perfiles no suprimidos, con 5 o más "Received Email" en la ventana y sin ningún evento de interacción, cohorte por cohorte (0 de más, 0 de menos, 0 ajenos al seed). `profile_count` de Klaviyo también da 984 | Ninguno |
| ¿Por qué 984 y no ~576? | La cifra "456 + 120" son los **candidatos** después de las reglas de TierSaver, no los miembros del segmento. El segmento solo codifica consentimiento, mails recibidos y "nunca interactuó"; las reglas que no se pueden expresar ahí las aplica la app sobre los miembros: antigüedad (`new_profile` 120, `profile_180_to_364_days` 150, bordes 364/179/180 días: 18), grupo protegido (90), restaurados (30). 984 − 288 de antigüedad = 696; de esos, 444 `never_engaged` + 6 + 6 de bordes = **456 candidatos del seed**, más los 120 de `sms_consented` (sin consentimiento SMS en esta cuenta), más 90 de `protected_group` si la tienda no tiene cargada esa lista como protegida y 30 de `restored` (la app no tiene registro propio de esa restauración: la hizo el seed). Esperado en la auditoría real: **696** sin grupo protegido configurado, **606** con la lista protegida del seed | Ninguno |
| Uso de facturación | `active_profiles`: `usage_used` ya refrescó a **2.885** (3.005 perfiles − 120 suprimidos), `usage_max` 250 | Ninguno |
| Perfiles | 3.005 (3.000 del seed, 4 de la cuenta, 1 de diagnóstico). `subscriptions.sms` sigue viniendo en todos | Ninguno |

Sigue abierto de este bloque: nombre real de la propiedad de apertura automática y qué cuenta la métrica nativa "Received Email" (hacen falta envíos reales).

**OAuth de Klaviyo: secretos en el Worker (hecho)**
- `KLAVIYO_CLIENT_ID` y `KLAVIYO_CLIENT_SECRET` cargados con `wrangler secret bulk` por stdin. Worker redesplegado (versión `41735da8`). Smoke 8 de 8.
- Las credenciales son válidas: un canje con un código inventado contra `a.klaviyo.com/oauth/token` devuelve `invalid_grant` (con un secret equivocado devuelve `invalid_client`). No se canjeó ni guardó nada.
- La app OAuth sigue en *Draft*; no se envió a revisión.

**Fase 3: revisión, aprobación, corrida, jobs, deshacer, ajustes, programación y cobro (hecho, probado con el Klaviyo falso y un Admin API falso, desplegado; nada probado todavía desde la interfaz real)**

Worker versión `97e0c4e5`, migración `0004_schedule.sql` aplicada en la D1 remota, Cron Trigger `17 * * * *`. `SUPPRESSION_ENABLED` sigue sin definir: ninguna corrida puede suprimir. 253 tests en `shopify/` (23 nuevos en `test/phase3-flow.test.ts`), typecheck limpio, smoke 8 de 8.

- **Pantalla "Review cleanup"** (`/app/simulation`, `app/simulations/review.ts`): cuenta de activos, miembros del segmento, motivos por los que se conserva a cada grupo, candidatos por motivo y activos después de la limpieza; vencimiento (24 h); los avisos de `12-CUMPLIMIENTO-KLAVIYO.md` 4.1; precio del tramo. Aprobar exige tildar la confirmación y un usuario de Shopify identificado; la aprobación es un único `UPDATE` atómico que repite todas las condiciones y queda en `events_log` con las reglas vigentes.
- **CSV de candidatos**: se descarga desde esa pantalla, en archivos de 1.500 filas (30 consultas a Klaviyo por archivo, dentro del límite de subrequests de Workers Free). Columnas: id de perfil, mail tal como lo tiene Klaviyo en ese momento, motivo y enlace al perfil. Los mails se leen de Klaviyo para la descarga y no se guardan ni se registran. **Solo existe antes de aprobar** (guardarraíl 7): con la simulación aprobada, ejecutada, vencida o reemplazada, la descarga se rechaza. Cada descarga queda en `events_log` (quién, qué parte, cuántas filas).
- **Arranque de la corrida**: botón "Start cleanup" sobre una simulación aprobada. Antes de consumir la simulación se comprueba el interruptor, la conexión y la suscripción de Shopify; con `SUPPRESSION_ENABLED` ausente el botón queda deshabilitado con un aviso y la simulación sigue aprobada.
- **Historial y detalle** (`/app/runs`, `/app/runs/:id`): estado, progreso en vivo, cuántos se enviaron, cuántos se dejaron sin tocar y por qué, error legible, cargo. **Consulta de jobs**: lee de Klaviyo, a pedido y de a 25, el estado de los jobs de la corrida (procesados y salteados por Klaviyo).
- **Deshacer** (`createUndoRun`): crea una corrida `undo` con exactamente los perfiles que la limpieza envió y que no fueron restaurados; no depende del interruptor. **Guardarraíl 5**: si desde la limpieza ya hubo una renovación del plan de Klaviyo, o no se puede descartar, pide una confirmación con advertencia (fuentes, en orden: fin de período que Klaviyo informó en una auditoría, día de renovación cargado por el merchant, y más de 31 días). Al terminar, marca `reactivated_at` en las filas originales: es lo que el scan usa para dejar a esos perfiles fuera de toda limpieza por 365 días.
- **Ajustes** (`/app/settings`, `app/settings/settings.ts`): criterios recomendados por Klaviyo o modo ampliado con los pisos de `RULE_LIMITS` (no se pueden bajar); ignorar aperturas automáticas; hasta 20 listas o segmentos protegidos, elegidos de la cuenta de Klaviyo (se guardan como `list:<id>` / `segment:<id>`; el segmento administrado no se ofrece); programación. Cambiar reglas o grupos protegidos sube `version` y reemplaza la simulación abierta; cambiar solo la programación, no. Todo cambio queda en `events_log`.
- **Programación mensual** (`app/schedule/`, apagada por defecto, columna nueva `settings.schedule_enabled`): el cron horario arranca **un scan** (solo lectura) por ciclo, `leadDays` días antes de la renovación y nunca a menos de 4. El día de renovación es el que cargó el merchant o, si no, el del fin de período que informó Klaviyo. En modo "approval" la simulación espera al merchant 24 h. **Sin mails de aviso todavía, esa espera solo sirve si el merchant abre la app.**
- **Modo automático** (opt-in): después de un scan programado aprueba ("automatic") y arranca la corrida solo si se cumplen todas: modo automático y programación encendidos, criterios recomendados de Klaviyo (nunca modo ampliado), al menos una limpieza anterior aprobada por una persona y completada (regla de producto 1), simulación programada, abierta y con candidatos, `SUPPRESSION_ENABLED` y suscripción activa. Cualquier "no" deja la simulación esperando al merchant.
- **Cobro** (`app/billing/billing.ts`; documentación de Shopify leída el 2026-11-25, API 2026-10): suscripción por uso con `cappedAmount` US$ 149 (`appSubscriptionCreate` con `appUsagePricingDetails`), que el merchant acepta antes de la primera limpieza; en tiendas de desarrollo se pide como `test`. Después de una corrida que suprimió perfiles, un `appUsageRecordCreate` con clave de idempotencia por corrida y el precio fijo del tramo de la lista simulada. No se cobra si nadie fue suprimido, si ya hubo un cargo en los últimos 28 días, por encima de 150.000 perfiles ni al deshacer. Si Shopify falla, el cargo queda abierto y el cron lo reintenta durante 7 días. Los términos que muestra Shopify salen de `FLAT_PRICE_TIERS` y cumplen las reglas de texto 3.2.
- Verificado en Chromium con `polaris.js` real: `s-checkbox`, `s-number-field` y `s-switch` participan de formularios nativos (`FormData`), tildados y destildados. `s-select` no toma el valor inicial por atributo: no se usa.

**Abierto / no verificado de este bloque**
- Ninguna pantalla nueva fue vista dentro del admin de Shopify (la sesión no puede abrir la app embebida). La descarga del CSV depende de que App Bridge agregue el token al `fetch`: mirar.
- El cobro nunca habló con Shopify real. No se sabe si la Billing API acepta suscripciones mientras la app no tenga elegida la distribución pública (A4).
- Auditoría real de punta a punta, rotación del refresh token y paso `/app/klaviyo/finish`: esperan a que Facundo conecte Klaviyo desde la tienda.
- Falta de la Fase 3: mails (aviso de simulación programada lista, resultado de la corrida), detector de ciclos (guardarraíl 6), reporte mensual, y decidir si se muestra la estimación de plan de Klaviyo.
- La corrida cobra por lo **enviado** a Klaviyo; no espera a que los jobs confirmen cuántos procesó Klaviyo.

**Primer intento real de "Connect Klaviyo" (Facundo, 2026-11-25 18:21 UTC): falló, causa encontrada y corregida**
- Lo que anduvo: consentimiento en Klaviyo, callback, y **`/app/klaviyo/finish` abre dentro del admin de Shopify** con `code` y `state` (la URL `admin.shopify.com/store/<tienda>/apps/<client id>/…` redirige bien a la app embebida).
- Lo que falló: `klaviyo_oauth_invalid_grant`. Logs del Worker: **Shopify cargó el paso final tres veces y canceló la primera a los 300 ms**, cuando el código ya se había canjeado en Klaviyo; las otras dos recibieron `invalid_grant` porque el código es de un solo uso. No quedó ninguna conexión guardada.
- Corrección (`finishKlaviyoAuthorization`, migración `0005_oauth_attempts.sql`): la primera carga que reclama el `state` hace el canje dentro de `waitUntil` (termina y se registra aunque le cancelen el request) y las demás esperan y devuelven ese resultado. El código nunca va dos veces a Klaviyo y cada `state` sirve una sola vez. La tabla nueva guarda solo el SHA-256 del `state`.
- Efecto lateral: Klaviyo emitió tokens en ese primer canje que la app nunca guardó ni puede revocar. Se pisan al reconectar; si se quiere limpiar, se quita la app en Klaviyo (Integrations) antes de volver a conectar.

**Decisiones de Facundo (2026-11-25, cuarta sesión)**
- **El cargo es estimado hasta que los jobs de Klaviyo confirmen.** Implementado: al terminar la corrida se guarda el cargo como estimado (`pending`) y no va nada a Shopify; el Workflow espera los jobs (30 s, 1, 2, 4, 8 y después 15 minutos, unas 2 horas en total) y recién con todos `complete` crea el usage record por lo que Klaviyo confirmó (`completed_count − skipped_count`). Si Klaviyo confirma cero, no se cobra. El cron reintenta las corridas chicas (hasta 10 jobs); las grandes dependen de su Workflow. **A verificar en la corrida real: qué cuenta exactamente `completed_count`.**
- **Autorizada una limpieza real sobre SGKvLG** (suprimir, consultar jobs, deshacer, apagar). Para eso: candado nuevo `SUPPRESSION_ALLOWED_ACCOUNT_ID` (si está definido, solo se suprime para una tienda conectada a esa cuenta de Klaviyo; deshacer no depende). Cargados como secretos del Worker, no en el repo: `SUPPRESSION_ENABLED=true` y `SUPPRESSION_ALLOWED_ACCOUNT_ID=SGKvLG`. **Hay que borrarlos al terminar la prueba** (`wrangler secret delete`).
- Para la cuenta sembrada, la suscripción de Shopify no bloquea el arranque (así se puede probar antes de resolver el cobro); para cualquier otra cuenta sigue siendo obligatoria.

Worker versión `7c98e25e`. 260 tests.

**Limpieza real de punta a punta sobre SGKvLG (autorizada por Facundo; hecha el 2026-11-25 18:42 UTC, 99 segundos)**

Facundo dejó una ventana de Chrome abierta, pero la sesión corre en la nube y no tiene forma de usar un navegador suyo. La prueba se hizo entonces con el código de la app (los mismos motores de scan, aprobación, corrida, gateway, confirmación de jobs y deshacer) contra la API real, con la clave privada de prueba: `test/live-klaviyo.test.ts` más `scripts/klaviyo-relay.mjs` (un relay local que tiene la clave, solo arranca si la cuenta es la esperada y Klaviyo la marca como test account). El test se saltea salvo que se le pase `LIVE_KLAVIYO_RELAY`. **No pasó por la app desplegada ni por el OAuth.**

| Paso | Resultado |
| --- | --- |
| Auditoría + simulación (modo cuenta sembrada, reglas por defecto, sin grupo protegido) | **984 miembros, 696 candidatos**: exactamente lo esperado |
| CSV de candidatos | Primera parte con un mail por fila, leído de Klaviyo en el momento |
| Aprobación y corrida | 696 perfiles en 7 lotes; `completed`, 0 fallados, 0 sin tocar |
| Jobs de supresión en Klaviyo | 7 jobs, todos `complete`: 100, 100, 100, 100, 100, 100 y 96; `completed_count` = `total_count`, `skipped_count` 0. Completos en menos de un minuto |
| Estado real de los perfiles | Suprimidos antes: 120. Después de la corrida: 816 (120 + 696) |
| Cargo | Estimado al terminar; con los jobs confirmados queda listo para Shopify (sin Shopify en la prueba, queda abierto, que es lo correcto) |
| Deshacer | Corrida `undo` de 696; 7 jobs de des-supresión `complete` (696 procesados, 0 salteados) |
| Estado final | **120 suprimidos, como al empezar**; el segmento volvió a 984 miembros. La cuenta quedó como estaba |

Qué responde de lo que estaba abierto: `completed_count` cuenta los perfiles procesados por el job y coincide con lo enviado (con `skipped_count` 0 en perfiles que existen y no estaban suprimidos); `any(id,[...])` con 50 ids funciona en volumen; el gateway real suprime y des-suprime por mail tal como lo tiene Klaviyo. Sigue sin verse qué pone Klaviyo en `skipped_count` (no hubo ningún salteado).

**Interruptor**: `SUPPRESSION_ENABLED` y `SUPPRESSION_ALLOWED_ACCOUNT_ID` **borrados** del Worker después de la prueba (quedan 5 secretos: los dos de Shopify, los dos de Klaviyo y la clave de cifrado). Ninguna corrida puede suprimir.

**Detector de ciclos (guardarraíl 6; hecho, probado con el falso, desplegado)**
- Durante el scan, si un miembro del segmento (o sea, no suprimido) figura en el historial propio como suprimido por una limpieza de TierSaver hace más de 72 horas y nunca restaurado por TierSaver, alguien lo des-suprimió por fuera. La app lo deja activo, le pone la marca de restaurado (queda fuera de toda limpieza por 365 días, igual que un deshacer), **apaga la programación mensual y el modo automático**, lo registra en `events_log` (`schedule.paused_cycle_detected`) y lo muestra en la pantalla de inicio. Las 72 horas evitan confundir una limpieza que Klaviyo todavía está aplicando.

Worker versión `f952e23d`. 263 tests más el de integración en vivo (salteado por defecto).

**Qué falta para producción, y por qué no lo puede cerrar la sesión sola**
1. **Conectar Klaviyo desde la tienda y recorrer las pantallas** (Facundo; la sesión no puede manejar su navegador). Único camino para verificar el OAuth real ya corregido, la rotación del refresh token, la descarga del CSV dentro del admin y los formularios.
2. **Cobro contra Shopify real**: aceptar la suscripción de prueba. Puede exigir elegir la distribución pública (A4), que no se puede cambiar después: decisión de Facundo.
3. **Datos protegidos de clientes y `read_all_orders`** (A4): los pide Facundo en el Dev Dashboard. Sin eso un merchant real no tiene candidatos con las reglas por defecto, y `orders/create` sigue comentado.
4. **Encender la supresión para todos**: solo Facundo.
5. **Mails** (simulación programada lista, resultado de corrida): necesitan el dominio en la cuenta TierSaver (desde el 2026-12-05) y definir el servicio de envío. Sin mails, la programación en modo aprobación solo sirve si el merchant abre la app dentro de las 24 h.
6. **Sitio**: scripts de build perdidos (tarea aparte), placeholders legales, dominio (2026-12-05). Publicar es un freno.
7. **Workers Paid** (US$ 5/mes, decidido "recién al desplegar la beta"): con Workers Free una corrida admite ~100.000 perfiles y un scan 50.000 miembros. Es un gasto: freno.
8. **Ficha y envío a revisión de Shopify**, y la revisión de la app OAuth en Klaviyo: frenos.
9. Reporte mensual, y decidir si se muestra la estimación de plan de Klaviyo.

**Segundo y tercer intento de "Connect Klaviyo" (Facundo, 18:45 y 18:46 UTC): fallaron de otra forma**
- La corrección del paso final funcionó: el código se canjeó una sola vez y las recargas esperaron ese resultado (por eso la pantalla quedó en blanco unos 20 segundos).
- Falló lo siguiente: `klaviyo_rate_limited_locally`. El canje anduvo, pero **la primera llamada a `GET /api/accounts` con el token nuevo falló tres veces seguidas con un error reintentable** (429 sin `Retry-After`, 5xx o error de red; el código guardado era el de la espera local, no el de Klaviyo), y los reintentos espaciados a 8 segundos se comieron el request. Con la clave privada esa misma llamada funciona. **Causa todavía desconocida.**
- Cambios para el próximo intento: el cliente informa la última falla real de Klaviyo en lugar de la espera local; al conectar, esperas cortas (5 s) y un segundo intento sin `fields[account]`; si igual falla, `events_log` guarda el código real (`klaviyo_<status>_<code>` o `klaviyo_network_error`).
- No hay conexión guardada. Cada intento fallido revoca en Klaviyo el permiso recién emitido.
- **Causa encontrada en el cuarto intento (19:0x UTC), con el diagnóstico nuevo: `klaviyo_network_error`.** `KlaviyoClient` guardaba el `fetch` global en un campo y lo llamaba como método (`this.fetchImpl(...)`); Cloudflare Workers lo rechaza con "Illegal invocation". Ninguna llamada a la API de Klaviyo desde el Worker desplegado pudo haber funcionado; no se vio antes porque los tests, el script en Node y la prueba en vivo inyectan su propio `fetch`, y el canje del token usa otra función. Corregido (se llama como función suelta) con un test de regresión que falla sin el arreglo. **Lección: lo probado con `fetch` inyectado no prueba el `fetch` del Worker.**
- **Quinto intento (18:55 UTC): conectado.** En la D1: `klaviyo_connections` con `tiersaver.myshopify.com` → `SGKvLG`, `connected`, los 10 scopes otorgados (incluido `usage:read`), `profiles_usage_type_id = active_profiles`, access token con vencimiento a 1 hora, tokens cifrados. `events_log`: `klaviyo.connected` con el usuario de Shopify. Verificado así el flujo OAuth real completo (PKCE, callback, paso final dentro del admin, canje único, lectura de cuenta y de uso). Pendiente: auditoría desde la interfaz y rotación del refresh token (se ve recién después del primer refresh, pasada la hora).
- **Auditoría real desde la interfaz (Facundo, 2026-11-25 ~19:00 UTC; captura): coincide con lo esperado.** Activos 2.885 (conteo de Klaviyo), cumplen los criterios 984, conservados por antigüedad 288, se suprimirían 696. Aviso "Test account: this audit reads seeded sample data" y precio US$ 15 mostrados. Primer scan corrido de punta a punta por el Workflow desplegado, con el token OAuth.
- **Aprobación desde la interfaz (Facundo, 23:08 UTC): registrada.** `simulations.approved_by = user:<id de Shopify>`, `events_log` con `simulation.approved`, los 696 candidatos y las reglas vigentes. La pantalla "Review cleanup" se ve bien: tabla, avisos, precio, botón de arranque deshabilitado con el aviso del interruptor y "Review pricing in Shopify". **El CSV no se llegó a probar** (no hay evento de descarga; la sección desaparece al aprobar).
- Interruptor vuelto a encender **solo para SGKvLG** (`SUPPRESSION_ENABLED=true` + `SUPPRESSION_ALLOWED_ACCOUNT_ID=SGKvLG`, secretos del Worker) para que Facundo pruebe arranque, jobs y deshacer desde la interfaz, dentro de la misma autorización. **Borrarlos al terminar.**
