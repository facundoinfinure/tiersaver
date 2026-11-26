# Calendario de lanzamiento

Armado el 2026-11-26. Documento interno. Todo lo que "sale" lo envía o publica Facundo, a mano, desde sus cuentas. Las fechas son objetivos, no proyecciones.

## Dos fases, dos relojes

| | Fase 1 · antes de la aprobación | Fase 2 · app aprobada |
| --- | --- | --- |
| Empieza | Hoy | El día que Shopify aprueba la app y existe el enlace de instalación ("día A") |
| Por qué | Las apps públicas necesitan aprobación de Shopify y no hay instalación por enlace antes; la revisión se estima en unos 30 días desde el envío (envío hacia el 2026-12-08, instalaciones posibles recién en enero de 2027). Klaviyo sí deja autorizar la app sin revisar | — |
| Objetivo | Conversaciones, opiniones y lista de espera | Auditorías corridas y primera limpieza aprobada |
| Pedido en cada mensaje | Uno de estos: (a) 15 minutos para mostrar la simulación con datos de demostración y escuchar qué falta; (b) permiso para avisar el día que la aprueben. **Nunca "probá la auditoría"** | "Try the free audit" |
| Borradores | `drafts/phase1/<id>.md` (30 agencias), mensaje "PHASE 1" de `drafts/creators/<id>.md`, posts de valor sin nombrar el producto | `drafts/<id>.md`, mensaje "PHASE 2" de creadores, Ask and Offer, historia de fundador, Show HN, Product Hunt |
| Reloj | "Día D" = dominio y casilla `hello@tiersaver.com` funcionando (previsto desde el 2026-12-05) | "Día A" = aprobación |
| Métrica única | Semana a semana: respuestas → llamadas hechas → "sí, avisame" (lista de espera) | Auditorías corridas → primera limpieza aprobada |

La fase vigente se escribe en la línea `PHASE:` de `README.md`. La cambia Facundo el día A.

Opción de fase 1 que **decide Facundo** y que el calendario no da por hecha: auditoría hecha a mano con una clave privada de Klaviyo de solo lectura, creada y revocable por el merchant, que solo cuenta perfiles (ver `agency-offer.md`, última sección).

## Metas por semana (las dos fases)

- 10 mensajes personales nuevos (agencias y creadores sumados). Nunca más de 5 por día.
- 2 conversaciones (llamada, o intercambio real por escrito).
- Si en dos semanas seguidas no hay ninguna conversación, se frena el envío y se revisa el mensaje.

## Antes de empezar (bloqueos)

| Bloqueo | Afecta a | Quién |
| --- | --- | --- |
| Casilla `hello@tiersaver.com`, con SPF, DKIM y DMARC | Todo mail | Facundo |
| Dirección postal real en el pie | Todo mail a Estados Unidos (CAN-SPAM) | Facundo |
| Demo con datos de demostración que se pueda mostrar en 15 minutos | El pedido (a) de fase 1 | Facundo |
| Abrir `evidence_url` y `contact_source_url` de cada fila | Cada mensaje | Facundo |
| Cuentas propias y con actividad real en Reddit, Klaviyo Community, LinkedIn | Comunidades | Facundo |

## Filas que no necesitan la casilla (formulario o LinkedIn)

`prospects.csv` tiene 25 filas con canal `contact-form`:

- **15 listas para usar** (con variante de fase 1): B09, N01, N02, N06 (prioridad 1); B01, B02, B03, B05, B08, N04, N07, N08, N12 (prioridad 2); A09, N03 (prioridad 3).
- **4 que esperan una decisión de Facundo** (ver `notes`): A03 The Mail Effect, B06 LOOP, B07 UpTempo, N13 The Inbox.
- **6 de segmento C** (C01, C05 a C09): sin borrador; el plan dice "solo con un caso real".

**Decisión de Facundo:** estas 15 pueden salir antes del día D porque no dependen de la casilla, pero el mensaje invita a responder y hoy no hay dónde recibir la respuesta con la marca de TierSaver. Opciones: (1) esperar al día D; (2) enviarlas antes y dar como contacto el medio que Facundo elija. El calendario las pone desde D−7 marcadas como "solo si Facundo decide".

