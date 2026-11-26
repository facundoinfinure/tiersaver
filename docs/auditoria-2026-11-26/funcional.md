# Revisión funcional y de confiabilidad · TierSaver

Fecha: 2026-11-26. Revisado sobre el commit `f44ca4f` (incluye la retención del cargo de 72 h, que entró mientras se hacía la revisión).

## Cómo se revisó

- Lectura completa de `packages/core/src/`, `shopify/app/{scans,simulations,runs,billing,schedule,settings,orders,klaviyo,data}`, `shopify/workers/`, rutas de webhooks y de simulación/corrida, esquema y `wrangler.jsonc`.
- Suites: `packages/core` 83 tests pasan; `shopify` 268 pasan y 1 se saltea (el de Klaviyo real). No se llamó a ninguna API real ni se tocó el repo.
- Ocho hallazgos se confirmaron con tests descartables que corren el código real contra D1 local: `/tmp/claude-0/-home-user-tiersaver/7c941f9f-138b-569f-a393-87cc163dabd0/scratchpad/t/bugs.test.ts` (config `vitest.scratch.config.mts` en la misma carpeta; se corre desde `shopify/` con `npx vitest run --config <esa config>`). Los ocho pasan, es decir, los ocho comportamientos existen.
- Límites de Cloudflare leídos hoy en developers.cloudflare.com (Workflows, Workers, D1, precios).

"Confirmado (test)" = reproducido con test descartable. "Confirmado (lectura)" = se desprende sin ambigüedad del código. "Plausible" = depende de un comportamiento externo que no se pudo verificar.

## Lo que está bien (para no revisarlo de nuevo)

- La compuerta de la simulación es atómica en SQL (`runs/engine.ts:117-163`): dos pestañas, doble clic o cron + manual no pueden crear dos corridas de la misma simulación; hay índice único `runs_simulation_unique`. Se vuelve a chequear al arrancar el Workflow.
- La aprobación es un `UPDATE` atómico con todas las condiciones (`simulations/review.ts:78-97`); un cambio de reglas sube `settings.version` y deja sin efecto la simulación.
- El modo automático exige una corrida anterior aprobada por una persona, reglas recomendadas, simulación programada y abierta (`schedule/automatic.ts`). No encontré camino que suprima sin simulación aprobada y vigente.
- La app nunca borra perfiles: solo `profile-suppression-bulk-create/delete-jobs`.
- Reanudación por lotes: un lote terminado no se reenvía, uno a medias se reenvía entero (seguro porque suprimir es idempotente por mail).
- Datos faltantes protegen: grupo protegido ilegible, segmento editado o en proceso, fecha de creación ausente, consentimiento SMS ausente.
- Clave de idempotencia del cargo por corrida; Workflow y cron pueden competir sin duplicar el cargo.
- El housekeeping no borra nada que una corrida o un deshacer necesite: los candidatos de una simulación aprobada y no ejecutada se borran a los 7 días (vence a las 24 h), y `run_profiles` no se toca.
- Parámetros ligados por sentencia de D1: todos los `IN (...)` van en tandas de 50 o 90 (límite 100).

---

## Hallazgos

### CRÍTICO

#### C1 · La cobertura de compras no tiene fecha de "hasta": con el webhook `orders/create` apagado, el paso del tiempo convierte a compradores en candidatos

- Dónde: `packages/core/src/rules.ts:179-183` (`covers`), `shopify/shopify.app.toml:31-34` (webhook comentado), `shopify/app/orders/purchases.ts:159-168`, `shopify/app/shopify.server.ts:27-41` (el backfill corre solo en `afterAuth`).
- Qué pasa: `purchasesCoveredSince` dice desde cuándo hay pedidos, pero nada dice hasta cuándo. El backfill corre una vez al instalar. El webhook que mantiene los hashes al día está deshabilitado en la configuración que se despliega. `covers()` da por completa la historia desde `since` hasta hoy.
- Escenario 1 (regla por defecto, config actual, sin `read_all_orders`): tienda instala el 2026-12-01; cobertura = 2026-10-02. Un perfil creado el 2026-11-01 compra el 2027-01-15 con un mail que Klaviyo no asocia a "Placed Order" (POS, otra integración, integración de Shopify caída). El 2027-11-02 el perfil cumple 365 días, `since <= createdAt` da cobertura suficiente, `purchase_hashes` no tiene la compra y el perfil sale como candidato.
- Escenario 2 (modo ampliado, `purchaseDays = 365`): 305 días después de instalar, `now - since >= 365 días` pasa a ser verdadero y la regla de compras deja de proteger a todos, con solo 60 días reales de pedidos.
- Escenario 3: se aprueba `read_all_orders` y se despliega sin descomentar el webhook: la cobertura queda "desde 2004" para siempre con datos congelados al día del backfill.
- Atenuante: el segmento de Klaviyo excluye a quien tenga un "Placed Order". El cruce con Shopify es justamente la segunda red, y es la que falla.
- Estado: confirmado (lectura). `covers()` no recibe ningún dato de frescura.
- Arreglo: guardar `purchases_fresh_until` (último backfill o último webhook procesado) y hacer que la regla proteja si ese dato tiene más de N horas; antes de cada scan, backfill incremental `processed_at:>=fresh_until - 1 día`; test que falle si `read_all_orders` está en los scopes y el webhook no está suscripto. No habilitar supresiones reales hasta tener esto.

