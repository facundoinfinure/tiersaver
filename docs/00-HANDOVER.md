# Handover

## En una línea

App de Shopify de higiene de lista para Klaviyo: suprime, con simulación y aprobación del merchant, los perfiles que nunca interactuaron, según los criterios publicados por Klaviyo. Meta de negocio: US$ 1.000 a 10.000 por mes con ~90% de margen, operada por una o dos personas.

## Por qué existe

- Desde el 18 de febrero de 2025 Klaviyo cobra por todos los perfiles activos, no por los contactados. Sigue vigente en noviembre de 2026.
- Los tramos saltan fuerte: de 10.000 a 12.500 perfiles el plan Email pasa de US$ 150 a US$ 275 por mes.
- Klaviyo revisa el conteo de perfiles activos poco antes de renovar el ciclo, y el conteo puede tardar hasta 72 horas en actualizarse tras una limpieza.
- Los perfiles suprimidos no cuentan para el plan, y la ayuda de Klaviyo recomienda suprimir inactivos de forma continua (citas en `12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.2).
- La supresión nativa en bloque alcanza solo a los miembros actuales del segmento; hay que repetirla a mano.
- Si se le quita la supresión a un perfil, no se lo puede volver a suprimir hasta 90 días después de la supresión anterior (ayuda de Klaviyo, leída el 2026-11-25; ver `12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.3).
- En marzo de 2026 Klaviyo sumó recomendaciones de supresión. Recomienda, no programa.
- Apps comparables en el App Store al 25 de noviembre de 2026 (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.10): ListSweep: Klaviyo Cleaner (lanzada el 14 de septiembre de 2026, plan gratis y Pro a US$ 7 por mes, sin reseñas) y ShopiDeck: Klaviyo Bot Cleaner (auditoría gratis y planes desde US$ 9 por mes, sin reseñas). Nae: Ghost Profile Auditor no apareció en la búsqueda del App Store ese día; no se pudo confirmar si sigue publicada. Corrige la versión anterior de este punto, que decía que los competidores eran gratis.

## Decisiones tomadas (no reabrir sin consultar)

