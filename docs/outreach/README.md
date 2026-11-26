# Prospección: cómo funciona

Armado el 2026-11-26. Documento interno. Todo lo que está en `drafts/` es **borrador**: ninguna sesión de Claude envía, publica ni completa formularios. Facundo revisa y envía.

## Qué hay en esta carpeta

| Archivo | Qué es |
| --- | --- |
| `prospects.csv` | Una fila por prospecto o hilo de comunidad. Es la planilla de seguimiento. |
| `drafts/<id>.md` | Primer mensaje (menos de 110 palabras), pie obligatorio y un único seguimiento (menos de 50 palabras). Para hilos (`T..`), la respuesta. |
| `do-not-contact.csv` | Lista de supresión. Quien pide no ser contactado va acá y no se le escribe nunca más. |

Segmentos del CSV: `A` (publicaron sobre limpieza de lista), `B` (boutiques y freelancers), `C` (Elite Master, sin borrador: el plan dice solo con un caso real), `new` (encontrados por búsqueda el 2026-11-26), `community` (hilos).

Valores de `type`: agency, freelancer, consultant, community-thread, newsletter. Valores de `contact_channel`: email, contact-form, linkedin, community.

## Límite de esta primera corrida (leer antes de usar la planilla)

La sesión que armó esto tenía la red restringida a Klaviyo, Shopify y Cloudflare, y el pedido para ampliarla fue rechazado. Por eso:

- Las páginas de agencias, el directorio de partners y las comunidades **no se abrieron de forma directa**. Se leyeron a través del índice del buscador (búsquedas limitadas al dominio de cada organización). Cada fila lo dice en `notes`.
- Solo se abrieron directamente dos artículos del centro de ayuda de Klaviyo (los pasos manuales de las respuestas en comunidades).
- Reddit no es accesible para el buscador: no hay ningún hilo de Reddit.
- Antes de enviar cualquier mensaje, Facundo (o una sesión con red abierta) tiene que abrir `evidence_url` y `contact_source_url` y confirmar que el dato sigue ahí. Hasta entonces el estado es `to-review`.

## Estados (`status`)

| Estado | Significa | Quién lo pone |
| --- | --- | --- |
| `to-review` | Fila y borrador listos para que Facundo los mire. | Claude |
| `approved` | Facundo abrió la evidencia y el contacto, y aprobó el texto. | Facundo |
| `sent` | Primer mensaje enviado. `last_action_date` = fecha de envío. | Facundo |
| `followed-up` | Se envió el único seguimiento (unos 5 días hábiles después). No hay tercer mensaje. | Facundo |
| `replied` | Contestaron. El resumen va en `notes`. | Facundo |
| `in-conversation` | Hay llamada o auditoría en curso. | Facundo |
| `closed-no-reply` | Sin respuesta 10 días hábiles después del seguimiento. No se insiste. | Claude o Facundo |
| `closed-not-now` | Dijeron que no por ahora, sin pedir baja. Se puede volver a escribir recién con un caso real. | Facundo |
| `do-not-contact` | Pidieron no ser contactados. Va también a `do-not-contact.csv`. Definitivo. | Facundo |
| `on-hold` | Falta un dato (país, contacto, decisión de Facundo). | Cualquiera |

## Ritmo semanal: 10 mensajes y 2 conversaciones

| Día | Facundo | Sesión de Claude |
| --- | --- | --- |
| Lunes | Elige 10 filas `to-review` por prioridad. Abre evidencia y contacto de cada una, corrige el borrador y las pasa a `approved`. | Antes del lunes: refresca la lista (ver abajo) y deja los borradores. |
| Martes y miércoles | Envía 5 por día, a mano, desde la casilla de TierSaver o por el formulario de cada agencia. Anota `sent` y la fecha. | Nada. No envía. |
| Jueves | Responde lo que haya llegado. Ofrece la auditoría sobre una cuenta. | Si Facundo pega una respuesta, propone borrador de contestación. |
| Viernes | Carga respuestas y bajas en el CSV y en `do-not-contact.csv`. Marca los seguimientos que vencen la semana siguiente. | Actualiza el CSV con lo que Facundo dictó; cierra filas vencidas; prepara los 10 de la semana siguiente. |

Meta: 10 primeros mensajes por semana y 2 conversaciones (llamada o auditoría corrida). Si en dos semanas seguidas no hay ninguna conversación, se revisa el mensaje antes de seguir enviando. Son objetivos, no proyecciones.

