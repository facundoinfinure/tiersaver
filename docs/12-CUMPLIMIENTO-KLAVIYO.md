# Cumplimiento con las políticas de Klaviyo y de Shopify

Fecha: 2026-11-25. Esto es un análisis de políticas hecho sobre fuentes primarias, no asesoramiento legal: baja el riesgo, pero no puede garantizar cómo va a interpretar Klaviyo sus propios términos.

## Resumen ejecutivo

1. **La actividad de fondo está permitida y Klaviyo la recomienda.** Su ayuda dice que los perfiles suprimidos no se cobran, que conviene suprimir inactivos de forma continua y que hay que reducir el conteo antes de la renovación para bajar de plan.
2. **Lo que la cláusula prohíbe es conservar el beneficio sin pagarlo**: suprimir antes del corte y reactivar después, suprimir gente a la que se le sigue escribiendo, o mandarles por otra vía. Hoy el diseño no hace nada de eso, pero tres elementos lo acercan.
3. **Precio (20% del ahorro): cambiar.** Es el elemento más expuesto: el ingreso de TierSaver pasa a ser una función directa de lo que Klaviyo deja de cobrar. Recomendación: tramos fijos por tamaño de lista (el plan B ya documentado).
4. **Nombre "TierSaver": ajustar o asumir el riesgo.** No viola nada por sí solo, pero declara que el producto está diseñado para bajar de tramo. "for Klaviyo" es tolerable como uso descriptivo, sin logo.
5. **Programación: mantener, con condiciones.** Correr antes de la renovación está avalado por la ayuda de Klaviyo, siempre que la supresión sea permanente y los criterios no sean más laxos que los de Klaviyo.
6. **Reactivación por compra: sacar del MVP o restringir mucho.** Es un ciclo suprimir/reactivar hecho por la app, justo el patrón que la regla de 90 días de Klaviyo limita. Deshacer se mantiene como corrección de errores.
7. **Mensajes: cambiar varios.** El borrador de ficha y los de outreach todavía venden "pagar menos a Klaviyo" y "justo antes de la fecha de facturación", contra la decisión A.
8. **Reglas por defecto: endurecer.** Las de TierSaver son más laxas que los criterios publicados por Klaviyo (permiten suprimir a quien compró hace 13 meses o abrió hace 4).
9. **Riesgo que queda:** Klaviyo puede revocar el acceso a la API "at any time for any reason". Ningún cambio lo elimina; el plan de contingencia está en la sección 4.

## 1. Qué prohíbe cada cláusula

### 1.1 La cláusula de cargos y la de integraciones

> "You may not use the Klaviyo services in a manner designed to avoid or circumvent bills, invoices, or other fees that Klaviyo would otherwise be entitled to collect"

https://www.klaviyo.com/legal/acceptable-use-policy (versión del 9 de abril de 2026, leída el 2026-11-25)

La misma política alcanza a quien construye la integración, no solo al merchant:

> "Businesses or partners that develop or offer integrations with the Services are responsible for ensuring that their integrations do not reasonably enable, promote, or facilitate Customer use in violation of this Policy."

https://www.klaviyo.com/legal/acceptable-use-policy (leída el 2026-11-25)

Y la decisión es de Klaviyo:

> "Klaviyo shall be entitled, without liability to Customer, to immediately suspend, terminate, or limit your access to Klaviyo Services at any time in the event that Klaviyo determines, in its sole discretion, that you have violated any part of this Policy [...] or that you have authorized or helped others to do so."

https://www.klaviyo.com/legal/acceptable-use-policy (leída el 2026-11-25)

Dos palabras cargan el peso: "designed" (importa el propósito del uso, no solo el efecto) y "otherwise be entitled to collect" (cargos que a Klaviyo le corresponderían).

### 1.2 Lo que Klaviyo publica sobre suprimir y sobre la factura

Los perfiles suprimidos no se cobran:

> "Additionally, suppressed profiles do not contribute towards your email plan's active profile count."

https://help.klaviyo.com/hc/en-us/articles/24263920096027 (actualizado el 2026-10-29, leído el 2026-11-25)

Klaviyo presenta la supresión de inactivos como forma de pagar menos, con esas palabras:

> "Review your email plan after suppressing profiles, and continue to manage your active profiles on an ongoing basis to avoid paying for contacts that are no longer providing revenue for your business."

https://help.klaviyo.com/hc/en-us/articles/24263920096027 (leído el 2026-11-25)

Y le indica al cliente que lo haga antes de la renovación:

> "Klaviyo checks your active profile count shortly before your billing cycle renews. An eligible downgrade takes effect for the next billing cycle. Enable auto-downgrade and reduce your active profile count before that check."

https://help.klaviyo.com/hc/en-us/articles/4405883690651 (actualizado el 2026-10-25, leído el 2026-11-25)

> "For example, say you suppress a batch of long-unengaged contacts, and your reachable count drops into a lower tier. Your billable profile base shrinks, especially if you have auto downgrade turned on."

https://www.klaviyo.com/platform/how-klaviyo-pricing-works (leído el 2026-11-25)

También define a quién corresponde suprimir, y la definición es estricta:

> "These profiles are not responding to events like product launches, winback messages, or even big sales like Black Friday. They have never purchased, have no tracked visits to your website, no checkouts started, and have not engaged with your sends. These are truly "inactive" contacts that can be suppressed in Klaviyo."

https://help.klaviyo.com/hc/en-us/articles/24263920096027 (leído el 2026-11-25)

### 1.2.1 Verificación del 2026-11-26: dos artículos, dos antigüedades, y ningún plazo para el conteo

Releídos el 2026-11-26 por la sesión principal (este documento registra lo que esa lectura informó; las citas en inglés son las que pasó esa sesión).

**Los dos artículos dan criterios distintos para la antigüedad del perfil.**

