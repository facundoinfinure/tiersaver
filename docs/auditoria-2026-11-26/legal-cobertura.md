# TierSaver · Revisión legal de cobertura (qué falta)

Fecha: 2026-11-26. Revisor 7 de 7: amplitud de cobertura. Insumo para el abogado, no opinión legal.
Repo leído en `f240583` (solo lectura). No se tocó código, no se llamó a ninguna API en vivo.

## 0. Cómo leer esto

- **Riesgo**: Crítico (frena el lanzamiento o invalida la protección), Alto (multa, reclamo o baja de la ficha plausibles), Medio (hueco que un abogado cuidadoso cierra), Bajo (prolijidad).
- **Textos propuestos**: los cortos van en la tabla; los largos están en el Anexo A con código `T-xx`. Todos en inglés, listos para pegar, sujetos al abogado.
- **Fuentes**: "verificado" quiere decir que lo leí hoy en la URL citada. "De memoria" quiere decir que no lo pude leer hoy y hay que confirmarlo.
- **No se pudo leer**: `www.shopify.com` está fuera de la red permitida de esta sesión. Quedan sin verificar el Partner Program Agreement (versión del 27 de febrero de 2026), el API License and Terms of Use y las pautas de marca de Shopify. Hay que habilitar ese host o leerlos a mano. La pregunta R6 del memo sigue abierta por el mismo motivo.

### Fuentes externas leídas hoy

| Tema | URL | Qué confirma |
| --- | --- | --- |
| Qué hace la supresión | https://help.klaviyo.com/hc/en-us/articles/115005246108 | "Approved transactional flow emails can still be sent to manually suppressed or unsubscribed profiles"; SMS y push no cambian; volver a suscribirse levanta la supresión manual; regla de 90 días; motivos de supresión (incluye "Spam complaint") |
| Bulk unsuppress | https://developers.klaviyo.com/en/reference/bulk_unsuppress_profiles | "This only removes suppressions with reason USER_SUPPRESSED"; no toca desuscriptos, INVALID_EMAIL ni HARD_BOUNCE |
| API Terms de Klaviyo (act. 12/11/2026) | https://www.klaviyo.com/legal/api-terms | Marca solo según el Newsroom; nada que sugiera patrocinio o aval sin consentimiento escrito; obliga a tener "a user agreement and a legally compliant privacy policy"; avisar a Klaviyo y a los usuarios ante acceso no autorizado; avisar a Klaviyo por escrito de cualquier incumplimiento del propio user agreement; borrar datos al pedido del usuario; indemnidad a favor de Klaviyo |
| Requisitos de ficha de Klaviyo | https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements | No sugerir aval; palabras vetadas "preferred", "recommended", "top performing", "best"; enlaces a términos y privacidad; contacto de soporte; logs 365 días "tamper-evident" |
| Requisitos del App Store de Shopify | https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements | 1.2.1 cobro solo por Shopify; 4.1.2 nombre; 4.2 precios; 4.3.3 sin estadísticas ni "the best / the first / the only"; 4.3.6-7 sin reseñas ni testimonios en la ficha; 1.3.1 sin incentivos por reseñas; 4.4.3 marcas de Shopify; 4.5.6 contacto de emergencia |
| Privacidad en apps de Shopify | https://shopify.dev/docs/apps/launch/privacy-requirements | Política obligatoria y enlazada; contenido recomendado (retención, si se procesa fuera de Europa, contacto, "some jurisdictions require ... a physical address"); mecanismo de transferencia; evaluar DPO |
| Cobro en Shopify | https://shopify.dev/docs/apps/launch/billing | "Shopify collects the charge and automatically pays out your share"; "Shopify handles all chargeback-related processes" |
| Impuestos de partners (fragmento de búsqueda, sin abrir) | https://help.shopify.com/partners/getting-started/sales-taxes | "It's your responsibility to remit taxes to the appropriate government authorities" |
| Regla de opción negativa de la FTC | https://gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/ y https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses | Regla "click to cancel" anulada en julio de 2025; ANPRM nuevo del 11/03/2026; ROSCA y la sección 5 se siguen aplicando; ~30 estados con leyes propias |
| Consumidor en Australia | https://www.ashurst.com/en/insights/significant-increase-in-consumer-definition-under-the-australian-consumer-law | Umbral de AU$ 100.000 desde el 1/7/2021, también para compras de empresas |

---

## 1. Hallazgos que cambian hechos (antes de discutir cláusulas)

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / acción | Pregunta al abogado |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | **Quién es la contraparte** | Términos §1 y §18, privacidad §1 y §14, pie del sitio: "Digital Solvers LLC, 153 E Flagler St, Miami, FL 33131". `docs/STATUS.md:207` dice que la dirección está "a confirmar por Facundo" y no hay suite. El encargo de esta revisión describe al dueño como persona física en Argentina sin entidad registrada. | Si la LLC no existe, no está activa, o no es la titular de la cuenta de Shopify Partner (la que cobra) y de la app de Klaviyo, los términos nombran a una parte equivocada: la limitación de responsabilidad no protege a la persona, y "We are a United States company" (privacidad §7) sería una afirmación falsa. Falta el estado de constitución. | **Crítico** | Confirmar: (a) existencia y estado de la LLC; (b) que la cuenta de Partner y el payout están a su nombre (`docs/10-TAREAS-HUMANAS.md:10` permite "empezar como individuo"); (c) dirección postal real con suite, que reciba correo (§17 Notices admite aviso por correo). Texto: T-27. Si se opera como persona física: reescribir identidad, sacar "United States company", y decidir entidad (decisión del dueño; no se redacta alrededor). | ¿LLC de Florida o de otro estado con domicilio en Miami? Si es de otro estado, ¿necesita registrarse como foreign LLC en Florida? ¿Registro de nombre de fantasía "TierSaver" (Fla. Stat. §865.09, ya en R8)? Riesgo personal del dueño si la LLC es de un solo miembro y él opera desde Argentina. |
| 1.2 | **Cartel "Draft ... not in effect"** | `site/build/build.mjs:318` pone en términos y privacidad: "has not been reviewed by a lawyer, is not final and is not in effect". | La app ya pide "I accept the TierSaver Terms of Service" y guarda `termsVersion` (`app.simulation.tsx`), enlazando a una página que dice que no rige. Aceptación de un texto que se declara no vigente. | **Crítico** | Sacar el cartel, el "(draft)" del título y el enlace "privacy policy (draft)" de `help/data-and-privacy.html` el mismo día que se publique; fijar la fecha de vigencia en la fecha real de publicación y subir `TERMS_VERSION` (`shopify/app/legal.ts`) a esa fecha. Hoy coinciden (2026-11-26), pero la fecha es anterior al visto bueno. | ¿Fecha de vigencia = fecha de publicación tras su OK? |
| 1.3 | **Help promete un mail que no existe** | `help/simulation-and-approval.html`: "TierSaver runs a new simulation and emails you a summary" y, en modo automático, "you still receive the summary". Privacidad §3: "the app sends no email". | Contradicción entre el centro de ayuda y la política. En modo automático el merchant no recibe ningún aviso. | **Alto** | Reemplazar por: "Before each monthly cleanup TierSaver runs a new simulation and shows it in the app." y "Automatic. ... The result is shown in the app's History." | — |
| 1.4 | **Help describe una función que la app no tiene** | `help/how-the-audit-works.html` y `help/monthly-schedule-and-your-klaviyo-plan.html`: "the audit also shows which Klaviyo plan size your active profile count corresponds to". `docs/00-HANDOVER.md` decidió que la app **no** lo muestra; `home-screen.tsx` no lo muestra. Privacidad §3 dice que se guarda "the Klaviyo plan size shown as a reference". | Afirmación de producto falsa y contraria a una decisión tomada. | Medio | Borrar esas dos frases del help y la mención en privacidad §3 si el dato no se guarda; o confirmar con desarrollo. | — |
| 1.5 | **"After that TierSaver runs monthly"** | Landing paso 04 y `help/monthly-schedule...`: "After your first manual cleanup, TierSaver runs once a month". | El calendario mensual está apagado por defecto (`schema.ts:141`, "Off by default"). La frase describe como automático algo que es opt-in. | Medio | "After that, if you turn on the monthly schedule, TierSaver runs a new audit every month, timed to finish before your Klaviyo plan renews. Scheduled cleanups wait for your approval unless you turn on automatic mode." | — |
| 1.6 | **Página pública con plantilla** | `shopify/app/routes/_index/route.tsx`: "A short heading about [your app]" con formulario de login, en el dominio de la app. | Página pública sin identidad ni enlaces legales. | Bajo | Redirigir a tiersaver.com o reemplazar por una página mínima con enlaces a términos y privacidad. | — |

