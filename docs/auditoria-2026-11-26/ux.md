# Revisión de UX de TierSaver antes del lanzamiento

Fecha: 2026-11-26. Alcance: experiencia del merchant, flujos, calidad de diseño, accesibilidad y estados completos, sobre las pantallas reales de `shopify/app/routes/`.

## Cómo se hizo

- Se levantó el preview local (`npm run preview:app` en `shopify/`, puerto 3210) con sesión de Shopify simulada y Klaviyo falso. No se tocó ningún servicio real: el navegador bloqueaba klaviyo.com, shopify.com, myshopify.com y tiersaver.com, y no hubo ningún pedido bloqueado.
- Se recorrió la app con Playwright (Chromium headless, deviceScaleFactor 1) a 1280 px y 390 px. Hay 170 capturas en `ux-shots/`: sufijo `-d` es escritorio, `-m` es móvil. Los prefijos `a` a `g` son las tandas del recorrido.
- Los estados que la interfaz no permite alcanzar a mano (corrida fallida, parcial, simulación vencida, renovación ya ocurrida, etc.) se forzaron escribiendo en la D1 **local** del preview. Esos estados muestran la pantalla real, pero los datos son armados: donde un detalle es producto del armado, está aclarado.
- No se modificó ningún archivo del repo. Al terminar se corrió `/__preview/reset` y se apagó el servidor. Los cambios sin commitear que muestra `git status` (`webhooks.*`, `shopify-webhook.server.ts`) son de otra persona.
- Requisitos de Shopify leídos el 2026-11-26 en shopify.dev: "Built for Shopify requirements" y "App Store requirements". Los números de sección citados salen de ahí.

Límites de esta revisión:

- App Bridge no corre en el preview. La barra de navegación se ve como links sueltos arriba: es del preview, no un hallazgo. No se pudo ver la barra de guardado, el título de la app en el admin ni el comportamiento real de `target="_top"`.
- No se probó con lector de pantalla real. Lo de accesibilidad sale del árbol de accesibilidad de Chromium, del orden de tabulación y del código.
- La pantalla de aprobación de precio de Shopify no existe en el preview: se saltea con un redirect.

## Resumen

El flujo principal funciona de punta a punta y tiene buenas bases: nada se suprime sin simulación aprobada, los números tienen formato consistente, la casilla de términos se valida en el servidor, el doble clic en "Start cleanup" creó una sola corrida, y los textos son sobrios y cumplen el tono de marca.

Lo que hay que arreglar antes de lanzar se concentra en cuatro temas:

1. **Errores que el merchant no ve.** Los errores de validación aparecen arriba de la página mientras el merchant está abajo, y las páginas 404 son texto crudo sin navegación.
2. **Acciones de alto impacto sin confirmación.** Restaurar 2.234 perfiles y desconectar Klaviyo se ejecutan con un clic.
3. **Callejones sin salida en Home.** Simulación vencida, corrida fallida, corrida en curso y primera auditoría sin historial de pedidos dejan al merchant sin siguiente paso.
4. **Cobro poco claro antes de aprobar.** No se explica el tope de US$ 149 que va a mostrar Shopify, ni cuándo sale el cargo, ni que deshacer después no devuelve nada.

No encontré ningún camino para suprimir sin simulación aprobada.

## Hallazgos

Severidades: **bloqueante** (no lanzar así), **alto** (arreglar antes de lanzar), **medio** (arreglar pronto), **bajo** (pulido).

### Bloqueantes

#### B1 · Las páginas de error son texto crudo, sin navegación

- **Pantalla y estado:** cualquier ruta inexistente (`/app/nope`) y una corrida que no existe (`/app/runs/<id inválido>`).
- **Captura:** `d-40-run-404-d.png`, `d-41-route-404-d.png` (y las `-m`).
- **Qué vive el merchant:** una página en blanco que dice "Not found" en tipografía serif, sin título, sin menú y sin botón para volver. Pasa, por ejemplo, al abrir un link viejo a una corrida. Un error 500 de cualquier loader cae en el mismo `ErrorBoundary` de `app.tsx` (`boundary.error`), y `root.tsx` no tiene ninguno propio; ese caso no lo pude forzar, lo infiero del código.
- **Por qué es bloqueante:** el requisito 2.1.1 del App Store rechaza apps con páginas de error 404/500 durante la revisión.
- **Corrección:** en `app.tsx`, que el `ErrorBoundary` siga delegando en `boundary.error` para las respuestas que Shopify necesita, y para el resto renderice un `s-page` dentro del `AppProvider` con la navegación:
  - 404: `<s-page heading="Page not found">` + `<s-section>` con "This page does not exist or is no longer available." y `<s-button href="/app" variant="primary">Go to home</s-button>`.
  - Otros: heading "Something went wrong", texto "Nothing was changed in Klaviyo. Reload the page. If it keeps happening, contact support." con link a soporte, y botón "Reload".
  - En `app.runs.$runId.tsx`, en vez de tirar 404, mostrar "This cleanup no longer exists." con botón "Back to History".
