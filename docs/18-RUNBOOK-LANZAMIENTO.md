# Runbook de lanzamiento

Escrito el 2026-11-26 (jueves). Documento interno. Es la lista única y ordenada para pasar de "código listo, cero usuarios" a "un merchant real instala y limpia". No agrega funciones.

Toda afirmación sobre una plataforma lleva su fuente entre corchetes (lista al final, todas leídas el 2026-11-26). **"Sin verificar"** quiere decir que la página oficial no lo dice o que no se pudo abrir desde esta sesión. Las páginas se leyeron con un extractor que resume: las frases entre comillas son textuales; el resto es paráfrasis.

## 0. Lo que hay que saber antes de leer el resto

1. **Ningún merchant real puede instalar la app antes de que Shopify la apruebe.** La distribución pública exige aprobación ("Approval required: Yes") [S1]. La distribución personalizada sirve para una sola tienda o una organización Plus, no puede cobrar por Shopify y no se puede cambiar después [S1, S2]. Por eso **el camino crítico es la revisión de Shopify**, y el outreach previo a la aprobación consigue conversaciones y lista de espera, no instalaciones.
2. **"Play" no es el 5 de diciembre.** El 5 de diciembre se puede mover el dominio. Recién con dominio, casillas y legales firmes se puede enviar a revisión. La documentación de Shopify no da plazo de revisión [S5, S6]; respuestas del personal de Shopify en su foro hablan de unos 30 días (dato visto solo en el índice del buscador, **sin verificar**). Estimación honesta: **publicación en enero de 2027**, si no hay rechazo.
3. **Lo más lento se puede empezar hoy**, sin dominio: abogado, elegir distribución pública, pedir `read_all_orders`, guardar el formulario de datos protegidos, probar el cobro, separar prueba y producción, elegir proveedor de casilla.
4. **Sin `read_all_orders` aprobado la app no le sirve a nadie**: una tienda real da cero candidatos. Ese pedido va primero y se espera su aprobación antes de enviar la app a revisión.

## 1. Respuestas verificadas

### 1.1 ¿Se puede instalar una app pública antes de la aprobación? Opciones para las primeras 5 a 10 tiendas

| Opción | Qué dice la documentación | ¿Sirve para TierSaver? |
| --- | --- | --- |
| Instalar la app pública en borrador en tiendas reales (link directo) | La app pública nace en estado Draft y requiere aprobación [S1, S6]. La ayuda de partners dice de las tiendas de transferencia a clientes: "Custom and draft apps can't be installed" [S7]. Ninguna página oficial describe un link de instalación para apps sin aprobar (la que se buscó, `/distribution/install-links`, da 404). Respuestas del personal de Shopify en el foro dicen que una app pública en borrador solo se instala en tiendas de desarrollo de la propia organización (**sin verificar**: el foro no se pudo abrir, se leyó por el índice del buscador) | **No.** No hay instalaciones reales antes de la aprobación |
| Tiendas de desarrollo | Sirven para probar; "Dev stores are for development and testing only" [S8]. Los datos protegidos funcionan ahí apenas se guarda el pedido [S4] | Solo para pruebas propias, capturas y el video |
| Distribución personalizada (custom) | "Installed on a single Shopify store, on multiple stores that belong to the same Plus organization"; "Can't charge merchants through Shopify's app billing system"; "You can't change the distribution method after you select it" [S1]. Desde el 2026-11-20 una app custom necesita una lista de IP permitidas para instalarse en tiendas fuera de la organización [S2] | **No.** Habría que registrar una app aparte por tienda, sin cobro, y Workers no tiene IP de salida fija. Es trabajo nuevo y no escala |
| Pública con visibilidad limitada, **después** de aprobada | Toda app aprobada tiene ficha; se elige "Limit visibility" o "Make fully visible" y se puede cambiar cuando se quiera. Las dos se instalan desde la URL de la ficha; la limitada no aparece en categorías, búsqueda del App Store ni buscadores [S9, S10] | **Sí, es la opción de beta.** Publicar con visibilidad limitada, sumar las primeras 5 a 10 tiendas por link directo y pasar a visibilidad completa cuando el flujo esté probado con datos reales |

Conclusión: **enviar a revisión cuanto antes y salir con visibilidad limitada.** La visibilidad limitada no evita la revisión (respuesta del foro, sin verificar; coherente con [S1]).

### 1.2 Requisitos del envío a Shopify y plazos

- **Límite de envíos**: una sola app nueva en revisión por organización [S5]. No afecta: la organización no tiene otras.
- **Datos protegidos de clientes** [S4]: nivel 1 = datos de clientes sin nombre, dirección, teléfono ni mail; nivel 2 = cuando se usa alguno de esos cuatro campos, y cada campo se pide por separado. TierSaver necesita **nivel 2, solo el campo Email** (lee el mail de los pedidos). Se pide en Dev Dashboard → Apps → la app → Settings → Access requests → "Protected customer data" → Manage. **Hay que elegir antes el método de distribución.** "Applying for protected customer data isn't possible while the app is under review" [S5]: se guarda **antes** de enviar. La página no dice si se aprueba antes o junto con la revisión de la app, ni cuánto tarda (**sin verificar**); el orden de sus pasos es guardar el pedido y después "Submit your app for review". En tiendas de desarrollo el dato se puede leer apenas se guarda el pedido; en tiendas reales la API no devuelve nada hasta la aprobación [S3, S4].
- **`read_all_orders`** [S3]: por defecto `read_orders` cubre "orders created within the last 60 days". Las apps de una organización de Partner necesitan aprobación: Settings → Access requests → "Read all orders" → Request access, describiendo la app y el motivo. "After approval, declare the scope and deploy the change." El requisito 3.2.1 exige demostrar la necesidad [S11]. Plazo de respuesta: **sin verificar** (no está publicado).
- **Plazo de la revisión de la app**: la documentación no da ninguno [S5, S6]. Estados: Draft → Submitted → (Paused si falla un requisito básico; se corrige y "Submit fixes") → Reviewed (hay que contestar el mail para seguir) → Published [S6]. Estimación de trabajo: 30 días desde el envío (foro, sin verificar), más las fiestas de diciembre.
- **Puntos del checklist todavía abiertos para TierSaver** (de `auditoria-2026-11-26/plataformas.md`, actualizados con lo hecho después):