---

## 2. Marketing por mail: quién responde por qué

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta al abogado |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Merchant como remitente y responsable (CAN-SPAM, CASL, GDPR/ePrivacy/PECR, TCPA, leyes estatales) | Términos §3: "the laws that apply to your marketing and to your customers' data". §2: "does not send email ... does not change consent". | Genérico. No dice que el merchant es el remitente, no nombra las leyes, no menciona registros de consentimiento ni manejo de bajas, ni que la app no verifica si un perfil puede ser contactado. | **Alto** | **T-01**, términos §3, viñeta nueva (o §3A "Your marketing and the law"). | ¿Nombrar las leyes o dejar la fórmula general más ejemplos? |
| 2.2 | La supresión de TierSaver no es una baja ni un registro de opt-out | No está. `help/what-suppress-means.html` explica la diferencia, pero no hay obligación contractual. | Un merchant puede creer que "ya está suprimido" equivale a cumplir un pedido de baja. Un deshacer lo vuelve enviable. | **Alto** | **T-02** (primer párrafo), términos §4. Repetir una línea en "Before you approve" (pantalla de simulación). | — |
| 2.3 | **Deshacer puede volver enviable a alguien que el merchant quería suprimido por otro motivo** | Términos §4: "undoing a cleanup removes the suppression the app applied". `help/undo.html`: "It does not touch profiles that were suppressed by you, by Klaviyo or by another run". Pantalla de undo: "Only the suppression TierSaver added is removed: profiles that unsubscribed or bounced stay as they are." | Verificado en código (`runs/engine.ts` `createUndoRun`, `runs/gateway.server.ts`): el undo manda a Klaviyo todos los perfiles `submitted` de la corrida, sin mirar el estado actual. Klaviyo tiene un solo motivo manual (USER_SUPPRESSED, verificado hoy). Si después de la limpieza el merchant, su agencia u otra herramienta "suprimió a mano" a ese perfil (por ejemplo, por un pedido de baja atendido como supresión manual o por un archivo de supresión), no queda rastro separado, y el undo lo levanta. Lo que sí queda protegido por Klaviyo: desuscriptos, rebotes, mails inválidos. Las quejas de spam son un motivo de supresión aparte que la documentación del endpoint no enumera: a confirmar en la cuenta de prueba. Además el undo resuelve el mail **actual** del perfil sin comparar el hash (el chequeo de hash es solo para `suppress`), así que si el perfil cambió de mail, se levanta la supresión de la dirección nueva. | **Alto** | **T-02** (segundo párrafo), términos §4, y corregir `help/undo.html`: "It does not touch profiles that were already suppressed before the run, or that bounced or unsubscribed. It cannot tell apart a manual suppression you would have added to the same profile after the run: Klaviyo records only one kind of manual suppression." Pantalla de undo: agregar "Before you send to these profiles again, check that you may lawfully email them." Sugerencia de producto (no legal): aplicar al undo el mismo chequeo de hash que al suppress. | ¿Alcanza el disclaimer o conviene que el undo exija una casilla "I have checked ..." siempre, no solo tras la renovación? |
| 2.4 | Efecto real de la supresión: transaccionales, flujos, SMS, re-suscripción | Términos §4: "cannot receive marketing emails ... even if that person later buys, until the suppression is removed". FAQ y pantalla de aprobación, igual. | Correcto pero incompleto frente a lo que Klaviyo publica hoy: (a) los flujos **aprobados como transaccionales** sí se siguen enviando a suprimidos manuales; todo el resto de los flujos (bienvenida, carrito abandonado, back-in-stock, win-back, pedido de reseña) no; (b) SMS y push no cambian; (c) si la persona se vuelve a suscribir, Klaviyo levanta la supresión manual; (d) puede cambiar el tamaño de segmentos, reportes y audiencias sincronizadas. El merchant no está avisado de (a) ni de (d) en términos ni en la app. | **Alto** | **T-03**, términos §4 (reemplaza la primera oración). En la app, "Before you approve": "Suppressed profiles stop receiving your campaigns and flows (welcome, abandoned cart, win-back and similar). Only emails Klaviyo has approved as transactional can still reach them." FAQ "Can I still email someone...": misma aclaración. | — |
| 2.5 | TCPA / SMS | La app deja afuera a todo perfil con consentimiento de SMS (`help/cleanup-criteria.html`) y la supresión es solo de mail (Klaviyo, verificado). | Sin impacto operativo. Falta decirlo en los términos para cerrar el punto. | Bajo | Incluido en T-03 ("does not change SMS or push consent"). | — |
| 2.6 | Sin asesoramiento legal, fiscal ni de entregabilidad | No está. | Las guías (`/guides/*`) dan instrucciones sobre Klaviyo y sobre qué conviene suprimir. Sin cláusula, pueden leerse como asesoramiento. | Medio | **T-04**, términos §10 o §17. Pie de cada guía: "General information as of {date}, not legal or deliverability advice. Klaviyo's documentation prevails." | — |
| 2.7 | Klaviyo puede cambiar criterios, precios o API | Términos §5 y §9, bien. | Falta que los criterios de la app "siguen" a los publicados por Klaviyo en una fecha y pueden dejar de coincidir. | Medio | Incluido en T-04. | — |
| 2.8 | Sin garantía de ahorro | Términos §5 y §11, pie del sitio, FAQ. Bien cubierto. | El nombre "TierSaver" es en sí una afirmación implícita de ahorro (ya señalado en `docs/12`, §2.2; decisión del dueño). | Medio | Sin texto nuevo. Mantener el disclaimer junto a cada mención de plan. | ¿El nombre, sumado al chequeo de salud de lista que muestra "Klaviyo plan size: Today / After the cleanup", constituye una afirmación de ahorro que requiere sustento (FTC, FDUTPA)? |
| 2.9 | Marketing propio de TierSaver (outreach a agencias y merchants) | `docs/05-GO-TO-MARKET.md` tiene borradores de mails en frío. Privacidad §10: solo "If you email us, we use your message and address to reply." | La política no cubre los datos de contactos comerciales que TierSaver junta para prospección. Los mails en frío B2B están alcanzados por CAN-SPAM (remitente identificado, dirección postal, baja que funcione), CASL si el destinatario está en Canadá (consentimiento o excepción acotada) y PECR/GDPR en Reino Unido y la UE (de memoria). | **Alto** | **T-21**, privacidad §10 (subsección nueva). Regla interna: todo mail de outreach lleva nombre legal, dirección postal y baja; lista de supresión propia; no escribir a Canadá ni a la UE sin base revisada. | ¿Base legal y alcance geográfico del outreach? |
| 2.10 | Mails operativos futuros al merchant | Privacidad §3 "Email from the app": previstos, no marketing. | Cuando existan: si llevan cualquier contenido promocional pasan a ser comerciales (CAN-SPAM). Falta consentimiento a comunicaciones electrónicas en los términos. | Medio | **T-09**, términos §17. | ¿Las condiciones de la API de Shopify limitan el uso del mail de contacto de la tienda? (no se pudo leer) |
| 2.11 | Programa de agencias con comisión | `docs/04-PRECIO-Y-COBRO.md`: 25% recurrente, pagado por fuera de Shopify. | Una agencia que recomienda TierSaver cobrando comisión tiene una "conexión material" que debe revelar (Guías de Endorsements de la FTC, 16 CFR Part 255, de memoria). No hay acuerdo de agencias ni cláusula. También hay que ver si el Partner Program Agreement permite la comisión (ya anotado en doc 04). | Medio | **T-25**, en el acuerdo de agencias (a crear antes de ofrecerlo por escrito). | ¿Hace falta un acuerdo de referidos separado? ¿1099/retenciones si la agencia es de EE.UU.? |
| 2.12 | Pedido de reseñas | `docs/05-GO-TO-MARKET.md:134`: "If TierSaver earned it, a short review ... And if something felt off, reply here first". | Pedir la reseña al contento y desviar al descontento es "review gating". Shopify 1.3.1 prohíbe incentivar o condicionar; la regla de reseñas de la FTC (16 CFR Part 465, de memoria) castiga suprimir reseñas negativas. | Medio | "Your first TierSaver cleanup finished. If you have a minute, an honest review on the Shopify App Store helps other merchants decide: [link]. Questions or problems: reply to this email." Enviar a todos por igual. | — |