| Artículo | Actualizado | Qué describe | Antigüedad | Resto de las condiciones |
| --- | --- | --- | --- | --- |
| "How to manage email suppressions and delete profiles in bulk", https://help.klaviyo.com/hc/en-us/articles/24312135764251 | 2026-10-27 | Los perfiles que Klaviyo sugiere suprimir | "Were created at least 365 days ago" | "Have received 5 or more emails over roughly the last 72 weeks"; "Have never opened or clicked an email from you"; "Have no recorded website visits, product views, started checkouts, or purchases"; "Can receive email marketing and have not had a suppression added in the last 90 days" |
| "Understanding active profile management in Klaviyo", https://help.klaviyo.com/hc/en-us/articles/24263920096027 | 2026-10-29 | Un segmento de inactividad armado a mano | "Created is at least 180 days ago" | Recibió al menos 5 mails en las últimas 72 semanas; cero Opened Email, Clicked Email, Active on Site, Viewed Product, Checkout Started y Placed Order en todo el historial |

- El default de TierSaver (`packages/core/src/rules.ts`, `newProfileDays: 365`) coincide con el primer artículo, que es el que seguimos. Por eso el sitio puede seguir diciendo que TierSaver sigue "the criteria Klaviyo publishes for suppressing unengaged profiles", con 365 días. Nunca "recommended" ni "recommends" en texto público.
- Los 180 días del segundo artículo no se mencionan en páginas públicas, salvo en una guía que compare los dos, y ahí cada número va atribuido a su artículo (hoy: `site/src/pages/guides/klaviyo-list-hygiene.html`). El piso del modo ampliado (`RULE_LIMITS.newProfileDays.min`, 180) coincide con ese segundo artículo.

**Klaviyo no publica ningún plazo para que se actualice el conteo de perfiles activos.**