Un formulario también puede contar como publicidad en algunos países (ver `README.md`): un solo mensaje, y sin seguimiento en DE/AT/CH, FR/BE, IT, GR, CZ, FI, LT.

## Fase 1 · día D−7 a día D+30

Si un día cae en fin de semana o feriado, pasa al día hábil siguiente. "Valor 1" y "Valor 2" son los posts de `drafts/communities/value-*.md`, **sin** la línea que nombra el producto.

| Día | Qué sale | A quién (ids) | Comunidad | Notas |
| --- | --- | --- | --- | --- |
| D−7 | Nada sale. Facundo abre evidencia y contacto de 10 filas y las pasa a `approved` | B09, N01, N02, N06, B01, B02, B03, B05, B08, N04 | — | Preparar la demo de 15 minutos |
| D−6 | 3 formularios, **solo si Facundo decide** | B09, N01, N02 | — | Variante `drafts/phase1/` |
| D−5 | 2 formularios, **solo si Facundo decide** | N06, B05 | Klaviyo Community: 1 respuesta útil (T01), sin nombrar el producto | Leer las reglas ese día |
| D−4 | 3 formularios, **solo si Facundo decide** | B01, B02, B03 | — | Sin seguimiento en DE/AT/CH y FI |
| D−3 | 2 formularios, **solo si Facundo decide** | B08, N04 | Klaviyo Community: 1 respuesta (T02) | — |
| D−2 | Nada nuevo. Responder lo que haya llegado | — | LinkedIn: post de valor (suppress, delete, unsubscribe), sin el paréntesis final | — |
| D−1 | Revisar 10 filas de mail y pasarlas a `approved` | A01, A04, B04, N05, N10, N09, N11, A05, A06, A07 | — | Confirmar dirección postal para las de US |
| **D** | Probar la casilla (enviarse un mail, revisar SPF/DKIM/DMARC). 3 mails | N10, N09 (UK, Ltd confirmada), N05 (AU) | — | Si la dirección postal no está, no sale nada a US |
| D+1 | 5 mails | A01, A04, B04 (US), N11 (CA, si pasa la prueba de publicación visible), A07 (US) | — | — |
| D+2 | 2 mails | A05, A06 (US) | Reddit: Valor 1 en un subreddit cuyas reglas lo permitan | Métrica de la semana 1: **respuestas** |
| D+3 | Nada nuevo. Responder. (Hacia esta fecha Facundo envía la app a revisión de Shopify: freno del `CLAUDE.md`, lo decide y lo hace él) | — | Klaviyo Community: 1 respuesta (T04) | — |
| D+4 | Cargar respuestas y bajas en los CSV | — | — | Cierre de semana |
| D+7 | 5 formularios | N07, N08, N12, A09, N03 | — | Seguimientos que vencen: los de D−6 a D−3 (solo donde corresponde) |
| D+8 | 5 mensajes a creadores (mensaje PHASE 1) | CR09, CR02, CR08, CR05, CR19 | — | Canal: el que publica cada uno; abrirlo antes |
| D+9 | Seguimientos de D y D+1 | N10, N09, N05, A01, A04, B04, N11, A07 | LinkedIn: versión corta de Valor 1 | Métrica de la semana 2: **llamadas hechas** |
| D+10 | Responder. Llamadas | — | Klaviyo Community: 1 respuesta (T07) | — |
| D+11 | Cargar respuestas | — | — | Si no hubo ninguna conversación en dos semanas: frenar y revisar el mensaje |
| D+14 | 5 mensajes: 2 con país sin confirmar (por formulario) y 3 creadores | A02, A08; CR24, CR13, CR07 | — | A02 y A08: confirmar país antes |
| D+15 | 5 mensajes a creadores | CR01, CR11, CR16, CR20, CR14 | Reddit: Valor 2 (otra semana, otro subreddit) | — |
| D+16 | Seguimientos de D+7 y D+8 | N07, N12, A09; CR09, CR02, CR08, CR05, CR19 | — | Métrica de la semana 3: **llamadas hechas** |
| D+17 | Responder. Llamadas | — | X: hilo de valor, sin la frase final entre paréntesis | — |
| D+18 | Cargar respuestas | — | — | — |
| D+21 | 5 filas que Facundo haya destrabado | de A03, B06, B07, N13 y creadores `on-hold` ya resueltos | — | Si no hay 5 destrabadas, la sesión busca filas nuevas (ver `AUTOMATION.md`) |
| D+22 | 5 creadores cuyo canal ya se identificó | de CR27 a CR40 (videos sin canal identificado) | Klaviyo Community: 1 respuesta | Ninguno sale sin nombre y canal comercial confirmados |
| D+23 | Seguimientos de D+14 y D+15 | — | LinkedIn: post de valor | Métrica de la semana 4: **"sí, avisame"** |
| D+24 | Responder. Llamadas | — | — | — |
| D+25 | Cargar respuestas. Armar la lista de espera (quién dijo que sí, por qué canal, qué pidió) | — | — | — |
| D+28 | 10 filas nuevas de la semana (las que haya dejado la sesión programada) | nuevas | — | Semana de fiestas: esperar menos respuestas |
| D+29 | — | — | Reddit o Klaviyo Community: 1 respuesta útil | — |
| D+30 | Balance de fase 1: respuestas, llamadas, lista de espera, objeciones repetidas | — | — | Con eso se ajusta `agency-offer.md` antes del día A |