- **Reprueba:** abrir `/app/nope` y `/app/runs/x` y ver página con menú y botón de vuelta, en 1280 y 390.

#### B2 · Error de hidratación en todas las pantallas con fecha, para todo merchant fuera de UTC

- **Pantalla y estado:** Home, Review, History y detalle de corrida, en cualquier estado que muestre fecha y hora.
- **Evidencia:** con el navegador en `America/Los_Angeles`, la consola da `Text content did not match. Server: "Nov 26, 2026, 1:36 AM" Client: "Nov 25, 2026, 5:36 PM"` y `Hydration failed… the entire root will switch to client rendering`. Sin captura: es salida de consola del script `p7.mjs`.
- **Qué vive el merchant:** el servidor (Workers, UTC) pinta una hora y el navegador la reemplaza por otra. React descarta todo el HTML del servidor y vuelve a renderizar la página entera: parpadeo, y si el merchant ya había tildado algo, se pierde. Además ninguna fecha dice en qué zona horaria está, y el vencimiento de la simulación ("can be used until…") es una fecha que importa.
- **Por qué es bloqueante:** afecta a casi todos los merchants en las pantallas principales, y Built for Shopify 4.1.1 penaliza parpadeo y recargas. Si preferís tratarlo como alto, es defendible; no lo lanzaría así.
- **Corrección:** formatear las fechas en el servidor con la zona de la tienda (la tabla `shops` ya guarda `iana_timezone`) y pasar el texto ya formateado desde el loader, con la zona visible: "Nov 25, 2026, 5:36 PM PST". Alternativa mínima: `timeZone: "UTC"` fijo en los cuatro `toLocaleString` y sufijo "UTC". Usar `<time dateTime={iso}>`.
- **Reprueba:** repetir con `timezoneId` distinto de UTC y verificar cero mensajes de hidratación.

### Altos

#### A1 · Los errores de validación quedan fuera de la vista

- **Pantalla y estado:** Review al aprobar sin tildar la casilla; Settings al guardar con valores inválidos; detalle de corrida al restaurar sin tildar la confirmación.
- **Captura:** `e-02-review-error-viewport-m.png`, `e-03-settings-error-viewport-m.png` (lo que queda en pantalla tras el error); `a-16-review-approve-without-ticking-d.png` y `c-11-settings-validation-errors-d.png` (página completa, con el banner arriba).
- **Qué vive el merchant:** aprieta el botón al pie de la página y no pasa nada visible. El banner de error aparece arriba de todo, fuera de pantalla, y el foco no se mueve. En Settings los campos con error no se marcan. En el detalle de corrida es peor: si no tilda "I understand…", el clic en "Restore" no muestra ningún mensaje (`d-36-undo-confirm-not-ticked-d.png`).
- **Requisito:** Built for Shopify 4.2.4: los errores van en rojo, junto al campo, y explican cómo arreglarlo.
- **Corrección:**
  - Review: prop `error` en el `s-checkbox` "acknowledged": "Tick this box to approve." Mantener el banner, pero llevarlo al lado del botón o hacer scroll y foco.
  - Settings: devolver los errores por campo desde la acción y pasarlos a la prop `error` de cada `s-number-field`. Ejemplo: "Enter a number between 4 and 14."
  - Corrida: `error` en el `s-checkbox` "confirmAfterRenewal": "Tick this box to confirm before restoring."
  - En los tres: tras una acción con error, mover el foco al primer campo con error.
- **Reprueba:** repetir los tres envíos inválidos a 390 px y ver el mensaje sin hacer scroll.

#### A2 · Restaurar miles de perfiles se ejecuta con un solo clic