---

## 3. Renovación automática y cobro recurrente (modo automático)

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta al abogado |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 | Divulgación y consentimiento al activar el modo automático | Términos §1, §2, §3: activar el modo "authorize[s] monthly cleanups to run without a separate approval". En la app (`app.settings.tsx`): casilla "Run the scheduled cleanup automatically, without waiting for my approval" con detalle "Off by default. Only with Klaviyo's recommended criteria...". | La casilla **no menciona el cobro**: ni precio, ni frecuencia, ni que sigue hasta que se apague, ni cómo cancelar. No se registra `termsVersion` al activarlo (solo en la aprobación manual). No hay confirmación posterior. Es el núcleo de cualquier norma de opción negativa: términos materiales claros antes del consentimiento, consentimiento expreso, cancelación simple. | **Alto** | **T-05** (texto de la casilla, banner de confirmación y párrafo nuevo en términos §6). Registrar en `events_log` actor, fecha, precio mostrado y `termsVersion` al activar. | ¿ROSCA y la sección 5 de la FTC alcanzan a una venta B2B a tiendas chicas? La regla anulada sí cubría B2B; la FTC reabrió la reglamentación en marzo de 2026. ¿Alguna ley estatal aplicable cubre B2B? (California §17601 define "consumer" como persona física para uso personal: de memoria, a confirmar.) |
| 3.2 | Aviso antes y después de cada corrida automática | Ninguno fuera de la app: la app no manda mails. El merchant se entera por la factura de Shopify o entrando a la app. | Cargo recurrente de hasta US$ 149 por mes sin recordatorio ni recibo propio. Es el punto más débil frente a un reclamo de "me cobraron sin avisar" y frente a un contracargo. | **Alto** | Decisión del dueño, dos caminos: (a) lanzar **sin** modo automático hasta tener mail operativo; (b) mantenerlo y agregar banner fijo en el inicio "Automatic cleanups are on. Next audit: {date}. Price if it suppresses profiles: {price}. Turn off in Settings." y recibo en History. Recomiendo (a) o, como mínimo, (b) más T-05. | ¿Un aviso solo dentro de la app alcanza como aviso previo? (se suma a R10) |
| 3.3 | Cancelación simple | Términos §3 "you can turn it off at any time"; §14 desinstalar. Help: "you can cancel by uninstalling the app". | Bien en sustancia (un clic en Settings, o desinstalar). Falta decir que apagarlo es inmediato y gratis, y que no revierte lo ya corrido. | Bajo | Incluido en T-05. | — |
| 3.4 | Aprobación del cargo en Shopify | `billing.ts` `subscriptionTerms()`: "Flat monthly price by list size: ... Charged only in a month when a cleanup suppresses profiles, at most once every 28 days. The audit is free." Tope US$ 149. | El texto que Shopify muestra no dice que con modo automático los cargos se repiten sin nueva aprobación. | Medio | Agregar a `subscriptionTerms()`: " In automatic mode, cleanups and their charges repeat monthly until you turn it off." | — |
| 3.5 | Ventana de deshacer sin cargo | Términos §6 "Undo and refunds": el cargo sale "usually within minutes". | Ya señalado como decisión pendiente en el memo. Desde cobertura: "every cleanup can be undone" en la landing, leído junto a "undo does not refund", puede resultar engañoso si no se dice al lado. | Medio | En "Before you approve": "Undoing a cleanup later does not refund its charge." | (R5 del memo) |

---

## 4. Terceros, marcas y nombre

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta al abogado |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1 | No afiliación | Términos §1, privacidad §1, pie del sitio, pantalla de aprobación, "Good to know". Bien. | Ninguno. | — | — | — |
| 4.2 | "Klaviyo" dentro del **nombre** del producto ("TierSaver for Klaviyo", "TierSaver: List Hygiene for Klaviyo") | `docs/12` §1.5 lo trató como uso descriptivo tolerable. | Los API Terms (leídos hoy) solo permiten usar la marca "as expressed in our Newsroom" y prohíben sugerir asociación sin consentimiento escrito. No hay regla de nombres publicada. Usar la marca ajena en el nombre es más que mención nominativa en un texto. Los competidores lo hacen, lo que no es permiso. | Medio | Tener listo un nombre de respaldo sin "Klaviyo" ("TierSaver: Email List Hygiene") y un plan de cambio. Pedir consentimiento escrito a Klaviyo al solicitar la ficha en su marketplace. | ¿Uso nominativo defendible en el nombre? ¿Conviene pedir el consentimiento ya? |
| 4.3 | Frase "Klaviyo's own recommended criteria" | Landing (hero y meta description), `app.settings.tsx`, borrador de ficha (`docs/07-LANZAMIENTO.md:54`). Fuente: artículo 24312135764251 (`site/src/sources.ts`, leído el 2026-11-25). | Los requisitos de ficha de Klaviyo vetan "recommended" cuando sugiere aval. La frase puede leerse como "recomendado por Klaviyo". Además la app agrega condiciones propias (pedidos de Shopify, SMS, listas protegidas), así que no son exactamente "los" criterios de Klaviyo. La fuente no está enlazada en el hero. | Medio | Reemplazar en todos lados por: "the criteria Klaviyo publishes for its own suppression recommendations" con enlace a la fuente y fecha. En la app: "Klaviyo's published criteria for long-term inactive profiles". | — |
| 4.4 | Insignia "Works with Klaviyo" | Landing, texto sin logo. `og-image.png` revisada: solo texto "for Klaviyo", sin logos ajenos. | "Works with" puede parecer un programa oficial. | Bajo | "Connects to your Klaviyo account". | — |
| 4.5 | Marcas de Shopify | "For Shopify brands" como texto. Requisito 4.4.3 (verificado): no usar marcas de Shopify en ícono, banner ni capturas; solo para indicar compatibilidad. | Pautas de marca de Shopify no leídas (host bloqueado). | Bajo | Verificar a mano antes de la ficha. Las capturas de la ficha no deben mostrar el logo de Shopify fuera del marco real del admin. | — |
| 4.6 | Obligaciones de TierSaver con Klaviyo que el contrato con el merchant debe permitir | Términos §9 y §14: suspender si Klaviyo lo exige. | Los API Terms exigen: avisar a Klaviyo y a los usuarios ante acceso no autorizado y **coordinar con Klaviyo los comunicados**; avisar a Klaviyo de cualquier incumplimiento del propio user agreement; Klaviyo puede usar nombre y logo de la app. Los términos no reservan el derecho de compartir con Klaviyo y Shopify la información necesaria para eso. | Medio | Términos §9: "We may share with Klaviyo and Shopify the information about your use of the app that their terms require us to share, such as information about a security incident or a breach of these terms." Y en privacidad §6. | (Pregunta 10 del memo) |
| 4.7 | Logs de 365 días que pide Klaviyo contra el borrado a las 48 h | Privacidad §9: todo se borra con `shop/redact`. | Conflicto ya señalado en R2. Desde cobertura: si se decide conservar un registro mínimo, la política tiene que decirlo **antes** de empezar a hacerlo. | Medio | Si se conserva: privacidad §9, "After that deletion we keep, for [365 days / the limitation period], a record that contains no customer data: the store domain, the dates and sizes of cleanups, who approved them, the terms version accepted and the charges created." | (R2 del memo) |
| 4.8 | Dependencia de Cloudflare | Privacidad §6; términos §17 fuerza mayor ("a hosting provider"). | Bien. | — | — | — |

