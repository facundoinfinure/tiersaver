# Tareas que solo puede hacer Facundo

Una sesión de Claude no crea cuentas, no escribe contraseñas ni datos bancarios, no acepta términos, no paga y no envía mensajes sin aprobación.

## Bloqueantes para empezar (Fase 0)

| # | Tarea | Qué entregar a la sesión |
| --- | --- | --- |
| 1 | Crear repo privado en GitHub y copiar este paquete | Acceso al repo |
| 2 | Crear cuenta de Shopify Partner y la app en el Dev Dashboard (pasos en `13-INSTRUCTIVO-CUENTAS.md`). Se puede empezar como individuo y sumar la LLC después | Client ID, y por formulario seguro: Client secret y token de service account |
| 3 | Crear una tienda de desarrollo desde el Dev Dashboard (pasos en `13-INSTRUCTIVO-CUENTAS.md`) | Dominio `*.myshopify.com` |
| 4 | Crear una cuenta de Klaviyo nueva, solo para pruebas, y convertirla en test account (pasos en `13-INSTRUCTIVO-CUENTAS.md`) | Clave privada como variable `KLAVIYO_TEST_PRIVATE_KEY` del entorno "tiersaver" |
| 5 | Crear una cuenta de Cloudflare nueva solo para TierSaver, mover tiersaver.com ahí y crear un API token (ver abajo). Reemplaza Vercel + Supabase (decisión del 2026-11-25) | Account ID; el token se carga por el formulario seguro que abre la sesión |

`.env` es local: no se sube al repo. La sesión provee `.env.example` con los nombres de las variables.

### Pasos de la tarea 5 (según la documentación de Cloudflare vigente)

1. Crear la cuenta nueva con un mail que controles (idealmente de la LLC o de TierSaver).
2. En la cuenta nueva: **Add a domain** → `tiersaver.com` → plan Free. Copiar el **Account ID**.
3. En la cuenta vieja: **Domain Registration → Manage Domains → tiersaver.com → Configuration**. Apagar DNSSEC si está activo y pedir el **move** a la cuenta nueva con su Account ID.
4. Aprobar el mail que llega a la cuenta nueva (hay 5 días; si no, se cancela).

Estado al 2026-11-25: pasos 1 y 2 hechos. El dominio se registró el 2026-11-25, así que los pasos 3 y 4 se pueden hacer desde el **2026-12-05**.

Condiciones: el dominio tiene que tener más de 10 días de registrado y el mail del titular verificado. La configuración de la cuenta vieja se pierde y el dominio queda bloqueado para transferencias 30 días. Fuente: developers.cloudflare.com/registrar/account-options/inter-account-transfer/

## Durante la construcción

| # | Tarea | Cuándo |
| --- | --- | --- |
| 6 | Instalar ListSweep y Nae en la tienda de desarrollo, recorrerlas y exportar el HAR. Nae no apareció en la búsqueda del App Store el 2026-11-25; la otra app comparable encontrada es ShopiDeck: Klaviyo Bot Cleaner (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.10) | Fase 1 |
| 7 | Aprobar o rechazar la instalación de REA | Fase 1 |
| 8 | Elegir entre las tres opciones de logo | Fase 2 |
| 9 | Crear la app OAuth en Klaviyo si se confirma ese camino (requiere rol owner, admin o manager) | Fase 3 |
| 10 | Cargar los registros DNS de tiersaver.com en Cloudflare con los valores que dé la sesión, o conectar el conector nuevo de Cloudflare | Fase 4 |
| 11 | Crear casilla de soporte (por ejemplo support@tiersaver.com) | Fase 4 |
| 12 | Hacer revisar por un abogado los términos de servicio propios de TierSaver, la política de privacidad y la limitación de responsabilidad frente a merchants (ventas perdidas por una supresión aprobada, cuenta de Klaviyo suspendida). Es una revisión de plantilla, recomendada antes de lanzar. **Ya no es bloqueante por la cláusula de la AUP de Klaviyo sobre evadir cargos**: con el precio fijo y los guardarraíles adoptados el 2026-11-25, esa consulta dejó de ser necesaria (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 5). Ese documento es un análisis de políticas, no asesoramiento legal | Antes de lanzar |
| 12b | En el Dev Dashboard de Shopify, pedir `read_all_orders` y acceso a datos protegidos nivel 2 (email), con la justificación que redacta la sesión | Fase 3 |

