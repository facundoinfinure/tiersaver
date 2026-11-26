# Revisión de privacidad y protección de datos — TierSaver

Fecha: 2026-11-26. Revisor independiente (privacidad del producto). No soy abogado; lo legal es análisis para llevarle a uno.
Alcance: código en `shopify/`, `packages/core/`, `site/`; textos `site/src/pages/privacy.html`, `site/src/pages/help/data-and-privacy.html`, `site/src/pages/terms.html` §8 y §14. Solo lectura: no se tocó el repo ni ninguna cuenta.

## 0. Resumen

El código está bien por encima de la media en minimización (sin mails en claro en base, logs ni payloads de Workflows; tokens con AES-256-GCM; cascadas de borrado completas). Los textos publicados coinciden casi línea por línea con el código. Lo que falta para lanzar no es higiene de código sino **contrato y procedimiento**:

| # | Hallazgo | Severidad |
| --- | --- | --- |
| P1 | No existe un DPA: la cláusula 8 de los términos no cubre el art. 28(3) GDPR ni el contrato de "service provider" de la CCPA, y no hay mecanismo de transferencia (SCC) | Alta (bloquea merchants UE/UK; Shopify nivel 1 pide "agreements") |
| P2 | `customers/data_request` no hace ni registra nada: el pedido se pierde; nadie se entera | Alta |
| P3 | Hashes SHA-256 sin clave e iguales entre tiendas: reversibles por diccionario y permiten cruzar a la misma persona entre merchants | Alta (arreglo barato antes de lanzar) |
| P4 | Si `shop/redact` no llega o falla, los datos de la tienda quedan para siempre: no hay purga de respaldo | Alta |
| P5 | Requisitos de nivel 2 de Shopify sin política escrita: respuesta a incidentes, registro de accesos, acceso del personal, DLP, separación test/producción | Alta (Shopify puede pedir evidencia) |
| P6 | La política no dice que el operador accede a los datos desde Argentina; identidad y domicilio de la entidad "a confirmar" | Media-alta |
| P7 | Logs de invocación de Cloudflare guardan la URL completa (código OAuth de Klaviyo, `id_token` de Shopify, dominio, IP) | Media |
| P8 | Sin plazos de retención mientras la app está instalada (hashes de compradores, `run_profiles`, `events_log`) | Media |
| P9 | Conflicto Klaviyo (logs 365 días, a prueba de manipulación) vs. borrado total a las 48 h | Media (decisión + texto) |
| P10 | `customers/redact` deja el id de perfil de Klaviyo y la revocación en Klaviyo al desinstalar es de un solo intento sin registro | Media |
| P11 | Webhook `orders/create` recibiría el pedido completo: falta `include_fields` | Media (antes de activarlo) |
| P12 | Diferencias menores texto ↔ código (lista en §2) | Baja |
| P13 | Un solo ambiente/base: la cuenta de prueba y producción comparten D1 | Media |
| P14 | Falta registro de actividades (art. 30.2 GDPR), análisis Ley 25.326/AAIP, representante art. 27 | Media (documentos) |

Fuentes que **no** pude leer (host bloqueado en esta sesión): `www.shopify.com/legal/api-terms`, `www.shopify.com/partners/terms` (Partner Program Agreement), `www.shopify.es`, `gdpr-info.eu`, `www.law.cornell.edu` (reglamento CCPA §7051), `www.argentina.gob.ar` (AAIP) e `infoleg.gob.ar` (Ley 25.326). Todo lo que digo de esos textos está rotulado **[de memoria, sin verificar]**. Hay que permitir esos hosts o que una persona los lea.

---

## 1. Inventario de datos (del código)

### 1.1 Guardado en D1 (`shopify/app/db/schema.ts`, migraciones `shopify/drizzle/0000`–`0005`)

| Tabla | Datos | ¿Personal? De quién | Plazo real en código |
| --- | --- | --- | --- |
| `session` | id, shop, state, scope, expires, access/refresh token de Shopify (AES-GCM, `session-storage.server.ts:26-36`). Columnas de usuario (userId, nombre, mail) en NULL: solo sesiones offline (`shopify.server.ts`, sin `useOnlineTokens`) | Credenciales del merchant | Se borra en `app/uninstalled` (`data/privacy.ts:22`) |
| `shops` | dominio myshopify, estado, fechas, `read_all_orders_granted`, `purchases_covered_since`, `iana_timezone` (nadie la escribe) | Merchant | Hasta `shop/redact` |
| `klaviyo_connections` | id de cuenta Klaviyo, tokens cifrados, scopes, revisión API, `profiles_usage_type_id` | Merchant | Se borra en `app/uninstalled` (`privacy.ts:23`) |
| `klaviyo_oauth_attempts` | SHA-256 del `state`, shop, resultado | No | 24 h (`housekeeping.ts:33`, `flow.server.ts:213`) |
| `settings` | reglas, ids de listas/segmentos protegidos, día de renovación, modo, plan | Merchant | Hasta `shop/redact` |
| `audits`, `simulations` | conteos, uso de Klaviyo, estimaciones, reglas; `approved_by` = id de usuario de Shopify | Personal del merchant (id) | Hasta `shop/redact` |
| `simulation_candidates` | id de perfil Klaviyo, motivo, **SHA-256 del mail** | Clientes del merchant (seudonimizado) | 7 días si la simulación no se ejecutó (`housekeeping.ts:31`); **sin plazo** si se ejecutó |
| `scans` / `scan_profiles` | por perfil evaluado: id de perfil, hash del mail, `facts` (fecha de creación, última actividad, consentimiento y supresión de email y SMS), decisión | Clientes del merchant | Al terminar el scan o ≤ ~25 h (`housekeeping.ts:27-29`) |
| `runs` / `run_profiles` | id de perfil Klaviyo, motivo, hash del mail, estado, id del job de Klaviyo, error, `reactivated_at`; `created_by` = id de usuario | Clientes y personal | **Sin plazo** mientras esté instalada |
| `purchase_hashes` | SHA-256 del mail del pedido, fecha del último pedido, SHA-256 de `shop:customerId` | Clientes (compradores) — dato protegido de Shopify derivado | **Sin plazo**; fila se borra con `customers/redact` |
| `usage_charges` | tamaño de lista, tramo, perfiles suprimidos, monto, motivo de no cobro, id del cargo en Shopify, clave de idempotencia | Merchant | Hasta `shop/redact` |
| `events_log` | actor (`user:<id Shopify>`), acción, ids, contadores, versión de términos | Personal del merchant (id) | Hasta `shop/redact` |

### 1.2 Leído y no guardado

- **Shopify Admin GraphQL** (`orders/purchases.ts:98-115`): `orders { email, processedAt, test, customer { id } }`. Mínimo correcto. `billing.ts`: `shop { plan { partnerDevelopment } }` y suscripciones.
- **Webhook `orders/create`** (`routes/webhooks.orders.create.tsx`): hoy **desactivado** en `shopify.app.toml:27-29`. Usa 4 campos; Shopify mandaría el pedido entero (nombre, direcciones, teléfono, líneas).
- **Klaviyo** (`klaviyo/api.ts`): cuenta (`test_account`, `timezone`, `contact_information.organization_name`, línea 77; con `allFields` como plan B al conectar: todos los campos de la cuenta, línea 76-77 y `connection.server.ts:179`); perfiles (`email`, `created`, `last_event_date`, suscripciones email, y SMS vía `additional-fields`; líneas 224-231, 301-307); ids de miembros de listas/segmentos; nombres de listas, segmentos y métricas; `billing-usage`. No pide `events:read` (`config.ts:69`).
- **Mails en claro en memoria**: en cada scan (hash), en cada lote de supresión/deshacer (`runs/gateway.server.ts:96-131`), en el CSV (`simulations/review.ts:150-163`, respuesta `no-store`, descarga registrada sin datos en `events_log`).
- **Cookie** `__Host-ts_klaviyo_oauth` (10 min, HttpOnly, Secure, SameSite=Lax; `flow.server.ts:72-74`).

