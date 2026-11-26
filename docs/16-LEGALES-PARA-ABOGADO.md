# Textos legales de TierSaver: paquete para firma del abogado

Fecha: 2026-11-26. Preparado por redactores de SaaS con asistencia de IA. **No somos abogados y esto no es asesoramiento legal.** Las posiciones de este memo son valores por defecto conservadores, ya escritos en los textos, para que usted los apruebe o los cambie. Donde una fuente no se pudo leer, la tabla lo dice.

## 1. Qué es y qué se le pide

**El producto.** TierSaver for Klaviyo es una app embebida de Shopify para tiendas (venta entre empresas). Con autorización del merchant lee su cuenta de Klaviyo y sus pedidos de Shopify, calcula una simulación de perfiles que nunca interactuaron y, después de que el merchant la aprueba, le pide a Klaviyo que los suprima (nunca los borra; una limpieza se puede deshacer desde la app). Plan mensual por tamaño de lista (US$ 9, 19, 39 o 79), cobrado solo por la facturación de Shopify: es gratis hasta la primera limpieza, el plan empieza cuando el merchant la aprueba y Shopify lo cobra cada 30 días hasta que lo cancela (modelo cambiado el 2026-11-26; antes era un cargo por limpieza). La app no envía mails. No está afiliada a Klaviyo ni a Shopify.

**Quién contrata.** Digital Solvers LLC (confirmado por el dueño el 2026-11-26). Falta un solo dato: estado de constitución y domicilio registrado (sección 4). Ley de Florida y tribunales del condado de Miami-Dade, por decisión del dueño. Quien opera la app es una sola persona, desde Argentina.

**Los tres documentos** (en inglés, fuentes en `site/src/pages/`):

| Documento | Archivo | Qué es |
| --- | --- | --- |
| Terms of service | `terms.html` | 18 cláusulas. Las de mayor peso: 4 (efectos de la supresión y límites del deshacer), 6 (precio y cobro), 11 a 13 (garantías, límite de responsabilidad, indemnidad), 15 (ley y foro) |
| Privacy policy | `privacy.html` | 14 secciones, escritas contra lo que el código guarda |
| Data Processing Addendum | `dpa.html` | 9 secciones y 3 anexos; incorporado por referencia desde términos 8; cláusulas contractuales tipo de la UE y addendum del Reino Unido |

**Cómo se hicieron.** Borrador, tres rondas de revisión contra el código y una auditoría de siete revisores (`docs/auditoria-2026-11-26/`), todo el 2026-11-26. Un test automático (`site/test/site.test.ts`) impide que el sitio diga algo distinto del código en precios, plazos y borrado. El 2026-11-26 se reescribieron la cláusula 6 de los términos y las partes de privacidad y DPA que describían el cobro, por el cambio a plan mensual. Las páginas siguen publicadas con cartel de borrador y sin indexar hasta su visto bueno. El historial cláusula por cláusula y las 43 preguntas originales están en `docs/16-historial-legales.md`; no hace falta leerlo.

**Qué se le pide.** Leer los tres textos y marcar la sección 2 (cinco puntos). La sección 3 no espera respuesta: son posiciones tomadas, a la vista por si quiere objetar alguna.

## 2. Lo único que necesitamos de usted

Cada punto ya está escrito en el texto con nuestra respuesta. Marque OK o cambiar.