- **Pantalla y estado:** detalle de corrida completada, sección "Undo this cleanup".
- **Captura:** `b-05-run-completed-d.png` (antes), `c-01-undo-first-click-d.png` (después de un clic ya está corriendo la restauración).
- **Qué vive el merchant:** un clic en "Restore 2,234 profiles" arranca la restauración. No hay confirmación, y falta el aviso que pide el PRD (sección 8): que Klaviyo no deja volver a suprimir esos perfiles hasta 90 días después. El texto solo menciona los 365 días de TierSaver. Tampoco dice qué pasa con el cargo.
- **Corrección:** `s-modal` con `heading="Restore 2,234 profiles?"`, acción primaria crítica "Restore profiles", secundaria "Cancel", y este texto:
  - "They can receive marketing email again and count toward your Klaviyo plan again."
  - "TierSaver will not suppress them again for 365 days. Klaviyo's help center says a restored profile cannot be suppressed again for 90 days."
  - Según el estado del cargo: "This cleanup has not been charged yet. If you restore all of it before {date}, it is not charged." o "This cleanup was already charged. Restoring does not refund it."
  - La confirmación por renovación ya existente va dentro del mismo modal.
- **Reprueba:** un clic no debe crear ninguna fila `undo` en `runs`.

#### A3 · Desconectar Klaviyo no pide confirmación ni avisa lo que se corta

- **Pantalla y estado:** Home, tarjeta "Klaviyo connection".
- **Captura:** `a-14-home-audited-d.png`, `d-43-home-disconnected-d.png`.
- **Qué vive el merchant:** un clic en el botón rojo desconecta. El texto no avisa que se frena la limpieza mensual, que se pierde la simulación pendiente y que para deshacer una limpieza hay que volver a conectar (lo último lo infiero de `gateway.server.ts`, que rechaza también los lotes de deshacer sin conexión).
- **Corrección:** `s-modal` con `heading="Disconnect Klaviyo?"`: "TierSaver loses access to your Klaviyo account. Scheduled audits stop and any pending simulation is discarded. Suppressed profiles stay suppressed. To undo a past cleanup you will need to connect again." Botones "Disconnect" (crítico) y "Cancel".
- **Reprueba:** un clic no desconecta; el modal se cierra con Escape y devuelve el foco al botón.

#### A4 · Home no dice qué hacer cuando la simulación venció

- **Pantalla y estado:** Home con simulación vencida (más de 24 horas); Review vencida.
- **Captura:** `d-10-home-sim-expired-d.png`, `d-09-review-expired-d.png`.
- **Qué vive el merchant:** Home sigue mostrando "A cleanup would suppress 2,234", el paso 3 "Review and approve" resaltado pero sin botón, y ningún aviso de que venció. En Review el banner dice "Run the audit again from the home page", sin botón.
- **Agravante:** con la programación mensual en modo aprobación, la auditoría corre sola y espera 24 horas. No encontré ningún aviso al merchant (busqué envío de mails o notificaciones en `shopify/app` y `shopify/workers` y no hay). El PRD (sección 6) pide un mail con el resumen. Hoy esa simulación vence sin que nadie se entere, todos los meses.
- **Corrección:**
  - Home: banner `tone="warning"` "Your last simulation expired" con texto "A simulation can be approved for 24 hours. Run the audit again to get a current one." y botón primario "Run the audit again". Mismo botón en el paso 3.
  - Review vencida o desactualizada: agregar el formulario con `intent=scan` y botón primario "Run the audit again" dentro del banner.
  - Programación: implementar el aviso por mail, o hasta entonces decirlo en Settings y Home: "TierSaver does not email you yet. Open the app on {date} to review and approve within 24 hours."
- **Reprueba:** forzar `created_at` 25 horas atrás y ver el botón en ambas pantallas.

#### A5 · Una corrida fallida o en curso no se ve en Home

- **Pantalla y estado:** Home con la última corrida en `failed`, y con una corrida `running`.
- **Captura:** `d-27-home-run-failed-d.png`, `d-22-home-run-running-d.png`, `d-28-review-after-failed-run-d.png`.
- **Qué vive el merchant:**
  - Fallida: "Last cleanup: 0 profiles suppressed." sin indicar que falló ni por qué. El paso 4 "Run the cleanup" queda resaltado sin botón. Review dice "This simulation was used for a cleanup", así que no hay cómo reintentar salvo adivinar que hay que auditar de nuevo.
  - En curso: la página de la corrida dice "You can leave this page", pero Home no muestra nada sobre la corrida; dice "0 profiles suppressed."