---

## 5. Publicidad (landing, precios, FAQ, ficha)

| # | Afirmación | ¿Sustentada? | Hueco | Riesgo | Texto propuesto | Pregunta |
| --- | --- | --- | --- | --- | --- | --- |
| 5.1 | "No one who buys is touched." (FAQ) · "Buyers stay" · "Anyone who has ever bought, opened, clicked or visited is kept." · ilustración "Buyers among them: None" | Parcial. El cruce es por hash del mail del pedido. Compras con otro mail, invitados sin mail, otros canales o historial que Shopify no entregó no se detectan. Términos §4 y §11 lo admiten. | Absolutos en la publicidad que el contrato desmiente: riesgo de afirmación engañosa (FTC Act §5, FDUTPA) y debilita la cláusula 11. | **Alto** | **T-24** (a). | (R5 del memo) |
| 5.2 | "Every cleanup ... can be undone" · "logged and reversible" | Parcial: exige app instalada y conectada, no devuelve mails no enviados ni el cargo, Klaviyo bloquea re-suprimir 90 días, puede ser parcial. | Falta el calificador al lado. | Medio | **T-24** (b). | — |
| 5.3 | "Nothing is deleted" | Cierto para perfiles de Klaviyo. | Ninguno relevante. Ojo: los datos de TierSaver sí se borran al desinstalar; la frase está siempre en contexto de perfiles. | Bajo | Opcional: "No profile is deleted." | — |
| 5.4 | "Free audit" · "The audit is free and read-only" | Sí: sin cargo, sin tarjeta, sin límite ("as often as you like"). | Condiciones del "gratis": hay que instalar la app y autorizar Shopify y Klaviyo. Guía de la FTC sobre "free" (16 CFR Part 251, de memoria): condiciones claras al lado. "Read-only" es inexacto en un punto: la auditoría crea y mantiene un segmento en Klaviyo (términos §2). | Medio | "The audit is free. It does not suppress or edit any profile; it adds one segment to your Klaviyo account to do the counting." Corregir también `help/how-the-audit-works.html` ("does not change anything in your Klaviyo account"). | — |
| 5.5 | "finishes before your plan renews, so Klaviyo's count is up to date" | Es un objetivo, no un resultado asegurado (Klaviyo dice "up to 72 hours"). | Promesa de timing. | Medio | "is timed to finish a few days before your plan renews, to give Klaviyo's count time to update". | — |
| 5.6 | Números de ejemplo | Rotulado: "An illustration with example numbers, not a customer result." Chequeo de salud: "Klaviyo list prices read on {date} ... your invoice may differ". | Bien. Mantener el rótulo visible junto al gráfico en móvil. | Bajo | — | — |
| 5.7 | Testimonios | No hay ninguno en el sitio. | Bien. No inventar; en la ficha están prohibidos (4.3.6-7). | — | — | — |
| 5.8 | Comparación con Klaviyo ("Doesn't Klaviyo already do this?") | Factual y enlazada. | Bien. | Bajo | — | — |
| 5.9 | Precio en help vs. términos | Help: "The price is set by your active profile count when a cleanup runs". Términos §6: "counted in the audit behind the simulation you approved". | Dos bases de cálculo distintas. | Bajo | Help: "by your active profile count in the audit behind the cleanup". | — |
| 5.10 | Borrador de ficha de Shopify | `docs/07-LANZAMIENTO.md:54`: "Suppressed profiles don't count toward your Klaviyo plan ... you can move to a lower plan". | Requisito 4.3.3: sin estadísticas ni afirmaciones de resultado en la ficha. La frase sobre el plan es una afirmación de resultado apenas velada. | Medio | Dejar en la ficha solo el hecho citado, sin "you can move to a lower plan", o sacarlo. | — |

---

## 6. Consumidor o empresa, capacidad, agencias

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta |
| --- | --- | --- | --- | --- | --- | --- |
| 6.1 | Solo empresas | Términos §1: "You confirm that you use it for your business and not as a consumer". | Falta "trade, business or profession" y la renuncia a normas de consumo "to the extent the law allows". Unipersonales pueden ser tratados como consumidores en algunos países. | Medio | **T-06** (primer párrafo), términos §1. | — |
| 6.2 | Edad | No hay número (pregunta 5 del memo). | — | Bajo | Incluido en T-06 ("at least 18"). | — |
| 6.3 | Autoridad para obligar a la empresa | Términos §1. | Bien. | — | — | — |
| 6.4 | Staff, colaboradores y agencias que actúan en la tienda | Términos §3: "You are responsible for everyone who uses the app through your Shopify store." | No dice que sus aprobaciones obligan al merchant (incluido el cargo), ni contempla a la agencia que instala y conecta el Klaviyo del cliente. El registro guarda solo el ID de usuario de Shopify. | **Alto** | **T-06** (segundo párrafo), términos §3. | ¿La aceptación de un colaborador de agencia obliga al merchant sin otra prueba de mandato? |
| 6.5 | Cuenta de Klaviyo de un tercero | Términos §3: "You must have the right to connect ... the Klaviyo account you connect". | Bien. | — | — | — |

---

