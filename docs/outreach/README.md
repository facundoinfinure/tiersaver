# Prospección: cómo funciona

PHASE: 1

> **Fase 1 = antes de la aprobación de Shopify. Fase 2 = hay enlace de instalación.** La línea de arriba la cambia Facundo, a mano, el día que Shopify aprueba la app. Las sesiones de Claude la leen y no la tocan.
>
> **Aviso sobre los 40 borradores originales de `drafts/`:** los 30 mensajes a agencias piden "run a free audit". Eso **no se puede cumplir antes de la aprobación**: las apps públicas necesitan aprobación de Shopify, no hay instalación por enlace antes, y la revisión se estima en unos 30 días desde el envío (envío hacia el 2026-12-08; instalaciones posibles recién en enero de 2027). Esos originales quedan como versión de **fase 2**. Para la fase 1 están las variantes de `drafts/phase1/` (las 30; las 10 de mayor prioridad son A01, A04, B04, B09, N01, N02, N05, N06, N10, A02), que piden 15 minutos sobre datos de demostración o permiso para avisar el día de la aprobación.

Armado el 2026-11-26 (prospección inicial y, el mismo día, creadores, comunidades, oferta para agencias, calendario y automatización). Documento interno. Todo lo que está en `drafts/` es **borrador**: ninguna sesión de Claude envía, publica ni completa formularios. Facundo revisa y envía.

## Qué hay en esta carpeta

| Archivo | Qué es |
| --- | --- |
| `prospects.csv` | Una fila por agencia, freelancer o hilo de comunidad (53). Es la planilla de seguimiento. |
| `creators.csv` | Una fila por canal de YouTube, podcast, newsletter o cuenta que publica sobre Klaviyo, email para Shopify o retención (40; 4 en español). 27 están `on-hold` porque falta el nombre del canal o un contacto publicado. |
| `drafts/<id>.md` | Agencias, versión de fase 2: primer mensaje (menos de 110 palabras), pie obligatorio y un único seguimiento (menos de 50 palabras). Para hilos (`T..`), la respuesta. |
| `drafts/phase1/<id>.md` | Agencias, variante de fase 1. |
| `drafts/creators/<id>.md` | Creadores: mensaje PHASE 1 y mensaje PHASE 2, pie y seguimiento. |
| `drafts/communities/*.md` | Posts listos por comunidad: dos posts de valor, Ask and Offer, historia de fundador (3 variantes), Show HN, Product Hunt, X y LinkedIn. |
| `drafts/README.md` | Índice de borradores y a qué fase corresponde cada grupo. |
| `communities.md` | Reglas de autopromoción de cada comunidad (con cita y URL, o "sin verificar"), qué se permite y qué borrador usar. |
| `agency-offer.md` | La oferta para agencias en una página (fase 1 y fase 2), objeciones y respuestas, guion de demo de 15 minutos y las opciones de programa que decide Facundo. |
| `sequence.md` | Calendario: fase 1 (día D−7 a D+30) y fase 2 (día A a A+30), metas y métrica de cada semana. |
| `tracker.csv` | Registro diario de lo que Facundo hizo: fecha, canal, id, acción, borrador, resultado, próximo paso. |
| `AUTOMATION.md` | Qué puede hacer una sesión programada y qué no, requisitos y el texto listo para pegar. |
| `tools/check_outreach.py` | Verificador de frases prohibidas, montos, largos y evidencia. Se corre antes de cada commit. |
| `do-not-contact.csv` | Lista de supresión. Quien pide no ser contactado va acá y no se le escribe nunca más. |

Segmentos de `prospects.csv`: `A` (publicaron sobre limpieza de lista), `B` (boutiques y freelancers), `C` (Elite Master, sin borrador: el plan dice solo con un caso real), `new` (encontrados por búsqueda el 2026-11-26), `community` (hilos).

Valores de `type`: agency, freelancer, consultant, community-thread, newsletter. Valores de `contact_channel`: email, contact-form, linkedin, community. En `creators.csv`: `type` youtube, podcast, newsletter, blog, blog-training, creator-guest, x, x-newsletter; `contact_channel` contact-form, substack, not-found.

## Rutina diaria de 10 minutos (Facundo)

