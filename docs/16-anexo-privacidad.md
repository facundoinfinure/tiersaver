# Anexo de privacidad al memo para el abogado

Fecha: 2026-11-26. Anexo de `docs/16-LEGALES-PARA-ABOGADO.md`. Lo redactó un revisor de políticas de privacidad, no un abogado. No es asesoramiento legal.

Actualizado el 2026-11-26 después de la revisión independiente de privacidad: ver "Qué cambió en la segunda ronda" al final de la sección 1. Las preguntas de este anexo pasaron a la lista única del memo (sección 3).

Qué es: el resultado de contrastar `site/src/pages/privacy.html` con el código de la app, tabla por tabla y log por log. Las respuestas de la sección 1 salen de leer el código; lo que no se pudo comprobar está en la sección 2.

## 1. Hechos comprobados en el código

### (a) Nombre y mail del usuario en la tabla `session`

No se llenan. Quedan en NULL.

- La app usa solo sesiones offline: `shopify/app/shopify.server.ts` no define `useOnlineTokens` y la librería lo pone en `false`.
- El adaptador de sesiones escribe `userId`, `firstName`, `lastName`, `email`, `accountOwner`, `locale`, `collaborator` y `emailVerified` solo cuando la sesión es online.
- Sí se guardan: id de sesión, dominio de la tienda, permisos, vencimiento, token de acceso y token de renovación de Shopify (los dos cifrados).
- El id de usuario de Shopify sí se guarda, en otras tablas: registro de acciones, simulaciones, auditorías y limpiezas. Sale del session token de Shopify. No se guarda nombre ni mail del personal.
- Cada aprobación manual registra además la versión de los términos aceptada (`shopify/app/legal.ts`, `shopify/app/simulations/review.ts`).

Esto responde la pregunta 12 del memo. Certeza alta por lectura de código; falta la comprobación en la base real (sección 2).

### (b) Datos de trabajo de una auditoría (`scan_profiles`)

Por cada perfil evaluado se guarda, mientras dura la auditoría:

- id de perfil de Klaviyo y hash SHA-256 del mail;
- fecha de creación y fecha de última actividad;
- estado de email: si puede recibir marketing, consentimiento, fecha del consentimiento y motivos de supresión;
- estado de SMS: si puede recibir marketing y consentimiento;
- la decisión de la regla y su motivo.

No hay mail en claro, nombre ni teléfono. Abarca a todos los perfiles evaluados (hasta 50.000), no solo a los seleccionados.

Se borra cuando la auditoría termina o falla. Si la auditoría muere sin llegar a su propia limpieza, la borra la tarea horaria `shopify/app/data/housekeeping.ts`: pasa una vez por hora y borra lo que tenga más de 24 horas, así que el peor caso es de unas 25 horas desde el inicio. Por eso la política dice "about 24 hours".

La misma tarea borra a los 7 días la lista por perfil de las simulaciones que nunca se ejecutaron (los conteos quedan) y a las 24 horas los marcadores de intentos de conexión con Klaviyo.

### (c) Mails en claro en logs o registros

No se encontró ninguno.

- Los `console.*` de la app escriben el tipo de webhook, contadores o el nombre del error.
- El detalle del registro de acciones lleva ids, contadores, códigos, reglas y la versión de los términos.
- Los errores de la supresión se reducen a códigos.
- Los datos que Cloudflare persiste de cada Workflow son ids, contadores y cursores.

Reservas: `shopify/app/entry.server.tsx` registra el error de render sin filtrar (riesgo bajo), y no se auditó todo lo que registra la librería de Shopify.

### (d) Cookies

- **App:** una sola, `__Host-ts_klaviyo_oauth`. Se pone al empezar a conectar Klaviyo, dura como máximo 10 minutos, es `HttpOnly`, `Secure` y `SameSite=Lax`, y se borra al terminar ese paso. Ata la respuesta de Klaviyo al navegador; no lleva datos personales. La librería de Shopify no pone cookies y la app no usa almacenamiento del navegador.
- **Sitio:** ninguna. La política de seguridad de contenido bloquea pedidos a otros sitios y envíos de formularios. El list check no envía ni guarda nada.

### Otros hechos que cambiaron el texto

- El mail de los perfiles de Klaviyo se lee en tres situaciones, no en dos: en cada auditoría (para calcular el hash), al suprimir o restaurar, y al descargar el CSV.
- La app no lee aperturas, clics ni eventos de Klaviyo. Los criterios los evalúa Klaviyo dentro del segmento que la app mantiene.
- Los hashes son hoy SHA-256 sin sal ni clave: quien conoce un mail puede calcular su hash, y el mismo cliente tiene el mismo valor en todas las tiendas. Está decidido pasarlos a HMAC-SHA-256 con clave por tienda guardada fuera de la base. La política ya los describe así ("keyed, per-store pseudonymized hashes"); el código todavía no (ver memo, sección 5).
- Ante un pedido de acceso, la app guarda más que un hash: también el id de perfil de Klaviyo, el motivo, el estado y las fechas. El webhook `customers/data_request` hoy no hace nada. Está decidido que registre el pedido y que el merchant vea en la app los datos que tenemos de ese cliente. El registro ya está en el código en curso (tabla `privacy_requests`, 90 días); la pantalla de descarga todavía no (ver memo, sección 5).
- El segmento que la app crea en Klaviyo queda en la cuenta del merchant al desinstalar. Esto responde la pregunta 11 del memo.
- La zona horaria de la tienda no se guarda hoy (la columna existe y nadie la escribe). Se sacó de la política.

### Qué cambió en la segunda ronda

La revisión independiente de privacidad volvió a leer el código y la documentación de Cloudflare, Shopify y Klaviyo. Lo que cambió en los textos:

