# Materiales de lanzamiento (Fase 5) · borradores

Escrito el 2026-11-26. Nada de esto se envió a ningún lado. El envío a revisión lo dispara Facundo.

## Capturas

`docs/launch/screenshots/` tiene cinco capturas del recorrido: inicio, auditoría, revisión y aprobación, limpieza terminada y ajustes. **Salen del entorno local** (`shopify/preview/`, datos de ejemplo, sin el marco del admin de Shopify), así que sirven para elegir qué mostrar y para el sitio, **no para la ficha**: Shopify pide capturas reales de la app (`07-LANZAMIENTO.md`). Para la ficha hay que repetirlas en la tienda de desarrollo, a 1600 × 900, con la cuenta de prueba.

Para regenerarlas: `npm run preview:app` en `shopify/` y, en otra terminal, `node preview/walk.mjs <carpeta>`.

Cuidado al elegirlas (regla 4.3.3 de Shopify y `12-CUMPLIMIENTO-KLAVIYO.md` 3.2): ninguna captura de la ficha puede mostrar cifras como promesa. Las de auditoría y revisión muestran números del merchant; en la ficha conviene acompañarlas con un título que hable del control ("Review every profile before anything changes"), no del resultado.

## Ficha del Shopify App Store (borrador corregido el 2026-11-26)

Los campos Introduction, Details y Features de acá son los mismos que ahora tiene `docs/07-LANZAMIENTO.md` (sección "Ficha"), que se actualizó el 2026-11-26 junto con el cambio de precio. Qué se corrigió respecto del borrador del 2026-11-25 y por qué:

- **Details tiene un máximo de 500 caracteres.** El borrador anterior tenía más de 800.
- **Ni precio ni "free" fuera de la sección de precios** (requisito 4.2 de Shopify). El borrador anterior decía "a free, read-only audit" en Details y "Free, read-only list audit" en Features.
- **"read-only" era inexacto**: la auditoría no cambia ningún perfil, pero crea un segmento en la cuenta de Klaviyo.
- **"Klaviyo's own recommended criteria"** no se puede usar (reglas de ficha de Klaviyo). Va "the criteria Klaviyo publishes for suppressing unengaged profiles".
- Se sacaron "every run ... can be undone" (el deshacer tiene límites) y las frases sobre el plan de Klaviyo y el momento de la corrida respecto de la renovación (`12-CUMPLIMIENTO-KLAVIYO.md` 3.2).

**Name**: TierSaver for Klaviyo

**Subtitle**: Automatic list hygiene for Klaviyo, with preview and undo

**Introduction** (máx. 100; tiene 99): Keep your Klaviyo list clean: suppress profiles that never engaged, after you approve a simulation.

**Details** (máx. 500; tiene 469): Run an audit to see how many profiles meet the criteria Klaviyo publishes for suppressing unengaged profiles: never opened, clicked, visited or purchased. Every profile is checked against your Shopify orders. SMS subscribers and the lists you protect are always kept. You review and approve a simulation before anything changes. Profiles are suppressed, never deleted, and a cleanup can be restored from the app. TierSaver is not affiliated with or endorsed by Klaviyo.

**Features**
- List audit that changes no profile
- The criteria Klaviyo publishes, by default
- Buyers protected with your Shopify order data
- Simulation and approval before every cleanup
- A log of every cleanup, with restore

**Pricing** (solo en la sección de precios de la ficha, el único lugar donde van precios y la palabra "free"). Free to install; the plan starts when you approve your first cleanup. Cuatro planes mensuales: $9 / month (lists up to 10,000 active profiles), $19 / month (up to 25,000), $39 / month (up to 75,000), $79 / month (up to 150,000). Texto de cada plan: Connecting Klaviyo, the audit and the simulation need no plan. Billed by Shopify every 30 days until you cancel in Settings or uninstall. Lists above 150,000 active profiles: write to hello@tiersaver.com. La tabla completa está en `docs/07-LANZAMIENTO.md`; decisión de Facundo del 2026-11-26.

Los límites de caracteres (100 y 500) y el requisito 4.2 hay que releerlos en la documentación vigente de Shopify antes de cargar la ficha. Nada de esto se cargó ni se envió.

## Instrucciones de prueba para el revisor de Shopify (borrador, en inglés)