| Punto | Estado hoy |
| --- | --- |
| Página `/` de plantilla y formulario de dominio (2.3.1) | Corregido el 2026-11-26 (`STATUS.md`). Falta verlo dentro del admin |
| `read_all_orders` y datos protegidos | **Sin pedir.** Bloquea todo lo demás |
| Cobro probado contra Shopify (1.2.2: aceptar, rechazar, reinstalar) | **Sin probar.** Espera la distribución pública |
| Método de precios de la ficha | **Sin elegir** (ver 1.3) |
| Términos y privacidad definitivos, en tiersaver.com | Borradores en staging; esperan abogado y dominio |
| Casilla de soporte que funcione | No existe |
| Capturas reales (3 a 6, 1600 × 900) y video del onboarding en inglés (4.5.3) | Sin hacer |
| Credenciales de prueba sin 2FA, también para Klaviyo (4.5.4, 4.5.5) | Sin resolver |
| Supresión encendida para la cuenta del revisor | Apagada (`SUPPRESSION_ENABLED`) |
| Instalar, desinstalar y reinstalar en tienda nueva; consola dentro del admin | Sin probar |
| Prueba y producción separadas; política de incidentes; registro de accesos (nivel 2) [S4] | Un solo Worker y una sola D1; políticas redactadas, no adoptadas (`17-POLITICAS-INTERNAS.md`) |
| Contacto de emergencia e ícono | Sin cargar |
| Workers Paid | Sin contratar |

### 1.3 Cobro: ¿Billing API o Shopify App Pricing?

- El requisito 1.2.1 acepta cualquiera de los dos: "Your app must use Shopify App Pricing or the Shopify Billing API for any app charges" [S11].
- Shopify App Pricing "is the default option when you submit a new public app", "when it supports their pricing model". La Billing API ("Manual pricing") es "the legacy method", "still supported for existing apps and outlier pricing models" [S12, S13, S14].
- **Dónde se elige** [S14]: Partner Dashboard → App distribution → la app → Distribution → Shopify App Store listing → Manage listing → el idioma bajo "Published languages" → "Pricing content" → Manage → Settings → **Pricing method**. Ahí aparecen "Shopify App Pricing" y "Manual pricing (legacy)".
- **Sin verificar**: si un revisor acepta hoy una app nueva con "Manual pricing (legacy)" cuando su modelo (cuatro planes mensuales fijos) sí entra en App Pricing. La documentación no lo prohíbe ni lo garantiza.
- App Pricing: hasta 8 planes públicos, precios en USD, cargos fijos mensuales o anuales, sin webhooks de suscripción, y una vez activado "you can't create new recurring application charges using the Billing API" [S14].

Qué hacer:

| Caso | Acción |
| --- | --- |
| El dashboard deja elegir "Manual pricing (legacy)" | Elegirlo. El código ya está (`shopify/app/billing/billing.ts`). Cargar los cuatro planes en la sección de precios de la ficha, iguales a `FLAT_PRICE_TIERS`. Probar en la tienda de desarrollo: aprobar, rechazar, reinstalar, subir y bajar de plan, cancelar. Tener listo el plan B por si el revisor pide el cambio |
| El dashboard obliga a App Pricing, o el revisor lo pide | Aplicar el camino alternativo documentado en la cabecera de `billing.ts`: planes definidos en el dashboard, página de planes alojada por Shopify, estado por la Partner API (necesita una credencial de Partner API como secreto). Cambia solo ese archivo. Es trabajo de código de la sesión, **antes** de enviar o como respuesta a la revisión |

Facundo mira esa pantalla apenas elija la distribución pública (paso 2 del camino crítico) y avisa qué opciones ve. Es la única forma de saberlo.

### 1.4 Klaviyo: ¿puede autorizar una cuenta real una app OAuth en Draft?

- **Sí.** "Your app does not have to be listed to share and use your installation URL with customers" [K1]. Mientras no esté revisada, los usuarios ven un aviso de que la app no fue revisada por Klaviyo, pero clientes y testers la pueden instalar y usar; la aprobación saca el aviso y la hace visible en el marketplace [K2].
- **Límites para apps sin revisar**: la documentación no fija tope de instalaciones [K1, K2]. Límite propio de OAuth: 10 pedidos de refresh por minuto; el refresh token se revoca tras 90 días sin uso [K1].
- **Para listarse** [K2, K3]: al menos 5 instalaciones activas de clientes reales con actividad de API en producción (no cuentan cuentas de prueba, de desarrollador ni de la propia empresa), logs retenidos 365 días como mínimo, MFA, cifrado en reposo, formulario de registro que acepta el Technology Partner Agreement, la AUP y los API Terms, formulario de seguridad, instrucciones de prueba, galería y guía de usuario.
- **El listado es opcional**: "you have the option to submit your app", y Klaviyo se reserva no listarla [K2]. **No hace falta para lanzar.** Las 5 instalaciones salen justamente de lanzar sin listar.
- **Sin verificar**: (a) que una cuenta real (no de prueba) complete el consentimiento con nuestra app en Draft: la documentación lo afirma, nadie lo probó; (b) un mensaje de la comunidad de Klaviyo que dice que las revisiones están en pausa (visto solo en el índice del buscador; la página oficial [K2] no lo dice).
- El `redirect_uri` "must exactly match a URL that has been entered in the allowlist"; la lista admite varias URLs [K1, K4]. Importa el Día D.

### 1.5 Cloudflare

- **Mover el dominio** [C1]: registrado hace más de 10 días, mail del titular verificado, DNSSEC apagado, sin bloqueos. Pasos: agregar el dominio en la cuenta nueva con un plan (hecho), apagar DNSSEC, en la cuenta de origen Manage Domain → Configuration → Start, y en la cuenta nueva Domain Registration → Manage Domains → View Actions → aceptar (5 días de plazo). Se pierde toda la configuración de la cuenta de origen; queda bloqueado para transferencias 30 días.
- **Dominios propios de los Workers** [C2]: en `wrangler.jsonc`, `"routes": [{ "pattern": "<host>", "custom_domain": true }]`. Cloudflare crea el registro DNS y el certificado. No se puede sobre un host que ya tenga un CNAME. `tiersaver.com` y `www.tiersaver.com` son hosts distintos: `www` necesita una regla de redirección.
- **Email Routing** [C3, C4]: Compute → Email Service → Email Routing → Onboard Domain; agrega MX, SPF y DKIM; cada regla manda una dirección a un destino verificado. Gratis e ilimitado en Free y Paid [C5]. **"Email Routing does not support sending or replying from your Cloudflare domain"** [C4]: las respuestas salen desde la dirección de destino (el mail personal de Facundo), no desde hello@.
- **Workers Paid** [C6]: mínimo de US$ 5 por mes por cuenta; incluye 10 millones de requests y 30 millones de ms de CPU; D1 con 5 GB; Workflows con 500.000 pasos por mes.
- **Separar prueba y producción** [C7]: entornos de Wrangler (`env.<nombre>`); cada entorno es un Worker aparte llamado `<nombre>-<entorno>`; bindings, variables y secretos **no se heredan** y se definen por entorno; `wrangler deploy --env <nombre>`.