#### C2 · Una corrida cuyo Workflow muere queda "running" para siempre y no se puede deshacer

- Dónde: `shopify/app/runs/engine.ts:468` (`still_running`), `shopify/app/data/housekeeping.ts:22-36` (solo recupera scans, no corridas), `shopify/app/runs/start.server.ts:20` y `:35`, `shopify/workers/scan.ts:48-62`.
- Escenario: corrida de 250 perfiles; el lote 0 se suprime; la instancia termina con error (límite de subrequests o de pasos, D1 caído más de 5 reintentos en `finalize run`, instancia terminada a mano, deploy roto). La fila queda en `running`. 30 días después `createUndoRun` sigue devolviendo `still_running`. Los 100 perfiles suprimidos no se pueden restaurar desde la app: se rompe la regla 3.
- Variantes: (a) `SUPPRESSION_RUN.create` falla después de `createSuppressionRun`: corrida en `queued` sin Workflow y simulación consumida; (b) el paso "automatic mode" reintenta tras fallar a mitad: `approveAutomatically` ya devuelve falso, sale con `not_open` y la corrida queda en `queued`.
- Estado: confirmado (test R1: estado `running`, 100 `submitted`, deshacer rechazado 30 días después, housekeeping no la toca).
- Arreglo: en el cron, (1) relanzar con el mismo id las corridas `queued` sin instancia (el id del Workflow es el de la corrida, así que es idempotente); (2) para corridas `running` sin avance en X horas, consultar `instance.status()` y, si la instancia terminó o no existe, ejecutar `finalizeRun` (queda `completed_with_errors` con lo no alcanzado intacto). Además permitir deshacer sobre lo ya `submitted` aunque la corrida no haya cerrado, después de marcarla `cancelled`.

### ALTO

#### A1 · Entre la simulación y la corrida no se vuelve a chequear nada salvo el hash del mail

- Dónde: `shopify/app/runs/gateway.server.ts:96-130`.
- Escenario: simulación a las 10:00, aprobación a las 18:00, arranque al día siguiente a las 09:30. A las 20:00 un candidato compra (el webhook actualiza `purchase_hashes`), abre un mail o hace clic. A las 09:30 se lo suprime igual. Un comprador de ayer deja de recibir marketing.
- Estado: confirmado (test R2: pedido registrado después de la simulación, el mail queda suprimido en el Klaviyo falso).
- Arreglo, barato y dentro del presupuesto por lote: (1) en el lote, cruzar `run_profiles.email_hash` con `purchase_hashes.last_order_at > simulación.created_at` (una consulta local) y saltear; (2) volver a leer la pertenencia al segmento candidato filtrando por los mails del lote (`GET /api/segments/{id}/profiles?filter=any(email,[...])`, 1 o 2 requests más) y saltear a quien ya no esté; (3) en el mismo lookup pedir `subscriptions` y saltear a quien ya esté suprimido (ver M6). Registrar el motivo en `error_code`.

#### A2 · Retención de 72 h: desinstalar dentro de la ventana deja la limpieza gratis

