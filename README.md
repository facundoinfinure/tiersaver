# TierSaver · paquete de handover

Paquete para que una sesión de Claude (Claude Code o equivalente, con shell y acceso al repo) lleve TierSaver de cero a app enviada a revisión en el Shopify App Store, con marca, sitio, soporte y go-to-market.

Fecha del handover: 25 de noviembre de 2026.

## Cómo usarlo

1. Crear un repo privado en GitHub y copiar todo este paquete en la raíz.
2. Completar las tareas de `docs/10-TAREAS-HUMANAS.md` marcadas como **bloqueantes** (cuentas y credenciales).
3. Abrir una sesión de Claude sobre el repo y pegar el contenido de `KICKOFF-PROMPT.md`.
4. La sesión lee `CLAUDE.md` y `docs/00-HANDOVER.md`, y trabaja fase por fase. Al final de cada fase actualiza `docs/STATUS.md`.

## Índice

| Archivo | Para qué |
| --- | --- |
| `CLAUDE.md` | Reglas permanentes del proyecto para el agente |
| `KICKOFF-PROMPT.md` | Prompt para arrancar la sesión |
| `docs/00-HANDOVER.md` | Contexto, decisiones, estado y orden de trabajo |
| `docs/01-PRD.md` | Producto: alcance del MVP, historias y criterios de aceptación |
| `docs/02-ARQUITECTURA.md` | Stack, modelo de datos, jobs, integraciones y dudas técnicas a verificar |
| `docs/03-MARCA.md` | Nombre, posicionamiento, mensajes e identidad visual |
| `docs/04-PRECIO-Y-COBRO.md` | Modelo de precio y cómo implementarlo |
| `docs/05-GO-TO-MARKET.md` | Canales, secuencia, agencias y scripts |
| `docs/06-TEARDOWN-REA.md` | Cómo analizar a los competidores con REA |
| `docs/07-LANZAMIENTO.md` | Checklist de envío al App Store y ficha |
| `docs/08-RIESGOS-Y-METRICAS.md` | Cortes para frenar y riesgos |
| `docs/09-FUENTES.md` | Fuentes y qué es dato versus estimación |
| `docs/10-TAREAS-HUMANAS.md` | Lo que solo puede hacer Facundo |
| `docs/STATUS.md` | Bitácora viva que mantiene la sesión |

## Lo que una sesión de Claude no puede hacer sola

Crear cuentas, escribir contraseñas o datos bancarios, aceptar términos, pagar, enviar mensajes en nombre de Facundo sin su aprobación y dar opinión legal. Todo eso está listado en `docs/10-TAREAS-HUMANAS.md`.
