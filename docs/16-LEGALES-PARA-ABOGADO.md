# Textos legales: memo para el abogado

Fecha: 2026-11-26. Redactado por un redactor de SaaS, no por un abogado. No es asesoramiento legal.

Archivos: `site/src/pages/terms.html` y `site/src/pages/privacy.html` (fuentes, en inglés). El sitio publicado (`site/terms.html`, `site/privacy.html`) se genera desde ahí.

## 1. Qué se le pide

Leer los términos y la política de privacidad de TierSaver for Klaviyo (Digital Solvers LLC, Florida) y decir "ok" o marcar qué cambiar, con foco en la limitación de responsabilidad, la indemnidad, la ley aplicable y las preguntas de la sección 3.

Contexto mínimo: app embebida de Shopify para merchants (B2B). Con autorización del merchant lee su cuenta de Klaviyo, calcula una simulación de perfiles inactivos y, después de que el merchant la aprueba, los suprime en Klaviyo (nunca los borra; cada limpieza se puede deshacer). Precio fijo mensual por tamaño de lista, cobrado solo por la facturación de Shopify. No está afiliada a Klaviyo ni a Shopify.

## 2. Cláusulas tocadas

### Términos (`terms.html`)

La numeración cambió: se agregó "13. Indemnification" y "17. General". Limitación de responsabilidad sigue en la 12; ley aplicable pasó de la 14 a la 15.