| Tema | Decisión |
| --- | --- |
| Nombre | TierSaver. Nombre de producto: "TierSaver: List Hygiene for Klaviyo" (descriptor decidido el 2026-11-25; antes "TierSaver for Klaviyo"). Pensado para sumar otras herramientas más adelante. En la ficha de Shopify (campo de 30 caracteres): "TierSaver for Klaviyo", con "list hygiene" en el subtítulo |
| Dominio | tiersaver.com, registrado en Cloudflare |
| Marca | Independiente |
| Posicionamiento | Higiene de lista automática para Klaviyo. El efecto en el plan de Klaviyo se menciona solo como hecho citado de la ayuda de Klaviyo y en segundo plano; no se venden ahorros, cifras ni garantías, ni el momento de la corrida respecto de la facturación. Las reglas de texto de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2, son obligatorias desde el 2026-11-25 |
| Reglas por defecto | Los criterios publicados por Klaviyo: perfil creado hace 365 días o más, 5 o más mails recibidos en ~72 semanas (504 días) y ninguna apertura, clic, actividad en el sitio ni compra, nunca. Modo ampliado opt-in con pisos que no se pueden bajar. Decidido el 2026-11-25; ver `01-PRD.md`, sección 3, y `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.1 |
| Reactivación | Sin reactivación automática por compra o checkout: quitada del MVP el 2026-11-25 (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 2.5). Deshacer queda como corrección de errores; un perfil restaurado no vuelve a ser candidato por 365 días |
| Identidad | Derivada de Infinure v3 en tema claro; ver `03-MARCA.md` |
| Precio | Precio fijo mensual por tamaño de lista: US$ 15 hasta 10.000 perfiles activos, US$ 29 hasta 25.000, US$ 79 hasta 75.000, US$ 149 hasta 150.000; por encima, por acuerdo (nunca se cobra automáticamente). Precios y límites confirmados por Facundo el 2026-11-25. El ciclo sin limpieza (nadie suprimido) no se cobra; como máximo un cargo cada 28 días; la auditoría es gratis. El cargo nunca depende de la factura de Klaviyo ni de `usage_max`. Decidido el 2026-11-25; reemplaza el 20% del ahorro, decidido y descartado el mismo día (motivo en `12-CUMPLIMIENTO-KLAVIYO.md`, secciones 2.1 y 3.3; detalle en `04-PRECIO-Y-COBRO.md`) |
| Cobro en Shopify | Billing API ("Manual Pricing") con suscripción por uso y `cappedAmount` de US$ 149, visible al aprobar. Decidido el 2026-11-25 y vigente hasta que se revise: con precio fijo, Shopify App Pricing pasa a ser posible (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.3). Es una pregunta de seguimiento, no una decisión tomada |
| Datos de compras | Pedidos de Shopify como diferenciador (`read_orders` + `read_all_orders` con aprobación + mail como dato protegido nivel 2), cruzados con "Placed Order" de Klaviyo. Decidido el 2026-11-25 |
| Historial de pedidos | Con `read_all_orders`, la app lee **todo** el historial de pedidos de la tienda (antes 1.095 días). La regla por defecto es "nunca compró" y necesita datos anteriores a la creación de cada perfil. Decidido el 2026-11-25 |
| Cobro y deshacer | Una limpieza que se deshace entera **antes** de que salga su cargo no se cobra. Un deshacer posterior al cargo no devuelve nada. El cargo es una estimación hasta que los jobs de Klaviyo confirman. Decidido el 2026-11-25 |
| Plan de Klaviyo en la app | La app **no** muestra en qué plan de Klaviyo caería el conteo ni ninguna estimación de precio de Klaviyo. Solo cita que los suprimidos no cuentan para el plan. Decidido el 2026-11-25 |
| Camino | Construir directo, sin validación previa. Los cortes de `08-RIESGOS-Y-METRICAS.md` son el freno |
| Hosting | **Cloudflare** (decidido el 2026-11-25): Workers para app y sitio, D1 como base, Workflows para las corridas de supresión, Cron Triggers, Queues y Email Service. Plan Workers Paid (US$ 5/mes) recién al desplegar la beta. Cuenta de Cloudflare dedicada a TierSaver. Reemplaza Vercel + Supabase |
| Cobro | LLC de EE.UU., por la facturación de Shopify |
| Soporte | Automatizado: centro de ayuda + bot, escalando lo crítico a Facundo |
| Mercado | Global en inglés, merchants de Shopify con 5.000 a 150.000 perfiles |

## Estado al 25 de noviembre de 2026

Hecho:
- Research de oportunidad y verificación de vigencia.
- Nombre elegido y dominio comprado.
- USPTO: sin resultados para "Tiersaver" (búsqueda de wordmark hecha por Facundo).
- One-pager de la oportunidad y plan de lanzamiento (artefactos en claude.ai, resumidos en este paquete).

Pendiente de chequeo:
- USPTO para "tier saver" con espacio, clases 9 y 42.
- Búsqueda del nombre en el Shopify App Store. Hay varias apps "Tier…" de descuentos por volumen (Tierly, Tierwise, TierFlow, TierUp); no se encontró ninguna TierSaver.

No hecho:
- No existe código, repo, cuentas de Shopify Partner ni Klaviyo de prueba.
- No se corrió REA ni se instalaron las apps competidoras.
- Ninguna agencia fue contactada.

## Orden de trabajo

### Fase 0 · Base
- Verificar cuentas y credenciales (`10-TAREAS-HUMANAS.md`).
- Scaffold de la app con la plantilla oficial de Shopify. Proyectos en Vercel y Supabase, ambientes dev y prod.
- Resolver las dudas "a verificar" de `02-ARQUITECTURA.md` y `04-PRECIO-Y-COBRO.md`.
- Cargar la cuenta de Klaviyo de prueba con 2.000 a 5.000 perfiles ficticios de actividad variada (script en `scripts/seed-klaviyo`).
- Entregable: app vacía que instala en la tienda de desarrollo; `STATUS.md` con las dudas resueltas.

### Fase 1 · Teardown
- Seguir `06-TEARDOWN-REA.md`. Requiere que Facundo instale las apps competidoras y apruebe REA.
- Entregable: `docs/teardown-notas.md` y ajustes al PRD.
- Si Facundo no puede hacer su parte todavía, esta fase no bloquea la Fase 3.

### Fase 2 · Marca
- Logo, ícono de app (1200 × 1200), tokens de color y tipografía, guía de mensajes.
- Entregable: carpeta `brand/` y `site/` con estilos base.

### Fase 3 · Construcción
- Según `01-PRD.md` y `02-ARQUITECTURA.md`, en este orden: auth de Shopify, conexión a Klaviyo, auditoría, reglas y simulación, supresión con cola, programación, registro y deshacer, reporte, cobro, webhooks de privacidad, pruebas de punta a punta.
- Entregable: MVP funcionando en la tienda de desarrollo contra la cuenta de Klaviyo de prueba.

### Fase 4 · Sitio y soporte
- Landing con chequeo de salud de lista ("list health check": cuántos perfiles cumplen los criterios de Klaviyo), páginas legales, centro de ayuda, bot de soporte, tres artículos de SEO.
- La calculadora pública de ahorro del plan original queda fuera: `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2, propone reemplazarla por el chequeo de salud de lista. Si el sitio muestra el plan de Klaviyo en que caería el conteo, va como dato secundario y rotulado como estimación.
- Entregable: tiersaver.com publicado.

### Fase 5 · Lanzamiento
- Ficha, capturas, video, checklist de `07-LANZAMIENTO.md`.
- Borradores de outreach de `05-GO-TO-MARKET.md` listos para que Facundo envíe.
- Entregable: app lista para enviar a revisión. El envío lo dispara Facundo.

## Definición de terminado

- Un merchant instala, conecta Klaviyo, ve su auditoría, simula, aprueba, y la limpieza corre con los criterios de Klaviyo sin tocar a nadie protegido. La limpieza mensual termina antes de que se renueve su plan, para que el conteo de Klaviyo esté al día.
- Puede deshacer cualquier ejecución como corrección de errores; los perfiles restaurados no vuelven a ser candidatos por 365 días.
- No hay reactivación automática, y la app nunca cambia el plan de Klaviyo del merchant.
- Se le cobra el precio fijo de su tamaño de lista solo en los ciclos en que una limpieza suprimió perfiles, y lo entiende antes de aceptar.
- Todo texto que ve el merchant cumple las reglas de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2.
- Al desinstalar, sus datos se borran.
- Pasa el checklist de requisitos del App Store vigente.

## Contacto

Facundo Bonfigli, único decisor. Juntar los pedidos en un solo mensaje.