- **Nota:** el estado se armó en la base local. Que una corrida fallida consume la simulación sale del código (`executed_at` se marca al iniciar).
- **Corrección:**
  - En curso: banner `tone="info"` "A cleanup is in progress" con "{n} of {total} profiles sent to Klaviyo so far." y botón "View progress".
  - Fallida: banner `tone="critical"` "Your last cleanup did not run" con el motivo ya traducido en `RUN_ERRORS`, "No profiles were suppressed and nothing is charged." y botón "Run the audit again" (o "Reconnect Klaviyo" si corresponde).
  - "Last cleanup": mostrar el `s-badge` de estado igual que History.
  - En el detalle de corrida fallida o parcial, agregar el botón de siguiente paso (ver M4).
- **Reprueba:** forzar `status='failed'` y `status='running'` y revisar Home.

#### A6 · Antes de aprobar no queda claro cuánto, cuándo y con qué tope se cobra

- **Pantalla y estado:** Review abierta y aprobada sin precio aceptado.
- **Captura:** `a-15-review-open-d.png`, `b-01-review-approved-billing-not-accepted-d.png`.
- **Qué vive el merchant:** el precio es una línea de texto debajo de cinco avisos ("Price: $29 for this cleanup (…)"). No dice cuándo sale el cargo (72 horas después, según el texto nuevo del detalle de corrida), ni que deshacer antes lo anula y después no hay devolución. Después Shopify le va a mostrar una suscripción por uso con máximo de US$ 149, y la app no lo anticipa: el merchant esperaba US$ 29 y ve US$ 149. El handover exige que lo entienda antes de aceptar.
- **Corrección:**
  - Sumar una cuarta tarjeta `Metric` en la grilla: label "TierSaver price for this cleanup", valor "$29", detalle "Charged through Shopify 72 hours after the cleanup".
  - Reemplazar la línea de precio por: "You pay $29 for this cleanup: the monthly price for lists up to 25,000 active profiles. The charge is sent to Shopify 72 hours after the cleanup finishes. If you undo the whole cleanup before then, you are not charged. After that, undoing does not refund it. At most one charge every 28 days."
  - En el paso de precio: "Shopify will show a maximum of $149 per 30 days. That is a ceiling set for the largest list size, not your price. Your price is $29."
  - Las 72 horas las está tocando otra persona en `app/billing/`: tomar el número de una constante compartida.
- **Sin verificar:** el texto exacto de la pantalla de Shopify; hay que mirarlo en la tienda de desarrollo.

#### A7 · Después de deshacer todo, la corrida sigue diciendo "Estimated charge: $29"

- **Pantalla y estado:** detalle de una limpieza ya restaurada por completo, con el cargo todavía pendiente.
- **Captura:** `c-05-cleanup-after-undo-d.png`.
- **Qué vive el merchant:** la tabla dice "Restored later: 2,234" y debajo "Estimated charge: $29… or you restore the whole cleanup before then, nothing is charged." Ya la restauró entera y la página le sigue anunciando un cargo. Lo mismo con el cargo en estado `failed` (`d-34-charge-failed-d.png`): se ve igual que pendiente.
- **Corrección:** en `loadRunDetail`, si `undo.restorable === 0` y el cargo está pendiente, mostrar "Not charged: you restored this cleanup before the charge was sent." Si no, mostrar la fecha concreta: "Estimated charge: $29, sent to Shopify on Nov 29, 2026 at 1:30 AM UTC unless you restore the whole cleanup first."
- **Nota:** esta zona está en edición por otra persona; puede que ya lo esté resolviendo.

#### A8 · Primera auditoría sin historial de pedidos: cero candidatos y ningún paso siguiente

- **Pantalla y estado:** Home tras la primera auditoría, cuando el historial de pedidos de Shopify todavía no cubre todo.
- **Captura:** `a-11-home-audited-no-order-history-d.png`, `a-12-review-zero-candidates-d.png`.
- **Qué vive el merchant:** es lo primero que ve después de conectar. "A cleanup would suppress 0", un aviso de que no se pudo cruzar con el historial completo de pedidos, y nada más: no dice si tiene que esperar, cuánto, ni si tiene que hacer algo. El paso 3 queda resaltado sin botón. Es el momento de mayor abandono posible.
- **Corrección:** banner con estado y acción según el caso:
  - Importación en curso: "TierSaver is still reading your Shopify order history. This usually takes {x}. Run the audit again when it finishes." con indicador de progreso si el workflow lo expone.
  - Falta el permiso de historial completo: decirlo y explicar qué falta.
  - En ambos, botón "Run the audit again" primario en el paso 2, y el paso 3 sin resaltar.
- **Sin verificar:** cómo se comporta el backfill real; en el preview no corre.

#### A9 · No hay ayuda ni contacto de soporte dentro de la app