| # | Punto | Nuestra respuesta, ya en el texto | Su visto bueno |
| --- | --- | --- | --- |
| 1 | **Garantías, límite de responsabilidad e indemnidad bajo ley de Florida** (términos 11, 12, 13) | Exclusión de garantías y de daños indirectos y lucro cesante, en mayúsculas y negrita. Tope total: lo pagado por Shopify en los 12 meses anteriores o USD 100, lo que sea mayor. Fuera del tope: muerte o lesiones por negligencia, fraude y dolo. El tope protege solo a TierSaver y no limita el pago ni la indemnidad del merchant. Indemnidad de una sola vía (del merchant), que no aplica si el reclamo resulta de nuestro incumplimiento, culpa grave o dolo. Sin indemnidad nuestra por propiedad intelectual. El mismo tope rige para el DPA | ☐ OK ☐ cambiar |
| 2 | **Ley, foro y renuncias** (términos 15) | Ley de Florida sin normas de conflicto; se excluye la CISG; tribunales estatales y federales de Miami-Dade, exclusivos. **Nuevo:** renuncia mutua a juicio por jurado y a acciones colectivas, en mayúsculas, con salvedad para donde la ley no las permite; excepción para medidas cautelares en cualquier tribunal; cada parte paga sus costos. Sin arbitraje. Sin acortar la prescripción | ☐ OK ☐ cambiar |
| 3 | **Suscripción con renovación automática y aceptación** (términos 1, 6, 16, 17). Cambió el 2026-11-26 | Es una suscripción clásica: instalar, conectar, auditar y simular son gratis; el plan empieza cuando el merchant aprueba su primera limpieza, en la pantalla de aprobación de Shopify, y Shopify lo cobra cada 30 días, haya o no limpieza, hasta que lo cancela. La tratamos como si las normas de renovación automática aplicaran aunque la venta sea entre empresas: términos 6 pone juntos, en una lista de cinco ítems, precio, renovación cada 30 días hasta cancelar, cómo cancelar (Settings → Plan, o desinstalando; efecto inmediato), sin reembolso del período en curso salvo que la ley lo exija, y cambio de precio solo con aprobación previa en Shopify. La app muestra precio, frecuencia y cómo cancelar antes de la aprobación, y registra quién aprobó, cuándo, el precio y la versión de los términos. Deshacer una limpieza no devuelve el mes. Modo automático: apagado por defecto, con casilla propia ("I accept the monthly plan described above and the TierSaver Terms of Service"); no agrega cargos y nunca sube el precio sin aprobación. Avisos solo dentro de la app (no hay mail, tampoco recordatorio de renovación). Aceptación: al instalar y con casilla en cada aprobación manual; cambios de términos con 30 días de aviso y uso continuado | ☐ OK ☐ cambiar |
| 4 | **DPA, transferencias y representante en la UE** (DPA completo; privacidad 7) | DPA incorporado por referencia, sin firma. Cláusulas tipo 2021/914: módulo 2 (y 3 si el merchant es encargado), cláusula 7 no aplica, cláusula 9 opción 2 con 30 días, ley y tribunales de Irlanda; addendum del Reino Unido; párrafo de Suiza. Sin adhesión al Data Privacy Framework. Acceso desde Argentina declarado, con la adecuación de la UE y del Reino Unido. **Representante del art. 27 GDPR: no se nombra durante la beta cerrada; se nombra en la UE y en el Reino Unido antes de abrir la app al público** | ☐ OK ☐ cambiar |
| 5 | **Argentina** (para un abogado argentino; no cambia los textos) | La contraparte es una LLC de EE.UU. y la base está en EE.UU., pero quien la opera está en Argentina. Posición: inscribir en el Registro Nacional de Bases de Datos de la AAIP (trámite gratuito) la base propia de contactos comerciales y la actuación como encargado, antes del primer merchant real. No se inscriben las bases de los merchants: son de ellos | ☐ OK ☐ cambiar |

## 3. Posiciones ya tomadas

No se pregunta nada de esta tabla. "Ex" es el número de la pregunta en la lista anterior (`docs/16-historial-legales.md`). Riesgo residual: lo que queda después de la posición. Fuentes leídas el 2026-11-26 salvo que diga otra cosa; "de memoria" quiere decir sin verificar hoy.

**Riesgo alto (uno solo, y no se arregla con texto)**

