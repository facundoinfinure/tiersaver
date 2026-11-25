# Handover

## En una línea

App de Shopify que baja la factura de Klaviyo suprimiendo perfiles inactivos antes del corte de facturación. Meta de negocio: US$ 1.000 a 10.000 por mes con ~90% de margen, operada por una o dos personas.

## Por qué existe

- Desde el 18 de febrero de 2025 Klaviyo cobra por todos los perfiles activos, no por los contactados. Sigue vigente en noviembre de 2026.
- Los tramos saltan fuerte: de 10.000 a 12.500 perfiles el plan Email pasa de US$ 150 a US$ 275 por mes.
- El conteo se toma al inicio del ciclo de facturación y puede tardar hasta 72 horas en actualizarse tras una limpieza.
- La supresión nativa en bloque alcanza solo a los miembros actuales del segmento; hay que repetirla a mano.
- Un perfil reactivado no se puede volver a suprimir durante 90 días (dato del research; confirmar en la ayuda de Klaviyo).
- En marzo de 2026 Klaviyo sumó recomendaciones de supresión. Recomienda, no programa.
- Competidores directos en el App Store: ListSweep y Nae: Ghost Profile Auditor. Ambos gratis y sin reseñas al 25 de noviembre de 2026.

## Decisiones tomadas (no reabrir sin consultar)

| Tema | Decisión |
| --- | --- |
| Nombre | TierSaver. En la ficha: "TierSaver for Klaviyo". Pensado para sumar otras herramientas con precio por tramos más adelante |
| Dominio | tiersaver.com, registrado en Cloudflare |
| Marca | Independiente |
| Posicionamiento | Higiene de lista automática para Klaviyo; el ahorro en la factura es el resultado medible, no el titular. Cambiado el 2026-11-25 por la cláusula de la Acceptable Use Policy de Klaviyo sobre evadir cargos (ver `STATUS.md`) |
| Identidad | Derivada de Infinure v3 en tema claro; ver `03-MARCA.md` |
| Precio | 20% del ahorro **verificado**: se cobra recién cuando la Billing Usage API de Klaviyo muestra la cuenta en un tramo más bajo. Tope US$ 149 por mes. Nada si no baja de tramo. Decidido el 2026-11-25 |
| Cobro en Shopify | Billing API ("Manual Pricing") con suscripción por uso y `cappedAmount` de US$ 149, visible al aprobar. Decidido el 2026-11-25 |
| Datos de compras | Pedidos de Shopify como diferenciador (`read_orders` + `read_all_orders` con aprobación + mail como dato protegido nivel 2), cruzados con "Placed Order" de Klaviyo. Decidido el 2026-11-25 |
| Camino | Construir directo, sin validación previa. Los cortes de `08-RIESGOS-Y-METRICAS.md` son el freno |
| Hosting | **En revisión** (2026-11-25): Vercel Hobby no permite uso comercial y los 2 proyectos gratis de Supabase están ocupados. Alternativas en `STATUS.md` |
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
- Según `01-PRD.md` y `02-ARQUITECTURA.md`, en este orden: auth de Shopify, conexión a Klaviyo, auditoría, reglas y simulación, supresión con cola, programación, reactivación, registro y deshacer, reporte, cobro, webhooks de privacidad, pruebas de punta a punta.
- Entregable: MVP funcionando en la tienda de desarrollo contra la cuenta de Klaviyo de prueba.

### Fase 4 · Sitio y soporte
- Landing con calculadora pública de ahorro, páginas legales, centro de ayuda, bot de soporte, tres artículos de SEO.
- Entregable: tiersaver.com publicado.

### Fase 5 · Lanzamiento
- Ficha, capturas, video, checklist de `07-LANZAMIENTO.md`.
- Borradores de outreach de `05-GO-TO-MARKET.md` listos para que Facundo envíe.
- Entregable: app lista para enviar a revisión. El envío lo dispara Facundo.

## Definición de terminado

- Un merchant instala, conecta Klaviyo, ve su auditoría, simula, aprueba, y la supresión corre antes de su fecha de facturación sin tocar a nadie protegido.
- Puede deshacer cualquier ejecución.
- Se le cobra según el modelo y lo entiende antes de aceptar.
- Al desinstalar, sus datos se borran.
- Pasa el checklist de requisitos del App Store vigente.

## Contacto

Facundo Bonfigli, único decisor. Juntar los pedidos en un solo mensaje.