## 7. Arquitectura de responsabilidad y cláusulas generales

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta |
| --- | --- | --- | --- | --- | --- | --- |
| 7.1 | Supresión errónea, ventas perdidas, pérdida de datos | Términos §11 y §12, con ejemplos. Sólido. | El ejemplo de ventas perdidas se limita a perfiles suprimidos "under criteria and a simulation you approved". Un error de la app (bug que suprime fuera de la simulación) queda solo bajo el tope general. Es razonable, pero conviene que el abogado lo vea. | Medio | — | ¿Tope separado para errores propios o para incidentes de datos? (pregunta 7 del memo) |
| 7.2 | Derechos no excluibles (Australia, Reino Unido, UE) | Términos §12 último párrafo: fórmula general "cannot be excluded or limited". | Australia: con precios de US$ 15 a 149 el merchant australiano es "consumer" a efectos de las garantías (umbral AU$ 100.000, verificado), que no se pueden excluir; la ley permite limitar el remedio a volver a prestar el servicio (art. 64A, de memoria). Además, cláusulas abusivas en contratos estándar con pymes, con multas desde noviembre de 2023 (de memoria). Reino Unido: UCTA somete a razonabilidad las exclusiones en condiciones estándar B2B y prohíbe excluir muerte o lesiones por negligencia (de memoria). Alemania: control de condiciones generales también B2B (de memoria). | **Alto** | **T-11**, términos §12 (reemplaza el último párrafo). | ¿Conviene un anexo por país o alcanza la cláusula general? ¿Bloquear instalación desde algún país? |
| 7.3 | Foro Florida frente a merchants de la UE, Reino Unido y Australia | Términos §15. | La cláusula es válida en origen, pero cobrar o ejecutar afuera es otra cosa, y normas imperativas locales pueden desplazar la ley elegida. | Medio | Incluido en T-11 (última oración). | (Pregunta 1 del memo) |
| 7.4 | Arbitraje, renuncia a jurado y a acciones colectivas | No hay (pregunta 1 del memo). | Sin renuncia a jurado ni a acciones colectivas, con base de clientes atomizada y cargo recurrente. | Medio | **T-10** (opcional, en mayúsculas, términos §15). | ¿Renuncia a jurado ejecutable en Florida entre empresas? (de memoria: sí si es clara y visible) |
| 7.5 | Medidas cautelares, honorarios, plazo para reclamar | R9, R4 y pregunta 8 del memo. | Ya planteados. | Medio | — | — |
| 7.6 | Indemnidad recíproca por propiedad intelectual | Solo del merchant hacia TierSaver (§13). | Un contrato solo unilateral se defiende peor ante un control de razonabilidad. | Bajo | "We will defend you against a third-party claim that the app, as we provide it, infringes that party's copyright or trademark, and pay the damages finally awarded, subject to the limit in section 12." | (R3 del memo) |
| 7.7 | Sanciones y control de exportaciones (OFAC) | No hay (pregunta 6 del memo). | Una LLC de EE.UU. no puede prestar servicios a personas o territorios sancionados. Venta mundial sin filtro propio (Shopify filtra en parte). | **Alto** | **T-07**, términos §17. | — |
| 7.8 | Anticorrupción | No hay. | Poco relevante para una app autoservicio. Sí para el programa de agencias. | Bajo | En el acuerdo de agencias: "Neither party will offer or accept a bribe or improper payment in connection with this agreement." | — |
| 7.9 | Usuarios de gobierno | No hay. | Cláusula estándar de software comercial. | Bajo | **T-08**, términos §17. | — |
| 7.10 | Consentimiento a contratar y recibir avisos por medios electrónicos | Parcial: §17 Notices. | Falta decir que la casilla vale como firma y que los registros de la app son prueba (E-SIGN / UETA). | Medio | **T-09**, términos §17. | — |
| 7.11 | Licencia de feedback | §17: "we may use them without any obligation to you". | Falta la concesión expresa (perpetua, irrevocable, mundial). | Bajo | **T-15**. | — |
| 7.12 | Licencia sobre los datos del merchant | §17: "You keep all rights in your data." | Falta la autorización expresa para procesarlos y actuar en sus cuentas. | Bajo | **T-16**, términos §17. | — |
| 7.13 | Confidencialidad | Solo §8 (personal de TierSaver). | Sin cláusula mutua; los tickets de soporte traen información comercial. | Bajo | **T-12**, términos §17. | — |
| 7.14 | Publicidad y uso de logos | No hay. | TierSaver querrá mostrar clientes; Klaviyo exige que el material de demo no exponga información de clientes. | Bajo | **T-13**, términos §17. | — |
| 7.15 | Funciones beta | No hay. El lanzamiento arranca con beta (`docs/05`). | — | Bajo | **T-14**, términos §10. | — |
| 7.16 | Suspensión por seguridad o falta de pago | §7 y §14: por incumplimiento, por pedido de Klaviyo o Shopify, o por fin del servicio. | Falta riesgo de seguridad y cargo impago o revertido. | Bajo | §14: agregar ", if we reasonably believe your use puts the service or another merchant at risk, or if a charge is unpaid or reversed". | — |
| 7.17 | Reembolsos, créditos y contracargos por Shopify | §6: no reembolsable salvo ley; "write to support@". Shopify maneja contracargos (verificado). | No dice por qué vía se corrige un cargo (reembolso o crédito de app en Shopify) ni plazo para reclamar. | Medio | **T-17** (primer párrafo), términos §6. | ¿Regla de Shopify sobre reembolsos de apps? (R6, no se pudo leer) |
| 7.18 | Impuestos | §6: "Prices ... exclude taxes, which Shopify may add." | Shopify cobra y paga al partner, y el partner debe ingresar los impuestos (ayuda de Shopify, fragmento). El vendedor a efectos fiscales es la LLC, no Shopify. No hay cláusula de impuestos a cargo del merchant. | Medio | **T-17** (segundo párrafo). Solo se señala: sales tax de EE.UU. sobre SaaS por estado, IVA de la UE y Reino Unido en B2B, y la situación fiscal argentina del dueño son tema del contador. | ¿Quién es el proveedor a efectos de IVA en ventas a la UE? |
| 7.19 | Idioma | No hay. | Quebec exige versión en francés de contratos de adhesión salvo voluntad expresa (de memoria). | Bajo | **T-18**, términos §17. | ¿Alcanza la cláusula bilingüe para Quebec? |
| 7.20 | Cesión, divisibilidad, no renuncia, fuerza mayor, acuerdo completo, supervivencia, terceros beneficiarios, avisos | §14 y §17. | Cubiertos. La lista de supervivencia debería sumar §7 (uso aceptable, por la indemnidad) y §16. | Bajo | — | — |
| 7.21 | Sin SLA ni tiempos de soporte | §10. | Cubierto. Help no dice horario de soporte. | Bajo | Help "Contact support": "We answer by email on business days. We do not commit to a response time." | — |
| 7.22 | Uso aceptable | §7. | Falta: acceso automatizado o scraping, reventa, uso para construir un producto competidor, y datos sensibles en nombres de listas. | Bajo | Agregar viñeta: "to access the app by automated means, to resell it, or to build a competing product". | — |
| 7.23 | DMCA | No aplica: el sitio y la app no alojan contenido de usuarios. | Ninguno. No agregar agente DMCA. | — | — | — |

---

## 8. Identidad del vendedor

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta |
| --- | --- | --- | --- | --- | --- | --- |
| 8.1 | Nombre legal, domicilio y contacto | Términos §18, privacidad §14, pie (solo "© 2026 Digital Solvers LLC"). | Falta tipo y estado de constitución, "doing business as TierSaver", suite, y el bloque completo en el pie o en una página "Legal notice". La UE (Directiva de comercio electrónico, art. 5, de memoria) pide nombre, domicilio, mail y datos de registro fácilmente accesibles. Shopify: "some jurisdictions require ... a physical address" (verificado). | **Alto** (ligado a 1.1) | **T-27**. | ¿Hace falta página de aviso legal para la UE y Alemania (Impressum)? |
| 8.2 | Verificación de comerciante (DSA) en el App Store | No tratado. | Los marketplaces que venden en la UE verifican y muestran datos del comerciante (DSA arts. 30-31). No encontré la documentación de Shopify (host bloqueado). Si Shopify lo pide, se publican nombre, dirección y teléfono. | Medio | Revisar en el Partner Dashboard antes de enviar la ficha; usar la dirección de la LLC, no una personal. | — |
| 8.3 | Operar como persona física | Los textos asumen LLC. | Sin entidad, el dueño responde con su patrimonio y debería publicar nombre y domicilio personales. | **Alto** | Decisión del dueño: constituir y usar la entidad antes de cobrar. No se redacta alrededor. | — |
| 8.4 | Marca independiente | Sin menciones a Infinure, dnuvi ni Alupont en `site/src` ni en los textos legales (grep). | Ojo: la cuenta de Cloudflare conectada a esta sesión lista cuentas con esos nombres; `docs/00-HANDOVER.md` pide una cuenta dedicada a TierSaver. Los registros públicos (WHOIS, certificado, remitente de mail) no deben mostrarlos. | Bajo | Verificar WHOIS y el dominio de envío de mail. | — |