#### Cómo enviar desde hello@tiersaver.com (decide y paga Facundo)

Email Routing y una casilla de un proveedor **no pueden convivir** en el mismo dominio: los dos necesitan los registros MX. Hay que elegir.

| Opción | Cómo queda | Costo | Para mail en frío |
| --- | --- | --- | --- |
| **A. Casilla en un proveedor de mail** (recomendada). Una casilla `hello@` con el alias `support@` | MX, SPF y DKIM del proveedor, más un registro DMARC. No se usa Email Routing. Se envía y se recibe desde hello@, con historial | Google Workspace Business Starter: US$ 7 por usuario por mes con compromiso anual, US$ 8,40 mensual. Zoho Mail Lite: alrededor de US$ 1 por usuario por mes, facturación anual. Fastmail: no se pudo confirmar. **Todos sin verificar**: los sitios de precios no se abren desde esta sesión; cifras del índice del buscador | Correcta: mail escrito a mano, uno por uno, desde una casilla real |
| B. Email Routing (recibir) + enviar por SMTP de Cloudflare Email Sending | Recibe gratis; para enviar se configura "enviar como" en el mail personal con el SMTP de Cloudflare [C8] | Incluido en Workers Paid: 3.000 mails por mes, después US$ 0,35 cada 1.000 [C5] | **No recomendada.** Está en beta y se describe para mail transaccional ("account emails, order confirmations, and alerts") [C8]; las cuentas nuevas arrancan con un cupo diario bajo [C9]; y las respuestas mezclan la casilla personal |
| C. Solo Email Routing | Recibe en el mail personal; se contesta desde el mail personal | Gratis | **No sirve**: el outreach exige enviar desde una dirección de TierSaver (`outreach/README.md`) |

Con la opción A cambia la decisión del 2026-11-26 ("las casillas reenvían a su mail"): pasan a ser una casilla real. Criterio general, sin fuente oficial leída hoy: un dominio registrado hace días tiene poca reputación; 10 mails por semana, escritos a mano y con SPF, DKIM y DMARC, es un volumen prudente; no usar herramientas de envío masivo.

## 2. Camino crítico

Orden por dependencia. "Plazo" es tiempo de espera, no de trabajo. F = Facundo, C = sesión de Claude.

| # | Paso | Quién | Depende de | Plazo | Estado hoy | Evidencia |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Textos legales: adoptados por el dueño sin abogado el 2026-11-26 (`16-LEGALES.md`). Antes de desplegar el sitio sin cartel: cumplir los compromisos C2 (DPA de Cloudflare) y C3 (buzones) de `17-POLITICAS-INTERNAS.md` | F | — | Antes del primer merchant real | Entidad cerrada: Digital Solvers LLC (Delaware), 153 E Flagler St, Suite 1640-6389, Miami, FL 33131. `LEGAL_DRAFT = false` en el código, sin desplegar | `16-LEGALES.md` §9 |
| 2 | Elegir **Public distribution** en el Dev Dashboard (irreversible; puede pedir el pago único de registro del App Store) | F | — | Minutos | Sin elegir. Facundo quería esperar a la landing: la documentación no lo exige, y esto destraba 3, 4, 5 y 6 | [S1, S2] |
| 3 | Pedir **Read all orders** (texto en la sección 6.2) | F | 2 | Sin verificar; pedirlo hoy | Sin pedir | [S3] |
| 4 | Guardar el pedido de **Protected customer data**, nivel 2, solo Email (textos en 6.1) | F | 2; respuestas verdaderas dependen de 7 y 8 | Se guarda en minutos; se revisa con la app (sin verificar) | Sin pedir | [S4, S5] |
| 5 | Mirar **Pricing method** en la ficha y avisar qué opciones hay; crear la ficha en borrador | F | 2 | Minutos | Sin hacer | [S14] |
| 6 | Probar el cobro en la tienda de desarrollo (aprobar, rechazar, reinstalar, cambiar de plan, cancelar) | F hace clic, C verifica | 2 y 5 | 1 día | Sin probar contra Shopify | [S11] 1.2.2 |
| 7 | Separar prueba y producción: Worker y D1 nuevos para producción, la base actual queda de prueba (propuesta en la sección 7) | C, con OK de F para crear recursos | — | 1 día | Un Worker, una D1 | [S4] nivel 2, [C7] |
| 8 | Adoptar las políticas internas (incidentes, accesos, 2FA) | F | — | 1 día | Redactadas, no adoptadas | `17-POLITICAS-INTERNAS.md` |
| 9 | Contratar Workers Paid | F (gasto) | — | Minutos | Sin contratar | [C6] |
| 10 | Elegir proveedor de casilla y abrir la cuenta (sección 1.5) | F (gasto) | — | Minutos; los registros DNS van el Día D | Sin elegir | [C4] |
| 11 | Aviso dentro de la app para cambios de términos ("notice banner"), o que el abogado saque esa promesa de los textos | C (código) o abogado | 1 | 1 día | Pendiente; los textos lo prometen | `16-LEGALES.md` §5 |
| 12 | Al aprobarse 3: declarar `read_all_orders`, reactivar `orders/create`, desplegar, y correr el flujo completo en la tienda de desarrollo | C | 3 aprobado, 4 guardado | 1 día | — | [S3] |
| 13 | **Día D (desde el 2026-12-05)**: mover el dominio, dominios de los Workers, casillas, URLs (sección 4) | F y C | 10 días desde el registro | 1 día | Pasos 1 y 2 del traslado hechos | [C1, C2] |
| 14 | Publicar legales definitivos (`LEGAL_DRAFT = false`, fechas de vigencia) | C, con OK de F | 1, 11, 13 | Horas | Borrador | `site/build/build.mjs:77` |
| 15 | Capturas reales, video, instrucciones y credenciales para el revisor; encender la supresión solo para la cuenta del revisor | F graba, C prepara | 6, 12, 13 | 2 días | Borradores | [S11] 4.5 |
| 16 | **Enviar a revisión**, con visibilidad limitada | F | 3 aprobado, 4, 6, 12 a 15 | Revisión: sin plazo oficial; estimar 30 días | — | [S5, S6] |
| 17 | Contestar al revisor el mismo día; corregir | F y C | 16 | Por ronda: días | — | [S6] |
| 18 | **Published**: encender la supresión para todos, cambiar el botón del sitio a la ficha, empezar el outreach con link | F decide, C ejecuta | 17 | Horas | — | sección 8 |