- **Pantalla y estado:** todas.
- **Captura:** `d-05-home-scan-failed-contact-support-d.png`.
- **Qué vive el merchant:** un mensaje de error dice "Contact support and we will sort it out" y no hay link, mail ni botón. Los únicos links externos son Terms y Privacy en Review. El sitio ya tiene artículos que responden justo las dudas de cada pantalla (`site/help/`: what-suppress-means, simulation-and-approval, undo, pricing, monthly-schedule-and-your-klaviyo-plan, cleanup-criteria), pero `app/legal.ts` solo expone términos y privacidad.
- **Corrección:** ampliar `legalUrls` con `help` y `support`, y agregar con `s-link target="_blank"`:
  - Home, tarjeta lateral "Help": "Help center" y "Contact support".
  - Review, "Before you approve": "What suppressing means" y "How undo works".
  - Detalle de corrida, sección de deshacer: "How undo works".
  - Settings, programación: "The monthly schedule and your Klaviyo plan".
  - Lista por encima de 150.000 (`d-08-review-above-150k-d.png`): hoy dice "priced by agreement" y deja aprobar sin decir con quién acordar. Agregar "Contact us to agree on a price before your first cleanup." con link.

#### A10 · Activar el modo automático no avisa que va a suprimir y cobrar sin intervención

- **Pantalla y estado:** Settings, casilla "Run the scheduled cleanup automatically, without waiting for my approval".
- **Captura:** `c-14-settings-saved-automatic-m.png`, `d-02-home-restore-locked-d.png` ("On · Runs automatically").
- **Qué vive el merchant:** tilda una casilla, guarda, y desde ahí TierSaver suprime perfiles y genera un cargo todos los meses sin que nadie mire. El texto de ayuda no menciona el cobro ni que no hay aviso previo.
- **Corrección:** detalle de la casilla: "Each month TierSaver suppresses the profiles that meet Klaviyo's criteria and charges the price for your list size, without asking you first. You can undo any cleanup from History." Al guardar con la casilla recién tildada, confirmar con `s-modal` "Turn on automatic cleanups?". En Home, bajo el badge: "Next cleanup runs on its own on {date}."

### Medios

#### M1 · Settings no usa la barra de guardado y deja salir con cambios sin guardar

- **Captura:** `a-09-settings-connected-default-d.png`.
- **Qué pasa:** el formulario tiene un botón "Save settings" al final de una página larga y ningún aviso al salir con cambios. Lo vi en el código (no hay `data-save-bar`); en el preview no se puede probar porque App Bridge no corre.
- **Requisito:** Built for Shopify 4.1.5.
- **Corrección:** `<Form method="post" data-save-bar>` y sacar la sección con el botón.

#### M2 · "Your list is already clean" cuando en realidad hay 2.234 perfiles retenidos por el bloqueo

- **Captura:** `d-02-home-restore-locked-d.png`, `d-03-review-restore-locked-d.png`.
- **Qué pasa:** tras deshacer una limpieza, la auditoría siguiente da 0 candidatos y dice que la lista ya está limpia. No lo está: 2.234 perfiles cumplen los criterios y quedaron fuera por 365 días.
- **Corrección:** cuando hay 0 candidatos y `recently_reactivated > 0`: "Nothing to suppress right now. 2,234 profiles meet the criteria but were restored recently, so TierSaver leaves them out until {date}." Reservar "already clean" para cuando nadie cumple los criterios.

#### M3 · La lista de candidatos no se puede descargar completa en listas grandes

- **Dónde:** `CandidateDownload` en `app.simulation.tsx`. Solo código, no lo reproduje.
- **Qué pasa:** se muestran como máximo 40 botones de 1.500 perfiles. Con más de 60.000 candidatos el texto dice "The list comes in N files" y los archivos 41 en adelante no tienen botón. El merchant aprueba algo que no pudo revisar entero.
- **Corrección:** `s-select` "File" con todas las partes más un botón "Download", o paginar los botones. Con más de 3 archivos la fila de botones tampoco escala en móvil.

#### M4 · Corrida parcial o fallida: sin explicación ni siguiente paso

- **Captura:** `d-29-run-partial-m.png`, `d-24-run-failed-reauth-d.png`.
- **Qué pasa:** "Not processed because of an error: 200" y nada más. No dice si se reintenta, si esos perfiles quedaron intactos ni cómo incluirlos. En la fallida, el badge dice "Did not run" y el banner "This run stopped early": dos cosas distintas.
- **Corrección:** banner `tone="warning"` "200 profiles were not processed": "They were left untouched in Klaviyo. Run a new audit to include them in the next cleanup." con botón "Run the audit again". Unificar: "Did not run" si se envió 0, "Stopped early" si se envió algo.