---

## 9. Privacidad y protección de datos

| # | Tema | ¿Cubierto hoy? | Hueco | Riesgo | Texto / dónde | Pregunta |
| --- | --- | --- | --- | --- | --- | --- |
| 9.1 | Términos de encargado (GDPR art. 28, CCPA "service provider") | Términos §8: siete compromisos. | Faltan elementos que el art. 28(3) y el reglamento de la CCPA (§7051, de memoria) piden por contrato: objeto, duración, naturaleza, tipos de datos y categorías de titulares; avisar si una instrucción es ilegal o si ya no se puede cumplir; obligaciones equivalentes a subencargados y derecho de objeción con plazo; no combinar datos; asistencia para evaluaciones de impacto y auditoría; transferencias solo bajo instrucción; derecho del merchant a frenar un uso no autorizado. | **Alto** | **T-23**, términos §8, o mejor una página `/dpa` incorporada por referencia. | (Preguntas 2 y 3 del memo) ¿DPA aparte con cláusulas contractuales tipo, módulo 2, y addendum del Reino Unido? |
| 9.2 | Mecanismo de transferencia a EE.UU. | Privacidad §7: "write to hello@". | No se afirma ninguno. Shopify (verificado) espera que la política lo trate. | **Alto** | Tras decidir: "Where the GDPR or UK GDPR applies to a merchant, transfers to us are made under the European Commission's standard contractual clauses (and the UK addendum), which form part of our data processing terms at tiersaver.com/dpa." | (Pregunta 2) ¿DPF, SCC o ambos? ¿Representante art. 27 en la UE y el Reino Unido? |
| 9.3 | Decisiones automatizadas (GDPR art. 22) y uso de IA | No se menciona. | La app aplica reglas fijas que cambian el estado de marketing de personas. El efecto (dejar de recibir marketing) no es jurídico ni, en principio, "similarmente significativo", y el responsable es el merchant; pero un lector de la UE lo va a buscar. Tampoco se dice que no hay IA en la selección. | Medio | **T-19**, privacidad §4. | ¿Coincide con la lectura de que el art. 22 no aplica? |
| 9.4 | Datos sensibles y de menores | Privacidad §12 (niños). | No dice que la app no está pensada para categorías especiales. Los nombres de listas o segmentos protegidos podrían revelar algo sensible; hoy se guardan solo IDs (bien). Una tienda de salud vuelve sensible, por contexto, el hash de sus compradores. | Bajo | **T-20**, privacidad §12 y términos §7. | — |
| 9.5 | Plazos de retención concretos | Privacidad §9: backups y logs "for a limited period". | GDPR art. 13 pide plazo o criterio. Sin número. | Medio | Completar con el dato real de Cloudflare (D1 Time Travel y retención de Workers Logs; verificar en su documentación): "up to [30] days". | — |
| 9.6 | Avisos de cambios de la política | Privacidad §13: "in the app or by email". | La app no manda mails; los términos ya se corrigieron en este punto, la política no. | Bajo | "we will show a notice in the app before it takes effect". | — |
| 9.7 | Aviso de nuevos subencargados | Privacidad §6 y términos §8: "update that list before we add one". | Sin plazo ni derecho de objeción. | Medio | Incluido en T-23 (b). | ¿Plazo? (14 o 30 días es lo habitual) |
| 9.8 | Plazo de aviso de incidentes | "without undue delay". | Aceptable para un encargado. Muchos merchants piden un número. Klaviyo exige además aviso a Klaviyo y coordinar comunicados (ver 4.6). | Medio | Opcional: "and in any case within 72 hours after we confirm it". | ¿Comprometer número? |
| 9.9 | CCPA: "sell" y "share", GPC | Privacidad §4: "We do not sell personal data". | Falta "share" en sentido CPRA y una línea sobre señales GPC/DNT. | Bajo | **T-22**, privacidad §10; y "sell or share" en §4. | (Pregunta 3) |
| 9.10 | Datos del personal del merchant | Privacidad §3: solo ID de usuario de Shopify. | La tabla de sesiones tiene columnas de nombre y mail (pregunta 12 del memo). Sin resolver. | Medio | Confirmar con desarrollo; si se llenan, declararlo. | — |
| 9.11 | Derechos del titular y pedidos vía Shopify | Privacidad §9 y §11. `webhooks.compliance.tsx`: `customers/data_request` no hace nada automático. | Coherente con la política (se responde por mail a pedido). Requiere que hello@ esté atendido. | Bajo | — | — |
| 9.12 | DPO y registros | No se menciona. Shopify sugiere evaluarlo. | Por escala, probablemente no obligatorio. | Bajo | — | (Pregunta 4) |
| 9.13 | Excepción de "estadísticas" en el uso propio | Términos §8. | Un encargado que usa datos para fines propios pasa a ser responsable de ese uso; hay que acotarlo a datos agregados y anónimos, y a la medición del servicio. | Medio | "... except to calculate your price and to produce aggregated statistics about the service that do not identify you, your store or any person". | (Ya planteado) |

---

## 10. Sitio web

| # | Tema | Estado verificado | Hueco | Riesgo | Acción |
| --- | --- | --- | --- | --- | --- |
| 10.1 | Cookies y recursos de terceros | `site/_headers`: CSP `default-src 'none'; script-src 'self'; ... connect-src 'none'; form-action 'none'`. Sin scripts ni fuentes externas en `site/src`. Privacidad §10 lo declara. | La afirmación "sets no cookies" depende de la configuración de la zona en Cloudflare: funciones como Bot Management pueden poner la cookie `__cf_bm`, y Web Analytics puede inyectar un beacon (la CSP lo bloquearía). No verificable desde el repo. | Medio | Verificar en el panel de Cloudflare antes de publicar y dejarlo anotado en `docs/STATUS.md`. No hace falta banner de cookies si se mantiene así. |
| 10.2 | Cookie de la app | Privacidad §3: `__Host-ts_klaviyo_oauth`, estrictamente necesaria. | Bien. | — | — |
| 10.3 | Declaración de accesibilidad | No hay. | Demandas por accesibilidad web son frecuentes en el sur de Florida (de memoria); un sitio sin local físico está menos expuesto. | Bajo | Página o párrafo: "We aim to meet WCAG 2.1 AA. If you have trouble using this site or the app, write to support@tiersaver.com." Correr una auditoría antes de afirmarlo. |
| 10.4 | security.txt | No existe `site/.well-known/`. | — | Bajo | Agregar `/.well-known/security.txt` (RFC 9116) con contacto y vencimiento. |
| 10.5 | Soporte | support@ y hello@ en términos, privacidad y help. | Los buzones tienen que existir y estar atendidos: son el canal para errores de cobro, pedidos de datos y avisos legales. Shopify exige contacto de soporte y contacto de emergencia (4.5.6). | **Alto** (operativo) | Confirmar que ambos buzones reciben antes de publicar. |
| 10.6 | Fecha y versión | Términos y privacidad: "Effective date: November 26, 2026". `TERMS_VERSION = "2026-11-26"`. | Coinciden hoy. No hay versión registrada de la política de privacidad, ni historial de versiones anteriores publicado. | Bajo | Guardar cada versión publicada (PDF o commit etiquetado) para poder probar qué texto aceptó cada merchant. |
| 10.7 | Guías con instrucciones de Klaviyo | Citan fuentes y fecha de lectura (`SOURCES_READ_ON`). | Falta el aviso de "no es asesoramiento" (ver 2.6). | Bajo | T-04. |