Orden sugerido: prioridad 1 primero (ver columna `priority`), mezclando canales para no depender del mail mientras la casilla no exista.

### Qué hace Facundo

- Revisa cada borrador contra la página que cita y lo envía él, con su nombre.
- Envía solo desde una dirección de TierSaver, con el pie completo.
- Registra respuestas, fechas y bajas.
- Decide los casos marcados en `notes` (The Mail Effect, LOOP, newsletter).

### Qué hace una sesión de Claude

- Refresca la lista: confirma que cada organización sigue activa, busca nuevos artículos de 2026 sobre limpieza de lista, vuelve a buscar los contactos que faltan, agrega hilos nuevos.
- Antes de agregar o redactar, cruza contra `do-not-contact.csv`. Si la organización o el contacto están ahí, no se toca.
- Redacta o ajusta borradores con las reglas de `docs/12-CUMPLIMIENTO-KLAVIYO.md` sección 3.2 y `brand/messaging.md`.
- Actualiza el CSV. No envía, no completa formularios, no crea cuentas, no inicia sesión en ningún lado.

## Reglas para los borradores

- Un solo pedido: probar la auditoría gratis en una cuenta y dar una opinión honesta. No es una venta, no se pide reseña y no se ofrece nada a cambio.
- Se vende higiene de lista con "the criteria Klaviyo publishes". Nunca ahorro, nunca pagarle menos a Klaviyo, nunca "Klaviyo recommends/recommended".
- La auditoría nunca es "read-only": no cambia ningún perfil, pero crea un segmento.
- Sin cifras, clientes ni testimonios inventados. Se dice que la app todavía no está en el Shopify App Store.
- Datos de contacto: solo los que la propia organización publica para consultas comerciales. No se adivinan ni se arman direcciones por patrón, no se usan sitios de listas ni data brokers, no se guardan teléfonos ni direcciones personales. Si no hay nada publicado: formulario de contacto, sin nombre.
- En comunidades: primero la respuesta útil (cómo hacerlo a mano), y como mucho una frase final de transparencia, solo donde las reglas lo permiten.

## Cumplimiento: mail en frío B2B

No es asesoramiento legal. Lo marcado como "de memoria" no se pudo verificar en esta corrida y hay que confirmarlo (idealmente con el abogado de `docs/16-LEGALES-PARA-ABOGADO.md`) antes de mandar mails a ese país. Todas las fuentes se leyeron el 2026-11-26 a través del índice del buscador, no abriendo la página.

### Estados Unidos — CAN-SPAM

- No hay excepción para mails entre empresas: la ley cubre todo mensaje comercial, B2B incluido.
- No exige consentimiento previo, pero cada mail tiene que cumplir: remitente y encabezados verdaderos, asunto que no engañe, dirección postal física válida, aviso claro de cómo darse de baja, y la baja procesada en 10 días hábiles como máximo. El mecanismo de baja tiene que funcionar al menos 30 días después del envío y no puede pedir más que la dirección de mail ni más pasos que responder o visitar una página.
- Fuente: FTC, "CAN-SPAM Act: A Compliance Guide for Business", https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- En el CSV: `US: CAN-SPAM, email ok with footer`. Las leyes estatales no se revisaron.

### Canadá — CASL

- Regla general: consentimiento. Hay consentimiento implícito (párrafo 10(9)(b)) solo si se cumplen las tres cosas: la persona publicó de forma visible la dirección (o hizo que se publicara), la publicación no dice que no quiere mensajes no solicitados, y el mensaje tiene que ver con su negocio o función.
- Que la dirección esté "disponible en internet" no alcanza; una copia hecha por un tercero tampoco. La carga de probar el consentimiento es de quien envía: guardar URL, fecha y por qué el mensaje es pertinente (por eso `contact_source_url` y `last_action_date`).
- Fuentes: CRTC, guía de consentimiento implícito, https://crtc.gc.ca/eng/com500/guide.htm · texto de la ley, https://laws-lois.justice.gc.ca/eng/acts/e-1.6/fulltext.html · decisión CRTC 2016-428 (Blackstone), https://crtc.gc.ca/eng/archive/2016/2016-428.htm
- De memoria, sin verificar: el mensaje también debe identificar al remitente, dar datos de contacto y un mecanismo de baja que se procese en 10 días hábiles.
- En el CSV: `CA: CASL implied consent only if...`. Antes de enviar, mirar la página y confirmar que no haya una frase del tipo "no unsolicited messages".