#### M5 · No se puede frenar una limpieza en curso

- **Captura:** `d-21-run-running-d.png`.
- **Qué pasa:** si el merchant se da cuenta de un error mientras corre, solo puede esperar y después deshacer (con el bloqueo de 365 días para todos). El estado `cancelled` existe en la base y en las etiquetas, pero no hay botón.
- **Corrección:** botón "Stop cleanup" con confirmación: "Profiles already sent to Klaviyo stay suppressed. You can restore them afterwards." Es un cambio de alcance: decisión de Facundo.

#### M6 · El detalle de corrida no muestra quién aprobó ni con qué reglas

- **Captura:** `b-05-run-completed-d.png`, `a-03-history-empty-d.png`.
- **Qué pasa:** el estado vacío de History promete "with who started it and what it changed", y el PRD (sección 8) pide origen, reglas y quién aprobó. La página no lo muestra, aunque `createdBy` ya viaja en el loader.
- **Corrección:** en "Summary": "Approved by {staff name} on {date}", "Rules: Klaviyo's recommended criteria" (o las ventanas usadas) y "Reason: Never opened, clicked, visited or purchased". Mostrar nombre, no el id numérico de usuario.

#### M7 · La tabla de jobs de Klaviyo es ruido técnico

- **Captura:** `b-06-run-jobs-d.png`.
- **Qué pasa:** 23 filas "JOB0001 · complete · 100 of 100" para una lista chica; una de 150.000 da cientos, paginadas de a 25 con un botón "Check next page".
- **Corrección:** dejar el resumen ("23 of 23 jobs are complete: 2,234 profiles processed, 0 skipped by Klaviyo") y poner la tabla dentro de un `s-details` "Show jobs". Reemplazar "This run created 23 jobs" por "Klaviyo is applying this cleanup in 23 batches."

#### M8 · Términos inconsistentes

- **Dónde:** todas las pantallas.
- **Qué pasa:**
  - "cleanup" y "run": "This run stopped early", "This run created 23 jobs".
  - "undo" y "restore": sección "Undo this cleanup", botón "Restore", tipo "Restore (undo)".
  - "audit" y "simulation": el merchant corre un "audit", revisa una "simulation" en la página "Review cleanup", aprieta "Approve simulation" y después "Start cleanup".
  - "bought" y "purchased"; "Klaviyo's inactive criteria", "long-term inactive criteria", "cleanup criteria".
- **Corrección:** un glosario fijo: audit (leer), simulation (resultado a aprobar), cleanup (suprimir), restore (verbo y sustantivo en botones y tipos; "undo" solo como explicación), purchased, "Klaviyo's inactive criteria". Botones: "Approve this cleanup" y "Start cleanup: suppress 2,234 profiles". Programación: "Run the audit every month" y "Run the cleanup automatically after each monthly audit".

#### M9 · El desglose de la simulación no cierra a la vista

- **Captura:** `a-15-review-open-d.png`.
- **Qué pasa:** 2.640 menos 240, 115 y 72 da 2.213, y la pantalla dice 2.234. La nota de superposición lo explica, pero el merchant que hace la cuenta desconfía justo antes de aprobar.
- **Corrección:** agregar una fila "Kept active in total: 406" (2.640 menos 2.234) antes de las razones, y sangrar las razones debajo como detalle. Usar `s-table` en vez de pilas de texto: hoy el árbol de accesibilidad lo lee como un solo párrafo corrido.

#### M10 · Review no avisa que Klaviyo está desconectado

- **Captura:** `d-12-review-approved-needs-reauth-d.png`.
- **Qué pasa:** con la conexión caída, Review deja seguir hasta aceptar el precio en Shopify, y recién "Start cleanup" devuelve el error.
- **Corrección:** banner `tone="warning"` arriba en Review ("Reconnect Klaviyo before starting this cleanup." con botón "Go to home") y deshabilitar los botones de precio e inicio.

#### M11 · Pasos de "Get started" incoherentes tras desconectar

- **Captura:** `d-43-home-disconnected-d.png`, `d-11-home-needs-reauth-d.png`.
- **Qué pasa:** pasos 1 y 2 pendientes y 3 y 4 con tilde verde. Con reconexión pendiente, el paso 3 sigue ofreciendo "Review".
- **Corrección:** si ya hubo una limpieza y falta conexión, no mostrar "Get started": solo el banner "Reconnect Klaviyo" con su botón dentro del banner.