---

## 11. Top 15 priorizado

1. **Contraparte real (1.1, 8.1, 8.3).** Confirmar que Digital Solvers LLC existe, está activa, es titular de la cuenta de Shopify Partner y de la app de Klaviyo, y que la dirección (con suite) es correcta. Si no, todo el esquema de responsabilidad queda sin efecto.
2. **Sacar el cartel "Draft ... not in effect" (1.2)** el día de publicación y alinear fecha de vigencia y `TERMS_VERSION`. Hoy la app hace aceptar un texto que se declara no vigente.
3. **Modo automático sin divulgación de cobro ni aviso (3.1, 3.2).** La casilla no menciona el cargo recurrente y la app no avisa antes ni después. Lanzar sin modo automático, o aplicar T-05 y registrar el consentimiento.
4. **Deshacer puede volver enviable a alguien suprimido por otro motivo (2.3).** Corregir `help/undo.html` y agregar T-02.
5. **Merchant como remitente y responsable de CAN-SPAM, CASL, GDPR/PECR y TCPA (2.1, 2.2).** Agregar T-01; la supresión de la app no es una baja.
6. **Efecto real de la supresión (2.4).** Avisar en términos, app y FAQ que se cortan los flujos no transaccionales y que SMS no cambia (T-03).
7. **Afirmaciones absolutas en la landing (5.1, 5.2, 5.4).** "No one who buys is touched", "can be undone", "read-only": calificar (T-24).
8. **Help promete un mail y una función que no existen (1.3, 1.4, 1.5).** Corregir tres artículos y el paso 04 de la landing.
9. **Términos de encargado incompletos y sin mecanismo de transferencia (9.1, 9.2).** DPA publicado con SCC, o T-23 como mínimo.
10. **Derechos no excluibles: Australia, Reino Unido, UE (7.2).** T-11.
11. **Sanciones y OFAC (7.7).** T-07.
12. **Staff, colaboradores y agencias obligan al merchant (6.4)** y "solo empresas, 18 años" (6.1, 6.2). T-06.
13. **"Klaviyo" en el nombre y "Klaviyo's own recommended criteria" (4.2, 4.3).** Reformular la frase; nombre de respaldo listo; pedir consentimiento escrito a Klaviyo.
14. **Marketing propio: outreach en frío, comisiones de agencias, pedido de reseñas (2.9, 2.11, 2.12).** Política de privacidad para prospectos (T-21), divulgación de comisión (T-25), pedido de reseña neutral.
15. **Reembolsos por Shopify, impuestos, consentimiento electrónico, renuncia a jurado y acciones colectivas (7.17, 7.18, 7.10, 7.4).** T-17, T-09, T-10 (a decidir con el abogado).

Pendiente de lectura por red bloqueada: Partner Program Agreement, API License and Terms of Use y pautas de marca de Shopify (`www.shopify.com`).

---

## Anexo A. Textos propuestos (inglés)

**T-01 · Terms §3 (new bullet, or new §3A "Your marketing and the law")**

> You are the sender. You, not TierSaver, are the sender of every message sent from your Klaviyo account and the controller of your customers' data, and you decide who is contacted, on what legal basis and through which channel. You are solely responsible for complying with the laws that apply to your email, SMS and other marketing, including the U.S. CAN-SPAM Act and Telephone Consumer Protection Act, U.S. state laws, Canada's Anti-Spam Legislation (CASL), the EU and UK GDPR, the ePrivacy Directive and the UK Privacy and Electronic Communications Regulations (PECR), and the equivalent laws wherever your customers are. That includes obtaining and recording consent, identifying yourself in your messages, honoring unsubscribe and opt-out requests within the time the law sets, and keeping your own suppression and do-not-contact records. The app does not obtain, record, verify or change consent, does not process unsubscribe requests, and does not check whether a profile may lawfully be contacted.

**T-02 · Terms §4 (two new paragraphs)**

> A suppression applied by the app is a list hygiene measure. It is not a record of an unsubscribe or of an objection to marketing, and you must not rely on it to honor one. If a person asks you to stop emailing them, record that in Klaviyo as an unsubscribe, whether or not the app has suppressed their profile.
>
> Undo asks Klaviyo to remove the manual suppression from every profile that the cleanup suppressed and that still exists in your account. Klaviyo records only one kind of manual suppression, so the app cannot tell the suppression it applied apart from one that you, a colleague or another tool would have wanted on the same profile after the cleanup. Undo does not resubscribe anyone: according to Klaviyo's documentation on [date], profiles that unsubscribed, bounced or have an invalid address stay as they are. After an undo the restored profiles can receive your marketing email again, and you are responsible for checking that you may lawfully email them before you do.

**T-03 · Terms §4 (replaces the first sentence)**

> Suppression applies to email. A suppressed profile is skipped by your Klaviyo campaigns and flows, including welcome, abandoned cart, back-in-stock and win-back messages, even if that person later buys. According to Klaviyo's documentation on [date], emails that Klaviyo has approved as transactional can still be sent to a manually suppressed profile, suppression does not change SMS or push consent, and Klaviyo removes a manual suppression if the person subscribes to your email marketing again. Suppression can also change the size of your segments, the reach of your flows, your reports and any audience you sync from Klaviyo to another service. Klaviyo decides how suppression works and can change it at any time.

**T-04 · Terms §10 (new paragraph "No professional advice")**

> The app, the help center and the guides on tiersaver.com give general information about how the app and Klaviyo work, as of the date shown. They are not legal, compliance, tax, deliverability or other professional advice. Statements about Klaviyo describe Klaviyo's published documentation on the date cited and may be out of date; Klaviyo's own documentation prevails. The cleanup criteria follow criteria that Klaviyo has published. Klaviyo may change them, and we do not promise that the app's criteria match Klaviyo's at any given time.

**T-05 · Automatic mode**

In-app, Settings, checkbox details:

> When this is on, TierSaver suppresses the profiles found by each monthly audit without asking you first. Each cleanup that suppresses at least one profile is charged through Shopify at the price for your list size (currently {price} per month), at most once every 28 days and never more than $149 in a 30-day Shopify billing cycle. This repeats every month until you turn it off here or uninstall the app. Turning it off is immediate and free.

Checkbox label:

> I authorize automatic monthly cleanups and the charges described above, and I accept the Terms of Service.

After saving, and on the home page while it is on:

> Automatic cleanups are on. Next audit: {date}. Price if it suppresses profiles: {price}. Turn this off at any time in Settings.

Terms §6, new paragraph "Automatic mode and recurring charges":

> If you turn on automatic mode, you authorize us to run a cleanup each month and to create the charge for each cleanup that suppresses at least one profile, without asking you again, until you turn automatic mode off in the app's Settings or uninstall the app. Turning it off takes effect immediately and stops future automatic cleanups and their charges. It does not reverse a cleanup that has already run or a charge already created. The app shows the date of the next scheduled audit on its home page.

**T-06 · Terms §1 and §3**

> You must be at least 18 years old and able to enter into a binding contract. The app is offered only to businesses. You confirm that you use it in the course of your trade, business or profession and not as a consumer and, to the extent the law allows, consumer protection laws do not apply to this agreement.
>
> Anyone who uses the app through your Shopify store, including staff, collaborators, agencies and freelancers to whom you have given access, acts for you. Their settings and approvals, including approvals that lead to a charge, are yours. If you are an agency or other service provider using the app in a client's store, you confirm that the client has authorized you to accept these terms, to connect the client's Klaviyo account and to approve cleanups and charges on its behalf.

**T-07 · Terms §17 "Trade controls"**