### 1.3 Fuera de la base (plataforma Cloudflare)

- **Workers Logs** (`wrangler.jsonc:8` `observability.enabled: true`): cada invocación registra método y URL del pedido; retención 3 días (Free) / 7 días (Paid). Fuente: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (leída hoy; la página no aclara si incluye query string: asumir que sí).
- **Estado de Workflows**: solo ids, contadores y cursores (`workers/*.ts`, payloads `{runId}`, `{scanId}`, `{shop}`); retención 3 días Free / 7 días por defecto, hasta 30 en Paid. Fuente: https://developers.cloudflare.com/workflows/reference/limits/
- **D1 Time Travel** (copias punto en el tiempo): 7 días Free / **30 días Paid**, siempre activo, no se puede apagar. Fuente: https://developers.cloudflare.com/d1/reference/time-travel/

---

## 2. Texto publicado vs. código

Los textos son precisos. Diferencias encontradas:

| # | Dónde | Texto | Código | Arreglo (texto exacto) |
| --- | --- | --- | --- | --- |
| M1 | privacy §9, último bloque y help "Deletion" | "can remain for a limited period in our hosting provider's encrypted backups" | Time Travel de D1: 30 días en Paid, no desactivable. Además "encrypted" no lo pude confirmar en la doc de D1 | Reemplazar por: "Deleted data can remain for up to 30 days in our hosting provider's point-in-time recovery copies of the database, which we cannot switch off, before it is permanently removed. We do not restore deleted data from those copies except to recover from an incident, and if we do, we delete it again." Quitar "encrypted" salvo que se confirme con Cloudflare. Esto además choca con "immediately delete" de Klaviyo (§4.1) y hay que decirlo al abogado |
| M2 | privacy §9 logs | "kept for a limited period set by our hosting provider" | 3/7 días según plan (doc de Cloudflare) | "Request logs are kept for up to 7 days." (y aplicar P7) |
| M3 | privacy §3 "Charge records" y help | "the price band that applied and the identifiers of the charges" | También guarda tamaño de lista, perfiles suprimidos, monto, motivo de no cobro (`schema.ts`, `usage_charges`) | "Charge records: the list size and price band that applied, the number of profiles suppressed, the amount, whether a charge was created and why not, and the identifiers of the charges created through Shopify." |
| M4 | privacy §3 "Store details" | "domain, installation status and dates" | También si Shopify otorgó `read_all_orders`, desde qué fecha está cubierto el historial de compras y los permisos de la sesión | Agregar: ", the Shopify permissions granted and the date from which the store's order history has been read." |
| M5 | privacy §3 "Klaviyo profile and account data" | lista cerrada de lo leído de la cuenta: "ID, organization name, time zone and active-profile usage figures" | Falta `test_account`; y el plan B `allFields` (`api.ts:76`) trae **toda** la cuenta: dirección postal, mail de contacto, sitio web, industria | Mejor arreglar el código: en `connection.server.ts:179` reintentar sin sparse fieldset pero leer solo `id` (o quitar el plan B). Si se deja: agregar "and, if that request fails while connecting, the account's full contact record, of which only the ID is used". También sumar "the names of the account's lists and segments" (la app los lista para elegir protegidos) |
| M6 | privacy §3, "Data we store → Profiles selected" | Solo habla de perfiles seleccionados | Coincide. Pero `scan_profiles` (todos los evaluados, hasta 50.000) está bien descrito en "working data". OK | Ninguno |
| M7 | privacy §9 "On uninstall … we revoke our access at Klaviyo" | Afirmación firme | `webhooks.app.uninstalled.tsx:14-19`: un intento, el error se traga, no se registra ni reintenta (`connection.server.ts:349-367`). Si falla, el grant queda vivo en Klaviyo (los tokens sí se borran, así que TierSaver ya no puede usarlo) | Código: registrar `klaviyo.revoke_failed` en `events_log` y reintentar una vez. Texto: "and we ask Klaviyo to revoke our access. You can also remove TierSaver from your Klaviyo account's integrations at any time." |
| M8 | privacy §9 "After uninstall" | "deleted … when Shopify sends its shop deletion request" | Cierto, pero sin respaldo si no llega (P4) | Tras arreglar P4: "…48 hours after an app is uninstalled, and in any case within 10 days of the uninstall." |
| M9 | privacy §9 "When a customer asks a store for their data" | "On request from the store, we provide that information" | El webhook `customers/data_request` es un `break` sin registro (`webhooks.compliance.tsx:26-29`). No hay herramienta ni runbook para armar la respuesta (P2) | Tras arreglar P2: "When Shopify sends us a customer data request for your store, we record it and make the information we hold about that customer available to you in the app within 30 days." |
| M10 | privacy §9 "customer deletion request" | "remove their hash from past simulations and runs" | `privacy.ts:69` corta en 50 hashes (inocuo); no toca `scan_profiles` (se borra sola en ≤25 h). El id de perfil de Klaviyo queda sin plazo (P10) | Ver P10 |
| M11 | privacy §7 | "We are a United States company … transferred to and processed in the United States" | El operador (único con acceso a la base, logs y secretos) está en Argentina según el encargo; el acceso remoto es tratamiento/transferencia | Agregar a §7: "The person who operates and supports TierSaver works from Argentina and can access the data described in section 3 from there for maintenance and support. Argentina is covered by an adequacy decision of the European Commission and by the United Kingdom's adequacy regulations." (verificar vigencia de ambas con el abogado) |
| M12 | privacy §1/§14 y terms §1 | Digital Solvers LLC, 153 E Flagler St | `docs/STATUS.md:207`: domicilio "a confirmar por Facundo"; la cuenta Partner puede estar como Individual (`docs/13-INSTRUCTIVO-CUENTAS.md:16`) | No publicar como vigente hasta confirmar que la LLC existe, el domicilio es el registrado y la cuenta Partner y la app de Klaviyo están a nombre de la misma entidad. Si no, el responsable identificado en la política no es quien trata los datos |
| M13 | help `data-and-privacy.html`, último párrafo | "privacy policy (draft)" | — | Quitar "(draft)" cuando salga el cartel; hoy `site/build/build.mjs:318-319` todavía dice que hay texto entre corchetes |
| M14 | help "Where it runs" | "run on Cloudflare" | Falta país/región y Argentina | "The app and its database run on Cloudflare, with the database in North America (United States region). See section 7 of the privacy policy." La región ENAM solo consta en `docs/STATUS.md:101`: verificar en el panel antes de afirmarlo |
| M15 | terms §8, 2.º punto | "except to calculate your price and to produce statistics that do not identify you or any person" | No hay código que produzca estadísticas | Quitar la excepción de estadísticas hasta que exista (es uso propio de datos de encargado; bajo CCPA exige compromisos de desidentificación) o acotar: "aggregated counts about our own service (for example, number of cleanups run)" |
| M16 | privacy §8 | "The app requests only the permissions it uses" | Klaviyo `metrics:read` y `usage:read` (opcional) se usan; OK. Shopify `read_orders` OK | Ninguno |
| M17 | privacy §10 | sitio sin cookies ni terceros | `site/_headers` (CSP `default-src 'none'`, `connect-src 'none'`), sin scripts de terceros en `site/src` | Coincide. Falta verificar en el panel que la zona no tenga Web Analytics/Bot Management con cookie `__cf_bm` |