- **Copias de respaldo.** D1 guarda copias de restauración a un punto en el tiempo ("Time Travel") por 7 días en el plan gratuito y 30 en el pago, y no se puede apagar. La política dice "up to 30 days" y ya no dice "encrypted", que no se pudo confirmar.
- **Logs.** Los logs por pedido de Cloudflare guardaban la dirección completa (con el código de autorización de Klaviyo y el session token de Shopify). Se apagaron (`invocation_logs: false` en `shopify/wrangler.jsonc`). Quedan los logs propios de la app, sin mails, nombres, tokens ni códigos. Cloudflare los guarda 3 o 7 días según el plan; la política no pone número.
- **Desinstalación.** La revocación en Klaviyo es de un solo intento y el error no se registra: la política ahora dice "we ask Klaviyo to revoke our access". Si el `shop/redact` de Shopify no llega, una purga de respaldo borra todo a los 10 días de la desinstalación (`shopify/app/data/housekeeping.ts`, en el código en curso); la política ya la menciona.
- **Datos que faltaban declarar.** Permisos de Shopify y fecha desde la que se leyó el historial; en los cargos, tamaño de lista, perfiles suprimidos, monto y motivo de no cobro; de la cuenta de Klaviyo, si es de prueba, los nombres de listas y segmentos, y el plan B que pide la cuenta sin limitar campos.
- **Argentina.** Quien opera y da soporte accede a la base desde Argentina. La política y el DPA lo declaran, con la mención de adecuación de la UE y del Reino Unido (a confirmar por el abogado).
- **Contrato de encargado.** Existe ahora `site/src/pages/dpa.html`, con cláusulas contractuales tipo (módulo 2), addendum del Reino Unido y tres anexos. El Anexo II lista solo medidas que el código tiene; no menciona 2FA, separación de ambientes ni registro de accesos del operador, porque no hay evidencia de ninguna de las tres.
- **Prospectos.** La política cubre los datos de contactos comerciales (sección 10).

Lo que la revisión propuso y **no** se aplicó, porque no hay decisión ni código: plazos de retención mientras la app está instalada; un registro mínimo que sobreviva a la desinstalación; borrar el id de perfil de Klaviyo ante un `customers/redact`; limitar los campos del webhook de pedidos (sigue desactivado).

Requisitos de Shopify (datos protegidos, nivel 2) y de Klaviyo que hoy no se cumplen y no se arreglan con texto: política de respuesta a incidentes, política de acceso y prevención de pérdida de datos, registro de accesos del operador, separación de datos de prueba y de producción, logs de 365 días a prueba de manipulación, procedimiento de rotación de secretos. Están en el memo, sección 4, punto 5.

## 2. Lo que quedó sin verificar

- El contenido real de la base en producción: que las columnas de usuario de `session` estén vacías y que la base esté en la región del este de Norteamérica (lo dice `docs/STATUS.md`, no la configuración). Consulta para lo primero: `SELECT COUNT(*) FROM session WHERE isOnline = 1 OR email IS NOT NULL OR firstName IS NOT NULL OR userId IS NOT NULL;` Debe dar 0.
- Qué plan de Cloudflare tiene la cuenta de producción (de eso dependen los 30 días de copias y los días de logs), y si D1 cifra en reposo las copias.
- Que `shopify/app/entry.server.tsx` no escriba en los logs un error de render con datos (hoy lo registra sin filtrar).
- Si la zona de Cloudflare del sitio agrega cookies propias o analítica. Hay que mirarlo en el panel.
- El Partner Program Agreement y el API License and Terms of Use de Shopify, el reglamento de la CCPA, la Ley 25.326 y las normas de la AAIP: los hosts estaban fuera de la red de la sesión. Los API Terms de Klaviyo y los requisitos de datos protegidos de Shopify sí se leyeron el 2026-11-26.
- Que la adecuación de Argentina siga vigente para la UE y para el Reino Unido.
- Si Shopify sigue devolviendo el mail en los pedidos de un cliente cuyo borrado ya se pidió. Si lo hace, la próxima lectura de pedidos volvería a crear su hash.
- El webhook de pedidos nuevos está desactivado hasta que Shopify apruebe el acceso al mail. Cuando se active, Shopify envía el pedido completo; conviene limitar los campos en la suscripción.

## 3. Preguntas para el abogado

Pasaron a la lista única de `docs/16-LEGALES-PARA-ABOGADO.md`, sección 3. Equivalencias (número de este anexo → número de la lista única):

| Anexo | Tema | Lista única |
| --- | --- | --- |
| 1 | Hashes como datos seudonimizados | 25 |
| 2 | Pedido de acceso (`customers/data_request`) | 24 |
| 3 | Qué se conserva tras un `customers/redact` | 24 |
| 4 | Retención mientras la app está instalada | 21 |
| 5 | Copias de respaldo, logs y "immediately delete" de Klaviyo | 7 y 22 |
| 6 | Cookie estrictamente necesaria, sin banner | 36 |
| 7 | Id de usuario del personal: responsable o encargado | 27 |
| 8 | Cláusula 8 como contrato de encargado | 2 (ahora hay un DPA) |
| 9 | Plazo de aviso de incidentes y coordinación con Klaviyo | 4 |
| 10 | Avisos por mail al contacto de la tienda | 37 |
| 11 | Proveedor de los buzones hello@ y support@ | 38 |
| 12 | Decisiones automatizadas (art. 22 GDPR) | 26 |

Preguntas nuevas de privacidad, también en la lista única: DPA y transferencias (2), contrato de "service provider" de la CCPA (3), prospección (28), Brasil y Argentina (39). Decisiones del dueño relacionadas (memo, sección 4): inscripción ante la AAIP, representante del art. 27 y políticas internas.