| Tema | Posición | Dónde | Base | Riesgo |
| --- | --- | --- | --- | --- |
| Cláusula de Klaviyo contra productos "competitive or substantially similar" | Seguimos adelante. Lectura: la cláusula prohíbe usar la API para construir un producto que compita con Klaviyo o lo copie. TierSaver no reemplaza a Klaviyo ni a ninguna función suya: opera dentro de la cuenta del merchant, exige que el merchant sea cliente de Klaviyo, usa los endpoints públicos de supresión para lo que fueron hechos y aplica los criterios que Klaviyo publica. Argumento en contra: Klaviyo ya ofrece guía y herramientas para suprimir inactivos, y decide "in its sole discretion". Mitigación: no decir que reemplaza funciones de Klaviyo ni usar palabras de aval (lo impide un test); seguir sus reglas de marca; precio fijo que no depende de lo que el merchant le paga a Klaviyo; términos 7 prohíbe el patrón suprimir y restaurar alrededor de la renovación; términos 9 y 14 permiten frenar el servicio sin responsabilidad si Klaviyo lo exige; las supresiones quedan en la cuenta del merchant. Opcional: pedirle a Klaviyo confirmación escrita antes de firmar su acuerdo de partners | Términos 2, 7, 9, 10, 14 | API Terms de Klaviyo, https://www.klaviyo.com/legal/api-terms ("Updated: November 12, 2026"): "access or use the APIs to: (i) design or develop a competitive or substantially similar product or service"; "We may terminate these API Terms with or without cause, and without notice to you". Análisis propio en `docs/12-CUMPLIMIENTO-KLAVIYO.md` | **Alto** (impacto total, probabilidad baja a media) |

**Contrato, cobro y responsabilidad**