- Dónde: `shopify/app/billing/billing.ts:267-268`, `shopify/workers/suppression-run.ts:80-85`, `shopify/app/data/privacy.ts:20-29`.
- Qué pasa: al desinstalar, Shopify cancela la suscripción y revoca el token; `handleUninstall` borra la sesión. Cuando vence la retención, `offlineAdminGraphql` falla, el cargo queda `failed` y el cron lo abandona a los 10 días. Los perfiles siguen suprimidos.
- Por qué pesa: según `04-PRECIO-Y-COBRO.md` la primera limpieza es la grande y las siguientes pueden no encontrar nada. Instalar, limpiar 150.000 perfiles (US$ 149) y desinstalar antes de 72 h es gratis, y es el recorrido natural de un merchant que solo quería la limpieza inicial. Antes de la retención la ventana era de minutos.
- Lo mismo vale para suscripción cancelada o tienda congelada dentro de las 72 h.
- Estado: confirmado (lectura). No hay forma de cobrar tras la desinstalación.
- Opciones (cambia una decisión del handover: la elige Facundo):
  1. Cobrar al confirmar Klaviyo, como antes, y si se deshace entero dentro de 72 h compensar con crédito: saltear el próximo cargo o emitir un app credit. Protege el ingreso y mantiene la promesa.
  2. Mantener la retención y aceptar la pérdida, midiéndola: evento `charge.lost_uninstall` y métrica en la beta.
  3. Retención corta (por ejemplo 24 h) como término medio.
- Si se mantiene la retención, arreglar igual A3, A4 y M1, que la hacen más frágil.

#### A3 · Si el cobro del Workflow falla una vez, el cron no puede cobrar corridas de más de 1.000 perfiles, y tres de ellas frenan a todas las demás tiendas

- Dónde: `shopify/workers/app.ts:52-55`, `shopify/app/runs/confirm.ts:59-63`, `shopify/app/billing/billing.ts:239` y `:315`.
- Qué pasa: `confirmRunJobs(..., 10)` devuelve `null` con más de 10 jobs (más de 1.000 perfiles), y antes gasta 10 requests a Klaviyo. Con `null`, `settleRunCharge` devuelve `estimated` y no cobra. El único camino que cobra corridas grandes es el paso "settle charge after undo window" del Workflow, que no reintenta si Shopify responde mal (devuelve `failed` como valor, no lanza) o si faltaba la suscripción en ese minuto.
- Además `runsWithOpenCharges` ordena por `finished_at` y el cron toma `.slice(0, 3)`: tres corridas grandes pendientes ocupan los tres lugares cada hora durante 10 días y ningún otro cargo se reintenta.
- También: si el merchant desconecta Klaviyo (o el token queda en `needs_reauth`) antes de la primera confirmación, el Workflow no puede leer los jobs, y el cron tampoco (`.catch(() => null)`): no se cobra nunca.
- Estado: confirmado (test B3: `null` para 11 jobs con 10 llamadas hechas, `estimated` después de la ventana, y la corrida chica queda en la posición 4 de la lista).
- Arreglo: guardar la confirmación en `usage_charges` (`confirmed_suppressed`, `confirmed_at`) la primera vez que Klaviyo confirma, y que `settleRunCharge` la use sin volver a Klaviyo; en el cron, saltear y rotar (ordenar por último intento, no por `finished_at`); hacer que el paso final lance ante `failed` para que el Workflow reintente con backoff.

#### A4 · Dos limpiezas, cero cargos: el cargo pendiente de A bloquea el de B, y después A se deshace

- Dónde: `shopify/app/billing/billing.ts:190-201` (la regla de 28 días cuenta filas `pending` y `failed`), `:251-259`.
- Escenario: limpieza A de 1 perfil (alcanza con proteger casi todo con un grupo). Queda `pending` 72 h. Nuevo scan y limpieza B de 50.000 perfiles: su fila nace `not_charged / already_charged_this_cycle`, estado final que no se revisa. Se deshace A dentro de las 72 h: `cleanup_undone`. Resultado: B suprimió 50.000 perfiles y no se cobró nada. Repetible todos los meses. También ocurre sin mala fe (prueba chica, después la real, deshacer la prueba).
- Estado: confirmado (test B1: 0 registros de uso, B con 50 `submitted`).
- Arreglo: que el "ya se cobró este ciclo" de B sea provisorio mientras el cargo que lo bloquea no esté `charged`: al pasar A a `not_charged`, reabrir B (`pending`, con su propia retención). O calcular la regla de 28 días solo contra filas `charged` y resolver el orden al cobrar.

#### A5 · Límites de Cloudflare: el plan gratis no puede correr ninguna lista real, y en el pago falta fijar límites

Límites vigentes hoy:

