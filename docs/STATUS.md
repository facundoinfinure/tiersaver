# Estado del proyecto

Bitácora viva. La sesión la actualiza al cerrar cada fase.

## Resumen

| Fase | Estado | Fecha |
| --- | --- | --- |
| 0 · Base | En curso, frenada por decisiones (ver abajo) | 2026-11-25 |
| 1 · Teardown | No iniciada (depende de Facundo) | |
| 2 · Marca | No iniciada | |
| 3 · Construcción | No iniciada (solo lógica de dominio en `packages/core`) | |
| 4 · Sitio y soporte | No iniciada | |
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
11. Rama de trabajo: la sesión solo puede empujar a `claude/gallant-knuth-51pv2e`, no a ramas por fase.

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