| Ex | Tema | Posición | Dónde | Base | Riesgo |
| --- | --- | --- | --- | --- | --- |
| 1 | Entidad | Digital Solvers LLC. El domicilio de los textos no se tocó hasta que el dueño complete el dato de la sección 4. Registro como LLC extranjera en Florida y nombre de fantasía "TierSaver": los resuelve el dueño con ese dato. Sin página de aviso legal (Impressum): no hay establecimiento en la UE y el sitio ya muestra nombre, domicilio y contacto | Términos 1 y 18, privacidad 1 y 14, DPA 1 y Anexo I | Confirmación del dueño. Fla. Stat. §865.09, de memoria | Medio hasta completar el dato |
| 6 | Aceptación por instalación y casilla | Alcanza: instalación más casilla en cada aprobación manual, con versión de términos registrada. El modo automático queda cubierto por la casilla que lo activa | Términos 1, 17 (Electronic agreement) | Práctica estándar de clickwrap; registro en `events_log` | Bajo (ver punto 3 de la sección 2) |
| 7 | Evidencia de aprobaciones después de desinstalar | No se conserva. Todo se borra con el pedido de Shopify o a los 10 días. Aceptamos perder esa prueba: el tope de responsabilidad es bajo y Shopify conserva las facturas. Los registros contables de cada cargo son los informes de pagos de Shopify. El registro de acciones de 365 días que pide Klaviyo se cumple mientras la app está instalada | Privacidad 9 | Requisito de borrado de Shopify (webhooks de privacidad); minimización | Medio |
| 8 | Derechos no excluibles (Australia, Reino Unido, UE) | Cláusula general, sin anexos por país y sin bloquear países. Se usa "statutory rights" en lugar del término técnico australiano porque un test del sitio prohíbe la raíz de esa palabra en todas las páginas. Aceptamos que el foro de Florida puede no sostenerse frente a una empresa chica de esos países | Términos 12 ("Rights that cannot be excluded") | Práctica estándar; Australian Consumer Law, de memoria | Medio |
| 11 | Arbitraje | No. Tribunales, con renuncia a jurado y a acciones colectivas. La renuncia a jurado entre empresas se ejecuta en Florida si es consciente, voluntaria y visible. La renuncia a acciones colectivas fuera de un arbitraje tiene poca jurisprudencia; por eso lleva salvedad | Términos 15 | Holland & Knight, abril de 2025, https://www.hklaw.com/en/insights/publications/2025/04/commercial-leases-right-to-jury-trial-waived-or-not-waived ; Gelco Corp. v. Campanile Motor Service, 677 So.2d 952 (citado en resultados de búsqueda, no leído entero); McKenzie Check Advance v. Betts (Fla. 2013), que se apoya en la ley federal de arbitraje | Medio (ver punto 2) |
| 12 | Nombrar las leyes de marketing | Se nombran (CAN-SPAM, TCPA, CASL, GDPR, ePrivacy, PECR) y se cierra con "and the equivalent laws wherever your customers are" | Términos 3 | Pedido del dueño | Bajo |
| 13 | Agencias y staff | Quien actúa por la tienda obliga al merchant; la agencia declara tener mandato. Sin otra prueba: el registro guarda el id de usuario de Shopify | Términos 3 ("People who act for you") | Práctica estándar | Bajo a medio |
| 14 | Límites del deshacer | Alcanza el aviso de la cláusula 4 más la confirmación que la app ya pide al restaurar. Sin casilla adicional | Términos 4, 11, 12 | Documentación de Klaviyo citada con fecha en el texto | Medio (es el punto con más riesgo de reclamo de un merchant) |
| 15 | Publicidad y nombre | Ninguna página promete ahorro ni muestra precios de Klaviyo (lo impide un test). "for Klaviyo" es uso descriptivo, sin logo, con aviso de no afiliación en todas las páginas. Hay nombre de respaldo si Klaviyo lo objeta | Términos 1 y 5; pie del sitio | API Terms de Klaviyo: "You may not use the Klaviyo brand or marks outside of what is expressed in our Newsroom" | Medio |
| 16 | Sanciones y exportación | Alcanza la cláusula "Trade controls". Sin filtro propio: Shopify ya filtra a sus merchants | Términos 17 | Práctica estándar | Bajo |
| 17 | Reembolsos | El período ya pago no se reembolsa al cancelar, al desinstalar ni al deshacer una limpieza, "salvo ley"; cualquier corrección va por Shopify (reembolso o crédito). La app cancela en Shopify sin prorrateo; en un cambio de plan prorratea Shopify con sus reglas | Términos 6 | Práctica estándar; `shopify/app/billing/billing.ts`. El Partner Program Agreement de Shopify **no se pudo leer** (host fuera de la red de la sesión) | Bajo a medio |
| 18 | Impuestos | A cargo del merchant; se suman en la factura de Shopify. Quién es el proveedor a efectos de IVA y sales tax lo ve el contador, no el abogado | Términos 6 ("Taxes") | Práctica estándar | Bajo a medio |
| 19 | Idioma y Quebec | Inglés prevalece; se deja la frase en francés | Términos 17 | Práctica estándar | Bajo |
| 23 | Confidencialidad, nombres y logos, feedback, usuarios de gobierno | Cláusulas estándar, se quedan | Términos 17 | Práctica estándar | Bajo |
| 29 | Programa de agencias con comisión | No existe y no se lanza sin un acuerdo de referidos escrito, con divulgación de la comisión | Fuera de los textos | Decisión de alcance | Sin riesgo hoy |
| 30 | Plazo para reclamar | No se acorta la prescripción. Los 60 días para reclamos de cobro quedaron como plazo de colaboración: el texto dice que no acortan ningún plazo legal | Términos 6 ("Billing questions") | Fla. Stat. §95.03, de memoria | Bajo |
| 31 | Aviso de cambios | Términos: 30 días de aviso para cambios que reducen derechos, salvo que la ley, Klaviyo o Shopify exijan antes. Precio: un precio más alto (porque la lista subió de tramo o porque cambiamos los precios) aplica solo después de que el merchant lo aprueba en la pantalla de Shopify; hasta entonces sigue el precio aprobado | Términos 6 y 16 | Práctica estándar | Bajo |
| 32 | Honorarios para la parte vencedora | No. Cada parte paga sus costos | Términos 15 | Fla. Stat. §57.105(7), de memoria, la volvería recíproca | Bajo |
| 33 | Medidas cautelares | Exceptuadas del foro exclusivo | Términos 15 | Práctica estándar | Bajo |
| 34 | La política de privacidad como parte del contrato | Solo donde la cláusula 8 la cita | Términos 17 | Práctica estándar | Bajo |
| 41 | Frenos del modo automático | Los números (10% de la lista; tres veces la última limpieza) quedan en el centro de ayuda, no en los términos, que remiten a él | Términos 6 | Permite ajustarlos sin cambiar el contrato | Bajo |
| 42 | Sin cargo por limpieza | No existe más el cargo por limpieza: toda limpieza que arranca con el plan activo está incluida, completa o parcial. Sin plan activo que cubra el tamaño de lista, no arranca ninguna | Términos 6 ("What the plan covers") | Hecho del producto (`planGate` en `shopify/app/billing/billing.ts`) | Bajo |
| 43 | Avisos dentro de la app | La promesa se mantiene. El aviso ("notice banner") todavía no existe en la app: es requisito de lanzamiento (sección 5) | Términos 8, 14, 16, 17; privacidad 6, 13; DPA 5 | Decisión propia | Medio hasta que exista |
| nueva | Una sola tienda por cuenta de Klaviyo | La app rechaza una segunda conexión; está prohibido en uso aceptable | Términos 7 | Decisión del dueño del 2026-11-26; `shopify/app/runs/gateway.server.ts` | Bajo |
| nueva | Plan congelado por Shopify | Si Shopify congela el plan por un problema de pago de la tienda, no arranca ninguna limpieza hasta que Shopify lo reactiva. La app no cobra por otra vía | Términos 6 | `shopify/app/billing/billing.ts` | Bajo |

