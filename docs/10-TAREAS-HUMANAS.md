# Tareas que solo puede hacer Facundo

Una sesión de Claude no crea cuentas, no escribe contraseñas ni datos bancarios, no acepta términos, no paga y no envía mensajes sin aprobación.

## Bloqueantes para empezar (Fase 0)

| # | Tarea | Qué entregar a la sesión |
| --- | --- | --- |
| 1 | Crear repo privado en GitHub y copiar este paquete | Acceso al repo |
| 2 | Crear cuenta de Shopify Partner a nombre de la LLC | Acceso con Shopify CLI (login interactivo en la sesión) |
| 3 | Crear una tienda de desarrollo desde el panel de partners | Dominio `*.myshopify.com` |
| 4 | Crear una cuenta de Klaviyo nueva, solo para pruebas | Clave privada de API de esa cuenta, en `.env` |
| 5 | Crear proyecto en Vercel y en Supabase, o autorizar a la sesión a crearlos | Tokens en `.env` |

`.env` es local: no se sube al repo. La sesión provee `.env.example` con los nombres de las variables.

## Durante la construcción

| # | Tarea | Cuándo |
| --- | --- | --- |
| 6 | Instalar ListSweep y Nae en la tienda de desarrollo, recorrerlas y exportar el HAR | Fase 1 |
| 7 | Aprobar o rechazar la instalación de REA | Fase 1 |
| 8 | Elegir entre las tres opciones de logo | Fase 2 |
| 9 | Crear la app OAuth en Klaviyo si se confirma ese camino (requiere rol owner, admin o manager) | Fase 3 |
| 10 | Cargar los registros DNS de tiersaver.com en Cloudflare con los valores que dé la sesión, o conectar el conector nuevo de Cloudflare | Fase 4 |
| 11 | Crear casilla de soporte (por ejemplo support@tiersaver.com) | Fase 4 |
| 12 | Hacer revisar por un abogado: política de privacidad, términos, limitación de responsabilidad por supresiones, y si los términos de la API de Klaviyo permiten el producto. **Adelantada a ya** (2026-11-25) para la cláusula de la AUP de Klaviyo sobre evadir cargos | Ya |
| 12b | En el Dev Dashboard de Shopify, pedir `read_all_orders` y acceso a datos protegidos nivel 2 (email), con la justificación que redacta la sesión | Fase 3 |

## Para lanzar

| # | Tarea |
| --- | --- |
| 13 | Completar datos fiscales y de pago de la LLC en el panel de partners |
| 14 | Revisar la ficha y disparar el envío a revisión |
| 15 | Revisar y enviar los borradores de outreach |
| 16 | Decidir si se registra la marca TierSaver; antes, buscar "tier saver" con espacio en USPTO (clases 9 y 42) y el nombre en el Shopify App Store |

## Decisiones que la sesión va a traer

- Método de conexión a Klaviyo (OAuth o clave privada), según lo que permita la plataforma.
- Si Shopify no acepta el precio por % de ahorro: pasar a tramos fijos o reformular.
- Dónde corren los workers si las funciones de Vercel no alcanzan.
- Proveedor de mail transaccional y de analítica.

## Pendiente de aclarar

- En cuál de las dos cuentas de Cloudflare quedó tiersaver.com. Como la marca es independiente, conviene que no dependa de la cuenta de otro proyecto.