| Límite | Workers Free | Workers Paid |
| --- | --- | --- |
| Pasos por instancia de Workflow | 1.024 | 10.000 (configurable hasta 25.000) |
| Pasos de Workflow incluidos | 3.000 por día | 500.000 por mes |
| CPU por paso | 10 ms | 30 s (hasta 5 min) |
| Subrequests por invocación | 50 externos + 1.000 internos | 10.000 (configurable hasta 10 M) |
| Consultas D1 por invocación | 50 | 1.000 |
| Filas escritas en D1 | 100.000 por día (se rechazan al pasarse) | 50 M por mes incluidas |
| Duración máxima de una consulta o batch D1 | 30 s | 30 s |
| Tamaño de base D1 | 500 MB | 10 GB |

Cuenta para una lista de 150.000 perfiles activos (estimaciones propias a partir del código; las cantidades de páginas y lotes son exactas):

| | Típico: 30.000 miembros del segmento, 25.000 candidatos, 2 grupos protegidos de 5.000 | Tope del código: 50.000 miembros y candidatos |
| --- | --- | --- |
| Scan, pasos | ~480 (300 de miembros, 100 de grupos, 60 de evaluación) | ~800, más 150 por cada grupo protegido grande |
| Scan, requests a Klaviyo | ~420 | ~700 o más |
| Scan, llamadas a D1 | ~1.850 | ~3.000 |
| Scan, filas escritas | ~260.000 | ~430.000 |
| Corrida, pasos | 250 lotes + ~15 | 500 lotes + ~25 |
| Corrida, subrequests (3 de Klaviyo + ~10 de D1 por lote; ~51 por paso de confirmación) | ~3.800 a 4.500 | ~7.500 a 9.600 |
| Corrida, filas escritas | ~150.000 | ~300.000 |

- Plan gratis: un solo scan típico escribe 2,6 veces la cuota diaria de D1, y al pasarse D1 rechaza escrituras de todas las tiendas hasta la medianoche UTC. 50 subrequests externos alcanzan para unos 16 lotes. 10 ms de CPU no alcanzan para parsear una página de 100 perfiles. Los comentarios que dicen que el plan gratis alcanza para "about 100,000 profiles" (`workers/suppression-run.ts:25`, `scans/engine.ts:108`, `workers/orders-backfill.ts:10`) son incorrectos. Si el Worker desplegado sigue en el plan gratis, no se puede activar `SUPPRESSION_ENABLED` ni probar con listas reales.
- Plan pago: la corrida al tope queda pegada al default de 10.000 subrequests. La documentación define el límite "por instancia de Workflow"; no pude confirmar si el contador se reinicia entre pasos, así que hay que suponer que no. Si se excede, la instancia muere con "Too many subrequests" y la corrida queda `running` (C2).
- Más de 50.000 miembros del segmento: el scan falla con `too_many_segment_members` ("contact support"). Para el tramo de 150.000 es un caso esperable (33% de la lista).
- Sin conteo de uso de Klaviyo utilizable (scope `usage:read` opcional, o conteo desactualizado), el conteo propio falla con `too_many_profiles_to_count` al pasar 150.000 perfiles totales, contando suprimidos (`scans/engine.ts:405`). Una cuenta con 120.000 activos y 60.000 suprimidos no puede auditarse.
- Estado: límites confirmados (documentación); cuentas confirmadas por lectura; el comportamiento del contador de subrequests es plausible.
- Arreglo: pasar a Workers Paid antes de cualquier merchant; en `wrangler.jsonc` fijar `limits.subrequests` (por ejemplo 100.000) y `limits.steps` en los tres Workflows; subir `maxMemberPages` y `maxCountPages` para el plan pago; prueba de carga con el Klaviyo falso a 50.000 y 150.000.

#### A6 · Modo automático sin freno ante un salto anormal de candidatos, y sigue habilitado aunque la única limpieza manual se haya deshecho

