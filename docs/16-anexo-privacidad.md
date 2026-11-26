# Anexo de privacidad al memo para el abogado

Fecha: 2026-11-26. Anexo de `docs/16-LEGALES-PARA-ABOGADO.md`. Lo redactó un revisor de políticas de privacidad, no un abogado. No es asesoramiento legal.

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
- Los hashes son SHA-256 sin sal ni clave. Quien conoce un mail puede calcular su hash. La política ahora los llama datos seudonimizados.
- Ante un pedido de acceso, la app guarda más que un hash: también el id de perfil de Klaviyo, el motivo, el estado y las fechas. El webhook `customers/data_request` no hace nada; la respuesta al merchant es manual, por mail.
- El segmento que la app crea en Klaviyo queda en la cuenta del merchant al desinstalar. Esto responde la pregunta 11 del memo.
- La zona horaria de la tienda no se guarda hoy (la columna existe y nadie la escribe). Se sacó de la política.

## 2. Lo que quedó sin verificar

- El contenido real de la base en producción: que las columnas de usuario de `session` estén vacías y que la base esté en la región del este de Norteamérica (lo dice `docs/STATUS.md`, no la configuración). Consulta para lo primero: `SELECT COUNT(*) FROM session WHERE isOnline = 1 OR email IS NOT NULL OR firstName IS NOT NULL OR userId IS NOT NULL;` Debe dar 0.
- Qué campos guarda Cloudflare en los logs de cada pedido y por cuánto tiempo. Si guarda la dirección completa, quedan registrados el código de autorización de Klaviyo, el session token de Shopify (de vida corta, con el id del usuario), el dominio de la tienda y la IP. La política ya no dice que los logs "no contienen" esos datos; dice qué escribe y qué no escribe la app.
- El plazo de las copias de respaldo de la base (restauración a un punto en el tiempo). La política dice "a limited period", sin número.
- Si la zona de Cloudflare del sitio agrega cookies propias o analítica. Hay que mirarlo en el panel.
- El texto original de los API Terms de Klaviyo y de los requisitos de datos protegidos de Shopify. Se usó el resumen de `docs/12-CUMPLIMIENTO-KLAVIYO.md`.
- Si Shopify sigue devolviendo el mail en los pedidos de un cliente cuyo borrado ya se pidió. Si lo hace, la próxima lectura de pedidos volvería a crear su hash.
- El webhook de pedidos nuevos está desactivado hasta que Shopify apruebe el acceso al mail. Cuando se active, Shopify envía el pedido completo; conviene limitar los campos en la suscripción.

## 3. Preguntas para el abogado

1. ¿Describir los hashes SHA-256 sin sal como datos personales seudonimizados alcanza, o conviene pasar a un hash con clave para sostener la minimización ante Shopify y el GDPR?
2. Ante un pedido de acceso de un cliente (`customers/data_request`), ¿qué hay que entregarle al merchant (hash, fecha del último pedido, historial de supresión) y en qué plazo? ¿Alcanza un proceso manual por mail?
3. Después de un pedido de borrado (`customers/redact`), ¿se pueden conservar el id de perfil de Klaviyo, el motivo y el estado para poder deshacer una limpieza? ¿Por cuánto tiempo?
4. ¿Hace falta fijar plazos de retención mientras la app está instalada para lo que hoy no tiene plazo (hashes de compradores, historial de limpiezas, registro de acciones)?
5. ¿Cómo declarar las copias de respaldo del proveedor y los logs después del borrado? ¿Es compatible con el borrado "immediately" de los API Terms de Klaviyo y con las 48 horas de Shopify?
6. Cookie estrictamente necesaria de la app: ¿alcanza con declararla en la política, sin banner, para merchants de la UE y del Reino Unido?
7. Id de usuario del personal del merchant en el registro de acciones: ¿TierSaver es responsable o encargado de ese dato? ¿Qué aviso le corresponde a ese personal?
8. Cláusula 8 de los términos: ¿faltan auditoría, objeción a subencargados con plazo de aviso, devolución o borrado a elección y asistencia al merchant para que valga como contrato de encargado?
9. Incidentes: la política y los términos dicen "without undue delay". ¿Conviene un plazo en horas? ¿Cómo se concilia con la obligación de coordinar los comunicados con Klaviyo?
10. Avisos por mail al contacto de la tienda: leer ese mail desde Shopify es un tratamiento nuevo. ¿Puede prometerse ya en los términos si la política dice que hoy no se guarda?
11. Cuando exista un buzón con proveedor para hello@ y support@, ¿ese proveedor debe figurar en la política?
12. ¿Hace falta una frase sobre decisiones automatizadas (art. 22 GDPR), dado que el modo automático suprime sin revisión humana caso por caso?
