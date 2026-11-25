# Instructivo: cuentas de Shopify y Klaviyo

Armado con la documentación oficial leída el 2026-11-25. Nada de esto se probó contra las plataformas: los nombres de botones salen de la documentación y pueden diferir un poco. Las fuentes están al final.

Regla general: los secretos (client secret, tokens, claves) nunca van por chat. Se cargan como variable del entorno "tiersaver" de Claude Code o por el formulario seguro que abre la sesión.

## A. Shopify

### A1. Cuenta de Partner

1. Entrar a https://partners.shopify.com/signup → **Continue with email** y completar el alta de la organización.
2. Entrar a https://dev.shopify.com/dashboard/ → **Organization settings** → **Organization** → **Contact details**: cargar un mail de negocio y verificarlo.

Para saber antes de empezar:
- No se encontró ningún costo por crear la cuenta. El registro en el App Store cuesta US$ 19 una sola vez y hace falta recién para publicar. **Es un gasto: no lo pagues todavía si no querés; para desarrollar no hace falta** (ver "No confirmado", punto 2).
- La LLC no hace falta para crear la cuenta ni la tienda de desarrollo. Se puede empezar como **Individual** y después agregar la LLC como entidad primaria. Sí hace falta antes de cobrar.
- Al registrarse en el App Store, Shopify pide declarar otras cuentas de Partner con 50% o más de control común (no es público). Si tus otros proyectos tienen cuenta de Partner, se declaran ahí.
- La dirección de contacto aparece en la ficha de la app salvo que marques ocultar la calle.
- Instalar apps de terceros en una tienda de desarrollo (la tarea de teardown con ListSweep y Nae) puede pedir verificación de identidad con documento y selfie.

### A2. Tienda de desarrollo

1. Dev Dashboard → **Stores** → **Create store** → tipo **Dev**.
2. Nombre (define la URL `*.myshopify.com`, no se cambia después). Plan **Basic**.
3. **Create store**.
4. Para pedidos de prueba: en la tienda, **Settings → Payments**, buscar `Bogus`, **Activate**. En el checkout: tarjeta número `1`, cualquier CVV.

### A3. Crear la app

1. Dev Dashboard → **Apps** → **Crear app** (con la lista de apps vacía, es el enlace de la barra inferior "Obtener credenciales de API"; no correr el comando `npm init @shopify/app@latest` que muestra esa pantalla: crea un proyecto nuevo y el nuestro ya existe) → **Start from Dev Dashboard** → nombre `TierSaver for Klaviyo` → **Create**.
2. En la app → **Settings**: copiar **Client ID** y **Client secret**.
3. En **Settings** → **App CLI automation token** → **Manage** → **Add service account**: nombre `TierSaver deploy`, vencimiento 90 días, permiso **App development** sobre esta app → **Add service account**. Copiar el token (se muestra una sola vez).
4. Entregar a la sesión: el Client ID y el dominio de la tienda por chat (no son secretos); el Client secret y el token del service account como variables del entorno "tiersaver" (`SHOPIFY_API_SECRET` y `SHOPIFY_SERVICE_ACCOUNT_TOKEN`) y abrir una sesión nueva.
5. La sesión completa `shopify.app.toml`, corre `shopify app deploy` con el token y carga las claves reales en el Worker.
6. Después de ese deploy: **Home** de la app → **Installs** → **Install app** → elegir la tienda → **Install**. Esto solo lo podés hacer vos.

### A4. Permisos especiales (más adelante, Fase 3)

- **Método de distribución**: para pedir datos protegidos hay que elegir antes **Public distribution** en **Home** → **Distribution**. **No se puede cambiar después.** Es tu decisión; coincide con lo ya decidido (app pública del App Store).
- **Datos protegidos (email)**: **Settings → Access requests** → **Protected customer data** → **Manage** → marcar **Customer data** y, en los campos, solo **Email**, con el motivo: "Match recent buyers to Klaviyo profiles so they are never suppressed." En tienda de desarrollo funciona sin revisión.
- **Read all orders**: **Settings → Access requests** → **Read all orders** → **Request access**. Recién cuando Shopify lo apruebe se agrega el scope. Mientras tanto la app ve 60 días de pedidos y, por diseño, no suprime a nadie.

## B. Klaviyo

### B1. Cuenta de prueba