En fase 1 **no** se publica: Product Hunt, Show HN, historia de fundador, Ask and Offer, ni ningún post de tipo "I built".

## Fase 2 · día A a día A+30

| Día | Qué sale | A quién | Comunidad | Notas |
| --- | --- | --- | --- | --- |
| A | Facundo cambia `PHASE:` a 2 en `README.md`. Mensaje a la lista de espera, uno por uno: "it is approved, here is the install link" | Todos los que dijeron "sí, avisame" | — | Solo a quienes lo pidieron |
| A+1 | 5 mensajes de fase 2 a quienes tuvieron llamada | de la lista de conversaciones | Shopify Community, Ask and Offer: `shopify-ask-and-offer.md`, reescrito | Métrica de la semana: **auditorías corridas** |
| A+2 | 5 mensajes de fase 2 (`drafts/<id>.md`) a filas nunca contactadas | prioridad 1 y 2 restantes | — | Nunca un mensaje de fase 2 a quien ya recibió el de fase 1 y no contestó |
| A+3 | 5 creadores, mensaje PHASE 2 | los que contestaron en fase 1 primero | LinkedIn: historia de fundador (variante 3) | — |
| A+4 | Responder. Acompañar auditorías | — | — | — |
| A+7 | 10 mensajes de la semana | prospectos y creadores restantes | Indie Hackers: historia de fundador (variante 1) | Métrica: **auditorías corridas** |
| A+10 | — | — | Reddit: historia de fundador (variante 2), solo donde las reglas lo permitan | — |
| A+14 | 10 mensajes de la semana | — | Posts de valor, ahora con la línea de transparencia donde se permite | Métrica: **primera limpieza aprobada** |
| A+16 | — | — | Show HN, **solo** si hay algo que cualquiera pueda probar. Decisión de Facundo | Quedarse en el hilo todo el día |
| A+21 | 10 mensajes de la semana. Pedido de reseña a quien terminó su primera limpieza (guion 6 de `docs/05-GO-TO-MARKET.md`: a todos por igual, sin nada a cambio) | — | — | Métrica: **primera limpieza aprobada** |
| A+23 | — | — | Product Hunt. Decisión de Facundo (crear cuenta y publicar son frenos) | Sin pedir votos |
| A+28 | 10 mensajes de la semana | — | — | — |
| A+30 | Balance: auditorías, limpiezas aprobadas, qué canal trajo cada una (`tracker.csv`) | — | — | — |

## Decisiones que necesita Facundo

1. Si las 15 filas de formulario salen antes del día D, y con qué contacto de respuesta.
2. Si se ofrece la auditoría a mano con clave de solo lectura en fase 1.
3. Qué demo se muestra en la llamada de 15 minutos (tienda de desarrollo y cuenta de Klaviyo de prueba).
4. A03, B06, B07, N13: escribirles o no.
5. CR03 (Flowium ya es C01), CR21 (posible competidor), CR24 (puede responder con tarifa de patrocinio: no se paga por menciones).
6. Show HN y Product Hunt: sí o no, y cuándo.
7. Programa para agencias (`agency-offer.md`, opciones A a E) y qué hacer con la frase de comisión del guion 4 de `docs/05-GO-TO-MARKET.md`.