**Privacidad y datos**

| Ex | Tema | Posición | Dónde | Base | Riesgo |
| --- | --- | --- | --- | --- | --- |
| 2 | Adecuación de Argentina | Vigente en la UE: la Comisión revisó y mantuvo la Decisión 2003/490/CE el 15 de enero de 2024. Reino Unido: la página del ICO lista a Argentina como país adecuado. La política lo afirma "on the effective date" | Privacidad 7; DPA 6 | https://www.hunton.com/privacy-and-cybersecurity-law-blog/2024/01/19/european-commission-reviews-and-reaffirms-adequacy-decisions-for-11-jurisdictions/ ; https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/adequacy-regulations/is-the-restricted-transfer-covered-by-adequacy-regulations (extracto de búsqueda; la página no se abrió) | Bajo |
| 2, 35 | Representante del art. 27 y DPO | Sin DPO: no hay seguimiento a gran escala ni categorías especiales. Representante: ver punto 4. No nos apoyamos en la excepción de tratamiento "ocasional": el tratamiento es periódico | Privacidad 14 (se agrega cuando exista) | GDPR arts. 27 y 37, de memoria. Las Directrices 3/2018 del EDPB **no se pudieron abrir** (host fuera de la red) | Medio hasta nombrarlo |
| 3 | Contrato de "service provider" de California | Cumple: no vender ni compartir, fines de negocio nombrados, no combinar, mismo nivel de protección, derecho a verificar y a frenar, aviso en 5 días hábiles, traslado a subencargados | Términos 8; DPA 7 | Reglamento de la CCPA §7051, vía https://prighter.com/resources/laws/ccpa-regulations/sections/7051 (resumen; el plazo de 5 días hábiles es de memoria) | Bajo a medio |
| 4 | Plazos comprometidos | Se mantienen: incidentes sin demora indebida y a más tardar 48 horas desde la confirmación; subencargados 30 días; 5 días hábiles si no se puede cumplir; prospectos 24 meses. Las 48 horas dejan margen al merchant para sus 72 horas del art. 33 GDPR. Coordinar con Klaviyo aplica a los comunicados públicos, no al aviso privado a cada merchant; a Klaviyo se le avisa al mismo tiempo | Términos 8; privacidad 8, 10; DPA 4, 5 | Práctica estándar de DPA; API Terms de Klaviyo: "notify both us and your users" | Medio (una sola persona: ver `docs/17-POLITICAS-INTERNAS.md` §1) |
| 20 | Uso propio de conteos agregados | Compatible con el rol de encargado: no identifica a nadie. Hoy ningún código produce estadísticas | Términos 8; DPA 4 | Práctica estándar | Bajo |
| 21 | Retención mientras la app está instalada | Sin plazo fijo para hashes de compradores e historial de limpiezas: son necesarios para proteger a quien compró alguna vez y para poder deshacer. Lo demás tiene plazo (24 horas, 7 días, 90 días) | Privacidad 9 | `shopify/app/data/housekeeping.ts`; cuadro en `docs/17` §3 | Bajo a medio |
| 22 | "Immediately delete" de Klaviyo | Tokens al instante; el resto con el pedido de Shopify (48 horas) o a los 10 días; copias del proveedor hasta 30 días, que no se pueden apagar; borrado antes si el merchant lo pide por mail. No hace falta trasladar nada más a los términos | Privacidad 9 | API Terms de Klaviyo: "immediately delete a user's data if the user requests deletion or terminates their account with you" | Medio |
| 24 | Pedidos de titulares | Como está en el código: el pedido de acceso se registra y el merchant descarga los datos desde Settings durante 90 días; el pedido de borrado corta el vínculo con el perfil de Klaviyo, que queda suprimido y bajo control del merchant | Privacidad 9; DPA 4 | Webhooks de privacidad de Shopify | Bajo |
| 25 | Hashes | Datos personales seudonimizados (HMAC-SHA-256 con clave por tienda). Así los describe la política | Privacidad 3 | `shopify/app/email-hash.ts` | Bajo |
| 26 | Decisiones automatizadas | El art. 22 GDPR no aplica: reglas fijas elegidas y aprobadas por el merchant, sin efecto legal ni similar. Nota de evaluación en `docs/17` §7 | Privacidad 4 | Análisis propio | Bajo a medio |
| 27 | Id de usuario del personal del merchant | TierSaver es responsable, para seguridad y trazabilidad. Dato mínimo; al personal le informa el merchant | Privacidad 2 y 3 | Práctica estándar | Bajo |
| 28 | Prospección en frío | Solo a empresas de EE.UU. al lanzar, con nombre legal, domicilio y baja en cada mensaje. Nada a Canadá, la UE ni el Reino Unido sin revisión previa | Privacidad 10; regla interna en `docs/17` §8 | CAN-SPAM, CASL, PECR, de memoria | Bajo si se cumple la regla |
| 36 | Cookie de la app | Estrictamente necesaria, declarada, sin banner | Privacidad 3 | Excepción de la Directiva ePrivacy, de memoria | Bajo |
| 37 | Avisos por mail | La app no envía mails. Si un día lo hace, antes se actualiza la política y la lista de subencargados | Privacidad 3; términos 17 | Hecho del producto | Bajo |
| 38 | Proveedor de los buzones | Cuando exista, se nombra en privacidad 10 como proveedor nuestro (no subencargado de datos de clientes) | Privacidad 10 | Análisis propio | Bajo |
| 39 | Brasil y merchants argentinos | Cláusulas propias "a pedido" hasta que haya merchants de esos países | DPA 6 y 8 | Práctica estándar | Bajo |
| 35 | Registros en EE.UU. | Ninguno por privacidad: no vendemos datos | — | De memoria | Bajo |
| 40 | Accesibilidad del sitio | Sin declaración formal. El sitio se construyó con criterios de accesibilidad | — | No hay obligación conocida para un sitio B2B de este tamaño, de memoria | Bajo |
| ex decisión 3 | Inscripción ante la AAIP | Ver punto 5. Si no se inscribe, la guía de la AAIP trata a una base no inscripta como ilícita | — | Ley 25.326 art. 21 y Resolución AAIP 132/2018, https://www.argentina.gob.ar/normativa/nacional/norma-315502/normas-modificadas (resumen de búsqueda; el texto de la ley no se abrió) | Medio hasta inscribir |