```
TierSaver for Klaviyo keeps a merchant's Klaviyo list clean by suppressing profiles that never engaged,
after the merchant reviews and approves a simulation. Nothing is deleted, and a cleanup can be restored from the app.

What you need
- A Klaviyo account. A free account works. We can provide a test account with sample profiles: [CREDENTIALS, sent separately].

Steps
1. Install the app and open it. The home page shows "Get started".
2. Click "Connect Klaviyo" and approve the access request in Klaviyo. You return to the app with "Klaviyo is connected".
3. Click "Run the free audit". It changes no profile and takes one or two minutes. It creates one segment in the
   Klaviyo account ("TierSaver: long-term inactive profiles (managed, do not edit)") and nothing else.
4. Click "Review and approve". Download the candidate list (CSV), tick the confirmation and click
   "Approve and start plan" (the button shows the monthly price).
5. Approving opens Shopify's approval screen for the monthly plan of that list size (a test charge on a
   development store). Approve it. The plan is billed every 30 days until cancelled; installing, connecting
   Klaviyo, the audit and the simulation need no plan.
6. Click "Start cleanup". Each profile is checked again right before it is sent, so the number suppressed can be
   lower than the number approved. The run page shows progress, a "Stop cleanup" button while it runs and, when
   finished, "Check jobs in Klaviyo".
7. On the same page, "Restore" removes the suppression the cleanup added.
8. "Settings" holds the rules, protected lists, the monthly schedule, automatic cleanups, the plan (with
   "Cancel plan") and customer data requests. "History" lists every cleanup and restore.
9. Home → "Disconnect Klaviyo" removes the app's access to Klaviyo.

Notes
- With the default rules the app only suppresses profiles that never purchased, checked against the store's
  full order history. On a store without order history access, or when its order data is not up to date,
  the audit keeps every profile active and says so.
- There is no charge per cleanup. A cleanup only starts while the store has an active plan that covers its list
  size. Restoring a cleanup does not refund the month. Cancelling the plan stops cleanups; audits stay free.
- The app sends no email.
- Uninstalling deletes the store's data from our systems (on Shopify's shop/redact, or 10 days after the
  uninstall if that request does not arrive). It does not unsuppress profiles in Klaviyo.
```

Pendiente para que estas instrucciones sean verdad: credenciales de una cuenta de Klaviyo para el revisor, supresión encendida en producción, cobro probado y acceso a datos protegidos.

## Estado del checklist de `07-LANZAMIENTO.md`

| Punto | Estado |
| --- | --- |
| Instala y desinstala limpio | Instalación probada en la tienda de desarrollo. Desinstalación y reinstalación en una tienda nueva: **sin probar** |
| OAuth de Shopify sin pantallas propias | Cumple |
| Todas las pantallas en Polaris, sin errores de consola | Cumple en el entorno local (recorrido automático, 23 pasos, sin errores). Dentro del admin: vistas por Facundo, sin revisar la consola |
| Estados vacíos y de error | Hechos: sin conexión, reconexión, auditoría fallida, sin historial de pedidos, lista limpia, simulación vencida o desactualizada, corrida detenida. Falta: límite de API con mensaje propio |
| Cobro en modo test | **Sin probar contra Shopify** (espera la distribución pública). Probado con Shopify simulado (`shopify/test/plan.test.ts`): aprobar el plan en la primera limpieza, rechazarlo, dos limpiezas en el mismo mes, lista que sube o baja de tramo, cancelar, plan congelado, tienda de desarrollo |
| Webhooks de cumplimiento con HMAC | Cumple (smoke test en cada despliegue) |
| Scopes mínimos | `read_orders` hoy; `read_all_orders` y datos protegidos por pedir |
| Capturas reales | Borradores del entorno local; faltan las reales |
| Video | Sin hacer |
| Privacidad y términos publicados | Términos, privacidad y DPA publicados como borrador en el staging, con cartel de borrador y sin indexar; esperan el visto bueno del abogado (`16-LEGALES-PARA-ABOGADO.md`) |
| Mail y URL de soporte | Las casillas no existen todavía |
| Monitoreo de errores | Logs de Workers activos; sin alertas |
| Centro de ayuda | Hecho (17 artículos y 3 guías) |
| Bot de soporte | Sin hacer |

## Lo que falta definir para publicar el sitio en serio

Está publicado como **staging, sin indexar**, en https://tiersaver-site.tiersaver.workers.dev. Para la publicación real en tiersaver.com:

1. Dominio: se puede mover a la cuenta TierSaver desde el 2026-12-05.
2. Términos, privacidad y DPA: ya tienen texto completo (limitación de responsabilidad, ley de Florida, subencargados, retención), pero siguen como borrador hasta el visto bueno del abogado. Las preguntas abiertas están en `16-LEGALES-PARA-ABOGADO.md`, sección 3.
3. Fecha de vigencia de las tres páginas y `TERMS_VERSION` de la app: hoy dicen 2026-11-27 (el cambio a plan mensual); se vuelven a fijar el día en que se saque el cartel de borrador.
4. Aviso dentro de la app ("notice banner") para cambios de términos, de política y de subencargados: los textos lo prometen y el código todavía no lo tiene (`16-LEGALES-PARA-ABOGADO.md`, sección 5).
5. URL de la ficha del App Store para el botón "Run my free list audit". Hasta que exista la ficha, el botón abre un mail a hello@tiersaver.com, y el sitio lo dice.
6. Casillas hello@ y support@.