- Dónde: `shopify/app/schedule/automatic.ts:26-50`.
- Escenario 1: 365 días después de un sorteo o una importación de 40.000 perfiles, todos pasan a ser candidatos el mismo mes. La corrida automática suprime 40.000 sin que nadie mire, y el cargo puede saltar de tramo. Lo mismo si una métrica de Klaviyo cambia de nombre o se rompe una integración.
- Escenario 2: el merchant deshizo su única limpieza manual (señal de reglas mal calibradas, según el PRD). La consulta solo pide una corrida `completed` con `processed_count > 0`, así que el automático corre igual.
- Tampoco se compara contra lo que la persona aprobó: grupos protegidos distintos de los de entonces pasan sin revisión.
- Estado: confirmado (test S2: `run: true` con 90.000 candidatos sobre 100.000 y la limpieza manual deshecha).
- Arreglo: dejar la simulación esperando aprobación si los candidatos superan un porcentaje de la lista (por ejemplo 10%) o N veces la última corrida aprobada por una persona, si el tramo de precio cambió, si la última limpieza manual fue deshecha, o si los grupos protegidos cambiaron desde la última aprobación humana. Cada "no" ya está modelado como motivo; es agregar condiciones.

### MEDIO

#### M1 · Un deshacer pedido dentro de la ventana pero todavía en curso cuando vence se cobra igual

- Dónde: `shopify/app/billing/billing.ts:251-268`. Solo se mira `reactivated_at`, que se estampa cuando el deshacer termina (`runs/engine.ts:366-377`).
- Escenario: deshacer pedido a la hora 71:50 sobre 25.000 perfiles (250 lotes, 10 a 15 minutos). A la hora 72:01 el Workflow cobra.
- Estado: confirmado (test B2: deshacer en `queued`, resultado `charged`).
- Arreglo: si hay un deshacer `queued` o `running` de esa corrida, devolver `held` y reintentar.

#### M2 · Un scan programado que falla no se reintenta en ese ciclo, y nadie se entera

- Dónde: `shopify/app/schedule/schedule.ts:56` y `:68` (`MAX(created_at)` de scans programados, cualquiera sea su estado).
- Escenario: el día previsto Klaviyo responde 503 o el segmento sigue procesando tras 40 consultas. El enfriamiento de 20 días bloquea el reintento: ese mes no hay limpieza. Los mails de aviso todavía no existen (pendiente conocido en `STATUS.md`).
- Estado: confirmado (test S1: 0 scans en los 48 ticks siguientes).
- Arreglo: contar solo scans `completed` (o `failed` con error no reintentable) para el enfriamiento, con un máximo de intentos por ciclo.
- Relacionado: en modo aprobación, sin mail, la simulación programada vence a las 24 h sin que el merchant la vea. Hasta que haya mails, la programación en modo aprobación no hace nada útil.

#### M3 · Lote aceptado por Klaviyo pero sin respuesta: queda `failed` y fuera del deshacer

- Dónde: `shopify/app/runs/engine.ts:255-272` y `:510`.
- Escenario: Klaviyo crea el job y la respuesta se pierde (timeout de 30 s, 5xx posterior) en todos los reintentos. Las filas pasan a `failed`. El deshacer solo toma `submitted`: esos perfiles quedan suprimidos sin camino de restauración en la app.
- Estado: confirmado (test R3: 5 enviados, 5 `failed`, deshacer responde `nothing_to_restore`). Que Klaviyo haya aplicado el job en ese caso es plausible.
- Arreglo: distinguir "falló antes de enviar" (conexión, switch, lookup) de "resultado incierto" (falló el POST). Los inciertos van a un estado propio que el deshacer incluye.

#### M4 · En modo ampliado todos los candidatos quedan rotulados "never_engaged"

- Dónde: `packages/core/src/rules.ts:237-240`, `shopify/app/scans/engine.ts:727-733` (el camino por segmento no trae fechas de engagement), `shopify/app/simulations/review.ts:106`.
- Escenario: `openDays = 182`. Un perfil que abrió hace 300 días entra al segmento y sale candidato con motivo `never_engaged`. El CSV que el merchant revisa antes de aprobar dice "Never opened, clicked, visited or purchased", que es falso, y el registro guarda el motivo equivocado.
- Estado: confirmado (lectura). `lapsed` solo aparece si hay una compra vieja en Shopify.
- Arreglo: si alguna ventana no es "nunca", rotular `lapsed` ("No activity inside your chosen windows").

#### M5 · Backfill de pedidos: tope de 250.000 pedidos sin reanudación

- Dónde: `shopify/workers/orders-backfill.ts:11` y `:55`.
- Escenario: tienda con 300.000 pedidos históricos y `read_all_orders`. El backfill corta a las 1.000 páginas, nunca marca la cobertura, y todos quedan protegidos para siempre con el mensaje de "order history". El próximo intento, solo en una nueva autorización, arranca de cero. Con el plan pago el tope de 1.024 pasos ya no aplica.
- Estado: confirmado (lectura).
- Arreglo: subir `MAX_PAGES` con `limits.steps`, guardar el cursor para reanudar, y mostrar el estado del backfill en la app.
- Menor, mismo módulo: `recordPurchases` solo usa `order.email`; pedidos de POS con cliente con mail y sin mail de pedido no protegen a nadie. Usar también el mail del cliente.