| Cláusula | Qué dice ahora | De dónde sale | Qué tiene que confirmar el abogado |
| --- | --- | --- | --- |
| Fecha de vigencia | November 26, 2026 | Indicación del dueño | Nada. La página sigue con el cartel de borrador hasta su visto bueno (ver sección 4) |
| 1. The agreement | Se acepta al instalar o usar. Uso comercial, no como consumidor; capacidad legal para contratar; quien acepta por una empresa declara que puede. Klaviyo y Shopify no son parte | Estándar B2B. No hay un hecho sobre edad mínima: no se puso un número | Si alcanza la aceptación por instalación (clickwrap dentro del flujo de Shopify) y si conviene fijar edad mínima de 18 |
| 2. What the app does | Agrega que la app mantiene un segmento en la cuenta de Klaviyo; que la primera limpieza siempre requiere aprobación; que el modo automático es una aprobación anticipada | Hechos del producto. El modo automático (opt-in) existe en la app según `docs/STATUS.md`; exige una limpieza anterior aprobada por una persona | Que describir el modo automático como aprobación anticipada sea suficiente |
| 6. Price and payment | Tabla de precios (sale del código, US$ 15 / 29 / 79 / 149 por tamaño de lista; más de 150.000, por acuerdo). Se cobra solo en un ciclo en que una limpieza suprimió al menos un perfil; como máximo una vez cada 28 días; máximo de US$ 149 por ciclo de 30 días de Shopify; todo por Shopify; sin datos de pago | `docs/04-PRECIO-Y-COBRO.md` | Nada de fondo. Ver si quiere los precios dentro de los términos o solo por referencia |
| 6. Undo and refunds (era placeholder) | Limpieza deshecha por completo antes de emitirse el cargo: no se cobra. Deshacer después: sin reembolso. Cargos emitidos no reembolsables salvo que la ley lo exija | Decisión del dueño | Si "no reembolsable salvo ley" es válido tal cual y si choca con alguna regla de Shopify sobre reembolsos de apps |
| 6. Cambios de precio | Aviso previo en la app o por mail; subir el máximo aprobado en Shopify requiere nueva aprobación | Funcionamiento de la Billing API de Shopify. No hay un plazo de aviso decidido: no se puso un número de días | Si hace falta un plazo mínimo de aviso |
| 7. Acceptable use | Separa en dos el uso prohibido: suprimir a quien se piensa seguir escribiendo; suprimir antes de la renovación y quitar las supresiones en masa después. Aclara que deshacer es para corregir errores | `docs/12-CUMPLIMIENTO-KLAVIYO.md` §4.1 | Nada |
| 8. Privacy and data (era placeholder de DPA) | Compromisos de encargado dentro de los términos: solo por instrucciones, sin venta ni uso propio, seguridad y confidencialidad, subencargados listados y aviso antes de sumar uno, ayuda con pedidos de titulares, aviso de incidentes sin demora indebida, borrado al desinstalar. Si la ley del merchant exige un DPA aparte, que escriba | Hechos de la app. No existe un DPA firmable todavía | Si esto alcanza como términos de tratamiento (art. 28 GDPR, CCPA "service provider") o hace falta un DPA aparte con cláusulas contractuales tipo. Ver pregunta 2 |
| 9. Dependence on Klaviyo and Shopify | Agrega que, si Klaviyo corta el acceso, frenar limpiezas, dejar de cobrar y avisar es la única obligación | `docs/12` §4.1 | Nada |
| 10. Availability | Agrega que no hay compromiso de disponibilidad ni de tiempos de soporte | Estándar | Nada |
| 11. Disclaimer of warranties | Completo: "as is", "as available", garantías expresas, implícitas y legales, comerciabilidad, aptitud, título, no infracción, curso de negociación. En negrita | Estándar | Si la negrita alcanza como "conspicuous" bajo la ley de Florida o hace falta mayúsculas |
| 12. Limitation of liability (era placeholder) | Exclusión de daños indirectos, incidentales, especiales, consecuentes, ejemplares y punitivos, y de lucro cesante, ingresos, ventas, negocio, reputación y datos, bajo cualquier teoría. Ejemplos: ventas perdidas por perfiles suprimidos con criterios y simulación aprobados (o modo automático), mails no enviados, acciones de Klaviyo o Shopify, falta de disponibilidad. Tope total: lo pagado en los 12 meses anteriores al primer hecho, o USD 100, lo que sea mayor. Vale aunque un remedio falle en su propósito esencial. Salvedad: lo que la ley no permite limitar, por ejemplo fraude o dolo | Posición indicada por el dueño; piso de USD 100 propuesto por el redactor | Validez bajo ley de Florida. Si hay que nombrar la culpa grave en la salvedad. Si la exclusión de lucro cesante directo se sostiene. Si el tope debe exceptuar las obligaciones de pago y la indemnidad del merchant (hoy el tope y la exclusión protegen solo a TierSaver; la responsabilidad del merchant no está limitada) |
| 13. Indemnification (nueva) | El merchant defiende e indemniza a TierSaver ante reclamos de terceros (incluidos sus clientes, Klaviyo y Shopify) por: uso contrario a los términos; sus datos, criterios y aprobaciones; su marketing o su incumplimiento de términos de Klaviyo o Shopify o de la ley. Procedimiento breve | Estándar. Los API Terms de Klaviyo le imponen a TierSaver una indemnidad a favor de Klaviyo (`docs/12` §1.4) | Alcance. Si conviene una indemnidad recíproca de TierSaver por infracción de propiedad intelectual |
| 14. Ending the agreement | Desinstalar termina el acuerdo. Sin cargos nuevos; los emitidos se deben. Las supresiones quedan en Klaviyo y ya no se pueden deshacer desde la app. Lista de cláusulas que sobreviven | Hechos de la app | Nada |
| 15. Governing law and disputes (era placeholder) | Ley de Florida sin normas de conflicto; excluye la Convención de Viena (CISG); jurisdicción y competencia exclusivas de los tribunales estatales y federales del condado de Miami-Dade; renuncia a objetar foro inconveniente; invitación no obligatoria a escribir antes | Decisión del dueño. La exclusión de la CISG la agregó el redactor | Texto de la cláusula de foro. Si la exclusión de la CISG hace falta para un servicio. Ver pregunta 1 |
| 16. Changes to these terms | Aviso en la app o por mail antes de un cambio significativo; seguir usando la app es aceptación | Texto anterior, completado | Si la aceptación por uso continuado se sostiene o conviene pedir aceptación en la app |
| 17. General (nueva) | Acuerdo completo; derechos sobre la app y sobre los datos del merchant; cesión; fuerza mayor; divisibilidad; no renuncia; relación entre las partes; avisos | Estándar | Lectura general |
| 18. Contact | Suma support@tiersaver.com | Dato de la empresa | Nada |

#### Cambios de la revisión de términos (2026-11-26)

Después del borrador, una revisión crítica comparó cada afirmación de los términos con el código. Esta tabla reemplaza a las filas de arriba donde difieren. Las preguntas que salieron de la revisión están en la sección 3.