Ruta más larga: **1 → 14 → 16 → 17 → 18** y **2 → 3 → 12 → 16**. Si el abogado o `read_all_orders` se demoran, se corre todo.

### Qué se puede enviar antes del 2026-12-05 y qué no

| Antes del 5 de diciembre: sí | Antes del 5 de diciembre: no |
| --- | --- |
| Paquete al abogado | Mover el dominio (10 días desde el registro) [C1] |
| Distribución pública | Casillas hello@ y support@ (necesitan el DNS en la cuenta TierSaver) |
| Pedido de `read_all_orders` | Envío a revisión de Shopify: pide política de privacidad y soporte que funcionen, y cambiar la URL de la app en plena revisión es un riesgo innecesario |
| Formulario de datos protegidos (guardar) | Publicar legales como vigentes |
| Ficha en borrador, ícono, contacto de emergencia | Mails de outreach (sin casilla ni dirección postal confirmada no sale ninguno) |
| Prueba del cobro en la tienda de desarrollo | Review submission de Klaviyo (faltan 5 instalaciones reales; no es necesario para lanzar) |
| Workers Paid, separación de ambientes, políticas | |
| Elegir proveedor de casilla | |

Enviar a revisión antes del dominio, con las URLs de `workers.dev`, no está prohibido por la documentación leída, pero no conviene: la ficha necesita casilla de soporte y política de privacidad definitivas, y los nueve días rinden más consiguiendo `read_all_orders` y la firma del abogado, que de todos modos van antes.

## 3. Hoy, sin dominio

Facundo:

- [ ] Mandar el paquete legal al abogado con fecha pedida. Confirmar estado de constitución y domicilio registrado de Digital Solvers LLC.
- [ ] Dev Dashboard → app → Home → Distribution → **Public distribution**.
- [ ] Settings → Access requests → **Read all orders** → Request access (texto 6.2).
- [ ] Settings → Access requests → **Protected customer data** → Manage → Customer data + Email (textos 6.1). Guardar después de adoptar las políticas y de separar ambientes, o contestar solo lo que ya es verdad.
- [ ] Abrir **Pricing method** (ruta en 1.3) y avisar qué opciones aparecen. No tocar "Submit".
- [ ] Subir el ícono (`brand/logo/final/app-icon.png`) y cargar el contacto de emergencia en la cuenta de Partner.
- [ ] Decidir y contratar: Workers Paid; proveedor de casilla.
- [ ] Adoptar `17-POLITICAS-INTERNAS.md` (2FA en Shopify, Klaviyo, Cloudflare y GitHub).
- [ ] Crear una segunda cuenta de Klaviyo real (gratis, no de prueba) para probar que el consentimiento de la app en Draft funciona fuera de la cuenta de prueba, y para el revisor de Shopify.
- [ ] Probar el cobro en la tienda de desarrollo (`14-PASOS-DASHBOARD.md`, paso 5).

Sesión de Claude (con el OK de Facundo donde se crean recursos):

- [ ] Separar prueba y producción (sección 7).
- [ ] Aviso dentro de la app, si el abogado mantiene la promesa en los textos.
- [ ] Plan B de cobro (App Pricing) si el paso 5 del camino crítico lo pide.
- [ ] Guion del video y lista de capturas; instrucciones para el revisor actualizadas (`15-LANZAMIENTO-MATERIALES.md`).
- [ ] Preparar el cambio de URLs de la sección 5 en una rama, sin desplegar.
- [ ] Refrescar `outreach/prospects.csv` y dejar una variante de los borradores para antes de la aprobación (sección 8).

## 4. Día D (dominio listo; primer día posible: sábado 2026-12-05)

Nadie debe estar usando la app mientras se despliega (`STATUS.md`, página "200").

| Hora | Paso | Quién |
| --- | --- | --- |
| 0:00 | Cuenta de origen: apagar DNSSEC si está activo; Manage Domain → Configuration → Start, con el Account ID de la cuenta TierSaver | F |
| 0:10 | Cuenta TierSaver: Domain Registration → Manage Domains → View Actions → aceptar. Esperar a que la zona figure activa | F |
| 0:20 | Con el árbol de git limpio: `node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com` (muestra el diff), revisar, y lo mismo con `--write`. Correr `npm test`, commitear en una rama (sección 5) | C |
| 0:30 | Desplegar el sitio con `tiersaver.com` como dominio propio; regla de redirección de `www` al dominio raíz | C |
| 0:45 | Desplegar la app de producción con `app.tiersaver.com` | C |
| 1:00 | Klaviyo → manage-apps → TierSaver → agregar `https://app.tiersaver.com/klaviyo/oauth/callback` a la lista de redirect, **sin borrar la anterior** | F |
| 1:10 | `shopify app deploy` con `application_url` y `redirect_urls` nuevos (sección 5) | C, con OK de F |
| 1:20 | Casilla: cargar MX, SPF, DKIM y DMARC del proveedor elegido. Crear `hello@` con alias `support@`. Mandar y recibir un mail de prueba con otra dirección | F carga, C dicta los valores |
| 2:00 | Prueba de humo: `npm run smoke:worker -- https://app.tiersaver.com`; abrir la app en la tienda de desarrollo; desconectar y reconectar Klaviyo (prueba el redirect nuevo); abrir términos y privacidad desde la app | C y F |
| 2:30 | Verificar desde afuera: `tiersaver.com` sin `X-Robots-Tag: noindex`; `tiersaver-site.tiersaver.workers.dev` con noindex; `sitemap.xml` y `robots.txt` | F |
| 3:00 | Si el abogado ya firmó: `LEGAL_DRAFT = false`, fechas de vigencia, reconstruir y desplegar el sitio | C, con OK de F |
| 3:30 | Klaviyo → app → cargar sitio, política de privacidad y soporte (`14-PASOS-DASHBOARD.md`, paso 4). No apretar "Review submission" | F |
| Días D+1 a D+3 | Capturas reales y video en la tienda de desarrollo, ya con `app.tiersaver.com` | F graba, C guía |
| D+3 (si `read_all_orders` está aprobado y el abogado firmó) | Enviar a revisión con visibilidad limitada | F |