### Reino Unido — PECR y UK GDPR

- Los "corporate subscribers" (sociedades como Ltd, LLP) quedan fuera de la regla de consentimiento de PECR para mail: se les puede escribir sin consentimiento, sin ocultar la identidad y dando una dirección válida para darse de baja; la baja se respeta.
- Autónomos ("sole traders") y sociedades de personas comunes cuentan como individuos: hace falta consentimiento o "soft opt-in" (que no aplica a un primer contacto). Si no se sabe qué es, se lo trata como individuo.
- Si el mensaje va a una persona con nombre, además aplica UK GDPR (base: interés legítimo, con derecho de oposición).
- Fuentes: ICO, "Business-to-business marketing", https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/ · ICO, "Electronic mail marketing", https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/
- En el CSV: `UK: PECR corporate subscriber...` cuando la forma societaria está confirmada; si no, formulario.

### Unión Europea

- La directiva ePrivacy (artículo 13) exige consentimiento previo para mail a personas físicas y deja que cada país decida cómo proteger a las personas jurídicas. Por eso el B2B cambia país por país. Fuente secundaria (no oficial): Fieldfisher, "EU e-marketing requirements", enero 2024, https://fieldfisher.com/en/insights/eu-e-marketing-requirements
- Además aplica el RGPD cuando la dirección identifica a una persona (nombre@empresa).
- Francia: la CNIL admite la prospección por mail entre profesionales sin consentimiento previo si el mensaje tiene relación con la profesión, con información y oposición simple y gratuita en cada mensaje; pero una ficha antigua desaconseja armar listas con direcciones tomadas de sitios web, y la CNIL remite a una sentencia del TJUE del 13-11-2025 (C-654/23). Fuente: https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique
- Lituania: una tabla de un proveedor dice que no hace falta consentimiento para B2B, con baja. Fuente no oficial, sin verificar.
- Alemania y Austria (de memoria, sin verificar): se exige consentimiento previo también para mail B2B (en Alemania, UWG §7). Italia, Grecia, República Checa, Finlandia y Bélgica: no se encontró fuente oficial en esta corrida.

Criterio que se aplicó por país en el CSV:

| País | Qué se hace |
| --- | --- |
| US | Mail, con pie completo. |
| CA | Mail solo si se cumple la prueba de publicación visible; si no, formulario. |
| UK (Ltd/LLP confirmada) | Mail, con identidad y baja. |
| UK (autónomo o forma no confirmada) | Formulario o LinkedIn. |
| AU | Mail, con pie y baja que funcione. |
| DE / AT / CH | Sin mail. Formulario del directorio o LinkedIn. |
| FR / BE, IT, GR, CZ, FI, LT | Sin mail hasta verificar. Formulario o LinkedIn. |
| SG | Sin verificar. Formulario. |
| País no confirmado | Primero confirmar el país. Mientras tanto, formulario. |

Un mensaje comercial enviado por formulario también puede contar como publicidad en algunos países (Alemania, de memoria). El formulario baja el riesgo porque es el canal que la empresa abrió para consultas, pero no lo elimina: un solo mensaje, pertinente, y nunca un segundo si no contestan en los países de la última fila.

### Australia — Spam Act 2003

- Regla general: consentimiento expreso o inferido. La mera publicación de una dirección no alcanza, salvo la excepción laboral: dirección de trabajo publicada de forma visible, con acuerdo de la persona u organización, sin aviso de que no quiere mensajes comerciales, y mensaje relacionado con su función.
- La ACMA advierte que el consentimiento inferido es menos confiable que el expreso y que la carga de la prueba es de quien envía.
- De memoria, sin verificar: el mensaje debe identificar al remitente y traer una baja funcional, procesada en 5 días hábiles.
- Fuentes: ACMA, "Avoid sending spam", https://www.acma.gov.au/avoid-sending-spam · Spam Act 2003, Schedule 2, https://www.legislation.gov.au/Details/C2016C00614 (consolidación de 2016; no se confirmó que sea la vigente).

### Singapur (una fila, Chronos Agency)