> You confirm that you are not located in, organized under the laws of, or ordinarily resident in a country or territory subject to comprehensive U.S. sanctions, and that you are not on, or owned or controlled by anyone on, a U.S. government list of restricted parties, including the lists maintained by the Office of Foreign Assets Control. You will not use the app in breach of the export control or sanctions laws of the United States or of any other country that applies to you.

**T-08 · Terms §17 "Government users"**

> The app is commercial computer software. If you are a U.S. government user, you receive only the rights set out in these terms, in line with 48 C.F.R. 12.212 and 227.7202.

**T-09 · Terms §17 "Electronic agreement"**

> You agree that these terms, your approvals in the app and the notices we give you are in electronic form, that ticking a box or pressing a button in the app has the same effect as a signature, and that our records of your approvals are evidence of them.

**T-10 · Terms §15 (optional, for counsel)**

> TO THE FULLEST EXTENT THE LAW ALLOWS, YOU AND WE EACH WAIVE THE RIGHT TO A TRIAL BY JURY IN ANY PROCEEDING THAT ARISES OUT OF OR RELATES TO THESE TERMS OR THE APP, AND AGREE THAT ANY CLAIM WILL BE BROUGHT ONLY IN AN INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN A CLASS, COLLECTIVE OR REPRESENTATIVE PROCEEDING.

**T-11 · Terms §12 (replaces the last paragraph)**

> Rights that cannot be excluded. Some laws give business customers rights that a contract cannot remove, for example the consumer guarantees of the Australian Consumer Law where they apply to you. Nothing in these terms excludes, restricts or modifies those rights. Where such a law allows us to limit our liability for failing to meet a guarantee, our liability is limited, at our choice, to supplying the service again or paying the cost of having it supplied again. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud or for intentional misconduct. The choice of Florida law and courts in section 15 does not take away a protection that the mandatory law of the country where you are established gives you and that cannot be waived by contract. If the law that applies does not allow one of the exclusions or limits in this section, it applies to the fullest extent that law allows.

**T-12 · Terms §17 "Confidentiality"**

> Each of us will keep confidential the non-public information it receives from the other in connection with the app, use it only for this agreement, and protect it with reasonable care. This does not apply to information that is or becomes public without a breach, that the recipient already knew or develops independently, or that the law requires to be disclosed.

**T-13 · Terms §17 "Names and logos"**

> We will not use your name or logo in our marketing, or present you as a customer, without your prior consent. You will not suggest that we, Klaviyo or Shopify endorse your business.

**T-14 · Terms §10 "Beta features"**

> Features marked as beta, preview or test are provided for evaluation, may change or be withdrawn at any time, and come with no commitment of any kind, in addition to the disclaimers in sections 11 and 12.

**T-15 · Terms §17 (replaces the feedback sentence)**

> If you send us suggestions or feedback, you grant us a perpetual, irrevocable, worldwide, royalty-free right to use them for any purpose, without any obligation to you. We will not name you as the source without your consent.

**T-16 · Terms §17 "Your data"**

> You keep all rights in your data. You authorize us to access and process it, and to act in your Shopify store and your Klaviyo account, as needed to provide the app to you and as described in the privacy policy.

**T-17 · Terms §6**

> Billing questions. Shopify issues the invoice and collects payment. If you think a charge is wrong, write to support@tiersaver.com within 60 days of the Shopify invoice that shows it. Where a correction is due, we make it through Shopify, as a refund or an app credit; we cannot refund in any other way. If a charge is unpaid or reversed, we may pause cleanups until it is settled.
>
> Taxes. You are responsible for any sales, use, value added, goods and services, withholding or similar taxes that apply to your use of the app, other than taxes on our income. Where such a tax applies, it is added to the charge on your Shopify invoice.

**T-18 · Terms §17 "Language"**

> These terms are written in English. If we provide a translation, the English version prevails. Les parties ont expressément demandé que le présent contrat soit rédigé en anglais.

**T-19 · Privacy §4 "Automated processing"**

> The app applies fixed rules chosen by the merchant, the cleanup criteria, to select profiles. The merchant reviews and approves the result, or authorizes it in advance in automatic mode. The only effect on a person is that the merchant's Klaviyo account stops sending them marketing email. It has no legal effect on them and, in our assessment, does not affect them in a similarly significant way. The app does not use machine learning or AI models to select profiles, and we do not build profiles of individuals for our own purposes. Each merchant is responsible for assessing this processing under the laws that apply to it.

**T-20 · Privacy §12 and Terms §7**

> The app is not designed to process special categories of personal data, data about children, or health, financial or precise location data. Merchants must not use the app to send us such data.

**T-21 · Privacy §10 "People we contact about TierSaver"**

> If you work at an agency or a business that may be interested in TierSaver, we may hold your name, role, business email address and company, taken from your company's website, your public professional profile or a message you sent us, in order to contact you about TierSaver. We rely on our legitimate interest in presenting our service to businesses, or on your consent where the law requires it. Every such message says who we are and how to stop receiving them. You can also object at any time by writing to hello@tiersaver.com. We keep this data until you object, or for [24] months after our last contact.

**T-22 · Privacy §10**

> This website does not track you, so there is nothing for it to change in response to a Do Not Track or Global Privacy Control signal.

**T-23 · Terms §8 (processor terms, additions)**

> Details of the processing. Subject matter and purpose: providing the app. Duration: while the app is installed, plus the deletion periods in the privacy policy. Nature: reading, hashing, comparing and storing data, and instructing Klaviyo to suppress or unsuppress profiles. Data subjects: your customers and contacts who have a profile in your Klaviyo account or an order in your Shopify store. Types of data: as listed in section 3 of the privacy policy.
>
> We will also: (a) tell you if we believe an instruction breaks data protection law, or if we can no longer meet our obligations under this section; (b) impose on each sub-processor data protection obligations equivalent to these, remain responsible for it, and show a notice in the app at least [14] days before adding or replacing one, during which you may object by uninstalling the app; (c) not combine your customers' data with data from any other source, not retain, use or disclose it outside our direct business relationship with you, and not "sell" or "share" it as those terms are defined in the California Consumer Privacy Act; (d) give you the information you reasonably need to show compliance and to carry out data protection impact assessments, and answer a reasonable written security questionnaire once a year; (e) transfer the data outside your country only as described in the privacy policy and, where the law requires a transfer mechanism, under the standard contractual clauses referred to there; (f) let you take reasonable steps to stop and remedy any unauthorized use of the data, which includes uninstalling the app.

**T-24 · Landing and FAQ**

(a) Buyers:

> Hero card 01: "Matched buyers stay" · "Anyone Klaviyo or Shopify has on record as having bought, opened, clicked or visited is kept."
> FAQ "Will I lose customers?": "A profile that TierSaver can match to a purchase, in your Shopify orders or in Klaviyo, is never a candidate. Matching uses the email address on the order, so a purchase made under a different address cannot be matched. You approve a simulation before anything runs, and you can download the list to check it."
> Illustration: "Matched buyers among them: None".

(b) Undo:

> "Every cleanup is simulated first and can be undone while the app is installed and connected to Klaviyo. Undoing does not resend emails that were skipped or refund the cleanup's charge. See what undo does."

**T-25 · Agency agreement**

> You will clearly tell each client, before the client installs TierSaver, that you receive a commission or other benefit from us. You will make no statement about TierSaver, about Klaviyo's prices or about savings that is not in our current published materials.

**T-27 · Seller identity block (terms §1 and §18, privacy §1 and §14, site footer)**

> TierSaver is operated by Digital Solvers LLC, a [State] limited liability company doing business as TierSaver, [street address, suite], Miami, FL 33131, United States. General and legal: hello@tiersaver.com. Support: support@tiersaver.com.