1. **Respuestas (3 min).** Abrir la casilla y los canales donde hubo envíos. Cada respuesta se anota en `tracker.csv` y cambia el `status` de la fila. Una baja va a `do-not-contact.csv` en el momento.
2. **Seguimientos (2 min).** Mirar en `tracker.csv` qué `next_step_date` es hoy. Enviar el único seguimiento que corresponda. No hay tercero.
3. **Envíos nuevos (4 min).** Tomar hasta 2 filas `approved` del día según `sequence.md`, abrir su borrador de la fase vigente, enviarlo a mano. Anotar fecha y `sent`.
4. **Registro (1 min).** Una línea por acción en `tracker.csv`, con los minutos que llevó.

La revisión de evidencia y contacto (pasar filas de `to-review` a `approved`) no entra en los 10 minutos: se hace una vez por semana, en tanda (ver "Ritmo semanal"). Si existe la tarea programada de `AUTOMATION.md`, el paso 3 arranca desde su resumen "las 10 acciones de hoy".

## Límite de esta primera corrida (leer antes de usar la planilla)

La sesión que armó esto tenía la red restringida a Klaviyo, Shopify y Cloudflare, y el pedido para ampliarla fue rechazado. Por eso:

- Las páginas de agencias, el directorio de partners y las comunidades **no se abrieron de forma directa**. Se leyeron a través del índice del buscador (búsquedas limitadas al dominio de cada organización). Cada fila lo dice en `notes`.
- Solo se abrieron directamente dos artículos del centro de ayuda de Klaviyo (los pasos manuales de las respuestas en comunidades).
- Reddit no es accesible para el buscador: no hay ningún hilo de Reddit.
- Antes de enviar cualquier mensaje, Facundo (o una sesión con red abierta) tiene que abrir `evidence_url` y `contact_source_url` y confirmar que el dato sigue ahí. Hasta entonces el estado es `to-review`.

Segunda corrida (2026-11-26, creadores y comunidades): la red solo dejó abrir `help.klaviyo.com`. YouTube, Reddit, Hacker News, Product Hunt, Indie Hackers, LinkedIn, X, la FTC, las dos comunidades y los sitios de creadores **no se abrieron**; todo salió del índice del buscador. Consecuencias:

- El buscador no muestra el nombre del canal de los videos de YouTube: 14 filas de `creators.csv` tienen el video como evidencia y el canal sin identificar (`on-hold`).
- No apareció ningún mail comercial de creadores: el contacto es el sitio o "not-found". `audience_size` quedó vacío en las 40 filas porque ningún resultado mostró la cifra.
- Los dos artículos de Klaviyo (24263920096027 y 24312135764251) sí se abrieron de forma directa y de ahí salen los pasos de los posts de valor.

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

- Un solo pedido. **Fase 1:** 15 minutos para mostrar la simulación con datos de demostración y escuchar qué falta, o permiso para avisar el día de la aprobación. **Fase 2:** probar la auditoría gratis en una cuenta y dar una opinión honesta. En ninguna de las dos es una venta, no se pide reseña ni mención y no se ofrece nada a cambio.
- La auditoría a mano con una clave privada de Klaviyo de solo lectura es una opción que decide Facundo (`agency-offer.md`); ningún borrador la ofrece.
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
- Reddit: sin acceso directo. Lo que se pudo saber de cada subreddit está en `communities.md`; antes de publicar hay que leer sus reglas.
- El resto (Indie Hackers, Hacker News, Product Hunt, X, LinkedIn, grupos): `communities.md`.

### Plataformas: automatización y autopromoción