| Cláusula | Qué dice ahora | De dónde sale | Qué tiene que confirmar el abogado |
| --- | --- | --- | --- |
| 1. The agreement | Se acepta al instalar y otra vez al confirmar en la app, al aprobar una limpieza. Esa aceptación cubre las limpiezas posteriores, incluidas las del modo automático | La casilla de aprobación incluye "I accept the TierSaver Terms of Service" con enlaces, y cada aprobación manual guarda `termsVersion` en `events_log` (`shopify/app/legal.ts`, `shopify/app/simulations/review.ts`) | Si ese diseño alcanza como aceptación y si cubre el modo automático, que aprueba sin casilla. Ver pregunta R1 |
| 2. What the app does | Criterios: nunca interactuaron o, con criterios ampliados, no interactuaron en los períodos elegidos. Se calcula una simulación antes de cada limpieza; sin modo automático nada cambia hasta aprobarla. Algunos perfiles de la simulación pueden quedar sin tocar | Modo "wider" (`packages/core/src/rules.ts`), aprobación automática (`shopify/app/schedule/automatic.ts`), perfiles salteados y corridas que frenan (`shopify/app/runs/engine.ts`) | Nada |
| 4. Suppression and its effects | Agrega: un perfil restaurado queda fuera de las limpiezas por 365 días; deshacer exige la app instalada y conectada a Klaviyo | `rules.ts` (`reactivationLockDays`), `engine.ts` | Nada |
| 6. When you are charged / How often | Se cobra por limpieza que suprimió al menos un perfil, después de que Klaviyo confirma. Precio completo aunque la limpieza sea parcial. Como máximo un cargo en cualquier período de 28 días. Ya no se usa "billing cycle" sin definir | `packages/core/src/charge.ts`, `shopify/app/billing/billing.ts` | Nada de fondo |
| 6. Más de 150.000 perfiles | La app no crea ningún cargo; podemos contactar al merchant para acordar un precio por seguir usándola | `charge.ts` (`above_price_tiers`) y decisión del dueño | Nada |
| 6. Undo and refunds | El cargo se crea a los minutos de terminar la limpieza, cuando Klaviyo confirma. Solo si todos los perfiles fueron restaurados antes de eso no se cobra; en cualquier otro caso deshacer no anula ni reembolsa. Cargos creados no reembolsables salvo ley | `billing.ts` y `shopify/workers/suppression-run.ts` (primer intento de confirmación a los 30 segundos). Describe el código actual; la ventana real es decisión pendiente del dueño (ver sección 3) | Si la redacción es clara y no engañosa. Ver pregunta R5 |
| 6. Cambios de precio | Un precio nuevo aplica solo después de que la app lo mostró y, donde Shopify lo exige, el merchant lo aprobó en Shopify. Ya no se promete aviso por mail | Los precios figuran en el texto que el merchant aprueba en Shopify (`billing.ts`, `subscriptionTerms`). La app no envía mails | Ver pregunta R10 |
| 8. Privacy and data | Uso propio: se exceptúa calcular el precio y estadísticas que no identifican a nadie. Borrado: "after you uninstall the app, within the periods described in the privacy policy" | El cobro usa el conteo de perfiles; el borrado completo llega con el `shop/redact` de Shopify (`shopify/app/data/privacy.ts`) | Si la excepción de uso propio es compatible con el rol de encargado |
| 9. Dependence on Klaviyo and Shopify | Incluye a Shopify. Si se corta el acceso: la app deja de correr limpiezas, no se crean cargos nuevos y la app muestra un aviso la próxima vez que se abre. Es la única obligación | El único aviso que existe es dentro de la app (`shopify/app/components/home-screen.tsx`) | Nada |
| 11. Disclaimer of warranties | Encabezado y párrafos operativos en mayúsculas y negrita. Agrega que no se promete que una limpieza suprima todos los perfiles de la simulación ni que un deshacer los restaure a todos | Revisión | Si alcanza como "conspicuous" |
| 12. Limitation of liability | Encabezado, exclusión y límite en mayúsculas y negrita; ejemplos y "fails of its essential purpose" en negrita. El límite se mide por los cargos pagados por Shopify en los 12 meses anteriores, o USD 100 | El merchant le paga a Shopify, no a Digital Solvers LLC | Lo mismo que antes, más la pregunta R5 |
| 13. Indemnification | Segundo punto acotado a la falta de derechos o consentimientos sobre los datos y a los criterios, ajustes y aprobaciones elegidos. No aplica si el reclamo resulta de nuestro incumplimiento, culpa grave o dolo. Los límites de la 12 no limitan las obligaciones del merchant | Revisión | Ver pregunta R3 |
| 14. Ending the agreement | Antes de suspender, donde sea razonable, aviso en la app y deshacer disponible. El segmento creado por la app queda en Klaviyo hasta que el merchant lo borre. Reinstalar no recupera el historial. La 14 se suma a las cláusulas que sobreviven | La app nunca borra el segmento (`shopify/app/klaviyo/api.ts` solo crea y actualiza). El historial se borra con el `shop/redact` | Nada |
| 16. Changes to these terms | Aviso dentro de la app antes de un cambio que reduce derechos o suma obligaciones. Los cambios rigen solo hacia adelante: no alcanzan cargos ya creados ni disputas anteriores | Revisión | Ver preguntas R1 y R10 |
| 17. General | Acuerdo completo: la política de privacidad forma parte solo donde la cláusula 8 la cita; si el texto de precios de Shopify difiere, valen los términos, sin superar nunca el máximo aprobado en Shopify. Relación: las personas nombradas en la 12 y la 13 pueden invocarlas. Avisos: dentro de la app; por mail solo cuando la app lo soporte; se fija cuándo se considera dado un aviso | Revisión | Ver preguntas R7 y R10 |