#### M12 · Varios banners apilados

- **Captura:** `f-04-home-first-audit-failed-d.png`, `d-06-home-resurfaced-d.png`.
- **Qué pasa:** Home puede mostrar a la vez aviso de conexión, reconexión, perfiles reaparecidos, simulación pendiente y hasta cuatro banners dentro de "Your list". Built for Shopify 4.3.4 pide no mostrar dos o más juntos.
- **Corrección:** un banner de página por vez, por prioridad (reconectar, corrida fallida, perfiles reaparecidos, simulación pendiente). Lo demás, como texto dentro de la tarjeta.

#### M13 · El aviso de auto-downgrade no dice dónde está

- **Captura:** `a-01-home-new-d.png` (tarjeta "Good to know").
- **Qué pasa:** el PRD (sección 1) pide un paso informativo que explique dónde está la opción (Billing > Preferences, solo Owner o Admin). Hoy es una frase en gris al pie de la columna lateral, que en móvil queda al final de todo.
- **Corrección:** tras la primera limpieza completada, en el detalle de corrida: "To move to a lower plan, an Owner or Admin can do it in Klaviyo under Billing > Preferences." con link al artículo de ayuda.

### Bajos

- **L1 · Fila que se rompe en móvil.** En `a-11-home-audited-no-order-history-m.png`, la etiqueta larga empuja el número 2.640 a una línea aparte, alineado a la izquierda. Usar `s-grid gridTemplateColumns="1fr auto"` en esas filas.
- **L2 · Tabla de resumen en móvil.** En `d-29-run-partial-m.png`, cada fila repite "Profiles / Count". Usar pares etiqueta y valor en vez de `s-table` para tres o cuatro filas.
- **L3 · Encabezado de columna vacío** en History (columna "Details"). Poner texto accesible: "Actions".
- **L4 · "Profiles: 2,234 of 2,234"** en History no dice de qué. Encabezado "Profiles sent".
- **L5 · Botón de auditoría en curso.** En `f-02-home-first-audit-running-d.png` es una barra gris con spinner, sin texto, y "Your list" queda como tarjeta vacía. Mostrar "Auditing…" y un `s-spinner` con texto en la tarjeta.
- **L6 · Sin indicador de carga al enviar.** Los botones se deshabilitan pero no muestran `loading`. Agregar `loading` al botón que disparó la acción.
- **L7 · Grupo protegido inexistente.** `d-42-settings-missing-group-d.png` muestra el id crudo "XyZ123 (not found in Klaviyo right now)". Guardar el nombre al protegerlo.
- **L8 · "Days before the renewal to run"** no tiene texto de ayuda. Agregar "Between 4 and 14. Default 5."
- **L9 · Formato de fecha fijo en `en-US`** aunque el navegador esté en otro idioma. Aceptable para el lanzamiento en inglés.
- **L10 · Banner "This simulation was used for a cleanup"** tiene solo un link. Agregar el resultado: "2,234 profiles suppressed on Nov 26." y botón "View cleanup".

## Lo que está bien y conviene no romper

- La casilla de términos nombra la cantidad exacta de perfiles, se valida en el servidor y es operable con teclado (Tab y Espacio); el orden de tabulación de Review es lógico.
- Doble clic en "Start cleanup": una sola corrida creada.
- "Nothing has changed in Klaviyo" repetido en los momentos correctos.
- El CSV trae id, mail, motivo y link al perfil en Klaviyo.
- Sin scroll horizontal a 390 px en ninguna pantalla; la columna lateral se apila bien.
- La confirmación por renovación del plan antes de deshacer está bien escrita y el servidor la exige.
- El detalle de corrida tiene migas de vuelta a History.
- Sin signos de exclamación, sin cifras de ahorro, sin promesas sobre la factura de Klaviyo.

## Cobertura de estados