1. Entrar a https://www.klaviyo.com/sign-up con un mail de TierSaver. Si usás el mismo login de otra cuenta de Klaviyo, quedan vinculadas bajo ese login.
2. Completar el asistente. La plataforma de e-commerce se puede saltear (**I'll do this later**).
3. Convertirla en cuenta de prueba: selector de cuenta abajo a la izquierda → **Settings** → **Account** → **Testing** → **Convert to test account**. No se revierte sin soporte. El seed se niega a correr si la cuenta no está marcada así.

Una cuenta de prueba es una cuenta común en plan gratis con una etiqueta; no es un entorno aparte.

### B2. Clave privada

1. **Settings** → **API keys** → **Create Private API Key** → **Custom Key**.
2. Marcar: `accounts:read`, `profiles:read`, `profiles:write`, `lists:read`, `lists:write`, `events:read`, `events:write`, `subscriptions:read`, `subscriptions:write`, `usage:read`, `metrics:read`, `segments:read`, `segments:write`. Las claves no se pueden editar después. (Los tres últimos se agregaron el 2026-11-25: sin ellos no se pueden verificar las métricas ni el segmento que crea la app. La primera clave no los tenía; hay que crear otra.)
3. **Create** y copiar la clave (`pk_...`; se muestra una sola vez).
4. Cargarla como variable `KLAVIYO_TEST_PRIVATE_KEY` del entorno "tiersaver" y abrir una sesión nueva. Pasarle a la sesión por chat el ID de la cuenta (6 caracteres, en Settings) o el nombre de la organización.

### B3. ¿Cobra por pasarse de 250 perfiles? No.

La ayuda de Klaviyo lo dice explícito: "If you are on the free Profiles & Email plan and are over your profile limit, you won't be upgraded but you also cannot send emails (or set flow emails live) until you are under your active profile limit." Y: "Free accounts are not automatically upgraded." Convertir la cuenta en test account no cambia el plan ni la facturación.

Entonces sembrar 3.000 perfiles en la cuenta gratis solo bloquea los envíos, que además es una protección contra mandar mails por error. Cuidado: si alguna vez se paga un plan en esa cuenta, pasa a regir la suba automática de plan por cantidad de perfiles.

### B4. Dominio para los mails ficticios

Klaviyo descarta en silencio eventos (y, según su FAQ, también perfiles) con direcciones `@example.com`, `@test.com` "o similares". Hace falta un dominio propio que no reciba correo.

Decidido por Facundo el 2026-11-25: `seed.tiersaver.com`. No hace falta crear ningún registro DNS: alcanza con que **no exista** ningún registro `seed` (A, AAAA, CNAME, MX) ni un comodín `*` en la zona de tiersaver.com, y con no activar Email Routing para ese subdominio. Como la zona se muda de cuenta el 2026-12-05, hay que volver a mirarlo después de la mudanza.

El seed se corre con `--email-domain seed.tiersaver.com`.

## No confirmado

1. Los campos exactos del formulario de alta de Partner.
2. Si elegir **Public distribution** exige haber pagado antes los US$ 19.
3. Si `read_all_orders` funciona en tienda de desarrollo antes de la aprobación.
4. Si la página **Versions** del dashboard deja cargar las URLs de redirección (por eso se usa el archivo TOML y `shopify app deploy`).
5. El flujo completo service account → deploy → instalación: armado desde la documentación, no probado.
6. Si la cuenta gratis de Klaviyo pide tarjeta en el alta.
7. Si la API de Klaviyo frena el import por encima de 250 perfiles, o si importar miles de direcciones inexistentes dispara alguna revisión de la cuenta.
8. Qué dominios entran en "o similares".

## Fuentes (leídas el 2026-11-25)

- shopify.dev/docs/apps/build/dev-dashboard/migrate-from-partners
- shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard
- shopify.dev/docs/apps/build/stores/development-stores
- shopify.dev/docs/apps/build/cli-for-apps/service-accounts
- shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service
- shopify.dev/docs/apps/launch/distribution/revenue-share y /select-distribution-method
- shopify.dev/docs/apps/launch/protected-customer-data
- shopify.dev/docs/api/usage/access-scopes#orders-permissions
- help.shopify.com/en/partners/manage-account/business-details, /contact-information, /associated-accounts
- developers.klaviyo.com/en/docs/create_a_test_account
- developers.klaviyo.com/en/docs/authenticate_
- developers.klaviyo.com/en/reference/events_api_overview
- developers.klaviyo.com/en/docs/custom_integration_faqs
- help.klaviyo.com/hc/en-us/articles/115000976672, /33136281415451, /360050759151