---

## 3. Requisitos de Shopify

Leído hoy: https://shopify.dev/docs/apps/launch/protected-customer-data , https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance , https://shopify.dev/docs/apps/launch/privacy-requirements , https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements , https://help.shopify.com/en/partners/ppa-api-faq .
**No leído**: API License and Terms of Use y Partner Program Agreement (`www.shopify.com` bloqueado). La FAQ confirma que hay versión vigente desde el 27 de febrero de 2026 que restringe el uso de Merchant/Customer Data y prohíbe usarlos (incluso derivados o agregados) para entrenar IA sin consentimiento escrito. [De memoria, sin verificar: los API Terms exigen política de privacidad, avisar a Shopify de incidentes de seguridad y borrar datos a pedido del merchant o de Shopify.] Hay que leerlos antes de enviar a revisión.

El mail es campo de **nivel 2**, así que aplican nivel 1 + nivel 2.

### Nivel 1

| Requisito (shopify.dev) | Estado | Evidencia / qué falta |
| --- | --- | --- |
| Procesar el mínimo | **Cumple** en la consulta GraphQL; **pendiente** en el webhook (P11) | `purchases.ts:98-115` |
| Informar a los merchants qué y por qué | **Cumple** | privacy §3–4 (con los ajustes de §2) |
| Limitar a los fines declarados | **Cumple** | sin usos secundarios en código; ver M15 |
| Respetar consentimiento | **Cumple / n.a.** | la app no cambia consentimiento; no suprime a quien no puede recibir marketing |
| Opt-out de "data sale/sharing" | **n.a.**, declarado | privacy §4 "do not sell". Agregar "or share" (§5.2) |
| Decisiones automatizadas con efecto significativo: opt-out | **Falta frase** | El modo automático suprime sin revisión caso por caso. Efecto: dejar de recibir marketing; no es "legal o similarmente significativo". Agregar a privacy §4: "Cleanups, including automatic ones, only stop marketing email to a profile. They are not decisions that produce legal or similarly significant effects on a person. A customer who wants to receive the store's email again can resubscribe, and the store can restore any profile." |
| **Acuerdos de privacidad y protección de datos con los merchants** | **No cumple del todo** | terms §8 es un resumen; no hay DPA (P1) |
| **Plazos de retención** | **Parcial** | Hay plazos para datos de trabajo y post-desinstalación; no para `purchase_hashes`, `run_profiles`, `events_log` mientras está instalada (P8) |
| Cifrado en reposo y en tránsito | **Cumple con salvedad** | Tokens: AES-256-GCM a nivel app. Resto: depende del cifrado en reposo de D1 por Cloudflare [de memoria: D1 cifra en reposo; pedir la página de Cloudflare como evidencia]. TLS: sí |

### Nivel 2

| Requisito | Estado | Qué falta |
| --- | --- | --- |
| Cifrar los backups | **A documentar** | Los únicos backups son Time Travel de D1. Guardar como evidencia la doc de Cloudflare sobre cifrado; **nunca** exportar la base (`wrangler d1 export`) a una máquina sin disco cifrado: escribirlo en la política interna |
| Separar datos de prueba y de producción | **No cumple** (P13) | Un solo D1 `tiersaver` y un solo Worker; `KLAVIYO_SEEDED_ACCOUNT_ID` de prueba vive en el mismo deploy (`wrangler.jsonc:44`) |
| Estrategia de prevención de pérdida de datos | **Falta política escrita** | 1 página: quién accede, prohibición de exportar, secretos solo en `wrangler secret`, sin copias locales |
| Limitar acceso del personal | **De hecho sí (una persona); falta escribirlo** | Listar cuentas con acceso al Cloudflare de TierSaver, Partner Dashboard, Klaviyo dev. Ojo: en esta sesión hay credenciales de Cloudflare de otras cuentas del dueño; la cuenta dedicada de TierSaver debe tener solo los miembros necesarios |
| Contraseñas fuertes | **Falta evidencia** | 2FA obligatorio en Cloudflare, Shopify Partners, Klaviyo, GitHub, registrador. Klaviyo además pide MFA (§4.2) |
| **Registro de accesos a datos protegidos** | **Parcial** | En la app: `events_log` registra quién descarga el CSV y quién aprueba. Falta: acceso del operador a D1 (usar Audit Logs de Cloudflare y revisarlos; anotarlo en la política) |
| **Política de respuesta a incidentes** | **No existe** | Ver documento D3 abajo |

### Webhooks de cumplimiento (https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

| Requisito | Estado |
| --- | --- |
| Suscripción a los tres temas | Cumple (`shopify.app.toml:33-35`) |
| 401 con HMAC inválido, 200 al recibir | Cumple (`authenticate.webhook`; spike en `docs/02`) |
| "Complete the action within 30 days" | `customers/redact` y `shop/redact`: inmediato. **`customers/data_request`: no se hace nada (P2)** |
| `customers/data_request`: "provide to the store owner directly" | **No cumple** (P2) |
| `shop/redact` 48 h después de desinstalar | Cumple si llega (P4) |

### Requisitos del App Store

- Política de privacidad enlazada desde la ficha (privacy-requirements): existe, pero hoy está servida en `tiersaver-site.tiersaver.workers.dev` con cartel de borrador (`wrangler.jsonc:46`). **Pendiente**: dominio final y sin cartel antes de enviar.
- Contenido recomendado de la política: datos vía API ✔, de merchants ✔, de clientes ✔, usos ✔, **retención** (parcial, P8), **si el desarrollador está en Europa y si procesa fuera de Europa** (parcial: falta Argentina, M11), contacto y domicilio ✔ (a confirmar, M12).
- 3.1.2 tokens offline con vencimiento: cumple (`shopify.server.ts:44`, `expiringOfflineAccessTokens`).
- 3.2 / 3.2.1 `read_all_orders`: hay que "demostrar la necesidad". Justificación lista en `docs/02`.

---

## 4. Requisitos de Klaviyo

### 4.1 API Terms (https://www.klaviyo.com/legal/api-terms , "Updated: November 12, 2026", leída hoy)