## 5. Qué cambia en el repo el día que existe el dominio (15 minutos)

Hosts propuestos: `tiersaver.com` (sitio) y `app.tiersaver.com` (app).

**Se corre un script; no se edita a mano.** Desde la raíz del repo, con el árbol de git limpio:

```
node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com           # simulación: imprime el diff y los pasos manuales
node scripts/dia-d.mjs --domain tiersaver.com --app-host app.tiersaver.com --write   # escribe los archivos
```

- Sin `--write` no escribe nada. Con el árbol de git sucio se niega a correr (también en simulación), salvo `--force`.
- Es idempotente: una segunda corrida dice "No hay nada para cambiar". Si un archivo no está como espera, se detiene sin escribir ninguno.
- No despliega, no llama a ninguna API y no lee secretos. Solo edita los archivos de la tabla.
- Test: `node --test scripts/dia-d.test.mjs` (también corre con `npm test` en la raíz). Escribe solo sobre una copia en una carpeta temporal.

Lo que el script cambia o comprueba (los números de línea son los de hoy; el script busca por nombre, no por línea):

| # | Archivo:línea | Hoy | Lo que hace el script |
| --- | --- | --- | --- |
| 1 | `shopify/shopify.app.toml:7` | `application_url = "https://tiersaver-app.tiersaver.workers.dev"` | `application_url = "https://app.tiersaver.com"` |
| 2 | `shopify/shopify.app.toml:11` | `redirect_urls = ["https://tiersaver-app.tiersaver.workers.dev/auth/callback"]` | `redirect_urls = ["https://app.tiersaver.com/auth/callback"]` |
| 3 | `shopify/wrangler.jsonc:56` | `"SHOPIFY_APP_URL": "https://tiersaver-app.tiersaver.workers.dev"` | `"SHOPIFY_APP_URL": "https://app.tiersaver.com"` |
| 4 | `shopify/wrangler.jsonc:54-55` | `"SITE_URL": "https://tiersaver-site.tiersaver.workers.dev"` y su comentario | Borra las dos líneas: `legalUrls` usa `https://tiersaver.com` por defecto (`shopify/app/legal.ts:52`). Con otro `--domain`, en vez de borrarla la apunta a ese dominio |
| 5 | `shopify/wrangler.jsonc` (nuevo, nivel superior) | No hay `routes` | `"routes": [{ "pattern": "app.tiersaver.com", "custom_domain": true }]` y `"workers_dev": true` (ver nota) |
| 6 | `site/wrangler.jsonc:18-20` | Comentario "No routes yet" | `"routes": [{ "pattern": "tiersaver.com", "custom_domain": true }]` y `"workers_dev": true` (ver nota); reemplaza el comentario |
| 7 | `site/build/build.mjs:56` | `ORIGIN = "https://tiersaver.com"` | **Sin cambio** con `tiersaver.com`: canónicas, `sitemap.xml`, `robots.txt` y el verificador de links ya usan el dominio final. Desde el 2026-11-26 `ORIGIN` está escrito solo ahí (`check-links.mjs` lo importa y `robots.txt` se genera) |
| 8 | `site/_headers:16-18` | Regla `https://:project.:account.workers.dev/*` → `X-Robots-Tag: noindex` | **Sin cambio**: ya aplica solo a `workers.dev`. El script comprueba que la regla esté; después se verifica desde afuera |

**Nota sobre `workers_dev` (diferencia con la versión anterior de esta tabla).** Con `routes` en la configuración, Wrangler deja de publicar la dirección `*.workers.dev` salvo que se ponga `"workers_dev": true` ("Defaults to `true` when the configuration has no `route` or `routes`, and `false` otherwise") [C8]. Este runbook cuenta con que las direcciones viejas sigan respondiendo (la primera URL de redirect de Klaviyo, que no se borra; el sitio de staging con noindex del paso 2:30), así que el script agrega `"workers_dev": true` en los dos Workers. Si Facundo prefiere apagarlas el mismo día: `--drop-workers-dev`, y en el paso 2:30 se verifica que ya no respondan.

Pasos manuales que el script no hace (los imprime en este orden, con las URLs ya armadas; el detalle y los horarios están en la sección 4):

1. Cloudflare: traslado del dominio y zona activa (F).
2. Revisar el diff, `npm test`, commit en una rama (C).
3. Desplegar el sitio (`npm run build -w @tiersaver/site` y `npx wrangler deploy` en `site/`), regla de redirección de `www`, y comprobar que `https://tiersaver.com/terms` abre **antes** de desplegar la app: la app deja de usar `SITE_URL` (C).
4. Desplegar la app (`npm run deploy:worker` en `shopify/`) (C).
5. Klaviyo → manage-apps → TierSaver → agregar `https://app.tiersaver.com/klaviyo/oauth/callback` a la lista de redirect, sin borrar la anterior (ruta en `shopify/app/klaviyo/config.ts:33`; se arma con `SHOPIFY_APP_URL` en `flow.server.ts:53`) (F).
6. `shopify app deploy` (`npm run deploy` en `shopify/`), con OK de F; comprobar en el dashboard que la versión activa muestra las dos URLs nuevas.
7. Casilla: registros DNS y mail de prueba (F carga, C dicta).
8. Prueba de humo (C y F) y verificación desde afuera (F).
9. Cargar sitio, privacidad y soporte en Klaviyo y en el listing de Shopify (F).

Con fecha propia (no son del Día D):