### Privacidad (`privacy.html`)

| Cláusula | Qué dice ahora | De dónde sale | Qué tiene que confirmar el abogado |
| --- | --- | --- | --- |
| Fecha de vigencia | November 26, 2026 | Indicación del dueño | Nada |
| 3. Datos procesados sin guardar | Los mails de Klaviyo se leen para enviar la supresión o el deshacer y para el CSV que el merchant descarga antes de aprobar; no se guardan ni se registran. Durante un escaneo, fechas y estado de consentimiento y supresión de cada perfil quedan como datos de trabajo sin mail y se borran al terminar | Hechos de la app; lo del escaneo sale del esquema (`shopify/app/db/schema.ts`, tabla `scan_profiles`) | Nada |
| 3. Email from the app (era placeholder) | Hoy la app no envía mails ni guarda un mail del merchant para eso. Están previstos avisos operativos (simulación lista, resultado, resumen mensual) al contacto de la tienda, sin marketing; antes se actualiza la política y la lista de subencargados | Hechos de la app | Si un aviso operativo necesita algo más (CAN-SPAM no aplica a mensajes transaccionales, a confirmar) |
| 4. Bases legales (era placeholder) | Datos de clientes del merchant: por instrucción del merchant, que responde por la base legal. Datos propios: ejecución del contrato, interés legítimo, obligaciones legales | Redacción conservadora; no hay un análisis de GDPR hecho | Que sea correcto y suficiente. Ver pregunta 2 |
| 5. Cambios en Klaviyo | Agrega el segmento que la app mantiene y que no cambia plan ni facturación | Hechos de la app | Nada |
| 6. Subencargados (era placeholder) | Uno solo: Cloudflare, Inc. (EE.UU.): Workers, D1, Workflows, logs. Sin proveedor de mail ni de monitoreo. Shopify (plataforma y cobro) y Klaviyo (contrato propio con el merchant) aparte, no como subencargados | Hechos de la app | Si Shopify debe figurar como subencargado. Si hace falta comprometer un plazo de aviso antes de sumar uno |
| 7. Dónde se procesan (era placeholder) | Empresa de EE.UU.; base con región primaria en el este de Norteamérica; la red de Cloudflare puede atender un pedido cerca del usuario; los datos se transfieren a EE.UU.; no se afirma ningún mecanismo de transferencia | Hechos de la app. Lo de la red global es el funcionamiento público de Cloudflare Workers | Mecanismo de transferencia para UE y Reino Unido. Ver pregunta 2 |
| 9. Retención (era placeholder) | No se guardan registros de cargos después del borrado; facturas y cobros quedan en Shopify. Los logs de Cloudflare no llevan mails ni tokens y duran lo que fije Cloudflare (sin número de días) | Hechos de la app | Si Digital Solvers LLC tiene que conservar registros contables o fiscales propios de cada cargo (hoy no lo hace) |
| 10. Sitio | Agrega: sin formularios y sin pedidos a otros sitios | Hechos del sitio | Nada |
| 12. Children | Agrega que no se recolectan a sabiendas datos de menores | Estándar | Nada |