#### M6 · El deshacer puede levantar una supresión manual del merchant, y se cobra por perfiles que ya estaban suprimidos

- Dónde: `shopify/app/runs/gateway.server.ts:96-130` (solo se lee `email`).
- Qué pasa: desuscriptos y rebotes están a salvo, porque el unsuppress de Klaviyo solo quita `USER_SUPPRESSED`. Pero si el merchant suprimió a mano a un candidato entre la simulación y la corrida, la corrida lo cuenta como `submitted` y un deshacer posterior lo reactiva. Y un perfil que se desuscribió en ese lapso también se envía y se cuenta.
- Estado: confirmado (lectura) que no se lee el estado de supresión; el efecto en Klaviyo es plausible.
- Arreglo: pedir `subscriptions` en el mismo lookup (no agrega requests) y saltear al que ya tiene algún motivo de supresión.
- Relacionado: el deshacer estampa `reactivated_at` y la interfaz dice "restored" sin leer el resultado de los jobs de unsuppress.

#### M7 · La confirmación del cargo depende de una semántica de Klaviyo no verificada y solo mira el último job de cada lote

- Dónde: `shopify/app/runs/confirm.ts:46`, `shopify/app/klaviyo/api.ts:817` ("presumably"), `shopify/app/runs/engine.ts:329-332`.
- Escenario: un lote se reintenta (respuesta perdida) y crea dos jobs; se guarda solo el segundo. Si Klaviyo informa como `skipped` los mails ya suprimidos, ese lote confirma 0. En una corrida de un solo lote: "Not charged: no profile was suppressed", con los perfiles suprimidos. Si `completed_count` ya excluye los salteados, la resta descuenta dos veces.
- Estado: plausible.
- Arreglo: verificar en la cuenta de prueba qué informa un job repetido; guardar todos los job ids por lote (tabla `run_jobs`); un job `cancelled` debería cerrar la confirmación, hoy la deja abierta para siempre.

#### M8 · No hay forma de frenar una corrida en curso

- Dónde: `shopify/app/runs/engine.ts:304` (el motor ya respeta un estado distinto de `running`), ninguna ruta lo escribe.
- Escenario: el merchant arranca 30.000 supresiones y se da cuenta del error al minuto. Tiene que esperar 10 a 15 minutos y después deshacer, con el bloqueo de 90 días de Klaviyo para todos esos perfiles.
- Estado: confirmado (lectura): `cancelled` existe en el esquema y en las etiquetas, nada lo asigna.
- Arreglo: acción "Stop" que pone `cancelled`; el lote siguiente corta solo.

#### M9 · Cargo perdido por horas en el borde de 28 días

- Dónde: `packages/core/src/charge.ts:106-110`, `shopify/app/billing/billing.ts:200` (usa `createdAt` de la estimación).
- Escenario: día de renovación 10, margen 5. Corridas el 5 de febrero y el 5 de marzo de un año no bisiesto: 28 días exactos. Si la de marzo termina unos minutos antes en el reloj que la de febrero, quedan 27,99 días y sale `already_charged_this_cycle`. Pasa en cada febrero a marzo para días de renovación 1 a 28.
- Estado: confirmado (lectura y aritmética).
- Arreglo: comparar por día calendario, o usar 27 días en el código manteniendo el texto de 28.

### BAJO