| # | Archivo:línea | Cuándo | Valor nuevo |
| --- | --- | --- | --- |
| 10 | `site/build/build.mjs:82` `LEGAL_DRAFT = true` | Con la firma del abogado. El aviso dentro de la app ya existe (`shopify/app/notices.ts`; cómo publicar uno: `17-POLITICAS-INTERNAS.md`, sección 9) | `false`, y reconstruir el sitio |
| 11 | `shopify/app/legal.ts:8` `TERMS_VERSION` y `site/src/site-config.ts:17` `TERMS_EFFECTIVE_DATE` (un test exige que coincidan) | El mismo día que el 10 | La fecha de ese día, en los dos |
| 12 | `shopify/shopify.app.toml:16` y `shopify/wrangler.jsonc:49` (`SCOPES`); `site/src/site-config.ts:42` (`SHOPIFY_SCOPES`) | Cuando Shopify apruebe `read_all_orders` | `"read_orders,read_all_orders"` en los dos primeros; agregar `"read_all_orders"` al tercero |
| 13 | `shopify/shopify.app.toml:43-46` (webhook `orders/create` comentado) | Con el pedido de datos protegidos guardado | Descomentar las cuatro líneas |
| 14 | `site/build/build.mjs:72` `AUDIT_CTA_URL` y `:74` `AUDIT_CTA_NOTE` | Cuando la app esté Published | `"https://apps.shopify.com/<handle>"` y `""` |
| 15 | `shopify/wrangler.jsonc:53` `KLAVIYO_SEEDED_ACCOUNT_ID` | Al separar ambientes | Solo en el entorno de prueba |
| 16 | `SUPPRESSION_ENABLED` y `SUPPRESSION_ALLOWED_ACCOUNT_ID` (variables o secretos del Worker; no están en el repo: `shopify/wrangler.jsonc:41-43`, `shopify/app/runs/gateway.server.ts:147-149`) | Para la revisión: `true` + el id de la cuenta de Klaviyo del revisor. Al publicar: `true` y sin cuenta permitida | Decisión de Facundo las dos veces |

El script imprime esta misma lista al final, con el archivo y la línea de cada constante al día de la corrida.

Estado de las sugerencias para dejar todo en una sola variable:

- **Hecho (2026-11-26):** `site/build/check-links.mjs` importa `ORIGIN` de `build.mjs` y `robots.txt` se genera desde `ORIGIN` (mismo contenido que antes; el build no cambió ningún archivo generado).
- **Pendiente:** los puntos 1, 2, 3 y el redirect de Klaviyo repiten el mismo host. Shopify CLI admite un archivo de configuración por ambiente (`shopify.app.<nombre>.toml`); junto con `env.<nombre>` de Wrangler [C7], la separación de ambientes de la sección 7 deja cada host escrito una sola vez por ambiente. Mientras tanto, el script es el único lugar donde se escribe el host.
- `SITE_URL` (punto 4) se borra solo cuando `tiersaver.com` sirva el sitio; por eso el sitio se despliega y se comprueba antes que la app.

## 6. Textos para los formularios de Shopify (inglés)

Fieles al código: la app lee de cada pedido `email`, `processedAt`, `createdAt` y `test` (`shopify/app/orders/sync.ts:85-104`) y guarda por comprador un hash con clave por tienda (HMAC-SHA-256) del mail, la fecha del último pedido y un hash del id de cliente (`shopify/app/orders/purchases.ts`, `site/src/pages/privacy.html`). Si el formulario ofrece opciones cerradas, elegir la que hable de funcionalidad de la app; las opciones exactas no están en la documentación (**sin verificar**).

### 6.1 Protected customer data

**Customer data — reason**

> TierSaver keeps a merchant's Klaviyo list clean by suppressing profiles that never engaged, after the merchant reviews and approves a simulation. To make sure no customer who has ever purchased is suppressed, the app reads the store's orders and matches buyers to Klaviyo profiles. It uses only the order's email address, its dates and whether it is a test order.

**Email — reason**

> The order email is the only identifier shared by a Shopify order and a Klaviyo profile. The app computes a keyed, per-store hash (HMAC-SHA-256) of the normalized email as soon as it reads it, and stores only that hash with the date of the buyer's most recent order. The email address itself is never stored or logged. Name, address and phone are not requested or used.

**Data protection details** (contestar cada pregunta con lo que corresponda de esta lista; no marcar nada que todavía no sea verdad)

| Tema | Respuesta verdadera hoy | Qué falta para poder decir que sí |
| --- | --- | --- |
| Minimización y finalidad | `We process only the order email, order dates and the test flag, for one purpose: keeping buyers out of a cleanup. Emails are stored only as keyed per-store hashes.` | — |
| Información al merchant y acuerdo de datos | `The privacy policy and the data processing addendum at tiersaver.com describe what is processed and why.` | Publicarlos como definitivos (pasos 13 y 14) |
| Retención | `All store data is deleted on Shopify's shop/redact request (48 hours after uninstall), or 10 days after uninstall if that request does not arrive. customers/redact deletes that customer's hashed purchase record.` | — |
| Cifrado en tránsito y en reposo | `TLS for all traffic. Access tokens are encrypted with AES-GCM with a key kept outside the database. The database is hosted on Cloudflare D1.` | Confirmar en la documentación de Cloudflare el cifrado en reposo de D1 y de sus copias (**sin verificar** en esta sesión) antes de afirmarlo |
| Copias de seguridad cifradas | Las únicas copias son las de recuperación de D1 (Time Travel) | Lo mismo |
| Prueba y producción separadas | **Hoy no** | Paso 7 |
| Prevención de pérdida de datos | `No readable customer data is stored; exports are limited to the merchant's own candidate list inside the app.` | Revisar con `17-POLITICAS-INTERNAS.md` |
| Acceso del personal limitado y contraseñas fuertes | `One operator. Two-factor authentication on Shopify, Klaviyo, Cloudflare and GitHub.` | Paso 8 (confirmar 2FA en las cuatro) |
| Registro de accesos a datos protegidos | **Hoy no hay un registro de accesos del personal** (el `events_log` registra acciones del merchant) | Definirlo en las políticas; decir la verdad si se pregunta |
| Política de respuesta a incidentes | Redactada | Paso 8 |

### 6.2 Read all orders