## 3. Preguntas abiertas

1. **Arbitraje, renuncia a acciones colectivas y renuncia a juicio por jurados.** No se agregó ninguna de las tres. ¿Conviene alguna para un SaaS B2B de este tamaño?
2. **Merchants de la UE y del Reino Unido.** ¿Hace falta un DPA aparte con cláusulas contractuales tipo (y el addendum del Reino Unido)? ¿Conviene que Digital Solvers LLC se certifique en el Data Privacy Framework? ¿Hace falta representante en la UE o el Reino Unido (art. 27 GDPR)? La política hoy no afirma ningún mecanismo de transferencia.
3. **CCPA/CPRA.** ¿Los compromisos de la cláusula 8 de los términos alcanzan como contrato de "service provider"? La política dice "do not sell"; no se usó "share" en el sentido de la CPRA. ¿Hace falta?
4. **Registros.** ¿Digital Solvers LLC tiene que inscribirse como responsable o encargado ante alguna autoridad (por ejemplo, registros estatales de EE.UU.)?
5. **Edad mínima.** No se fijó un número. ¿Conviene decir 18?
6. **Exportación y sanciones.** No hay cláusula. ¿Hace falta una declaración de cumplimiento de controles de exportación y sanciones de EE.UU.?
7. **Limitación de responsabilidad.** ¿Culpa grave en la salvedad? ¿Tope recíproco o con excepciones (pago, indemnidad, confidencialidad)? ¿Un tope separado y más alto para incidentes de datos?
8. **Plazo para reclamar.** No se acortó el plazo de prescripción. Entendemos que la ley de Florida no lo permite por contrato; a confirmar.
9. **Avisos y cambios.** ¿Hace falta un plazo mínimo de aviso para cambios de términos y de precio? Hoy no hay un número.
10. **Klaviyo.** Los API Terms de Klaviyo exigen indemnidad a favor de Klaviyo, ley de Massachusetts y coordinar con Klaviyo los comunicados ante un incidente (`docs/12-CUMPLIMIENTO-KLAVIYO.md` §1.4). ¿Algo de eso tiene que reflejarse en los términos con el merchant?
11. **Segmento al desinstalar.** Los textos no dicen qué pasa con el segmento que la app crea en Klaviyo cuando el merchant desinstala. Falta el dato técnico.
12. **Datos del personal del merchant.** La política dice que el registro de acciones guarda el id de usuario de Shopify. La tabla de sesiones de Shopify tiene columnas para nombre y mail del usuario (`shopify/app/db/schema.ts`). Hay que confirmar con desarrollo que quedan vacías; si no, la política tiene que decirlo.

### Preguntas de la revisión de términos

Agregadas el 2026-11-26 por la revisión de los términos contra el código.