- B1 · `shops.iana_timezone` nunca se escribe; la programación usa siempre UTC (`schedule/schedule.ts:49`). El margen de 5 días lo absorbe, pero el comentario "shop's calendar" no es cierto. Confirmado (ningún código lo asigna).
- B2 · `createScan` hace lectura y después inserción sin atomicidad (`scans/engine.ts:187-204`): cron y clic simultáneos crean dos scans. Sin daño; el segundo reemplaza al primero. Un índice único parcial lo cierra.
- B3 · Se puede aprobar y arrancar una segunda corrida mientras la primera sigue en curso (un scan nuevo ve todavía activos a los perfiles que se están suprimiendo). Los mismos perfiles quedan en dos corridas; deshacer una los reactiva mientras la otra los muestra suprimidos, y el detector de ciclos pausa la programación. Bloquear scan y aprobación con corrida abierta.
- B4 · El housekeeping marca `failed` un scan de más de 24 h y borra sus filas, pero el Workflow puede seguir y terminar en `completed` con candidatos parciales y un resumen que no coincide (`data/housekeeping.ts:27-29`, `scans/engine.ts:229`). Solo suprime de menos. Chequear el estado en `finalize`.
- B5 · Falso positivo del detector de ciclos (`scans/engine.ts:702-710`): toma `submitted` como "suprimido". Si Klaviyo salteó el perfil (bloqueo de 90 días), 72 h después lo declara "resurfaced", pausa la programación y pasa el modo a aprobación.
- B6 · El `app/uninstalled` que llega tarde, después de una reinstalación rápida, borra la sesión y la conexión nuevas (`routes/webhooks.app.uninstalled.tsx`). Plausible. Comparar la fecha del webhook con `installed_at`.
- B7 · Una suscripción de prueba vale como suscripción en cualquier tienda (`billing/billing.ts:98`). Tienda de desarrollo que se transfiere a un merchant: los cargos seguirían siendo de prueba. Plausible; exigir `test === false` cuando la tienda no es de desarrollo.
- B8 · La opción `countMachineOpens = false` no tiene efecto en el camino por segmento (`klaviyo/api.ts:620-621`). Es conservador, pero es una opción que no hace nada.
- B9 · `scheduleDecisions` tiene `LIMIT 500` sin orden (`schedule/schedule.ts:73`): con más de 500 tiendas programadas, algunas no se evalúan nunca.
- B10 · La cotización de la simulación mira solo cargos `charged` (`scans/engine.ts:450-458`) y el cobro mira también `pending` y `failed`: la pantalla puede anunciar un cargo que después no sale.
- B11 · `customers/redact` anula `email_hash` en `run_profiles`, y con eso se pierde el bloqueo de 365 días de ese perfil (`data/privacy.ts:76-88`).
- B12 · Tokens offline de Shopify con vencimiento (`shopify.server.ts:43-45`): Workflow, cron y request pueden refrescar a la vez. No pude verificar si la librería serializa el refresh como hace el código propio para Klaviyo. A verificar.
- B13 · `run_profiles` crece sin límite (unos 30 MB por corrida de 50.000 con índices). Con 10 GB hay margen para cientos de corridas grandes; conviene una política de retención pasado el bloqueo de 365 días.

---

## Comportamientos importantes sin test

1. Frescura de la cobertura de compras (C1): ningún test cubre pedidos posteriores al backfill.
2. Corrida con Workflow muerto y recuperación (C2). `test/workflow.test.ts` solo cubre el camino feliz y el switch apagado.
3. Revalidación en el lote (A1): `klaviyo-gateway.test.ts` cubre mail cambiado, perfil inexistente y sin mail; no compra ni engagement posteriores, ni perfil ya suprimido.
4. Camino del cron para cargos (A3): `confirmRunJobs` no aparece en ningún test; tampoco el `slice(0, 3)` ni el handler `scheduled` de `workers/app.ts`.
5. Interacción entre cargos de dos corridas (A4) y deshacer en curso al vencer la retención (M1).
6. `ScanWorkflow`, `OrdersBackfillWorkflow` y el paso "automatic mode" no corren en tests (la config de test solo registra `SuppressionRunWorkflow`).
7. Scan programado fallido y reintento (M2).
8. Escala: ningún test pasa de unos cientos de perfiles; no hay prueba de 500 lotes ni de 500 páginas.
9. Desinstalación a mitad de corrida y a mitad de la retención; desconexión de Klaviyo a mitad de corrida.
10. Jobs de Klaviyo duplicados por reintento y `skipped_count` (M7): el Klaviyo falso no modela "ya suprimido".
11. Motivo `lapsed` en modo ampliado por el camino real del scan (M4).
12. Borde de 28 días con horas (M9).

## Orden sugerido

1. Antes de activar `SUPPRESSION_ENABLED` para cualquier cuenta que no sea la de prueba: C1, C2, A1, A5 (plan pago y límites).
2. Antes de cobrar a un merchant real: decisión de Facundo sobre A2; A3, A4, M1.
3. Antes de ofrecer el modo automático: A6, M2, y los mails pendientes.
4. Después: M3 a M9 y los bajos.