| Estado | Alcanzado | Captura | Cómo |
| --- | --- | --- | --- |
| Sin conectar | Sí | `a-01` | Flujo real |
| Conexión rechazada en Klaviyo | Sí | `a-06` | Flujo real (`decline=1`) |
| Conexión fallida | Sí | `a-05` | URL con `klaviyo=failed` |
| Conectado sin auditoría | Sí | `a-07`, `a-08`, `a-09` | Flujo real |
| Auditoría en cola y en curso | Sí | `f-01`, `f-02`, `f-03` | Forzado en D1 |
| Auditoría fallida | Sí | `d-04`, `d-05`, `f-04` | Forzado en D1 |
| Auditoría sin candidatos (sin historial de pedidos) | Sí | `a-11`, `a-12` | Flujo real |
| Auditoría con candidatos | Sí | `a-14` | Flujo real |
| Simulación abierta, CSV | Sí | `a-15` | Flujo real |
| Aprobar sin tildar | Sí | `a-16`, `e-01`, `e-02` | Flujo real |
| Simulación aprobada, precio sin aceptar | Sí | `b-01`, `b-02` | Flujo real |
| Precio aceptado | Sí | `b-03` | Atajo del preview |
| Precio rechazado en Shopify | No | — | El preview no simula el rechazo; por código, la app vuelve al estado "sin aceptar" |
| Simulación vencida | Sí | `d-09`, `d-10`, `d-14` | Forzado en D1 |
| Simulación desactualizada por cambio de reglas | Sí | `d-01` | Flujo real |
| Simulación ejecutada | Sí | `b-08` | Flujo real |
| Corrida en cola y en curso | Sí | `d-20` a `d-23` | Forzado en D1 |
| Corrida completada, jobs | Sí | `b-05`, `b-06` | Flujo real |
| Corrida fallida (3 motivos) | Sí | `d-24` a `d-27` | Forzado en D1 |
| Corrida parcial y cancelada | Sí | `d-29`, `d-30`, `d-31` | Forzado en D1 |
| Cargo estimado, cobrado, no cobrado, fallido | Sí | `b-05`, `d-32`, `d-33`, `d-34` | Forzado en D1 |
| Deshacer completado | Sí | `c-04`, `c-05`, `g-01` | Flujo real |
| Deshacer en curso | No | — | El Klaviyo falso termina al instante y el intento de forzarlo falló en el script; revisado solo en código (mismo banner "Restore in progress" que la limpieza en curso) |
| Deshacer tras renovación | Sí | `d-35b`, `d-36` | Forzado en D1 |
| Bloqueo de 365 días tras restaurar | Sí | `d-02`, `d-03` | Flujo real |
| Perfiles reaparecidos | Sí | `d-06` | Forzado en D1 |
| Lista por encima de 150.000 | Sí | `d-07`, `d-08` | Forzado en D1 |
| Settings: por defecto, ventanas ampliadas, errores, guardado | Sí | `a-09`, `c-10`, `c-11`, `c-14` | Flujo real |
| Programación apagada y encendida, modo automático | Sí | `c-12`, `c-13`, `c-15` | Flujo real |
| Reconexión necesaria | Sí | `d-11`, `d-12`, `d-13` | Forzado en D1 |
| Desconectado | Sí | `d-43` a `d-46` | Flujo real |
| History vacía y con filas | Sí | `a-03`, `c-07` | Flujo real |
| 404 de ruta y de corrida | Sí | `d-40`, `d-41` | Flujo real |
| Error 500 de loader | No | — | No se pudo forzar sin tocar código |
| Supresión apagada por el interruptor | No | — | Requiere otra configuración del Worker; revisado solo en código (banner "Cleanups are not switched on yet" y botón deshabilitado) |
| Sección de cobro en Settings | No existe | — | El encargo la mencionaba; `app.settings.tsx` no tiene nada de cobro. El merchant no tiene dónde ver el estado de su suscripción |
| Cuenta de prueba sembrada | No | — | Variable vacía en el preview |
| Listas con nombres largos, más de 50 listas | No | — | El Klaviyo falso trae tres listas fijas |
| Red lenta | No | — | No se midió |
| Dentro del admin de Shopify (App Bridge, barra de guardado, modales) | No | — | El preview no carga App Bridge |

## Qué queda sin verificar

- Todo lo que depende de App Bridge y del admin real: menú, barra de guardado, modales, redirect de precio.
- El texto de la pantalla de aprobación de precio de Shopify (para A6).
- El comportamiento del backfill de pedidos real (para A8).
- Lector de pantalla real y contraste medido. Los componentes son Polaris sin estilos propios, salvo el número grande de `Metric`.
- M1, M3 y la parte de A3 sobre deshacer sin conexión salen del código, no de una reproducción.

## Siguiente paso sugerido

Arreglar B1, B2 y A1 primero: son chicos, acotados y dos de ellos son motivo de rechazo en la revisión de Shopify. Después A2 y A3 (dos modales), y A4, A5 y A8 juntos, porque son todos el mismo problema: Home no refleja el estado real ni ofrece el siguiente paso. A6 y A7 conviene coordinarlos con quien está editando `app/billing/`.