- El artículo 24312135764251 solo dice "Processing may take a few moments" y "may take some time". El 24263920096027 tampoco da un plazo.
- La cifra "hasta 72 horas", que estaba en el sitio, en la app y en `00-HANDOVER.md`, venía de un blog de agencia, no de Klaviyo. Se quitó del sitio el 2026-11-26. Lo que se dice ahora: Klaviyo actualiza su conteo según su propio calendario y lo revisa poco antes de que se renueve el ciclo de facturación (esto último sale de https://help.klaviyo.com/hc/en-us/articles/4405883690651, cita en 1.2).
- Pendiente fuera del sitio: `00-HANDOVER.md` ("Por qué existe", tercer punto) todavía dice 72 horas; cambiarlo es de Facundo o de la sesión principal.

**Cómo citar el efecto en el plan, con las palabras de Klaviyo.**

- Los suprimidos "do not count toward your email plan's active profile limit" (24312135764251); "do not contribute towards your email plan's active profile count" (24263920096027).
- "Advanced KDP billing is based on total profiles, including suppressed profiles" (24312135764251). En el sitio: en Advanced KDP los suprimidos siguen contando para su total. No más "can still count".
- Suprimir "will not automatically change the Email subscription plan on your account" (24312135764251), y "a lower active profile count does not necessarily lower your bill" (24263920096027).

### 1.3 La lectura más plausible

A Klaviyo le corresponde cobrar por los perfiles a los que el cliente puede escribir. Si el merchant renuncia de verdad a escribirle a un perfil inactivo, Klaviyo dice por escrito que ese perfil no se cobra: ahí no hay un cargo "otherwise entitled" que se esté evitando. La cláusula apunta a quien conserva el beneficio (poder escribirles) sin pagarlo.

No encontré en la ayuda ninguna frase que nombre el "juego" de suprimir y reactivar alrededor del corte. Lo que hay es el mecanismo que lo limita:

> "Once a profile is manually suppressed, if that same profile becomes unsuppressed, it cannot be manually suppressed again until 90 days after the previous suppression. This rule is inactive for the first 30 days after a new account is created."

https://help.klaviyo.com/hc/en-us/articles/24312135764251 (actualizado el 2026-10-27, leído el 2026-11-25)

Esto corrige `docs/STATUS.md` (duda 7): los 90 días se cuentan desde la supresión anterior, no desde la reactivación.

**Del lado equivocado (no hacer nunca, ni facilitar):**

- Suprimir antes del chequeo de renovación y reactivar después, en cualquier variante, automática o sugerida.
- Suprimir perfiles a los que el merchant piensa seguir escribiendo (compradores, gente que abre o hace clic).
- Seguir escribiéndoles a los suprimidos por otra vía: otro proveedor, otra cuenta de Klaviyo, mails "transaccionales" con contenido de marketing. La AUP además prohíbe "Waterfalling or list cleaning across multiple email or mobile messaging service providers".
- Ocultar perfiles activos: quitarles el mail y reponerlo, moverlos a otra cuenta, repartir la lista en cuentas gratis.
- Criterios más agresivos que los de Klaviyo con el fin declarado de llegar a un tramo ("te faltan 300 perfiles para bajar, aflojá las reglas").

**Del lado correcto:**

- Supresión permanente de perfiles sin actividad sostenida, con criterios iguales o más estrictos que los publicados por Klaviyo, aprobada por el merchant.
- Hacerlo de forma periódica y terminarlo antes de la renovación para que el conteo lo refleje.
- Informar el efecto en el plan, y que la baja de plan la haga el merchant (auto-downgrade o cambio manual).

### 1.4 Términos de la API

> "You may charge for your Integration; however, you may not sell, rent, lease, sublicense, redistribute, or syndicate access to any of our APIs. We may terminate your access to our APIs at any time for any reason."

> "We reserve the right to revoke your access to the APIs without prior notice if we determine your use violates the API Terms or our Terms of Service or is otherwise objectionable as determined in our sole discretion."

https://www.klaviyo.com/legal/api-terms (versión del 12 de noviembre de 2026, leída el 2026-11-25)

Cobrar por la integración está permitido. La revocación no necesita causa. Otras cláusulas que tocan a TierSaver:

> "In addition, you shall not [...] access or use the APIs to: (i) design or develop a competitive or substantially similar product or service; (ii) copy or extract any features or functionality thereof; [...] (vii) parse or scrape any of Klaviyo's data; in each case other than as explicitly permitted by Klaviyo in writing."

https://www.klaviyo.com/legal/api-terms (leída el 2026-11-25)

- (i) y (ii): Klaviyo ya tiene "Suppress inactive profiles" y recomendaciones de supresión. TierSaver automatiza una función nativa. Es un segundo motivo posible, independiente del de la factura. Riesgo bajo a medio: casi todas las apps del ecosistema extienden funciones nativas.
- (vii) y los términos del sitio: la tabla de precios se leyó del slider de klaviyo.com/pricing con navegador headless (`packages/core/src/price-tables/klaviyo.ts:5-16`) y está previsto refrescarla cada mes. Los términos del sitio prohíben "Use any robot, spider, or other automatic device, process, or means to access the Website for any purpose, including monitoring or copying any of the material on the Website" (https://www.klaviyo.com/legal/website-terms-of-use, versión del 3 de octubre de 2024, leída el 2026-11-25). Las páginas de esta investigación también se leyeron por medios automáticos; Klaviyo publica `llms.txt` y versiones Markdown para lectura por agentes, así que la lectura puntual de documentación parece tolerada. Un refresco mensual automatizado de precios, como parte del producto, no lo está con claridad: que lo haga una persona.
- Obligaciones concretas: acuerdo de usuario y política de privacidad propios y visibles; permiso expreso antes de entrar a la cuenta; borrar los datos del usuario "immediately" si lo pide o cierra su cuenta; coordinar con Klaviyo cualquier comunicado ante un incidente; Klaviyo puede auditar la integración; indemnidad a favor de Klaviyo; responsabilidad de Klaviyo limitada a US$ 100; ley de Massachusetts.

### 1.5 Términos de servicio del cliente

El merchant responde por lo que haga una app en su cuenta:

> "Klaviyo is not responsible for any disclosure, modification or deletion of Customer Data resulting from access by such Non-Klaviyo Services or its Provider."

https://www.klaviyo.com/legal/terms-of-service (versión del 17 de diciembre de 2025, sección 3.4, leída el 2026-11-25)

La sección 4.3 permite suspender la cuenta del merchant si Klaviyo determina "in its reasonable discretion" que se usa "in an unauthorized, inappropriate, or fraudulent manner". El riesgo no es solo de TierSaver: un merchant podría perder su cuenta. Eso obliga a ser estrictos.

### 1.6 Marketplace y programa de partners

Una app OAuth funciona sin estar listada, con una advertencia:

> "Until your app has been reviewed and approved by our team, users will receive an OAuth installation warning that your app has not been reviewed by Klaviyo."

> "Note that not all submitted apps will be approved. Klaviyo reserves the right to not list your app for any reason."

https://developers.klaviyo.com/en/docs/submit_your_app_for_review (leído el 2026-11-25)

Requisitos de listado relevantes (https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements, leído el 2026-11-25): "at least 5 installs with demonstrated Production level API activity"; "the least permissive scope set possible"; "App listings should not imply endorsement by Klaviyo without formal, written approval"; términos y política de privacidad enlazados; MFA, cifrado en reposo con AES-256 y "Logs must be retained for a minimum of 365 days". La página abre con: "We list apps that drive efficiency and revenue by delivering incremental improvements to existing customer workflows." Entre las categorías de listado no hay una de higiene de lista; la más cercana es "Workflow automation".

Listarse implica firmar el Technology Partner Agreement, que agrega dos ganchos amplios:

> "Company agrees not to [...] (e) use the Klaviyo APIs to develop any products or services similar to or competing with the Klaviyo Services"

> "You shall not engage in any deceptive, misleading, illegal or unethical marketing activities, or activities that otherwise may be detrimental to us, our customers, or to the public."

https://www.klaviyo.com/legal/technology-partner-agreement (versión del 13 de noviembre de 2025, secciones 2.g y 10.e, leída el 2026-11-25)

Una app que cobra un porcentaje de lo que Klaviyo deja de facturar encaja con facilidad en "detrimental to us".

### 1.7 Marca

> "You may not use the Klaviyo brand or marks outside of what is expressed in our Newsroom. [...] You may not use the Klaviyo brand in any way that suggests that Klaviyo sponsors, endorses, or associates with your Integration without prior written consent."

https://www.klaviyo.com/legal/api-terms (leída el 2026-11-25)

El Newsroom (https://www.klaviyo.com/newsroom, leído el 2026-11-25) no muestra pautas de uso de marca ni un kit descargable; no encontré una guía de marca para terceros. Lectura prudente: el nombre "Klaviyo" solo como texto descriptivo de compatibilidad; nada de logo, tipografía ni colores de Klaviyo; nada de "official", "certified", "recommended" ni "partner".

### 1.8 Datos personales

El DPA de Klaviyo regula a Klaviyo como encargado del merchant; TierSaver no es parte. Si TierSaver entra al programa de partners rige el Partner Data Protection Addendum ("independent controllers"). Frente al merchant, TierSaver es su encargado y necesita política de privacidad y condiciones de tratamiento propias. Hay una tensión a resolver: Klaviyo pide logs por 365 días para listarse, y a la vez borrar los datos del usuario de inmediato; Shopify exige borrar al desinstalar. Salida: logs operativos sin datos personales (IDs internos, conteos, endpoints), y borrado de todo lo demás.

### 1.9 Shopify

Todo leído en https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements el 2026-11-25.

- **(a) Precio como porcentaje de un ahorro.** No hay regla que lo prohíba. Lo que se exige es cobrar por Shopify (requisito 1.2) e información "accurate and complete" de precios, solo en la sección de precios (4.2).
- **(b) Afirmaciones.** Requisito 4.3.3: "Do not use any statistics or data in your app's listing content, overview of the app, and/or app introduction. This includes verifiable and unverifiable information." Y sin garantías. Ningún "save $125" ni porcentaje en el texto, el subtítulo o las imágenes de la ficha.
- **(c) Nombre.** Requisito 4.1.2: "Every app must have its own unique, recognizable name that leads with your distinctive brand identifier. Your app's name must not be identical or confusingly similar to another app, developer, brand, or Shopify product." "TierSaver for Klaviyo" empieza con marca propia. Las fichas existentes usan el mismo patrón ("ListSweep: Klaviyo Cleaner", "ShopiDeck: Klaviyo Bot Cleaner").
- **(d) Datos protegidos.** Leer mails de clientes es nivel 2: pedir el acceso por campo, cumplir los requisitos de nivel 1 y 2 y pasar la revisión de protección de datos. "Process only the minimum personal data required to provide app functionality to merchants" (https://shopify.dev/docs/apps/launch/protected-customer-data, leído el 2026-11-25). Guardar solo hashes va en esa línea.

### 1.10 Cómo se describen las apps comparables (evidencia, no prueba)

- **ListSweep: Klaviyo Cleaner** (https://apps.shopify.com/listsweep, leído el 2026-11-25; lanzada el 14 de septiembre de 2026, 0 reseñas, plan gratis y Pro a US$ 7 por mes): "Find profiles that never open, click, or buy — suppress them so they stop inflating your bill." Promete "See your estimated Klaviyo bill saving before you suppress anything" y "Sweeps can run on a recurring schedule automatically."
- **ShopiDeck: Klaviyo Bot Cleaner** (https://apps.shopify.com/shopideck-klaviyo-botcleaner, leído el 2026-11-25; 0 reseñas, auditoría gratis y planes desde US$ 9 por mes): "suspicious profiles that may inflate Klaviyo contact counts", con "estimated savings".
- **Nae: Ghost Profile Auditor**: no apareció en la búsqueda del App Store ni en las direcciones probadas.

Conclusión: Shopify aprueba fichas que hablan de la factura de Klaviyo. Eso no dice nada sobre Klaviyo: son apps de semanas o meses, sin reseñas, y no sabemos si Klaviyo las miró. Ninguna cobra un porcentaje del ahorro y ninguna anuncia reactivación.

## 2. Dónde está expuesto el diseño actual

### 2.1 Precio como porcentaje del ahorro — el punto más expuesto

- Convierte el ingreso de TierSaver en una fracción de lo que Klaviyo deja de cobrar. Es la mejor prueba posible de que el producto está "designed to" reducir cargos, y encaja en "detrimental to us".
- Alinea el incentivo de TierSaver con suprimir más, contra la regla de producto "defaults conservadores".
- Obliga a pedir `usage:read` para calcular el cargo. En la revisión de Klaviyo hay que declarar el uso de cada scope; "leemos tu facturación para cobrar nuestra parte de lo que dejaste de pagarle a Klaviyo" es la peor frase posible en ese formulario.
- Archivos: `docs/00-HANDOVER.md:26`, `docs/04-PRECIO-Y-COBRO.md:7-10`, `CLAUDE.md:3` y `:23`, `packages/core/src/charge.ts`, `packages/core/src/savings.ts`, `site/src/calculator/estimate.ts`.

### 2.2 El nombre

"TierSaver" significa "el que te ahorra un tramo". No infringe nada, pero contradice el posicionamiento de higiene y le ahorra trabajo a quien quiera leer el producto como evasión. `docs/03-MARCA.md:10` y `brand/messaging.md:10` además exigen que el subtítulo y el primer titular digan "Klaviyo bill", y `docs/03-MARCA.md:92` pide un logo que sugiera bajar un escalón: van en sentido contrario a la decisión A.

### 2.3 Sincronizar con la fecha de facturación

El hecho en sí está avalado por la ayuda de Klaviyo (1.2). La exposición está en dos cosas: presentarlo como la propuesta de valor ("right before your billing date") y combinarlo con reactivación. Suprimir justo antes del chequeo solo es defendible si esos perfiles no vuelven.

### 2.4 Programación

Correr todos los meses es lo que Klaviyo llama "manage your active profiles on an ongoing basis". El modo automático sin aprobación (`docs/01-PRD.md:55`) es aceptable para Klaviyo; el cuidado es que use solo los criterios más estrictos.

### 2.5 Reactivación por compra o checkout

`docs/01-PRD.md:59`, `docs/02-ARQUITECTURA.md:59`. Klaviyo documenta lo contrario como comportamiento normal:

> "Once a profile is suppressed, even if that contact starts a checkout on your website or makes a purchase, they will remain suppressed and ineligible to receive any marketing emails."

> "A manual suppression can be removed when a profile resubscribes to email marketing or when you remove it manually."

https://help.klaviyo.com/hc/en-us/articles/24263920096027 (leído el 2026-11-25)

Problemas:

- Es un ciclo suprimir/reactivar ejecutado por la app. Sube el conteo facturable, así que no evade nada en sí mismo, pero junto con una supresión mensual es el patrón que la regla de 90 días limita.
- "Inicia checkout" no es una señal suficiente para volver a hacer contactable a alguien.
- Reactivar no registra consentimiento. Quien compra sin aceptar marketing vuelve a ser contactable con su estado anterior.
- Si los criterios pasan a ser los de Klaviyo (nunca compró), el caso se achica: el que compra y acepta marketing se vuelve a suscribir por el flujo normal, y eso levanta la supresión manual. Falta verificar en la cuenta de prueba que la sincronización de consentimiento de Shopify cuente como resuscripción.

### 2.6 Deshacer

`docs/01-PRD.md:64`. Es corrección de errores y Klaviyo ofrece lo mismo ("Bulk unsuppress"). Se vuelve un problema solo si se puede usar como reactivación masiva después de la renovación.

### 2.7 Reglas por defecto más laxas que las de Klaviyo

`packages/core/src/rules.ts:28-35` (defaults) y `:39-46` (mínimos).

| Señal | Recomendaciones de supresión de Klaviyo | TierSaver por defecto | Mínimo que TierSaver acepta |
| --- | --- | --- | --- |
| Antigüedad del perfil | Creado hace 365 días o más | 90 días | 30 días |
| Compras | Ninguna, nunca | Ninguna en 365 días | 90 días |
| Clics | Ninguno, nunca | Ninguno en 180 días | 60 días |
| Aperturas | Ninguna, nunca | Ninguna en 90 días | 30 días |
| Mails recibidos | 5 o más en ~72 semanas | Sin condición | Sin condición |
| Actividad en el sitio | Ninguna, nunca | Ninguna en 180 días | 30 días |

Fuente de la columna de Klaviyo: "Recommended profiles must meet the following criteria: Can receive email marketing and have not had a suppression added in the last 90 days. Were created at least 365 days ago. Have received 5 or more emails over roughly the last 72 weeks. Have never opened or clicked an email from you. Have no recorded website visits, product views, started checkouts, or purchases." (https://help.klaviyo.com/hc/en-us/articles/24312135764251, leído el 2026-11-25). El diálogo de supresión en bloque usa un piso más bajo: mantiene activos a quienes "Have clicked an email or placed an order within the last 182 days".

Con los valores actuales un merchant puede suprimir a alguien que compró hace 91 días. Eso es suprimir gente que no es inactiva para bajar el conteo, y es el caso que Klaviyo leería como violación. La descripción del producto como "nunca compradores" tampoco coincide con el PRD, que protege solo compras de los últimos 365 días (`docs/01-PRD.md:32`).

### 2.8 Textos marcados en el repo

Contradicen la decisión A o la lista de `brand/messaging.md`:

| Archivo:línea | Texto | Problema |
| --- | --- | --- |
| `docs/01-PRD.md:14` | "Stop paying Klaviyo for people who never open." | Promesa centrada en no pagarle a Klaviyo |
| `docs/01-PRD.md:5`, `:10` | "Quiere pagar menos…", "antes del corte de facturación" | Interno, pero define el producto como reducción de factura |
| `docs/01-PRD.md:85` | "You're already in the lowest tier we can get you to." | El objetivo declarado es el tramo |
| `docs/00-HANDOVER.md:5` | "App de Shopify que baja la factura de Klaviyo… antes del corte" | Ídem; contradice la línea 24 del mismo archivo |
| `CLAUDE.md:3` | "…para que el merchant quede en un tramo de precio más bajo. Cobra una parte del ahorro." | Declaración de propósito en la primera línea del repo |
| `docs/03-MARCA.md:10`, `brand/messaging.md:10` | El subtítulo y el titular "tienen que decir 'Klaviyo bill'" | Obliga a encabezar con la factura |
| `docs/03-MARCA.md:27`, `brand/messaging.md:25`, `:32`, `site/styleguide.html:35` | "Klaviyo list hygiene that pays for itself." | La parte destacada es la plata |
| `docs/03-MARCA.md:28`, `brand/messaging.md:26`, `site/styleguide.html:36`, `:76` | "…right before your billing date. …your Klaviyo bill can drop a tier." | Timing contra el corte como promesa |
| `docs/03-MARCA.md:18`, `brand/messaging.md:18` | "suppresses before the billing date, and reactivates anyone who buys again" | Suprimir antes del corte + reactivar, en la misma frase |
| `docs/03-MARCA.md:31`, `brand/messaging.md:19`, `:29`, `site/styleguide.html:74`, `:131`, `:171` | "You only pay when Klaviyo confirms a lower tier." | Ata el cobro a la pérdida de Klaviyo |
| `docs/03-MARCA.md:45`, `brand/messaging.md:64` | "It does not schedule it against your billing date. TierSaver does." | El diferencial declarado es el timing de facturación |
| `docs/07-LANZAMIENTO.md:44` | "Lower your Klaviyo bill by suppressing inactive profiles" | Subtítulo de ficha: exactamente el pitch descartado |
| `docs/07-LANZAMIENTO.md:46`, `:51`, `:54`, `:55` | "shows your savings, and suppresses them before your billing date", "estimated savings in dollars" | Ídem; además roza el requisito 4.3.3 de Shopify |
| `docs/07-LANZAMIENTO.md:57`, `docs/05-GO-TO-MARKET.md:12-13`, `:133-134` | Palabras clave y guías "reduce Klaviyo bill", "Klaviyo cost" | SEO armado sobre bajar la factura |
| `docs/05-GO-TO-MARKET.md:45` | Referencia a la receta "automatically suppress and unsuppress profiles… to optimize costs", con ángulo "producto mantenido en lugar de receta" | Asocia TierSaver con el ciclo suprimir/reactivar |
| `docs/05-GO-TO-MARKET.md:73`, `:75` | "suppress inactive profiles before Klaviyo counts them for the next bill", "re-activates only people who buy again" | Outreach: describe ganarle al conteo |
| `docs/05-GO-TO-MARKET.md:91`, `:101`, `:113`, `:129` | "so brands stop paying for people who never open", "Clients pay 20% of what they save", "schedules suppression against each account's billing date" | Outreach a agencias con el pitch de factura |
| `docs/08-RIESGOS-Y-METRICAS.md:21`, `:28` | "Diferenciarse por timing de facturación", "Subtítulo explícito con 'Klaviyo bill'" | Estrategia interna contraria a la decisión A |
| `site/src/calculator/estimate.ts:198`, `:213` | "Your list would move down a tier.", "your Klaviyo bill would not change. You would not be charged." | Calculadora pública de ahorro |

Durante esta investigación otra sesión agregó la landing (`site/index.html`, generada desde `site/src/pages/index.html`; todavía sin commit, las líneas pueden moverse). Repite los mismos textos y suma otros:

| Archivo:línea | Texto | Problema |
| --- | --- | --- |
| `site/index.html:6`, `:55`, `:56` | Título y hero: "list hygiene that pays for itself", "right before your billing date… your Klaviyo bill can drop a tier" | Igual que el borrador de mensajes |
| `site/index.html:101-102`, `:237-245`, `:344` | "You only pay when Klaviyo confirms a lower tier.", "20% of the confirmed saving, capped at $149 a month" | Publica el modelo de porcentaje del ahorro |
| `site/index.html:148-149` | "Run it ahead of your billing date… schedules it 5 days before your Klaviyo billing date" | Timing contra el corte como función |
| `site/index.html:80`, `:205-227`, `:255-272` | Calculadora y ejemplos "Estimated saving $125/mo", "fee 20% of $125" | Calculadora de ahorro como pieza central |
| `site/index.html:303` | "It does not schedule it against your billing date. TierSaver does." | Diferencial declarado: el corte |

Está bien encaminado y conviene conservar: `site/index.html:317-318` explica el efecto en el plan como hecho de Klaviyo y aclara que la baja la decide el merchant.

Sin problema: `shopify/app/routes/_index/route.tsx` sigue siendo la plantilla ("A short heading about [your app]"), y `shopify/shopify.app.toml:4` solo tiene el nombre.

Los documentos internos no los lee Klaviyo, pero definen qué construyen las próximas sesiones: si el PRD dice "pagar menos", el producto sale así.

## 3. Guardarraíles

### 3.1 Reglas de producto a imponer en código

1. **Piso de criterios igual al de Klaviyo, no configurable hacia abajo.** Modo por defecto ("Klaviyo-recommended"): creado hace 365 días o más, 5 o más mails recibidos en 72 semanas, ninguna apertura, clic, visita, vista de producto, checkout ni compra, nunca. Modo ampliado, opt-in y con advertencia: nunca por debajo de 182 días para clic y compra, y de 180 días de antigüedad. Subir los mínimos de `RULE_LIMITS`.
2. **Agregar la condición "recibió mails".** Nadie es inactivo si nunca se le escribió.
3. **Nunca suprimir compradores en el modo por defecto.** Si el merchant quiere incluir compradores viejos, que sea decisión explícita, con ventana mínima de 365 días.
4. **Sin reactivación automática.** Sacarla del MVP. Si se mantiene: solo pedido pagado (nunca checkout iniciado), solo con consentimiento de marketing en ese pedido, apagada por defecto, y el perfil reactivado no vuelve a ser candidato por 365 días.
5. **Deshacer sin puerta giratoria.** Sigue disponible siempre (regla de producto 3), pero si la corrida ya fue contada en una renovación pide confirmación con una advertencia. Los perfiles restaurados quedan fuera de toda corrida por 365 días (hoy `reactivationLockDays` es 90, con máximo 365).
6. **Detector de ciclos.** Si la auditoría encuentra activos, sin compra ni resuscripción, perfiles que TierSaver suprimió, se pausa la programación, se avisa al merchant y esos perfiles no se vuelven a suprimir.
7. **Nada que ayude a escribirles a los suprimidos.** Sin exportar listas de suprimidos, sin sincronizar a otros proveedores. El CSV de simulación es para revisar candidatos antes de aprobar, no después.
8. **La app nunca cambia el plan.** No toca el auto-downgrade ni la facturación; solo explica dónde está la opción.
9. **Sin metas de tramo.** No mostrar "te faltan N perfiles para el tramo siguiente" junto a controles que aflojan reglas. La alerta de tramo de `docs/01-PRD.md:56` puede quedar como aviso de crecimiento, sin llamado a suprimir más.
10. **Scopes mínimos.** `accounts:read`, `profiles:read`, `profiles:write`, `subscriptions:write` (los dos que pide Bulk Suppress), más los de lectura de segmentos, métricas y eventos que la auditoría use de verdad. `usage:read` solo si el reporte lo necesita y nunca para calcular el cargo.
11. **Límites de la API.** Respetar 75/s y 750/m en supresión y 100 segmentos por día; backoff ante 429; nada de varias credenciales para sumar cupo ("You agree not to circumvent any limitations documented with our APIs").
12. **Honrar la revocación.** Ante `invalid_grant`, tratar la cuenta como desinstalada: frenar corridas, avisar y no reintentar. Al desinstalar en Shopify, llamar a `/oauth/revoke`. Desconexión visible dentro de la app (requisito de revisión de Klaviyo).
13. **Sin scraping de precios.** La tabla la actualiza una persona.
14. **Registro.** Bitácora de quién aprobó qué y con qué criterios, sin mails en claro, conservada 365 días.

### 3.2 Reglas de texto

**Se puede decir** (ficha, sitio, app, outreach):

- Qué hace: "Keeps your Klaviyo list clean by suppressing profiles that never engaged, following the criteria Klaviyo publishes for suppressing unengaged profiles." (Corregido el 2026-11-26: los requisitos de ficha de Klaviyo no permiten juntar su nombre con "recommended".)
- Cómo protege: simulación, aprobación, registro, nada se borra.
- El efecto en el plan, como hecho citado de Klaviyo y en segundo plano: "Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, you can move to a lower plan in Klaviyo's billing settings."
- "Runs monthly and finishes before your plan renews, so Klaviyo's count is up to date."

**No se puede decir:**

- "Stop paying Klaviyo…", "Lower / reduce / cut your Klaviyo bill" como titular, subtítulo o palabra clave principal.
- "right before your billing date", "before Klaviyo counts them", "against your billing date".
- "pays for itself", "You only pay when Klaviyo confirms a lower tier", "we take 20% of what you save".
- Suprimir y reactivar en la misma promesa.
- Cifras, porcentajes o garantías de ahorro en la ficha de Shopify (requisito 4.3.3). En el sitio, solo como estimación a partir de datos del merchant.
- "official", "certified", "recommended by", "Klaviyo partner", el logo de Klaviyo.
- Comparaciones que dejen mal a Klaviyo ("Klaviyo charges you for dead profiles").

La calculadora pública de ahorro es el activo de marketing más comprometido. Alternativa: "list health check" que muestra cuántos perfiles cumplen los criterios de Klaviyo y, como dato secundario, en qué plan caería ese conteo.

### 3.3 Alternativas para el precio

| Opción | Cómo es | Cuánto baja la exposición |
| --- | --- | --- |
| A. Actual | 20% del ahorro verificado, tope US$ 149 | Nada. Es la referencia |
| B. Tramos fijos por tamaño de lista | US$ 29 / 79 / 149 según perfiles activos (plan B de `docs/04-PRECIO-Y-COBRO.md:53`) | Mucho. Corta el vínculo entre el ingreso de TierSaver y la pérdida de Klaviyo, saca `usage:read` del cobro y es el modelo de las apps comparables. Queda el riesgo de fondo de la actividad |
| C. Fijo + garantía | Tramos fijos, y el mes sin ninguna supresión no se cobra | Casi lo mismo que B. Conserva algo de "si no sirve, no pagás" sin medir la factura de Klaviyo |
| D. Por perfil suprimido | Centavos por perfil | Poco. Ya no depende de la factura, pero premia suprimir más |
| E. Porcentaje con otro nombre | "Success fee", "performance pricing" | Nada. Mismo mecanismo |

**Recomendación: C.** Auditoría gratis; tramos fijos por tamaño de lista cobrados con suscripción común; el mes en que no hay corrida no se cobra. Cuesta dos cosas: la regla "si no hay ahorro, no se cobra" (`CLAUDE.md:23`) pasa a ser "si no hay limpieza, no se cobra", y se pierde el argumento de venta sin riesgo. Ventaja lateral: con precio fijo se puede usar Shopify App Pricing, el camino preferido por Shopify.

**Nombre.** Opciones: (1) mantener "TierSaver for Klaviyo" y asumir que el nombre contradice el posicionamiento; (2) mantener la marca y cambiar el descriptor a "TierSaver: List Hygiene for Klaviyo"; (3) cambiar la marca por una de higiene. Con el precio B o C, la opción 2 es razonable y barata. Con el precio actual, nombre más precio juntos son difíciles de defender. Cambiar el nombre después del lanzamiento cuesta mucho más que ahora.

Las dos decisiones son de Facundo. No se aplicó ninguna.

**Estado al 2026-11-26.** Facundo decidió el precio dos veces después de este análisis: el 2026-11-25, cargo fijo por limpieza (variante de C, US$ 15 / 29 / 79 / 149); el 2026-11-26, **plan mensual fijo por tamaño de lista** (variante de B): US$ 9 / 19 / 39 / 79 por mes hasta 10.000 / 25.000 / 75.000 / 150.000 perfiles activos, gratis hasta la primera limpieza, cobrado por Shopify cada 30 días hasta que el merchant lo cancela. Para la exposición frente a Klaviyo vale lo dicho de B: el ingreso no depende de la factura de Klaviyo ni de cuántos perfiles se suprimen. Lo que se pierde respecto de C es "el mes sin limpieza no se cobra"; la regla de producto 6 pasó a ser "gratis hasta la primera limpieza" (`CLAUDE.md`, `00-HANDOVER.md`). El nombre quedó en la opción 2.

## 4. Cobertura operativa

### 4.1 Términos propios y avisos en la app

En los términos de servicio de TierSaver:

- El merchant es responsable de su cuenta de Klaviyo, de su plan y de cumplir los términos de Klaviyo. TierSaver actúa por instrucción suya, con las aprobaciones registradas.
- TierSaver no garantiza ahorro ni cambio de plan. El plan lo cambia el merchant en Klaviyo.
- TierSaver no está afiliada a Klaviyo ni cuenta con su aval. "Klaviyo" es marca de Klaviyo, Inc.
- El servicio depende de la API de Klaviyo y puede dejar de funcionar si Klaviyo cambia la API o los términos, o revoca el acceso, sin responsabilidad de TierSaver más allá de dejar de cobrar.
- Uso prohibido: reactivar en masa después de la renovación, usar la app para seguir escribiéndoles a los suprimidos por otra vía. TierSaver puede suspender la cuenta que lo haga.
- Limitación de responsabilidad por ventas perdidas a causa de supresiones aprobadas por el merchant.
- Política de privacidad con qué datos se leen, para qué, dónde se guardan y cuándo se borran. Es obligación de los API Terms y de Shopify.

En la app, antes de la primera aprobación y resumido antes de cada corrida:

- "Suppressed profiles can no longer receive marketing email from you, even if they later buy."
- "Unsuppressing a profile blocks suppressing it again for 90 days."
- "Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo."
- "TierSaver is not affiliated with or endorsed by Klaviyo."

### 4.2 Acercarse a Klaviyo

Recomendación: sí, después de cambiar precio y criterios.

1. **Revisión del marketplace como aprobación de hecho.** Al llegar a 5 instalaciones con actividad real, enviar la app a revisión describiendo el caso de uso sin eufemismos. Si la aprueban, hay un antecedente escrito de que Klaviyo vio el producto. Si la rechazan, se sabe con 5 clientes y no con 200. Un listado no impide una revocación posterior.
2. **Consulta escrita antes.** Los API Terms indican legal@klaviyo.com para dudas. Un mail corto que pregunte si una app que automatiza la supresión de inactivos con los criterios de la ayuda es compatible con la AUP. Riesgo: llamar la atención y recibir un no; es preferible a enterarse por una revocación. Queda como borrador para que lo envíe Facundo.
3. **Programa de partners.** Solo después del listado. Suma obligaciones (código de conducta, "detrimental to us") sin dar protección adicional.

Enviar a revisión, escribirle a Klaviyo y aceptar el Technology Partner Agreement son frenos de `CLAUDE.md`: los hace Facundo.

### 4.3 Qué monitorear

- Mensual: fecha "Updated" de la AUP, los API Terms, los términos de servicio y el Technology Partner Agreement; los artículos 24263920096027, 24312135764251, 4405883690651 y 115000976672 de la ayuda; klaviyo.com/whats-new.
- Señales de Klaviyo: mails de app.marketplace@klaviyo.com o de legal, `invalid_grant` en varias cuentas a la vez, errores 403 nuevos, cambios en los endpoints de supresión o en la regla de 90 días.
- Señales propias: tasa de deshacer, perfiles reactivados a mano por merchants, merchants con reglas en el mínimo, tickets que pregunten cómo reactivar después del corte.
- Si Klaviyo lanza supresión programada nativa: el producto queda redundante, además de "substantially similar".

### 4.4 Contingencia si revocan el acceso

- Mismo día: frenar corridas y cargos, cancelar las suscripciones de Shopify, avisar a todos los merchants con un texto preparado. Los perfiles quedan suprimidos y se manejan desde Klaviyo; no hace falta reactivar nada.
- Escribir a Klaviyo para pedir el motivo y qué habría que cambiar. No crear otra app ni otra cuenta para volver a entrar: sería esquivar la revocación.
- Modo degradado que no usa la API: guía paso a paso para armar el segmento de inactividad y usar "Suppress inactive profiles" a mano, con recordatorio antes de la renovación. Vale mucho menos.
- Diseño previo: el motor de reglas y de corridas con el proveedor detrás de una interfaz (ya hay un gateway en `shopify/app/runs/gateway.server.ts`), para que la extensión a otro proveedor no sea reescribir todo.
- Financiero: no comprometer gastos fijos que dependan de este ingreso mientras exista un solo proveedor que puede cortarlo sin aviso.

## 5. Riesgo residual

Lo que sigue incierto después de todo esto:

- **Discreción de Klaviyo.** "At any time for any reason" no se mitiga con diseño. Con precio fijo, criterios de Klaviyo, sin reactivación y textos de higiene, la probabilidad estimada de una revocación dirigida es baja; es una estimación mía, sin datos de casos reales.
- **Interés comercial de Klaviyo.** El cambio de facturación de 2025 buscó cobrar por todos los perfiles activos. Una app que crezca y baje de tramo a miles de cuentas afecta ingresos aunque cumpla la letra. El riesgo sube con el éxito.
- **No hay precedente publicado** de Klaviyo aplicando la cláusula de cargos a una app o a un cliente. No pude leer la comunidad ni el marketplace de Klaviyo.
- **La cláusula de producto similar** depende de si Klaviyo decide automatizar la supresión.
- **Shopify**: no pude leer el Partner Program Agreement ni los términos de la API (están en shopify.com).

Preguntas donde una hora de abogado todavía vale la pena:

1. **Si se mantiene el 20% del ahorro:** ¿expone a TierSaver a algo más que la revocación? TierSaver acepta los API Terms (indemnidad, ley de Massachusetts) y los merchants tienen contrato con Klaviyo; un esquema que cobra por reducirle ingresos a la otra parte de ese contrato merece que un abogado de EE.UU. mire el riesgo de un reclamo por interferencia contractual o incumplimiento. Con precio fijo esta pregunta casi desaparece.
2. **En cualquier caso:** revisión de los términos de servicio y la limitación de responsabilidad de TierSaver frente a merchants (ventas perdidas por una supresión, cuenta de Klaviyo suspendida). Es una revisión de plantilla, no una opinión sobre Klaviyo.

Si se adoptan el precio fijo y los guardarraíles de la sección 3, la consulta 1 deja de ser necesaria y la 2 es recomendable pero no urgente. Si se mantiene el modelo actual, la consulta 1 es necesaria antes de lanzar.

## Fuentes leídas

Todas el 2026-11-25. "Completa" significa el texto entero; "por secciones", las partes indicadas más búsqueda por términos en el resto.

Klaviyo, legales:
- Acceptable Use Policy (9 de abril de 2026), completa: https://www.klaviyo.com/legal/acceptable-use-policy
- API Terms of Use (12 de noviembre de 2026), completa: https://www.klaviyo.com/legal/api-terms
- Terms of Service (17 de diciembre de 2025), completa: https://www.klaviyo.com/legal/terms-of-service
- Technology Partner Agreement (13 de noviembre de 2025), secciones 2, 3, 8, 9 y 10 completas; 1, 4, 5, 6 y 7 parciales: https://www.klaviyo.com/legal/technology-partner-agreement
- Website Terms of Use (3 de octubre de 2024), sección de usos prohibidos: https://www.klaviyo.com/legal/website-terms-of-use
- Data Processing Agreement (11 de septiembre de 2026) y Partner Data Protection Addendum (12 de septiembre de 2022), solo búsqueda por términos: https://www.klaviyo.com/legal/data-processing-agreement y https://www.klaviyo.com/legal/partner-data-protection
- Intellectual Property Notices (22 de enero de 2025): https://www.klaviyo.com/legal/intellectual-property-notices
- Newsroom: https://www.klaviyo.com/newsroom
- How Klaviyo pricing works: https://www.klaviyo.com/platform/how-klaviyo-pricing-works

Klaviyo, desarrolladores:
- App listing requirements, completa: https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements
- Submit your app for review, Pass your app review, Create a public OAuth app, Set up OAuth (por secciones): https://developers.klaviyo.com/en/docs/submit_your_app_for_review , /pass_your_app_review , /create_a_public_oauth_app , /set_up_oauth
- Referencia de Bulk Suppress Profiles, Bulk Unsuppress Profiles y List Billing Usage: https://developers.klaviyo.com/en/reference/bulk_suppress_profiles , /bulk_unsuppress_profiles , /list_billing_usage

Klaviyo, ayuda:
- Understanding active profile management (completa): https://help.klaviyo.com/hc/en-us/articles/24263920096027
- How to manage email suppressions and delete profiles in bulk (completa): https://help.klaviyo.com/hc/en-us/articles/24312135764251
- How Klaviyo billing works; How to choose your upgrade preference; FAQ: Feb 18 billing changes; FAQ: Feb 18 appreciation discount; How to add or change a plan; Understanding your account usage (por secciones): artículos 115000976672, 4405883690651, 33136281415451, 33734334633627, 8356575957275, 17543571835675
- Understanding suppressed email profiles; How to create a sunset flow; How to clean your email list; Understanding third-party apps (por secciones): artículos 115005246108, 360017518492, 360044054732, 360049626051
- Índice completo de la ayuda (`llms.txt`) y cinco búsquedas sobre reactivar, volver a suprimir y ciclo de facturación

Shopify:
- App Store requirements (secciones 1 y 4; el resto por términos): https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Work with protected customer data (por secciones): https://shopify.dev/docs/apps/launch/protected-customer-data
- Fichas: https://apps.shopify.com/listsweep y https://apps.shopify.com/shopideck-klaviyo-botcleaner ; once búsquedas en apps.shopify.com

## No se pudo leer

- **marketplace.klaviyo.com** (directorio de apps de Klaviyo) y **connect.klaviyo.com**: hosts bloqueados. No se pudo ver si existe alguna app de higiene de lista listada por Klaviyo, que sería la mejor evidencia de tolerancia.
- **Pautas de marca de Klaviyo para terceros**: los API Terms remiten al Newsroom, que no muestra ninguna. No encontré otra página.
- **Security Standards y Program Guide** del programa de partners: el acuerdo los enlaza y no pude seguirlos.
- **Partner Code of Conduct** de Klaviyo: descargado, no analizado.
- **Shopify Partner Program Agreement, API License and Terms of Use y pautas de marca de Shopify**: están en www.shopify.com, host bloqueado.
- **Nae: Ghost Profile Auditor**: no figura en la búsqueda del App Store; no pude confirmar si sigue publicada.
- **Comunidad de Klaviyo, foros y blogs de terceros**: fuera de los hosts permitidos. No hay evidencia, a favor ni en contra, de casos reales de aplicación de la cláusula.
- **Un enunciado de Klaviyo sobre suprimir y reactivar alrededor del corte**: lo busqué en la ayuda y no existe más allá de la regla de 90 días.