## Para lanzar

| # | Tarea |
| --- | --- |
| 13 | Completar datos fiscales y de pago de la LLC en el panel de partners |
| 14 | Revisar la ficha y disparar el envío a revisión |
| 15 | Revisar y enviar los borradores de outreach |
| 16 | Decidir si se registra la marca TierSaver; antes, buscar "tier saver" con espacio en USPTO (clases 9 y 42) y el nombre en el Shopify App Store |

## Después de la revisión de políticas (2026-11-25)

Tareas y decisiones que propone `12-CUMPLIMIENTO-KLAVIYO.md`. Ninguna está aplicada.

| # | Tarea | Cuándo |
| --- | --- | --- |
| 17 | Confirmar los límites de tamaño de lista del precio. Los precios (US$ 29 / 79 / 149) están decididos; los límites (25.000 / 75.000 / 150.000 perfiles activos) son provisionales. Hasta confirmarlos, todo texto que los muestre lo dice, y no se envía la ficha con esos números | Antes de publicar precios |
| 18 | Decidir el descriptor del nombre. Opciones (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.3): (1) mantener "TierSaver for Klaviyo" y asumir que el nombre contradice el posicionamiento; (2) mantener la marca y cambiar el descriptor a "TierSaver: List Hygiene for Klaviyo"; (3) cambiar la marca por una de higiene. Cambiarlo después del lanzamiento cuesta mucho más. Incluye decidir si se revisa el logo | Antes de la ficha |
| 19 | Decidir si se contacta a Klaviyo y cuándo (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.2). Caminos: una consulta escrita a su casilla legal, preguntando si una app que automatiza la supresión de inactivos con los criterios de su ayuda es compatible con la AUP; enviar la app a la revisión de su marketplace al llegar a 5 instalaciones con actividad real; el programa de partners solo después del listado. Riesgo de consultar: llamar la atención y recibir un no. La sesión deja el mail como borrador; enviarlo, enviar a revisión y aceptar el acuerdo de partners los hace Facundo | A decidir |
| 20 | Actualizar a mano, una vez por mes, la tabla de precios de Klaviyo (`packages/core/src/price-tables/klaviyo.ts`). No se hace por lectura automática de klaviyo.com: los términos de su sitio prohíben el acceso automatizado (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 1.4, y sección 3.1, regla 13). Facundo mira la página y le pasa los valores a la sesión, o los carga | Mensual |

Otras decisiones abiertas que salen de la misma revisión:

- Si el cobro pasa de la Billing API a Shopify App Pricing, que con precio fijo es posible. Hoy sigue la Billing API con tope de US$ 149 (`04-PRECIO-Y-COBRO.md`).
- El umbral del corte de la semana 5 en `08-RIESGOS-Y-METRICAS.md`, que estaba definido sobre el ahorro en dólares.
- Volver a aprobar los mensajes: `brand/messaging.md` se revisó después de la aprobación del 2026-11-25.
- Si se le escribe a la agencia cuya receta publicada suprime y vuelve a activar perfiles (`05-GO-TO-MARKET.md`, prioridad A).

## Decisiones que la sesión va a traer

- Método de conexión a Klaviyo (OAuth o clave privada), según lo que permita la plataforma.
- Dónde corren los workers si las funciones de Vercel no alcanzan.
- Proveedor de mail transaccional y de analítica.

## Pendiente de aclarar

- En cuál de las dos cuentas de Cloudflare quedó tiersaver.com. Como la marca es independiente, conviene que no dependa de la cuenta de otro proyecto.