> TierSaver's default cleanup rule only suppresses Klaviyo profiles that have never purchased. Profiles are eligible only when they were created at least 365 days ago, so the orders that prove a purchase are almost always older than 60 days. With the default 60-day window the app cannot tell a past customer from a profile that never bought, and it keeps every profile active. With read_all_orders the app reads the store's full order history once, then keeps it current, and stores per buyer only a keyed hash of the order email and the date of the most recent order. It never stores order contents, names, addresses or readable emails, and it never writes to orders.

Para el video de la revisión (3.2.1, "must demonstrate the need"): mostrar la auditoría sin historial (nadie es candidato y la app lo explica) y con historial.

## 7. Separar prueba y producción (propuesta para la sesión principal)

Lo pide el nivel 2 de datos protegidos: "Keep test and production data separate" [S4].

- **Producción**: Worker `tiersaver-app` en `app.tiersaver.com`, con una **D1 nueva y vacía**, secretos propios y sin `KLAVIYO_SEEDED_ACCOUNT_ID`. Es la app de Shopify actual (`client_id` de `shopify.app.toml:3`), que es la que va a revisión.
- **Prueba**: entorno `staging` de Wrangler (Worker `tiersaver-app-staging` en `workers.dev`) con la D1 actual, que ya tiene los datos de la tienda de desarrollo y de la cuenta sembrada. Los Workflows del entorno llevan otro nombre. Necesita una segunda app de Shopify "TierSaver (dev)" con su propio archivo `shopify.app.dev.toml` (crearla es tarea de Facundo). La app OAuth de Klaviyo puede ser la misma: su lista admite las dos URLs de redirect [K4].
- `HASH_PEPPER` y `TOKEN_ENCRYPTION_KEY` nuevos para producción, guardados por Facundo fuera de Cloudflare (`STATUS.md`: si `HASH_PEPPER` se pierde, las limpiezas anteriores no se pueden restaurar).
- Efecto: la tienda de desarrollo hay que reinstalarla contra la app de prueba.

## 8. Go-to-market

Rutina y reglas: `docs/outreach/README.md` (10 primeros mensajes y 2 conversaciones por semana; Facundo revisa y envía; un solo seguimiento; lista de no contactar).

### Mientras dura la revisión (no hay link de instalación)

El pedido de los borradores actuales es "probar la auditoría gratis en una cuenta". **Hasta la aprobación eso no se puede cumplir.** Dos caminos honestos, decide Facundo:

- **Esperar**: usar estas semanas para abrir evidencia y contacto de cada fila y pasarlas a `approved`, sin enviar. El primer mail sale el día de la publicación.
- **Enviar con otro pedido** (solo prioridad 1, 5 por semana): mostrar la app en una llamada de 15 minutos sobre la tienda de desarrollo y avisar el día que esté disponible. El texto dice que la app está en revisión de Shopify. Necesita la casilla, la dirección postal confirmada y una variante de los borradores.

En los dos casos no sale ningún mail sin casilla de TierSaver, pie completo y dirección postal (`outreach/README.md`, "Bloqueos").

### Desde la publicación

| Semana | Facundo | Sesión de Claude |
| --- | --- | --- |
| 1 | Lunes: aprobar 10 filas. Martes y miércoles: enviar 5 por día con el link de la ficha. Jueves: responder. Viernes: cargar respuestas y bajas. Acompañar en llamada a cada instalación | Cambiar el botón del sitio a la ficha (punto 14 de la sección 5). Mirar a diario errores y corridas de las primeras tiendas. Dejar los 10 borradores de la semana 2 |
| 2 | Misma rutina. Único seguimiento a los de la semana 1 | Corregir lo que aparezca en uso real. Refrescar la planilla |
| 3 | Misma rutina. Si en dos semanas no hubo ninguna conversación, frenar y revisar el mensaje antes de seguir (`outreach/README.md`) | Proponer el mensaje nuevo a partir de las respuestas |
| 4 | Decidir: pasar a visibilidad completa si hay al menos 5 tiendas con una limpieza sin incidentes; revisar los cortes de `08-RIESGOS-Y-METRICAS.md` | Con 5 instalaciones reales: preparar el material de la revisión de Klaviyo, para que Facundo decida si se envía |

Son objetivos de trabajo, no proyecciones de resultados.

## 9. Qué significa "play"

**Definición**: un merchant que no conocemos abre un link de `apps.shopify.com`, instala, conecta Klaviyo, ve su auditoría con candidatos reales, aprueba la simulación y el plan, y la limpieza corre. Todo lo siguiente tiene que ser verdad antes:

| # | Condición | Quién la cumple | Estado |
| --- | --- | --- | --- |
| 1 | App en estado Published en Shopify (visibilidad limitada alcanza) | Shopify, tras la revisión | Sin enviar |
| 2 | `read_all_orders` aprobado y declarado; Email aprobado como dato protegido. Sin esto, cero candidatos | Shopify | Sin pedir |
| 3 | `SUPPRESSION_ENABLED = true` para todas las cuentas (sin `SUPPRESSION_ALLOWED_ACCOUNT_ID`) | **Decisión de Facundo** | Apagada |
| 4 | Términos, privacidad y DPA definitivos, con la firma del abogado; `LEGAL_DRAFT = false` | Abogado y Facundo | Borrador |
| 5 | Aviso dentro de la app para cambios de términos, o la promesa quitada de los textos | Sesión o abogado | **Falta** |
| 6 | Producción en Workers Paid, separada de la prueba | Facundo (gasto) y sesión | Falta |
| 7 | Casillas hello@ y support@ recibiendo y enviando | Facundo | No existen |
| 8 | Cobro probado contra Shopify, con el método de precios confirmado | Facundo y sesión | Sin probar |
| 9 | Consentimiento de Klaviyo probado con una cuenta real y la app en Draft; el aviso de "no revisada" explicado en la ayuda | Facundo prueba, sesión redacta | Sin probar |
| 10 | Un ciclo completo (auditoría, limpieza, restore) corrido en producción con el código y las URLs finales | Sesión y Facundo | Hecho en staging el 2026-11-26; falta en producción |

El listado en el marketplace de Klaviyo **no** es condición.

## 10. Riesgos que pueden frenar la llegada de usuarios aun con todo hecho