- La Spam Control Act exige una vía de baja y la etiqueta `<ADV>` en mensajes comerciales no solicitados enviados en forma masiva. No quedó claro si un mail individual B2B entra. Fuente: IMDA, https://imda.gov.sg/infocomm-regulation-and-guides/unsolicited-communications/best-practices-for-organisations · ley, https://sso.agc.gov.sg/Act/SCA2007. Sin verificar: usar formulario.

### Comunidades

- Klaviyo Community: se puede mencionar un producto si es pertinente al mensaje original y ayuda de forma directa. Guía: https://community.klaviyo.com/getting-started-with-the-community-50
- Shopify Community: las recomendaciones de apps solo van en el foro "Ask and Offer", sea la app propia o ajena; promocionar en otros foros cuenta como spam y los mensajes privados no solicitados están prohibidos. Guía: https://community.shopify.com/guidelines. Por eso el borrador para el hilo de Shopify no menciona TierSaver.
- Reddit: sin acceso. Antes de responder en cualquier subreddit hay que leer sus reglas; la mayoría limita la autopromoción (de memoria, sin verificar).

## Pie obligatorio de todo mail

```
--
TierSaver, a product of Digital Solvers LLC
[registered address — pending]
TierSaver is not affiliated with or endorsed by Klaviyo.
If you'd rather not hear from me again, reply "no thanks" and I won't write again.
```

- Identidad del remitente: "TierSaver, a product of Digital Solvers LLC". Nunca Infinure, dnuvi ni Alupont, ni en el texto ni en la dirección de envío ni en la firma.
- Dirección postal: va la real cuando exista. Sin ella el mail no cumple CAN-SPAM.
- Baja en una línea, por respuesta. Toda baja se carga el mismo día.
- En formulario o LinkedIn se dejan la primera y la última línea.

## Bloqueos antes de enviar el primer mail

1. **La casilla `hello@tiersaver.com` no existe** hasta que el dominio pase a Cloudflare (desde el 2026-12-05). No se envía desde ninguna dirección de otra marca. Hasta entonces solo se pueden usar formularios de contacto y LinkedIn, y solo en las filas donde ese es el canal.
2. **La dirección postal está pendiente** (`[registered address — pending]`). Sin dirección no sale ningún mail a Estados Unidos.
3. Cada fila tiene que pasar por la revisión de Facundo (evidencia y contacto abiertos de forma directa).
4. Antes del primer envío por mail conviene configurar SPF, DKIM y DMARC del dominio (recomendación general, no figura todavía en `docs/10-TAREAS-HUMANAS.md`).

## Lista de supresión

`do-not-contact.csv` tiene las columnas `organization,contact_value,date,reason`.

- Toda persona u organización que pida no ser contactada, por el medio que sea, va a ese archivo el mismo día, y su fila en `prospects.csv` pasa a `do-not-contact`.
- No se le vuelve a escribir nunca, por ningún canal, ni con otro motivo, ni desde otra dirección.
- La lista se revisa antes de cada tanda de envíos y antes de agregar prospectos nuevos. No se borra ninguna línea.
- En `contact_value` va el dato con el que se la contactó (la dirección o la URL del formulario); en `reason`, "opt-out" y el canal por el que lo pidió.

## Diferencias encontradas con el resto del paquete

- **Criterios de Klaviyo**: el artículo "Understanding active profile management in Klaviyo" (https://help.klaviyo.com/hc/en-us/articles/24263920096027, abierto el 2026-11-26) describe el segmento de inactividad con perfiles creados hace **180 días** o más. `docs/12-CUMPLIMIENTO-KLAVIYO.md` cita otro artículo (24312135764251, leído el 2026-11-25) con **365 días**. Las respuestas para comunidades citan el de 180 días, que es el que se abrió hoy. Hay que releer los dos y anotar el resultado en `docs/STATUS.md`.
- El mismo artículo no dice cuándo revisa Klaviyo el conteo ni cuánto tarda en actualizarse (solo "may take some time"). El guion 7 de `docs/05-GO-TO-MARKET.md` habla de 72 horas: las respuestas de `drafts/T*.md` no repiten ese dato.
- **amail agency** figura como Platinum Master en el directorio (el plan decía Silver Master). **YOCTO** figura como Elite Master.
- **LOOP** es ambiguo: hay dos fichas en el directorio (Milán, Platinum Master; Salzburgo, sin nivel).
- **Digital Heroes** no es una agencia de retención sino una agencia de software y Shopify de unas 115 personas.
- **UpTempo** y **&BAM** no se pudieron verificar.