| Cláusula | Estado |
| --- | --- |
| "you must maintain a user agreement and a legally compliant privacy policy" / política que describa "clearly and accurately" | Cumple con los ajustes de §2 |
| "obtain express permission from users before you access their Klaviyo accounts" | Cumple (OAuth + botón Connect) |
| "immediately delete a user's data if the user requests deletion or terminates their account with you" | **Parcial**: tokens al instante; el resto a las 48 h; copias Time Travel hasta 30 días. No hay botón "delete my data now" ni borrado al **desconectar** Klaviyo sin desinstalar (los `run_profiles`, `simulation_candidates` y `audits` quedan). Arreglo: (a) texto M1; (b) decidir si "Disconnect Klaviyo" ofrece "also delete history"; (c) runbook para el pedido por mail que promete privacy §9 (un `DELETE FROM shops WHERE shop=?` manual documentado) |
| "appropriate technical and organizational security measures" | Técnicas: sí. Organizativas: faltan los documentos de §3 nivel 2 |
| Incidentes: "notify both us and your users", "work with us immediately", "coordinate with us on any public statements before publication" | **Falta en la política de incidentes (D3)**. No hace falta ponerlo en los términos con el merchant, pero privacy §8 no debe prometer comunicados unilaterales (hoy no lo hace) |
| Derecho de auditoría de Klaviyo / "provide us with proof" | Tener a mano este inventario y los documentos D1–D4 |
| "(vi) aggregate Klaviyo's data with competitors' data" | Sin riesgo hoy: no hay agregación entre cuentas. El arreglo P3 (hash por tienda) lo vuelve imposible por diseño |

### 4.2 Requisitos para listar la app (https://developers.klaviyo.com/en/docs/prepare_your_app , leída hoy)

| Requisito | Estado |
| --- | --- |
| Scopes mínimos | Cumple (`config.ts:40-85`); `usage:read` es opcional pero se pide siempre junto con los requeridos (`KLAVIYO_SCOPES`): revisar si se puede pedir solo cuando haga falta |
| Credenciales en un almacén de secretos cifrado, rotación periódica | Secrets de Workers ✔. **Falta procedimiento de rotación** de `KLAVIYO_CLIENT_SECRET` y sobre todo de `TOKEN_ENCRYPTION_KEY` (el formato `v1:` permite versionar, pero no hay código de re-cifrado) |
| Cifrar en reposo PII y tokens (AES-256) | Tokens ✔. Los hashes no están cifrados a nivel app: con P3 pasan a ser HMAC con clave fuera de la base, que es el argumento más fuerte |
| MFA para acceso a sistemas con datos | Falta evidencia (§3) |
| "State where user data is stored and processed"; consentimiento explícito si los datos salen de la región del usuario | privacy §7 lo dice; el "consentimiento explícito" para merchants no estadounidenses hoy es la aceptación de términos. Agregar a terms §8: "You agree that we process that data in the United States and, for operation and support, from Argentina, as described in the privacy policy." |
| **Logs de accesos, cambios, borrados y llamadas API; a prueba de manipulación; retención mínima 365 días; monitoreo y alertas** | **No cumple** (P9): `events_log` se borra con `shop/redact` y es una tabla común; Workers Logs dura 7 días; no hay alertas |
| Manejo completo de instalación/desinstalación en OAuth; revocar tokens | Cumple (`disconnect`), con la salvedad M7 |
| Vulnerabilidades críticas en 3 días, altas en 7 | Falta proceso (Dependabot/`npm audit` en CI) |
| Avisar a clientes de caídas | Falta canal (hoy solo aviso dentro de la app) |

---

## 5. Derecho aplicable: qué documento, cláusula o cambio falta

Los textos legales externos no se pudieron abrir (ver §0). Artículos citados **[de memoria, sin verificar]**; URL oficiales para que el abogado confirme: GDPR https://eur-lex.europa.eu/eli/reg/2016/679/oj ; CCPA regs https://cppa.ca.gov/regulations/ ; LGPD https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm ; PIPEDA https://laws-lois.justice.gc.ca/eng/acts/P-8.6/ ; Ley 25.326 https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790 ; Privacy Act (AU) https://www.oaic.gov.au/privacy/australian-privacy-principles .

### 5.1 GDPR / UK GDPR

**¿Hace falta un DPA? Sí.** Todo merchant de la UE/UK (y todo merchant de afuera que venda a la UE) necesita un contrato art. 28(3) con TierSaver. Hoy se ofrece "write to hello@" y no existe el documento. La cláusula 8 cubre: instrucciones, confidencialidad, seguridad, ayuda con pedidos de titulares, aviso de brechas, borrado. **Le falta**:

1. Objeto, duración, naturaleza y finalidad, tipos de datos y categorías de titulares (encabezado del 28(3)) → Anexo I.
2. Instrucciones documentadas **incluidas las transferencias** (28(3)(a)) y deber de avisar si una instrucción infringe la ley (28(3) in fine).
3. Subencargados: autorización general **con aviso previo y derecho a objetar** (28(2)) y traslado de obligaciones (28(4)). Hoy "update that list before we add one" no notifica a nadie.
4. Ayuda con arts. 32–36 (seguridad, brechas, evaluaciones de impacto) (28(3)(f)).
5. **Borrar o devolver a elección** del responsable (28(3)(g)).
6. **Información y auditorías** (28(3)(h)).
7. Plazo concreto de aviso de brecha (el responsable tiene 72 h, art. 33): comprometer "within 48 hours".

**Documento D1 a crear: `site/src/pages/dpa.html` (Data Processing Addendum), incorporado por referencia**, para que no haya que firmar nada. Cambio exacto en terms §8, reemplazar la última oración ("If the law that applies to you requires a separate data processing agreement, write to…") por:

> "The TierSaver Data Processing Addendum at tiersaver.com/dpa forms part of these terms whenever a data protection law applies to our processing of your customers' personal data. It includes the European Commission's standard contractual clauses and the UK addendum where a transfer requires them. If the two conflict, the Data Processing Addendum prevails on data protection matters."

Contenido mínimo del DPA: Anexo I (partes; titulares: clientes y suscriptores del merchant; datos: id de perfil de Klaviyo, hash del mail, mail en tránsito, fechas, estado de consentimiento/supresión, fecha de último pedido, hash de id de cliente; sin categorías especiales; duración: mientras esté instalada + plazos de privacy §9); Anexo II (medidas: las de privacy §8 + P3 + políticas D2–D4); Anexo III (subencargados: Cloudflare, Inc.; aviso con 30 días por aviso en la app y página pública, derecho a objetar y a desinstalar sin cargo); SCC 2021/914 **Módulo 2** (responsable → encargado) con ley y foro de Irlanda, opción 2 de la cláusula 9 (autorización general), y **Módulo 3** si el merchant es a su vez encargado; UK IDTA Addendum; cláusula CCPA (5.2); cláusula LGPD/ANPD (5.3); Quebec/PIPEDA y APP australianos (5.4, 5.6).