| Riesgo | Por qué puede pasar | Mitigación |
| --- | --- | --- |
| La revisión de Shopify tarda más de lo estimado | No hay plazo publicado; fiestas de diciembre | Enviar lo antes posible; no prometer fecha a nadie; contestar cada ronda el mismo día |
| Rechazo o pausa en la revisión | Motivos documentados: cobro, instalación, experiencia embebida, interfaz, pruebas que el revisor no puede completar [S15]. Los propios: credenciales de Klaviyo con verificación, cero candidatos en la tienda del revisor, página "200" tras un despliegue | Cuenta de Klaviyo dedicada al revisor, con datos y sin segundo factor; instrucciones que digan qué va a ver; video que muestre el flujo completo; no desplegar durante la revisión |
| Shopify no aprueba `read_all_orders`, o tarda | El requisito pide demostrar la necesidad | Pedirlo hoy con el texto 6.2. Si lo rechazan, pedir el motivo y volver a pedir; no hay plan B de producto sin reabrir decisiones de `00-HANDOVER.md` |
| El revisor pide pasar a Shopify App Pricing | Es el método por defecto y el modelo de TierSaver entra en él | Plan B ya documentado en `billing.ts`; estimar un día de trabajo y otra ronda de revisión |
| El formulario de datos protegidos pide algo que no es verdad | Nivel 2: ambientes separados, política de incidentes, registro de accesos | Pasos 7 y 8 antes de enviar; no afirmar nada que no esté hecho |
| Cero candidatos en una tienda real, aun con el scope | Reglas conservadoras por diseño; el historial de pedidos tarda en leerse en tiendas grandes | La pantalla ya lo explica. En el outreach, apuntar a listas grandes y antiguas (5.000 a 150.000 perfiles) |
| Cláusula de Klaviyo sobre productos "competitive or substantially similar" y sobre evadir cargos | Klaviyo tiene supresión y recomendaciones nativas; puede revocar la app o no listarla | Decisión ya tomada de seguir (`16-LEGALES.md`). No firmar el Technology Partner Agreement sin el abogado. Ningún texto nuevo sobre la factura. El listado no es necesario para operar |
| El aviso "app no revisada por Klaviyo" asusta al merchant | Aparece en el consentimiento hasta que Klaviyo revise [K2] | Una línea antes del botón "Connect Klaviyo" y un artículo de ayuda; decirlo en la llamada |
| Los mails de outreach no llegan o caen en spam | Dominio nuevo, casilla nueva | Casilla real con SPF, DKIM y DMARC; a mano y pocos; mezclar con formularios y LinkedIn |
| Outreach antes de la aprobación sin nada para instalar | No existe link de instalación previo | Sección 8: esperar, o cambiar el pedido |
| El abogado demora o pide cambios de fondo | Depende de un tercero | Mandarle el paquete hoy, con fecha |
| Se pierde `HASH_PEPPER` | No está guardado fuera de Cloudflare | Facundo lo guarda en su gestor de contraseñas al crear el de producción |

## 11. Lo que no se pudo verificar

- Plazo de la revisión de Shopify, de `read_all_orders` y de datos protegidos: no publicados. La cifra de 30 días y la regla "en borrador solo tiendas de desarrollo" vienen del foro de desarrolladores de Shopify, que esta sesión no pudo abrir (`community.shopify.dev` está fuera de la red permitida); se leyeron en el índice del buscador.
- Si el pedido de datos protegidos se aprueba antes o junto con la revisión de la app; las opciones exactas y las preguntas del formulario.
- Si `read_all_orders` se puede aprobar con la app todavía en borrador, y si funciona en la tienda de desarrollo antes de la aprobación.
- Si una app nueva puede enviarse con "Manual pricing (legacy)": se ve en el dashboard (paso 5).
- El monto del pago único de registro del App Store ([S1] dice que existe; `14-PASOS-DASHBOARD.md` dice US$ 19).
- Qué es exactamente la lista de IP permitidas de las apps custom [S2].
- Que una cuenta real de Klaviyo autorice la app en Draft (la documentación lo afirma; falta probarlo). El mensaje de la comunidad sobre revisiones en pausa (`community.klaviyo.com`, fuera de la red).
- Precios de Google Workspace, Zoho y Fastmail, y las reglas de remitentes de Gmail (`workspace.google.com`, `zoho.com`, `support.google.com`, fuera de la red).
- Cifrado en reposo de D1 y de sus copias.
- La memoria del usuario estaba vacía: nada de este documento sale de ahí.

## Fuentes (leídas el 2026-11-26)

Shopify
- [S1] https://shopify.dev/docs/apps/launch/distribution
- [S2] https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- [S3] https://shopify.dev/docs/api/usage/access-scopes
- [S4] https://shopify.dev/docs/apps/launch/protected-customer-data
- [S5] https://shopify.dev/docs/apps/store/review/app-submission
- [S6] https://shopify.dev/docs/apps/launch/app-store-review/review-process
- [S7] https://help.shopify.com/en/partners/manage-clients-stores/development-stores
- [S8] https://shopify.dev/docs/apps/build/dev-dashboard/development-stores
- [S9] https://shopify.dev/docs/apps/launch/distribution/visibility
- [S10] https://shopify.dev/docs/apps/launch/app-requirements-checklist
- [S11] https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- [S12] https://shopify.dev/docs/apps/launch/billing
- [S13] https://shopify.dev/docs/apps/launch/billing/manual-pricing
- [S14] https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- [S15] https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- Sin abrir (solo índice del buscador): hilos de community.shopify.dev 9409, 29152, 33101, 37242 y 32009.

Klaviyo
- [K1] https://developers.klaviyo.com/en/docs/set_up_oauth
- [K2] https://developers.klaviyo.com/en/docs/submit_your_app_for_review
- [K3] https://developers.klaviyo.com/en/docs/klaviyo_app_listing_requirements
- [K4] https://developers.klaviyo.com/en/docs/create_a_public_oauth_app
- Sin abrir: community.klaviyo.com, hilo 19822.

Cloudflare
- [C1] https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/
- [C2] https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- [C3] https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/
- [C4] https://developers.cloudflare.com/email-routing/postmaster/
- [C5] https://developers.cloudflare.com/email-service/platform/pricing/
- [C6] https://developers.cloudflare.com/workers/platform/pricing/
- [C7] https://developers.cloudflare.com/workers/wrangler/environments/
- [C8] https://developers.cloudflare.com/workers/wrangler/configuration/ (apartado `workers.dev`) y https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- [C8] https://developers.cloudflare.com/email-service/
- [C9] https://developers.cloudflare.com/email-service/platform/limits/