- **R1. Aceptación.** La casilla de aprobación de la simulación incluye la aceptación de los términos, con enlaces, y se registra la versión aceptada. ¿Ese diseño alcanza? ¿Cubre las limpiezas del modo automático, que se aprueban sin casilla? ¿Hace falta volver a pedir aceptación en cada cambio de términos?
- **R2. Evidencia contra borrado.** La cláusula 3 se apoya en "your approvals are recorded", pero ese registro se borra entero con el `shop/redact` de Shopify (`shopify/app/data/privacy.ts`). ¿Se puede conservar un registro sin datos personales (tienda, fecha, versión de términos, aprobaciones, cargos) durante el plazo de prescripción? ¿Cómo se concilia con Shopify y con los 365 días de logs que pide Klaviyo para listar la app? Es más amplio que la pregunta contable de la tabla de privacidad.
- **R3. Indemnidad.** ¿La regla de Florida sobre indemnidad por negligencia propia del indemnizado obliga a reescribir la cláusula 13? ¿Conviene exceptuar la culpa grave también ahí, como quedó redactado?
- **R4. Honorarios.** ¿Conviene una cláusula de honorarios para la parte vencedora, dado que Fla. Stat. §57.105(7) vuelve recíproca cualquier cláusula unilateral?
- **R5. FDUTPA.** ¿Hay exposición entre empresas por las afirmaciones de precio y de "undo"? ¿Cambia algo el límite de la cláusula 12 frente a un reclamo de ese tipo?
- **R6. Shopify.** ¿El Partner Program Agreement y los API Terms de Shopify exigen cláusulas en los términos con el merchant (exención a favor de Shopify, reglas de reembolso o créditos)? No se pudieron leer.
- **R7. Política de privacidad.** ¿Conviene que forme parte del contrato solo donde la cláusula 8 la cita, como quedó, o de otra forma?
- **R8. Nombre comercial.** Si Digital Solvers LLC opera como "TierSaver", ¿hace falta registrar el nombre de fantasía en Florida (Fla. Stat. §865.09)?
- **R9. Medidas cautelares.** ¿Conviene exceptuarlas del foro exclusivo, para poder frenar un abuso de la app donde esté el merchant?
- **R10. Avisos solo dentro de la app.** Hoy la app no envía mails. ¿Un aviso dentro de la app alcanza para cambios de precio y de términos, o hace falta el mail antes de publicar los términos como vigentes?

La pregunta 11 de arriba ya tiene el dato técnico: la app nunca borra el segmento que crea en Klaviyo, y la cláusula 14 ahora lo dice.

### Ventana para deshacer sin cargo (decidida el 2026-11-26)

El dueño eligió una ventana real de 72 horas. El cargo confirmado por Klaviyo se retiene 72 horas desde que termina la limpieza (`CHARGE_HOLD_HOURS` en `shopify/app/runs/labels.ts`, aplicado en `shopify/app/billing/billing.ts`). Si en ese plazo se restauran todos los perfiles de la limpieza, no se cobra. Deshacer una parte, o deshacer después de creado el cargo, no lo cancela ni lo devuelve. La cláusula 6 ("Undo and refunds") ya lo dice así, y la pantalla de la limpieza muestra el mismo plazo.

Consecuencia aceptada: si el merchant desinstala la app dentro de las 72 horas, Shopify ya no permite crear el cargo y esa limpieza queda sin cobrar.

Dato relacionado, fuera de los términos: si el merchant desconecta Klaviyo entre la limpieza y la confirmación, el cargo no se puede confirmar y a los 10 días deja de reintentarse (`shopify/app/billing/billing.ts`, `runsWithOpenCharges`).

## 4. Qué no se cambió y por qué

- **Cartel de borrador, título "(draft)" y rótulo "Legal · Draft".** Siguen hasta el visto bueno del abogado. El cartel lo genera `site/build/build.mjs` y todavía dice que hay texto entre corchetes por completar: ya no lo hay. Sacar el cartel es un cambio de build y de un test (`legal pages carry the draft banner`), fuera de este encargo.
- **Arbitraje, acciones colectivas, juicio por jurados.** Quedan como pregunta (decisión del dueño).
- **Mecanismo de transferencia internacional y DPA firmable.** No existen todavía; no se inventaron.
- **Plazos en días** (aviso de cambios, retención de logs de Cloudflare, aviso de incidentes). No hay decisiones ni datos; no se pusieron números.
- **Secciones 3, 4 y 5 de los términos** (responsabilidades del merchant, efectos de la supresión, ninguna promesa sobre el plan o la factura de Klaviyo). Ya cumplían `docs/12` §4.1; solo se unificó "run" por "cleanup".
- **Lista de datos guardados (privacidad §3) y seguridad (§8).** Coinciden con el esquema de la base. Se mantuvieron la zona horaria de la tienda y el hash del id de cliente de Shopify, que están en el esquema.
- **Otras páginas del sitio.** No se tocaron. Dos quedan desalineadas con los textos legales: `site/src/pages/help/monthly-schedule-and-your-klaviyo-plan.html` dice que antes de cada limpieza mensual llega un resumen por mail (hoy la app no envía mails), y `site/src/pages/help/data-and-privacy.html` enlaza a "privacy policy (draft)" y no menciona el CSV.