**Transferencias.** EE.UU.: Digital Solvers LLC no está en el Data Privacy Framework → SCC obligatorias para merchants UE/UK; evaluar autocertificación DPF (https://www.dataprivacyframework.gov) como alternativa más simple si la LLC califica (requiere estar bajo jurisdicción de la FTC). Cloudflare: firmar/aceptar el DPA de Cloudflare (incluye SCC, está en DPF [sin verificar]) y guardar copia: es el contrato 28(4) con el subencargado. Argentina: adecuación de la Comisión (Decisión 2003/490/CE, confirmada en la revisión de enero de 2024 [sin verificar]); igual hay que **declararla** (M11) y listarla en el Anexo I.

**Subencargados.** Solo Cloudflare: correcto según el código. Shopify no es subencargado de TierSaver (es plataforma del merchant). Si se usa un proveedor de mail para hello@/support@ (los pedidos de titulares llegan ahí), es proveedor de TierSaver como responsable de esa correspondencia: nombrarlo en privacy §10.

**Registro de actividades (art. 30.2).** La excepción de <250 empleados no aplica a tratamiento no ocasional. **Documento D5: `docs/privacidad/registro-de-tratamiento.md`**, se arma en una hora con el §1 de este informe.

**Representante art. 27.** Para merchants establecidos en la UE, TierSaver queda atado por contrato + SCC; no necesariamente por el art. 3(2). Para merchants de fuera de la UE que venden a la UE, el tratamiento de TierSaver "se relaciona" con esa oferta (Directrices EDPB 3/2018) y no es ocasional → representante en la UE y, por separado, en UK. Costo típico: servicio anual de terceros. **Pregunta concreta al abogado**: ¿se nombra desde el lanzamiento o al primer merchant con clientes UE? Si no se nombra, que quede por escrito la decisión y el disparador. Cuando exista, agregar a privacy §14: "Our representative in the European Union under Article 27 GDPR is [name, address, email]; in the United Kingdom, [name, address, email]."

**DPO.** No obligatorio (sin monitoreo a gran escala ni categorías especiales).

**Pedidos de titulares.** El flujo publicado (titular → tienda → Shopify → webhook → TierSaver → tienda) es correcto para un encargado, pero el eslabón de TierSaver está roto (P2).

**Roles.** privacy §2 dice que para datos del personal del merchant TierSaver es responsable. Para el id de usuario en `events_log` es más defendible ser encargado (se guarda por cuenta del merchant, para su trazabilidad). Dejarlo como pregunta 7 del anexo; no bloquea.

### 5.2 CCPA / CPRA (contrato de service provider)

El reglamento §7051(a) [de memoria] exige que el contrato: (1) prohíba vender **o compartir**; (2) identifique los fines de negocio **específicos**; (3) prohíba retener, usar o divulgar fuera de esos fines y fuera de la relación directa; (4) prohíba **combinar** con datos de otras fuentes; (5) obligue a cumplir la CCPA con el mismo nivel de protección; (6) dé al negocio derecho a verificar el uso; (7) obligue a **avisar en 5 días hábiles si ya no puede cumplir**; (8) dé derecho a frenar y remediar el uso no autorizado; (9) cooperación con pedidos de consumidores; más aviso y traslado a subcontratistas.
Terms §8 cubre 1 (sin "share"), 3 parcial, 9. **Faltan 2, 4, 5, 6, 7, 8.** Texto exacto para agregar como puntos en terms §8 (o en el DPA):

> "- do not sell or share it (as those terms are defined in the California Consumer Privacy Act), and do not retain, use or disclose it outside our direct business relationship with you or for any purpose other than the business purposes of auditing your Klaviyo list, protecting buyers, simulating, suppressing and restoring profiles, and billing you;
> - do not combine it with personal data we receive from or on behalf of anyone else, or collect ourselves;
> - comply with the data protection laws that apply to us as your service provider and give that data the level of protection those laws require, and tell you within five business days if we can no longer do so;
> - let you take reasonable and appropriate steps to check that we use it consistently with your obligations, and to stop and remediate any unauthorized use."

"Do not combine" hoy es cierto en el código pero frágil: el mismo hash en dos tiendas es el mismo valor (P3).
En privacy §4 cambiar "We do not sell personal data" por "We do not sell or share personal data".

### 5.3 LGPD (Brasil) [de memoria, sin verificar]

TierSaver = operador (art. 5 VII, art. 39: sigue instrucciones del controlador). Falta: (a) registro de operaciones (art. 37) → mismo D5; (b) transferencia internacional (art. 33): la Resolución CD/ANPD 19/2024 fijó cláusulas contractuales estándar propias de la ANPD, exigibles desde agosto de 2025 → **anexo ANPD en el DPA** para merchants brasileños; (c) encarregado: agentes de pequeño porte están dispensados de nombrarlo (Resolución CD/ANPD 2/2022) pero deben dar un canal de contacto → ya está (hello@). Confirmar con abogado brasileño solo si hay merchants de Brasil.

### 5.4 PIPEDA y Quebec (Canadá) [de memoria]

El merchant canadiense sigue siendo responsable de los datos que transfiere para tratamiento (Principio 4.1.3) y debe asegurar protección comparable por contrato → lo cubre el DPA (seguridad, uso limitado, aviso de brechas, borrado). Quebec (Ley 25, arts. 17 y 18.3): contrato escrito con medidas, uso limitado, aviso de incidentes y destrucción, y evaluación previa del merchant para comunicar fuera de Quebec → el DPA debe incluir "we will give you the information you reasonably need to assess a transfer outside Québec". Sin cambio de producto.

### 5.5 Argentina — Ley 25.326 [de memoria; AAIP e Infoleg bloqueados]

- La contraparte es una LLC de Florida, pero quien **trata** los datos (accede a la base, a los logs y a los secretos) es una persona en Argentina. Hay argumento serio de que hay tratamiento en territorio argentino.
- Art. 25 (prestación de servicios de tratamiento por cuenta de terceros): contrato, no usar para otro fin, no ceder, y destruir los datos al terminar (se pueden conservar hasta dos años con autorización). El DPA lo cubre; el borrado a 48 h cumple de sobra.
- Art. 21 / Registro Nacional de Bases de Datos (AAIP): la inscripción de bases privadas que exceden el uso personal es obligatoria y gratuita. **Pregunta concreta para un abogado argentino**: ¿debe inscribirse Facundo (o la LLC como "usuario de datos" con operación local) por la base de TierSaver y por la de contactos de merchants? Si la respuesta es sí, es un trámite por TAD; hacerlo antes del primer merchant real.
- Art. 12 (transferencia internacional) rige para exportar desde Argentina; acá los datos entran, no salen. Los merchants argentinos que usen la app sí exportan a EE.UU. (país sin nivel adecuado para la AAIP): el DPA debe ofrecerles las cláusulas modelo de la Disposición AAIP 60-E/2016 o equivalente.
- Tema aparte, fuera de mi alcance pero conectado: si toda la actividad se dirige desde Argentina, la LLC puede no ser el único sujeto relevante (fiscal y regulatorio). Que el abogado lo vea junto con M12.

### 5.6 Australia [de memoria]

El merchant australiano responde por lo que haga el receptor extranjero (APP 8.1 y s 16C) salvo que lo obligue por contrato a cumplir los APP → una línea en el DPA: "we will handle that data in a way that is consistent with the Australian Privacy Principles". TierSaver probablemente queda bajo la exención de pequeña empresa (facturación < AUD 3 M) mientras no "comercie" con datos. Aviso de brechas (NDB): el plazo de 48 h propuesto alcanza para que el merchant cumpla sus 30 días de evaluación.

---

## 6. Hallazgos en detalle

### P1 — No hay DPA ni mecanismo de transferencia · Alta
- **Evidencia**: `site/src/pages/terms.html` §8 (último párrafo); `privacy.html` §7 ("If the law that applies to you requires a specific agreement for that transfer, write to…"); `docs/16-LEGALES-PARA-ABOGADO.md` §4 ("Mecanismo de transferencia internacional y DPA firmable. No existen todavía"). Shopify nivel 1: "Make privacy and data protection agreements with your merchants".
- **Riesgo**: un merchant de la UE/UK que instala queda en infracción del art. 28 y del capítulo V desde el primer scan; agencias y merchants medianos lo piden antes de instalar; Shopify puede pedirlo en una revisión de datos protegidos.
- **Arreglo**: documento D1 (`dpa.html`) + cambio de terms §8 + puntos CCPA (textos en §5.1 y §5.2). Aceptar el DPA de Cloudflare y archivarlo.

### P2 — `customers/data_request` se descarta sin registro · Alta
- **Evidencia**: `shopify/app/routes/webhooks.compliance.tsx:26-29` (`break` con un comentario que además es falso: dice que lo único que hay es un hash con fecha; también hay id de perfil, motivo, estado y fechas en `run_profiles` y `simulation_candidates`, como reconoce privacy §9). No hay `logEvent`, ni tabla, ni aviso. No hay script de consulta en `scripts/`.
- **Requisito**: "The webhook contains the resource IDs of the customer data that you need to provide to the store owner directly"; "Complete the action within 30 days" (https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance).
- **Riesgo**: incumplimiento directo de un requisito obligatorio del App Store y de la promesa de terms §8 ("help you respond … including through Shopify's privacy requests"). El merchant no sabe que tiene que escribir a hello@, y TierSaver no sabe que llegó el pedido.
- **Arreglo de código** (chico):
  1. En `data/privacy.ts`, nueva `collectCustomerData(db, shop, {id, email})`: calcula los hashes como `redactCustomer`, y devuelve `{ purchase: {lastOrderAt} | null, profiles: [{ klaviyoProfileId, runId|simulationId, reason, status, updatedAt, reactivatedAt }] }` buscando por `email_hash` en `purchase_hashes`, `run_profiles` (índice `run_profiles_shop_hash_idx` ya existe) y `simulation_candidates`.
  2. Nueva tabla `privacy_requests (id, shop → shops ON DELETE CASCADE, kind, shopify_request_id, received_at, result_json, delivered_at)`; `result_json` sin mail (el merchant ya sabe de qué cliente es por el id del pedido en Shopify; guardar el `customer.id` de Shopify, que el merchant ya tiene).
  3. En el `case "CUSTOMERS_DATA_REQUEST"`: guardar la fila y `logEvent(… action: "privacy.data_request_received")`. Hacer lo mismo (solo el log, sin datos) para `CUSTOMERS_REDACT`: hoy tampoco queda constancia de haber cumplido.
  4. En la app: aviso en Home ("A customer data request is ready") y descarga del JSON desde Settings. Eso es "entregar al dueño de la tienda directamente" sin mandar mails.
  5. Purga: borrar `privacy_requests` a los 90 días en `housekeeping.ts`.
- **Texto**: M9.

### P3 — Hashes SHA-256 sin clave, iguales en todas las tiendas · Alta
- **Evidencia**: `packages/core/src/email-hash.ts:9-13` (`SHA-256(trim+lowercase(email))`); usado en `purchase_hashes`, `simulation_candidates`, `run_profiles`, `scan_profiles`. `hashCustomerId` (`data/privacy.ts:9-13`) es `SHA-256("shop:id")` sobre un id numérico secuencial: se enumera en minutos.
- **Riesgo**: (a) quien obtenga la base (fuga, copia Time Travel, proveedor) revierte la mayoría de los hashes con listas de mails filtrados: es el formato exacto que usan las redes publicitarias para "matchear" audiencias, y los reguladores (FTC, EDPB) no lo consideran protección; (b) el mismo cliente tiene el mismo valor en todas las tiendas → TierSaver puede, sin querer, saber que una persona compra en N merchants: contradice "do not combine" (CCPA) y la separación entre responsables; (c) debilita la justificación de minimización ante Shopify para un campo de nivel 2.
- **Arreglo de código**: HMAC-SHA-256 con clave por tienda derivada de un secreto del Worker.
  - `packages/core/src/email-hash.ts`: `hashEmail(email, key: CryptoKey)` → `HMAC(key, normalizeEmail(email))`; `deriveShopHashKey(secret, shop)` con HKDF (`info = "tiersaver/email-hash/v1/" + shop`), igual que `deriveKey` en `klaviyo/oauth.ts:103-119`.
  - Secreto nuevo `HASH_PEPPER` (no reutilizar `TOKEN_ENCRYPTION_KEY`: así se puede rotar por separado).
  - Pasar la clave en los cinco puntos de uso: `orders/purchases.ts:64`, `klaviyo/api.ts:244`, `runs/gateway.server.ts:121`, `data/privacy.ts:49`, y `hashCustomerId`.
  - El cruce sigue funcionando: los dos lados (pedido y perfil) los calcula la app para la misma tienda; `customers/redact` recibe el mail y recalcula.
  - Migración: no hay merchants reales; vaciar `purchase_hashes`, `simulation_candidates`, `scan_profiles` y los `email_hash` de `run_profiles` de la tienda de desarrollo y volver a correr el backfill.
- **Texto** (privacy §3 y §8, help "How hashes are used"): reemplazar "a SHA-256 hash" por "a keyed hash (HMAC-SHA-256, with a secret key that is unique to each store and kept outside the database)" y la frase de seudonimización por: "They are pseudonymized data, not anonymous data: they still relate to a person and we treat them as personal data. Without the key, a hash cannot be computed from an email address, and the hashes of one store cannot be matched with those of another."

### P4 — Sin purga de respaldo si `shop/redact` no llega · Alta
- **Evidencia**: `data/privacy.ts:20-29` (`handleUninstall` deja todo menos los tokens); `data/housekeeping.ts` no mira `shops.status = 'uninstalled'`. Además `deleteShopData` es un único `DELETE` con cascada sobre tablas que pueden tener cientos de miles de filas (`purchase_hashes` de todo el historial, `run_profiles`): si D1 corta la consulta por tiempo o tamaño, el webhook devuelve 500, Shopify reintenta y al final desiste [límites de D1 no verificados para este caso].
- **Riesgo**: datos personales de clientes de un merchant que ya se fue, retenidos indefinidamente; contradice privacy §9, terms §8, Klaviyo ("immediately delete") y art. 28(3)(g).
- **Arreglo de código**:
  1. En `purgeStaleData`: `DELETE` por tandas de las tiendas con `status='uninstalled' AND uninstalled_at < now − 10 días` (hijos primero, en lotes de ~5.000 filas con `LIMIT`, y al final `shops`). Reutilizar esa misma rutina por tandas dentro de `deleteShopData`.
  2. Registrar el resultado en un log sin datos (`console.log("shop data purged")`), ya que `events_log` se va con la tienda.
  3. Test: tienda desinstalada hace 11 días sin `shop/redact` → no queda ninguna fila.
- **Caso borde a verificar**: reinstalación dentro de las 48 h. `ensureShop` revive la fila (`purchases.ts:41-52`); si Shopify igual manda `shop/redact`, `deleteShopData` borra la sesión y todo lo de una tienda **instalada**. La doc de Shopify no dice qué pasa al reinstalar. Defensa barata: en `SHOP_REDACT`, si `shops.status='installed'` y `installed_at > uninstalled_at` previo, borrar solo los datos anteriores a la reinstalación o, más simple, borrar todo **excepto** `session`/`shops` y relanzar el backfill. Decidir y testear.

### P5 — Políticas internas que Shopify (nivel 2) y Klaviyo exigen y no existen · Alta
- **Evidencia**: `grep -ri incident docs/` solo devuelve menciones en los memos legales; no hay runbook.
- **Documentos a crear** (internos, español, 1–2 páginas cada uno, en `docs/privacidad/`):
  - **D2 `politica-de-acceso-y-dlp.md`**: quién tiene acceso (una persona), 2FA obligatorio en Cloudflare/Shopify Partners/Klaviyo/GitHub/registrador, cuenta de Cloudflare dedicada sin otros miembros, prohibición de `wrangler d1 export` y de consultas ad hoc que devuelvan filas por perfil salvo para un pedido de titular, revisión mensual de Audit Logs de Cloudflare, rotación de secretos (anual y ante sospecha; procedimiento de re-cifrado de tokens con `v2:`).
  - **D3 `respuesta-a-incidentes.md`**: definición, contención (apagar `SUPPRESSION_ENABLED`, rotar `SHOPIFY_API_SECRET`, `KLAVIYO_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `HASH_PEPPER`), evaluación, **avisos**: merchants afectados en ≤ 48 h (aviso en la app + mail al contacto de la tienda: para un incidente está justificado leer `shop.email` en ese momento), **Klaviyo** ("work with us immediately", coordinar comunicados públicos antes de publicar), **Shopify** (según API Terms, a leer), y registro del incidente. Plantilla de aviso en inglés.
  - **D4 `retencion.md`**: la tabla de §1 con los plazos definitivos (P8).
  - **D5 `registro-de-tratamiento.md`** (art. 30.2 GDPR / art. 37 LGPD).
- **Texto** (privacy §8, reemplazar la última oración): "If we learn of a breach affecting personal data, we will notify the affected merchants without undue delay and no later than 48 hours after we confirm it, with the information they need to meet their own obligations." (y lo mismo en terms §8, 6.º punto).

### P6 — Argentina y entidad sin confirmar · Media-alta
Ver M11, M12 y §5.5. Sin eso la política identifica mal dónde y quién trata.

### P7 — URLs completas en los logs de Cloudflare · Media
- **Evidencia**: `wrangler.jsonc:8`; rutas con secretos en la query: `/klaviyo/oauth/callback?code=…&state=…` y `/app/klaviyo/finish?code=…&state=…` (`flow.server.ts:128-150`), `/klaviyo/oauth/start?ticket=…`, y toda carga embebida con `id_token`, `hmac`, `host`, `shop` que agrega Shopify. El código de Klaviyo además viaja por `admin.shopify.com` (historial del navegador y logs de Shopify).
- **Riesgo real**: bajo para el código (vive 5 minutos, un solo uso, atado por PKCE a un verificador que nunca sale del servidor: buen diseño, `oauth.ts:121-126`) y para el `id_token` (≈1 minuto). Pero son credenciales en logs de un tercero y la política tuvo que retroceder a "the app does not write…".
- **Arreglo**: en `wrangler.jsonc`: `"observability": { "enabled": true, "logs": { "invocation_logs": false } }` (opción documentada en https://developers.cloudflare.com/workers/observability/logs/workers-logs/ ). Se conservan los `console.*` propios, que ya están saneados. Si se quiere traza de pedidos, agregar un `console.log` propio con método + `pathname` (sin query). Reemplazar además `console.error(error)` de `entry.server.tsx:25` por `console.error(error instanceof Error ? error.name : "render_error")`.
- **Texto** (privacy §9): "We keep our own operational logs for up to 7 days. They record the time, the path requested (without its parameters), counts and error codes. They do not contain customer email addresses, names, access tokens or authorization codes."
- Opcional: pasar `code`/`state` del callback a la app embebida por POST no es posible dentro del admin; alternativa más limpia es hacer el intercambio en el callback y dejar solo un ticket opaco de un uso para el paso embebido. No es necesario para lanzar.

### P8 — Sin retención mientras la app está instalada · Media
- **Evidencia**: `housekeeping.ts` solo purga datos de trabajo. `purchase_hashes` crece con todo el historial desde 2004 (`purchases.ts:27`); `run_profiles` y `simulation_candidates` de corridas ejecutadas no vencen nunca; `events_log` tampoco. Shopify nivel 1: "Apply retention periods to make sure that personal data isn't kept for longer than needed".
- **Propuesta** (decisión de Facundo; toca la promesa "todo es reversible"):
  - `run_profiles` y `simulation_candidates` de corridas ejecutadas: borrar el `email_hash` a los 30 días de terminada la corrida (ya no hace falta: solo sirve para validar el mail al suprimir; el deshacer usa el id de perfil). Borrar las filas por perfil a los **24 meses**; quedan los contadores en `runs`. El deshacer de una corrida de más de 2 años deja de estar disponible: decirlo en terms §4.
  - `purchase_hashes`: es la regla "nunca compró" → no vence mientras esté instalada; justificarlo en D4 y en la política ("kept for as long as the app is installed, because the default rule protects anyone who has ever purchased").
  - `events_log`: 24 meses (ver P9).
- **Texto** (privacy §9, primer punto): agregar "The email hash of a profile in a cleanup is removed 30 days after the cleanup ends. The per-profile history of a cleanup is deleted 24 months after it ran; its totals are kept, and it can no longer be undone from the app after that."

### P9 — Logs de 365 días que pide Klaviyo vs. borrado a 48 h · Media
- **Evidencia**: https://developers.klaviyo.com/en/docs/prepare_your_app ("Retain logs for a minimum of 365 days", "tamper-evident", registrar accesos, cambios, borrados y llamadas API). `events_log` cae en cascada con `shops`. Pregunta R2 del memo.
- **Propuesta**: tabla nueva `compliance_log` **sin FK a `shops`** y sin datos de clientes: `(id, at, shop_domain, actor_kind, action, counts, terms_version)`. Solo agrega filas (sin `UPDATE`/`DELETE` en el código; "tamper-evident" se refuerza encadenando `prev_hash`). Retención 24 meses, también después de desinstalar. Cubre: evidencia de aprobaciones (cláusula 3 de los términos), cumplimiento de webhooks de privacidad, requisito de Klaviyo.
- **Conflicto**: el dominio de la tienda y el id de usuario del personal son datos del merchant; conservarlos 24 meses tras desinstalar exige decirlo. Guardar el actor como `user`/`schedule`/`webhook` sin el id.
- **Texto** (privacy §9): "After uninstall we keep, for 24 months, a minimal record that contains no customer data: the store domain, the dates and types of actions taken (for example, a cleanup approved, the number of profiles suppressed, the version of the terms accepted, charges created) and the privacy requests we processed. We keep it to show what was done and authorized, to meet our obligations to Shopify and Klaviyo, and to handle disputes." Y corregir "We keep no charge records after that deletion".
- Necesita OK del abogado (base: interés legítimo / defensa de reclamos, art. 17(3)(e) GDPR) y que Shopify lo admita ("legally required to retain" es la única excepción que nombra la doc; un registro sin datos de clientes no es dato de clientes de Shopify).

### P10 — `customers/redact` conserva el id de perfil de Klaviyo · Media
- **Evidencia**: `data/privacy.ts:39-43, 75-89`: borra `purchase_hashes` y pone `email_hash = NULL`; las filas de `run_profiles`/`simulation_candidates` quedan con id de perfil, motivo, estado.
- **Análisis**: el id de perfil identifica a la persona en la cuenta de Klaviyo del merchant. El merchant, al borrar al cliente, normalmente también lo borra en Klaviyo (la integración Shopify–Klaviyo lo propaga [sin verificar]) y el id queda huérfano; si no, sigue apuntando a una persona. Conservarlo "para poder deshacer" es defendible pero débil cuando el titular pidió el borrado: restaurar el marketing a alguien que pidió ser borrado es justo lo que no hay que poder hacer.
- **Arreglo**: en `redactCustomer`, además de anular el hash, marcar esas filas con `status='skipped'`, `error_code='redacted'` y reemplazar `profile_id` por un valor opaco (`"redacted:" + random`), de modo que un deshacer posterior las saltee. Los contadores de la corrida no cambian.
- **Texto** (privacy §9): "…we delete that customer's hashed purchase record and remove their hash and their Klaviyo profile ID from past simulations and cleanups. A later undo does not restore that profile."
- También: registrar el evento (P2.3).

### P11 — `orders/create` sin filtro de campos · Media (antes de activarlo)
- **Evidencia**: `shopify.app.toml:27-29` (comentado); `routes/webhooks.orders.create.tsx:6-12` usa `email`, `processed_at`, `created_at`, `test`, `customer.id`.
- **Riesgo**: recibir nombre, direcciones, teléfono y líneas de cada pedido (todo nivel 2) en memoria y, según el plan, en logs de la plataforma; obliga a pedir más campos protegidos de los que la app usa.
- **Arreglo**: al activar la suscripción: `include_fields = ["id", "email", "processed_at", "created_at", "test", "customer"]` (sintaxis de `shopify.app.toml` a confirmar en https://shopify.dev/docs/apps/build/webhooks/customize/modify-payloads ; `customer` no se puede recortar a `customer.id` en REST-shape: verificar). Luego cambiar privacy §3: quitar "Order notifications sent by Shopify can contain other order details. The app does not use or store them." y poner "Order notifications are limited to those same fields."

### P13 — Un solo ambiente · Media
- **Evidencia**: `wrangler.jsonc` sin `env`; un D1; `application_url` en `workers.dev`; `KLAVIYO_SEEDED_ACCOUNT_ID` en `vars` de ese mismo deploy.
- **Requisito**: nivel 2 "Keep test and production data separate".
- **Arreglo**: `env.production` con su propio D1, sus propios secretos (otra `TOKEN_ENCRYPTION_KEY` y `HASH_PEPPER`) y sin `KLAVIYO_SEEDED_ACCOUNT_ID`; app de Shopify separada para desarrollo (`shopify.app.dev.toml`). Hacerlo antes del primer merchant real.

### P14 — Otros
- **Cookie**: estrictamente necesaria, declarada: sin banner. OK.
- **Aviso a titulares**: correcto que la política mande al titular a la tienda. Sugerir a los merchants (help) una línea para su propia política: "We use TierSaver (Digital Solvers LLC, USA) to keep our email list clean; it processes pseudonymized identifiers of subscribers."
- **Menores, venta, publicidad**: declarado; coincide con el código.
- **`KLAVIYO_SCOPES`** pide `usage:read` siempre: si Klaviyo revisa "mínimo de scopes", o se justifica o se pide aparte.
- **Sitio**: confirmar en el panel de Cloudflare que no haya Web Analytics ni cookies de bot management en la zona de tiersaver.com cuando se mueva el dominio.

---

## 7. Desinstalación y borrado: verificación

| Momento | Qué hace el código | ¿Completo? |
| --- | --- | --- |
| `app/uninstalled` (`webhooks.app.uninstalled.tsx`) | HMAC; `disconnect()` → `POST /oauth/revoke` del refresh token en Klaviyo, **un intento, error ignorado** (`connection.server.ts:349-367`); borra fila de `klaviyo_connections`; `handleUninstall` borra `session` y marca la tienda | Tokens: sí. Revocación: mejor esfuerzo (M7). Idempotente: sí |
| Entre desinstalación y `shop/redact` | Todo lo demás sigue en la base. Workflows en vuelo fallan al no haber conexión/sesión (el gateway se niega: `klaviyo_not_connected`). El cron no cobra ni escanea tiendas sin conexión | Correcto; ventana de 48 h declarada |
| `shop/redact` (`privacy.ts:32-37`) | Borra `session` y `shops`; cascada a las 12 tablas hijas — verificado en `drizzle/0001_domain.sql` (todas con `ON DELETE CASCADE`; `scan_profiles`, `scans`, `klaviyo_oauth_attempts` en 0003/0005 según `schema.ts`). `runs.undo_of_run_id` no tiene FK pero la fila cae por `shop` | Sí, **si llega y si el DELETE entra en los límites de D1** (P4) |
| Lo que **no** se borra | Copias Time Travel (hasta 30 días, M1); logs de Workers (7 días, con URLs: P7); estado de Workflows (7–30 días, solo ids); el segmento "TierSaver · candidates" y las supresiones en Klaviyo (declarado); cargos en Shopify (declarado) | Declarar plazos (M1, M2) |
| D1: ¿FK activas? | D1 las aplica por defecto [de memoria; el test `test/schema.test.ts` y los tests de privacidad deberían cubrir la cascada contra `workerd`: confirmar que existe un test de `deleteShopData` que cuente filas en todas las tablas] | A confirmar con un test |

Conclusión: el diseño borra todo, pero depende de un único webhook sin red de seguridad, y la revocación en Klaviyo no deja rastro si falla.

---

## 8. Orden sugerido antes de lanzar

1. Código (≈1–2 días): P3 (HMAC por tienda), P2 (data_request), P4 (purga de respaldo + borrado por tandas), P7 (`invocation_logs: false`), P10, M5, M7, P11 al activar el webhook, P13.
2. Documentos internos: D2–D5 (medio día con este informe como base).
3. Con el abogado: D1 (DPA + SCC + UK + cláusulas CCPA/LGPD/AU/Quebec), P9 (registro mínimo post-desinstalación), art. 27, Argentina/AAIP, M12.
4. Textos: aplicar M1–M15 y los párrafos de P3, P5, P7, P8, P9, P10 en `privacy.html`, `help/data-and-privacy.html` y `terms.html` §8.
5. Leer (persona o sesión con acceso a `www.shopify.com`): Shopify API License and Terms of Use y Partner Program Agreement, y contrastar con §3.

## 9. Fuentes

Leídas hoy (2026-11-26):
- https://shopify.dev/docs/apps/launch/protected-customer-data
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://shopify.dev/docs/apps/launch/privacy-requirements
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://help.shopify.com/en/partners/ppa-api-faq
- https://www.klaviyo.com/legal/api-terms (Updated: November 12, 2026)
- https://developers.klaviyo.com/en/docs/prepare_your_app
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workflows/reference/limits/

No se pudieron abrir (host fuera de la red permitida de la sesión): `www.shopify.com` (API Terms, Partner Program Agreement), `www.shopify.es`, `gdpr-info.eu`, `www.law.cornell.edu`, `www.argentina.gob.ar`, `servicios.infoleg.gob.ar`. `https://developers.klaviyo.com/en/docs/app_listing_requirements` dio 404 (la página vigente es `prepare_your_app`).

Las herramientas de lectura resumen las páginas; las citas entre comillas son frases cortas devueltas por la herramienta, no una transcripción completa. Antes de citar en un documento legal, releer la fuente.
