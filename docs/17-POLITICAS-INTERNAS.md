# Políticas internas de TierSaver

Fecha: 2026-11-26. Versión 2: los textos públicos quedaron adoptados por el dueño sin revisión externa (`docs/16-LEGALES.md`); los compromisos de abajo tienen fecha límite y, hasta cumplirlos, el sitio no se despliega sin cartel. Las piden los requisitos de datos protegidos de Shopify, los API Terms de Klaviyo y el DPA (`site/src/pages/dpa.html`). No es asesoramiento legal.

Alcance: una sola persona opera TierSaver (Facundo, "el operador"), desde Argentina, por cuenta de Digital Solvers LLC. La app corre en Cloudflare Workers, con base D1, Workflows y un cron horario. No hay empleados ni contratistas con acceso.

**[COMPROMISO]** marca lo que el operador tiene que hacer de verdad para que este documento y los textos públicos sean ciertos. Todo lo demás describe lo que el código ya hace.

Resumen de compromisos pendientes de adoptar:

| # | Compromiso | Sección | Fecha límite |
| --- | --- | --- | --- |
| C1 | Activar 2FA en Cloudflare, Shopify Partners, Klaviyo, GitHub, el registrador del dominio y el proveedor de mail | 2 | Antes del primer merchant real |
| C2 | Aceptar y archivar el DPA de Cloudflare (el Anexo II del DPA dice que el subencargado está obligado por contrato escrito) | 4 | **Antes de desplegar el sitio sin cartel** |
| C3 | Crear y atender hello@ y support@ (revisar al menos una vez por día hábil). Los términos los usan para reclamos, aviso previo de disputas y exclusión del arbitraje | 1, 6 | **Antes de desplegar el sitio sin cartel** |
| C4 | Guardar una copia de `HASH_PEPPER` y de la clave de cifrado de tokens en un gestor de contraseñas | 2 | Antes del primer merchant real |
| C5 | Separar ambiente de prueba y de producción (otra base D1 y otro Worker) | 2 | Antes del primer merchant real |
| C6 | Confirmar los canales de aviso de incidentes: Shopify, por soporte de partners (https://help.shopify.com/questions/partners, API Terms 6.2.10), dentro de 24 horas; Klaviyo, contacto de los API Terms (legal@klaviyo.com figura en sus API Terms) | 1 | Antes del primer merchant real |
| C7 | Revisar este documento una vez por año y después de cada incidente | todas | 2027-11-26 |
| C8 | Confirmar que el buzón de 153 E Flagler St, Suite 1640-6389 está registrado a nombre de Digital Solvers LLC ante la agencia receptora (pie CAN-SPAM, 16 CFR 316.2(p)) | 8 | Antes del primer mail en frío |
| C9 | Decidir el representante del art. 27 en la UE y en el Reino Unido (`16-LEGALES.md` §2.4) y, si se nombra, agregarlo a privacidad 1 y al Anexo I.A del DPA | 5 | Antes del primer merchant de la UE o el Reino Unido |
| C10 | Registrar las exclusiones de arbitraje recibidas en hello@ (tienda, fecha, mail) y guardarlas mientras dure la relación más 5 años | 11 | Desde el primer merchant real |
| C11 | Revisar la inscripción ante la AAIP si ocurre un disparador de la sección 10 | 10 | Cuando ocurra |

## 1. Respuesta a incidentes

**Qué es un incidente:** acceso, pérdida, alteración o divulgación no autorizados de datos de un merchant o de sus clientes; un secreto expuesto (token, `HASH_PEPPER`, clave de cifrado, credencial de Cloudflare); o un error de la app que suprime perfiles fuera de una simulación aprobada.

**Quién:** el operador es el único responsable de detectar, contener, avisar y documentar. No hay guardia: **[COMPROMISO]** revisar hello@ y support@ y las alertas de Cloudflare al menos una vez por día hábil. Si el operador no va a estar disponible más de 48 horas, pausa el cron y el modo automático antes de irse, o deja a una persona de confianza con instrucciones para hacerlo.

**Pasos:**

1. **Registrar** la hora de detección y qué se sabe, en un archivo fuera del repo público.
2. **Contener** (en la primera hora desde la detección):
   - secreto expuesto: rotarlo en Cloudflare (`wrangler secret put`) y revocar la credencial en el origen. Rotar `HASH_PEPPER` invalida todos los hashes: los pedidos se vuelven a leer solos, pero las limpiezas anteriores ya no se pueden deshacer; solo se rota si ese secreto fue el expuesto;
   - acceso indebido a la cuenta de Cloudflare: cerrar sesiones, cambiar contraseña, revisar el registro de auditoría de la cuenta;
   - error de la app: frenar las limpiezas (quitar el trigger del cron y desactivar el modo automático por despliegue) y dejar el deshacer disponible.
3. **Confirmar** si hubo datos personales afectados, de qué tiendas y cuáles. La base no tiene mails en claro, nombres ni datos de pago: lo expuesto serían ids de perfil de Klaviyo, hashes con clave, fechas, estados y tokens cifrados.
4. **Avisar a los merchants afectados sin demora indebida y a más tardar 48 horas después de confirmar** (términos 8, privacidad 8, DPA 4). Contenido: qué pasó, cuándo, qué datos, qué se hizo, qué puede hacer el merchant y contacto. Canal: mail al contacto que el merchant haya usado con nosotros y, si afecta a todas las tiendas, aviso dentro de la app de tipo `service` (sección 9). El aviso de la app es el mismo para todas las tiendas: no sirve para un incidente que toca solo a algunas, porque se lo mostraría también a las demás. El mail es un borrador que el operador revisa y envía en persona.
5. **Avisar a Shopify dentro de las 24 horas de conocer** un incidente real o sospechado que toque datos de merchants obtenidos de Shopify (API Terms 6.2.10 y Partner Program Agreement: "immediately upon, but no later than twenty-four (24) hours of, becoming aware"), por el soporte de partners, aunque todavía no esté confirmado; después, informar el avance. **Avisar a Klaviyo** de inmediato si toca datos de Klaviyo, trabajar con ellos para remediar y avisar a los usuarios en lo que la ley exija (Klaviyo API Terms, "Privacy and Security"). Klaviyo exige además coordinar con ellos cualquier **comunicado público** antes de publicarlo: no se publica nada sin eso. **[COMPROMISO]** confirmar antes del lanzamiento por qué canal recibe cada uno estos avisos (soporte de partners de Shopify; contacto que indiquen los API Terms o el soporte de desarrolladores de Klaviyo) y anotarlo acá.
6. **Evaluar otros avisos**: si TierSaver es responsable de los datos afectados (cuenta del merchant, prospectos), el aviso a una autoridad lo decide el operador; en ese caso conviene consultar a un abogado (`16-LEGALES.md` §7). Para los datos de clientes, el aviso a la autoridad es del merchant.
7. **Cerrar**: causa, corrección, fecha, y qué cambia en este documento. Guardar el registro 3 años.

Las copias de D1 ("Time Travel") permiten restaurar la base a un punto anterior. Si se restaura, se vuelven a borrar los datos que ya se habían borrado (privacidad 9).

## 2. Control de acceso y prevención de pérdida de datos

- **Quién accede:** solo el operador. Ningún tercero tiene credenciales. Si se suma una persona, antes firma confidencialidad y se actualiza este documento.
- **2FA obligatorio** en toda cuenta que toque datos o despliegues: Cloudflare (cuenta TierSaver), Shopify Partners, Klaviyo (cuenta de desarrollador), GitHub, registrador del dominio y proveedor de mail. **[COMPROMISO]** activarlo y verificarlo; hoy no hay evidencia de que esté activo.
- **Secretos:** viven solo como secretos de Cloudflare (`TOKEN_ENCRYPTION_KEY`, `HASH_PEPPER`, credenciales de Shopify y de Klaviyo). No van al repo, a los logs ni a un chat. **[COMPROMISO]** copia de respaldo en un gestor de contraseñas: `HASH_PEPPER` hoy no está guardado en ningún otro lado (`docs/STATUS.md`).
- **Rotación:** credenciales de Shopify y de Klaviyo, ante sospecha o cada 12 meses. La clave de cifrado de tokens y `HASH_PEPPER`, solo ante exposición (rotarlas rompe datos existentes).
- **Prohibido:** exportar la base de producción a una máquina personal; copiar datos de producción a un ambiente de prueba; consultar datos de una tienda sin un motivo de soporte u operación. Una consulta manual a producción se anota (fecha, motivo, tienda).
- **Tokens de API de Cloudflare:** con el alcance mínimo, con vencimiento, uno por uso (despliegue, sesión de desarrollo). Se revocan al terminar.
- **Asistentes de IA y sesiones remotas:** trabajan con el repo y con datos de prueba. No reciben credenciales de producción con permiso de lectura de la base salvo para una tarea puntual aprobada por el operador, con token temporal.
- **Ambientes:** hoy hay uno solo. **[COMPROMISO]** separar prueba y producción antes del primer merchant real. La cuenta de Klaviyo de prueba es la única sobre la que se ejecutan supresiones fuera de un merchant real.
- **Registro de accesos del operador:** el registro de auditoría de la cuenta de Cloudflare. La app registra las acciones de los usuarios de cada tienda en `events_log`.
- **Equipo del operador:** disco cifrado, bloqueo de pantalla, sistema actualizado.

## 3. Calendario de retención

Valores tomados de `shopify/app/data/housekeeping.ts`, `shopify/app/data/privacy.ts` y la política de privacidad (sección 9). Actualizado el 2026-11-26 por el cambio a plan mensual: se quitó el registro de limpieza sin cobrar y se agregó el estado del plan. La tarea horaria (`17 * * * *`) ejecuta los borrados.

| Dato | Plazo | Cómo se borra |
| --- | --- | --- |
| Datos de trabajo de una auditoría (`scan_profiles`) | Hasta que la auditoría termina; como máximo unas 24 horas desde que empezó | Fin de la auditoría o tarea horaria |
| Lista por perfil de una simulación que no se ejecutó | 7 días (`UNUSED_SIMULATION_CANDIDATES_DAYS`); los conteos quedan | Tarea horaria |
| Marcadores de intento de conexión con Klaviyo | 24 horas | Tarea horaria |
| Cookie `__Host-ts_klaviyo_oauth` | 10 minutos como máximo | Vence o se borra al terminar el paso |
| Registro de un pedido de acceso de un cliente | 90 días (`PRIVACY_REQUEST_RETENTION_DAYS`), o antes si llega su pedido de borrado | Tarea horaria o `customers/redact` |
| Hashes de compradores, historial de limpiezas por perfil, registro de acciones, ajustes | Mientras la app está instalada. Sin plazo propio: se necesitan para proteger a quien compró alguna vez y para deshacer | Con la tienda |
| Tokens de Shopify y de Klaviyo | Hasta la desinstalación | Al recibir el aviso de desinstalación |
| Estado del plan de la tienda (`shop_plans`): id de la suscripción de Shopify, precio mensual, tramo que cubre, estado, si es de prueba, fechas de inicio, fin y fin del período en curso | Mientras la app está instalada | Al recibir el aviso de desinstalación (`handleUninstall`), junto con los tokens |
| Todo lo demás de una tienda desinstalada | Hasta el `shop/redact` de Shopify (48 horas después de desinstalar); si no llega, 10 días (`UNINSTALLED_SHOP_RETENTION_DAYS`) | Webhook o tarea horaria |
| Datos de un cliente con pedido de borrado | Al recibir `customers/redact`: se borra su hash y sus filas de simulación; en limpiezas pasadas se quita el hash y el id de perfil se reemplaza por un valor al azar | Webhook |
| Copias "Time Travel" de D1 | Hasta 30 días en el plan pago (7 en el gratuito); no se pueden apagar | Las vence Cloudflare |
| Logs propios de la app y estado de los Workflows en Cloudflare | Lo que fija Cloudflare según el plan (3 o 7 días según su documentación leída el 2026-11-26) | Los vence Cloudflare |

Ya no hay ningún registro que sobreviva a la desinstalación. La tabla `unpaid_cleanups` del modelo de cargo por limpieza quedó sin uso desde el 2026-11-26: nada la escribe ni la lee, en producción no tiene filas, y la tarea horaria sigue borrando cualquier fila de más de 400 días. La tabla `usage_charges` del mismo modelo tampoco recibe filas nuevas; las que hubiera se borran con la tienda.
| Datos de prospectos (nombre, cargo, mail laboral, empresa) | Hasta que la persona se opone; como máximo 24 meses desde el último contacto | **[COMPROMISO]** revisión manual cada 6 meses |
| Correspondencia de hello@ y support@ | 24 meses desde el último mensaje, salvo reclamo abierto | **[COMPROMISO]** revisión manual cada 6 meses |
| Registros de incidentes | 3 años | Manual |
| Exclusiones del arbitraje (tienda, fecha, mail) | Mientras dure la relación y 5 años más (plazo de prescripción de contratos escritos en Florida, Fla. Stat. 95.11, de memoria) | Manual |

Borrado anticipado a pedido de un merchant (privacidad 9): el operador desinstala o borra la tienda de la base con el procedimiento documentado (`DELETE FROM shops WHERE shop = ?`, que borra en cascada, más las filas de `session`), y responde por mail.

## 4. Subencargados

| Subencargado | Qué hace | Dónde | Contrato |
| --- | --- | --- | --- |
| Cloudflare, Inc. | Workers (app y sitio), D1 (base), Workflows (tareas), logs operativos | EE.UU. (base, región este de Norteamérica); red global para atender pedidos | **[COMPROMISO]** aceptar el DPA de Cloudflare desde el panel y archivar una copia con fecha |

No son subencargados: Shopify (plataforma y cobro, contrato propio con el merchant) y Klaviyo (contrato propio con el merchant). El proveedor de los buzones, cuando exista, es proveedor de TierSaver para su propia correspondencia; se nombra en privacidad 10.

Alta o cambio de un subencargado: actualizar privacidad 6 y el Anexo III del DPA, y mostrar el aviso en la app, **30 días antes**. El aviso se publica como indica la sección 9, con tipo `subprocessor`; el cambio no rige antes de los 30 días desde su `publishedAt`.

## 5. Registro de actividades de tratamiento como encargado (art. 30.2 GDPR)

| Campo | Contenido |
| --- | --- |
| Encargado | Digital Solvers LLC, LLC de Delaware, 153 E Flagler St, Suite 1640-6389, Miami, FL 33131, USA. Contacto: hello@tiersaver.com |
| Responsables por cuenta de quienes se trata | Cada merchant con la app instalada, identificado por su dominio `myshopify.com`. La lista vigente es la tabla `shops` |
| Representante en la UE / Reino Unido | Sin nombrar; decisión pendiente C9 (`docs/16-LEGALES.md` §2.4) |
| DPO | No hay; no es obligatorio |
| Categorías de tratamiento | (a) Auditoría de la lista de Klaviyo; (b) reconocimiento de compradores con los pedidos de Shopify; (c) simulación; (d) supresión de los perfiles aprobados y deshacer; (e) comprobación del plan de la tienda antes de cada limpieza; (f) atención de pedidos de acceso y borrado recibidos de Shopify |
| Titulares | Clientes, suscriptores y contactos del merchant con perfil en Klaviyo o pedido en Shopify |
| Datos | Guardados: id de perfil de Klaviyo, hash con clave del mail, motivo y estado, fecha del último pedido, hash del id de cliente de Shopify. En memoria, sin guardar: mail, fechas de creación y última actividad, estado de consentimiento y supresión. Sin categorías especiales |
| Transferencias a terceros países | EE.UU. (alojamiento, Cloudflare): cláusulas contractuales tipo de la UE y addendum del Reino Unido, vía el DPA. Argentina (acceso del operador): decisión de adecuación 2003/490/CE y normas de adecuación del Reino Unido |
| Medidas de seguridad (art. 32) | Anexo II del DPA y sección 2 de este documento |
| Plazos | Sección 3 |

Tratamientos propios, como responsable (art. 30.1, resumen): cuenta e instalación del merchant, registro de acciones con id de usuario de Shopify, estado del plan de la tienda, prospectos (interés legítimo, 24 meses), correspondencia.

## 6. Pedidos de titulares

La app no tiene relación directa con los clientes de las tiendas. El circuito es: cliente → tienda → Shopify → webhook → TierSaver → tienda.

| Pedido | Qué hace la app | Qué hace el operador |
| --- | --- | --- |
| Acceso (`customers/data_request`) | Verifica la firma, registra el pedido y lo lista en Settings → "Customer data requests". El merchant descarga lo que hay de ese cliente durante 90 días. La app no le envía nada al cliente | Nada, salvo que el merchant escriba |
| Borrado de un cliente (`customers/redact`) | Borra su hash de compras, sus filas de simulación y su pedido de acceso; en limpiezas pasadas quita el hash y reemplaza el id de perfil por un valor al azar. Un deshacer posterior no lo restaura | Nada |
| Borrado de la tienda (`shop/redact`) | Borra todo lo de la tienda. Respaldo a los 10 días | Nada |
| Un cliente escribe directo a hello@ | — | Responder dentro de 5 días hábiles derivándolo a la tienda; no confirmar ni negar que la tienda usa TierSaver más allá de lo necesario |
| Un merchant o un prospecto ejerce sus propios derechos | — | Responder dentro de 30 días. Prospecto que se opone: borrarlo y anotarlo en la lista de no contactar |

**[COMPROMISO]** hello@ tiene que existir y leerse para que estos plazos se cumplan.

## 7. Nota de evaluación de impacto: supresión automática por reglas

No es una evaluación de impacto formal (art. 35 GDPR). Es la nota que respalda la posición de que no hace falta una y de que el art. 22 no aplica, para entregar a un merchant que la pida (DPA 4, "Assistance").

- **Qué se decide:** si un perfil de Klaviyo deja de recibir marketing por mail de esa tienda.
- **Cómo:** reglas fijas y publicadas (nunca interactuó, antigüedad mínima, mails recibidos, nunca compró), que el merchant elige. Sin aprendizaje automático ni perfiles propios. Klaviyo evalúa los criterios de actividad dentro de un segmento; la app cruza con los pedidos de Shopify.
- **Intervención humana:** la primera limpieza siempre la aprueba una persona sobre una simulación que puede descargar. El modo automático exige una limpieza manual previa, solo usa los criterios por defecto y se frena solo si la limpieza sería desproporcionada (más del 10% de la lista o más de tres veces la última aprobada, sobre 200 perfiles).
- **Efecto sobre la persona:** deja de recibir campañas y flujos de esa tienda. No pierde su cuenta, sus compras ni los mails transaccionales. No hay efecto legal ni, a nuestro juicio, uno similarmente significativo. El riesgo real es comercial y del merchant: no enviarle a alguien que habría comprado.
- **Reversibilidad:** la persona puede volver a suscribirse, lo que levanta la supresión en Klaviyo; el merchant puede deshacer la limpieza o levantar una supresión a mano.
- **Sesgo conservador:** ante un dato faltante o desactualizado (pedidos de más de 6 horas), el perfil queda activo. Cada perfil se vuelve a revisar justo antes de enviarlo.
- **Datos:** mínimos y seudonimizados (sección 5). Sin categorías especiales; los términos prohíben enviarlas.
- **Riesgos que quedan:** un comprador con otro mail no se reconoce (términos 4 lo avisa); el deshacer puede levantar una supresión que el merchant puso por su cuenta (términos 4 lo avisa); una supresión no es un registro de baja (términos 4 lo avisa).
- **Conclusión:** riesgo bajo para los titulares. Revisar esta nota si se agregan criterios nuevos, otros canales (SMS) o cualquier modelo estadístico.

## 8. Regla de prospección

Regla adoptada (`16-LEGALES.md`): mails en frío solo a empresas de EE.UU.; cada mensaje lleva el nombre legal, el domicilio postal y cómo dejar de recibirlos; lista propia de no contactar; nada a Canadá, la UE ni el Reino Unido. Todo mail a terceros sale como borrador que el operador revisa y envía. Los datos de prospectos nunca salen de las cuentas de Shopify o de Klaviyo de un merchant.

## 9. Avisos dentro de la app (cómo publicar uno)

Los términos (8, 14, 16 y 17), la privacidad (6 y 13) y el DPA (5) prometen "a notice in the app" antes de un cambio de términos, de precios o de subencargados. Ese aviso es una lista escrita en el código: `shopify/app/notices.ts`. Hoy está vacía.

**Publicar un aviso es un cambio de código y un despliegue de la app.** No hay panel ni base de datos.

1. Redactar el texto en inglés, texto plano: `title` (una línea, con la fecha en que rige el cambio) y `body` (qué cambia y qué puede hacer el merchant). Sin datos personales y sin cifras que no estén ya en los términos o precios publicados. Lo aprueba Facundo.
2. Agregar la entrada **arriba** de `NOTICES` (la más nueva primero), con un `id` nuevo que no se reutiliza ni se renombra (por ejemplo `2027-02-terms`), `publishedAt` con la fecha del despliegue (día calendario UTC), `kind` (`terms`, `privacy`, `subprocessor`, `pricing` o `service`) y, si corresponde, `linkLabel` y `linkUrl` a la página publicada. Hay un ejemplo comentado en el archivo.
3. Publicar primero la página nueva en el sitio (términos, privacidad o DPA, con su fecha de vigencia futura) y después desplegar la app. Tests: `npm test` en `shopify/`.
4. Anotar en `STATUS.md` la fecha de publicación y la fecha en que rige el cambio.

Qué ve el merchant y por cuánto tiempo:

| Dónde | Qué | Hasta cuándo |
| --- | --- | --- |
| Home | Banner informativo arriba, con el botón "Got it" | 90 días desde `publishedAt`, o hasta que esa tienda apriete "Got it" |
| Pantalla de revisión de la simulación | El mismo banner, solo para avisos `terms` y `pricing` (ahí se aceptan los términos y el precio) | Igual que en Home |
| Settings → "Notices" | Lista de todos los avisos con su fecha, descartados o no | 12 meses desde `publishedAt` |

Reglas:

- **Mínimo 30 días visible y sin tocar.** El cambio anunciado no puede regir antes de `publishedAt` + 30 días (salvo que la ley, Klaviyo o Shopify exijan antes, términos 16). Una entrada no se edita ni se borra mientras esté dentro de los 12 meses: si hay que corregir, se publica otra.
- Una entrada con `publishedAt` futuro no se muestra hasta ese día. Cambiar el `id` de una entrada la vuelve a mostrar a todas las tiendas.
- El aviso nunca bloquea la app: informa. No reemplaza pedir de nuevo la aceptación de los términos, que sigue ocurriendo al aprobar una limpieza (`TERMS_VERSION`).
- **Registro:** cada "Got it" queda en `events_log` (acción `notice.dismissed`, tienda, usuario de Shopify, fecha, id del aviso), una fila por tienda y aviso. Se borra con el resto de los datos de la tienda al desinstalar. La app **no** registra cuándo vio el aviso cada tienda; la prueba de que se mostró es la fecha del despliegue y `publishedAt` en el historial de git.
- **Límites conocidos:** el aviso es igual para todas las tiendas (no se puede dirigir a una sola) y solo lo ve quien abre la app. Una tienda que no abre la app en esos 90 días no lo ve en Home; le queda la lista de Settings. Los términos (17, Notices) dicen que el aviso se da "when it is first shown there"; se acepta así (`16-LEGALES.md`).

## 10. Inscripción ante la AAIP (solo si ocurre un disparador)

Decisión del 2026-11-26 (`16-LEGALES.md` §2.5): no se inscribe ahora. Se revisa si la LLC obtiene CUIT o se registra en Argentina por otro motivo, si se suma un merchant argentino, si TierSaver contrata personal en Argentina o si la AAIP consulta. Las bases de los merchants **nunca** se inscriben: son de ellos. Lo que se inscribiría es la base propia de la LLC (cuentas de merchants, prospectos, correspondencia).

Pasos (fuente: https://www.argentina.gob.ar/servicio/inscribir-un-responsable-de-bases-de-datos-personales-privadas, leída el 2026-11-26; trámite gratuito, sin vencimiento):

1. Conseguir la CUIT de Digital Solvers LLC como sujeto del exterior y la clave fiscal nivel 2 de su representante, o apoderar a una persona en Trámites a Distancia (TAD). Esto lo hace un contador; tiene costo y consecuencias fiscales que hay que evaluar antes.
2. En TAD, iniciar "Inscripción del Responsable al Registro Nacional de Bases de Datos", tipo "privado", con los datos del responsable y copia digital del contrato social o certificado de constitución de la LLC.
3. Guardar el código de registro del responsable que llega por mail.
4. Con ese código, inscribir la base: nombre que describa contenido y finalidad ("Clientes y contactos comerciales de TierSaver"), datos que contiene (sin datos sensibles ni antecedentes), forma de recolección, destino y cesiones (Cloudflare como proveedor de alojamiento), medidas de seguridad (sección 2).
5. Anotar acá la fecha y los números de registro, y actualizar el registro si cambian los datos.

Consultas: registrobasesdedatos@aaip.gob.ar (según los instructivos de la AAIP encontrados por búsqueda, sin verificar).

## 11. Exclusiones del arbitraje

Términos 15 permite que un merchant se excluya del arbitraje dentro de los 30 días de aceptar los términos, por mail a hello@. Cada exclusión se registra (tienda `myshopify.com`, fecha de recepción, mail de origen) en un archivo fuera del repo, se responde con un acuse y se guarda mientras dure la relación y 5 años más. Una tienda excluida litiga en los tribunales de Miami-Dade, con las renuncias a jurado y a acciones colectivas.