## 4. Datos que completa el dueño

1. **Estado de constitución y domicilio registrado de Digital Solvers LLC.** Es el único dato de hecho pendiente. Los textos dicen "153 E Flagler St, Miami, FL 33131, United States" en seis lugares (términos 1 y 18, privacidad 1 y 14, DPA 1, Anexo I y contacto) y no nombran el estado. Con ese dato se decide también: registro como LLC extranjera en Florida y nombre de fantasía "TierSaver".
2. A confirmar, sin cambiar los textos: que la cuenta de Shopify Partner y la app de Klaviyo estén a nombre de la LLC; que el plan de Cloudflare de producción sea el pago (de eso dependen las copias de "up to 30 days").

## 5. Lo que depende de código u operación

| Qué | Por qué importa | Estado |
| --- | --- | --- |
| Aviso dentro de la app ("notice banner") | Términos 8, 14, 16 y 17, privacidad 6 y 13 y DPA 5 prometen "a notice in the app" | **Pendiente de código.** No publicar como vigente sin él |
| Una tienda por cuenta de Klaviyo | Términos 7, privacidad 4 | Implementado (`shopify/app/runs/gateway.server.ts`). El registro de limpieza sin cobrar del modelo anterior ya no existe en los textos ni lo escribe el código; la tabla quedó vacía y sin uso |
| Buzones hello@ y support@ | Los textos los nombran para reclamos, privacidad y avisos legales | **No existen todavía** |
| Políticas internas | Las piden Shopify (datos protegidos) y Klaviyo; respaldan las 48 horas | Redactadas en `docs/17-POLITICAS-INTERNAS.md`; **falta adoptarlas** (2FA, DPA de Cloudflare, ambiente de prueba) |
| Representante en la UE y el Reino Unido | Punto 4 | Sin nombrar; cuesta dinero: decide el dueño |
| Inscripción ante la AAIP | Punto 5 | Sin hacer |
| Quitar el cartel de borrador, fijar la fecha de vigencia y subir `TERMS_VERSION` | La app hace aceptar una versión con fecha | Hoy los tres textos y `TERMS_VERSION` dicen 2026-11-27 (el cambio a plan mensual); se vuelven a fijar el día de su visto bueno (`site/src/site-config.ts`, `shopify/app/legal.ts`) |
| App desplegada con el código de la auditoría | Los textos describen ese código | **Sin desplegar** (migraciones pendientes, ver `docs/STATUS.md`) |

## 6. Qué no se pudo verificar

- Partner Program Agreement y API License and Terms of Use de Shopify (`www.shopify.com` fuera de la red de la sesión).
- Directrices 3/2018 del EDPB (`edpb.europa.eu` fuera de la red): umbral del representante del art. 27.
- Texto oficial del reglamento de la CCPA §7051 y de la Ley 25.326: se usaron resúmenes.
- Lista vigente de países adecuados del Reino Unido: solo el extracto que devolvió la búsqueda.
- Jurisprudencia de Florida: citas tomadas de resúmenes, no de los fallos. No hay fallo de Florida encontrado sobre renuncia a acciones colectivas fuera de un arbitraje.
- Todo lo marcado "de memoria" en la sección 3.

Detalle técnico de privacidad (qué guarda cada tabla, logs, cookies): `docs/16-anexo-privacidad.md`.