- **Reddit.** Las reglas del sitio y de cada subreddit no se pudieron abrir: **sin verificar — leer antes de postear** (https://www.redditinc.com/policies/content-policy y las reglas de cada subreddit). Fuentes secundarias: una cuenta que casi solo se promociona se trata como spam, y publicar lo mismo en varios subreddits a la vez también. Nada automatizado; una cuenta, la de Facundo.
- **LinkedIn.** Su ayuda dice que no permite software ni extensiones de terceros que extraigan datos o automaticen actividad en el sitio (https://www.linkedin.com/help/linkedin/answer/a1341387, por el índice). Los mensajes salen a mano, uno por uno.
- **X.** "You may not send automated posts or Direct Messages that are spam, or otherwise engage in spamming activity." (https://help.x.com/en/rules-and-policies/x-automation, por el índice). Sin mensajes directos a desconocidos.
- **YouTube.** Políticas de spam y de comentarios: **sin verificar**. No se comenta en videos ajenos para nombrar el producto.
- Detalle por comunidad en `communities.md`; qué queda manual, en `AUTOMATION.md`.

### Creadores: transparencia (guías de la FTC)

- Una línea: **quien mencione TierSaver en público y tenga cualquier vínculo con nosotros (acceso anticipado, algo gratis, pago, relación personal) tiene que decirlo de forma clara en la misma pieza.** La FTC llama a eso "material connection" e incluye que la marca le pague o le dé productos o servicios gratis o con descuento. Fuentes (por el índice, sin abrir): https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers y https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking
- No se paga por menciones ni se ofrece nada a cambio. Por eso cada borrador a creadores lo dice y pide la aclaración si alguna vez hablan de la app.
- Si Facundo decide alguna vez pagar un patrocinio o un referido, se informa siempre, por escrito y en la pieza. No es asesoramiento legal.

### Reseñas y votos

- **No se compran reseñas, votos ni seguidores**, en ningún sitio, ni se le pide a conocidos que voten.
- **Shopify App Store.** Requisito 1.3 ("Always use honest and transparent review practices"): "It is forbidden to offer incentives or withhold features in exchange for reviews, regardless of whether this occurs through the app or external channels." Tampoco se pide una reseña positiva. Fuente (por el índice): https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements. Shopify informó en 2026 que despublica reseñas que no pasan su control de autenticidad y que las sanciones llegan a quitar la app o cerrar la cuenta de partner.
- **Prohibido el "review gating":** el pedido de reseña va igual para todos los que terminaron su primera limpieza, sin filtrar por conformidad y sin desviar a los disconformes (guion 6 de `docs/05-GO-TO-MARKET.md`).
- A agencias y creadores no se les pide reseña en el App Store: solo puede opinar quien tiene la app instalada, y nunca a cambio de algo.

## Pie obligatorio de todo mail

```
--
TierSaver, a product of Digital Solvers LLC
153 E Flagler St, Suite 1640-6389, Miami, FL 33131, USA
TierSaver is not affiliated with or endorsed by Klaviyo.
If you'd rather not hear from me again, reply "no thanks" and I won't write again.
```

- Identidad del remitente: "TierSaver, a product of Digital Solvers LLC". Nunca Infinure, dnuvi ni Alupont, ni en el texto ni en la dirección de envío ni en la firma.
- Dirección postal: la del buzón comercial de la LLC (confirmada por Facundo el 2026-11-26). Un buzón privado registrado ante una agencia receptora de correo (CMRA) cuenta como "valid physical postal address" (16 CFR 316.2(p), https://www.law.cornell.edu/cfr/text/16/316.2, leído el 2026-11-26), siempre que esté registrado a nombre de Digital Solvers LLC.
- Baja en una línea, por respuesta. Toda baja se carga el mismo día.
- En formulario o LinkedIn se dejan la primera y la última línea.

## Bloqueos antes de enviar el primer mail

1. **La casilla `hello@tiersaver.com` no existe** hasta que el dominio pase a Cloudflare (desde el 2026-12-05). No se envía desde ninguna dirección de otra marca. Hasta entonces solo se pueden usar formularios de contacto y LinkedIn, y solo en las filas donde ese es el canal.
2. ~~La dirección postal está pendiente~~. Resuelto el 2026-11-26: `153 E Flagler St, Suite 1640-6389, Miami, FL 33131, USA` (buzón comercial de la LLC). Facundo confirma que el buzón está registrado a nombre de Digital Solvers LLC ante la CMRA (formulario USPS 1583); si no, no cumple 16 CFR 316.2(p).
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
- **Segmento de 180 días:** el artículo 24263920096027 (reabierto el 2026-11-26) lista diez condiciones; las dos primeras son "Person can receive email marketing" y "Email is set". La tabla de `docs/12-CUMPLIMIENTO-KLAVIYO.md` 1.2.1 no las nombra (sí están en `site/src/pages/guides/klaviyo-list-hygiene.html`). Los posts de valor usan las diez. Conviene completar la tabla de `12`.
- **Regla de 90 días:** Klaviyo la cuenta desde la supresión anterior ("cannot be manually suppressed again until 90 days after the previous suppression"), no desde que se quita. `drafts/T05.md` y `T12.md` dicen "if you unsuppress a profile, you cannot suppress it again by hand for 90 days": ajustar la frase antes de publicarlas.
- **Comisión para partners:** el guion 4 de `docs/05-GO-TO-MARKET.md` ofrece "25% recurring commission or three free months". `agency-offer.md` no compromete nada y lo deja como opción abierta. Hay que decidir y corregir uno de los dos.
- **`docs/12` 3.2** todavía muestra como permitido "using Klaviyo's own recommended criteria"; `brand/messaging.md` lo prohíbe. Los borradores siguen a `messaging.md`.
