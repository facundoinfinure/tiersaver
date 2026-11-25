# Lanzamiento en el Shopify App Store

Los requisitos cambian. Antes de preparar el envío, leer la página vigente: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements

## Lo verificado el 25 de noviembre de 2026

- Cobro: solo por Shopify App Pricing o la Billing API. Sin cobro por fuera.
- Webhooks de cumplimiento obligatorios para toda app del App Store: `customers/data_request`, `customers/redact`, `shop/redact`. Deben verificar el HMAC y responder 401 si es inválido. Si faltan o no responden bien, la app se rechaza.
- `shop/redact` llega 48 horas después de la desinstalación: ahí se borran los datos de la tienda.
- Ícono: 1200 × 1200 px, JPEG o PNG.
- La app debe estar libre de errores, incluso menores, para completar la revisión.
- Desde el 4 de noviembre de 2026 hay límites de envío de apps nuevas por organización (una sola app nueva en revisión a la vez, más un segundo requisito). Leer el detalle en la página de envío antes de planificar fechas: https://shopify.dev/docs/apps/store/review/app-submission
- El mail de contacto del envío es donde Shopify escribe durante la revisión.

## Checklist previo al envío

Funcional
- [ ] Instala y desinstala limpio en una tienda de desarrollo nueva.
- [ ] OAuth de Shopify sin pantallas intermedias propias antes de autenticar.
- [ ] Todas las pantallas en Polaris, sin errores de consola.
- [ ] Estados vacíos y de error diseñados.
- [ ] Cobro probado en modo test: aceptar, rechazar, llegar al tope.
- [ ] Webhooks de cumplimiento respondiendo y verificando HMAC.
- [ ] Scopes mínimos; cada uno justificado por escrito.
- [ ] Si se leen datos protegidos de clientes: solicitud de acceso completada.

Contenido
- [ ] Nombre y subtítulo sin promesas que no se puedan probar.
- [ ] Capturas reales de la app (no mockups).
- [ ] Video corto de demostración.
- [ ] Política de privacidad y términos publicados en tiersaver.com.
- [ ] Mail y URL de soporte funcionando.
- [ ] Instrucciones de prueba para el revisor, con credenciales de una cuenta de Klaviyo de prueba si hacen falta.

Operación
- [ ] Monitoreo de errores activo.
- [ ] Centro de ayuda con: cómo funciona, qué es suprimir, cómo deshacer, cómo se cobra, qué pasa al desinstalar.
- [ ] Bot de soporte respondiendo con esos artículos y escalando a Facundo lo que toque dinero o datos.

## Ficha (borrador en inglés)

**Name**: TierSaver for Klaviyo

**Subtitle**: Lower your Klaviyo bill by suppressing inactive profiles

**Introduction**: Klaviyo bills for every active profile, even the ones that never open. TierSaver finds them, shows your savings, and suppresses them before your billing date.

**Details**: Run a free audit to see your current tier, the tier you could be on, and the estimated monthly savings. Set protection rules so recent buyers, recent clickers, SMS subscribers and VIPs are never touched. Simulate every cleanup before it runs, schedule it ahead of your billing date, and undo any run. You pay a share of what you save, and nothing when there are no savings.

**Features**
- Free audit with estimated savings in dollars
- Protection rules for buyers, clickers, SMS and VIP segments
- Simulation before every cleanup, with one-click undo
- Scheduled runs ahead of your Klaviyo billing date
- Monthly savings report

**Palabras clave**: reduce Klaviyo bill, Klaviyo cost, suppress inactive profiles, list cleaning, sunset flow.

No afirmar un porcentaje de ahorro en la ficha hasta tener datos propios.

## Video

Opción: skill brag (github.com/latent-spaces/brag), que arma un video corto de lanzamiento a partir del proyecto. Pide Node 22, FFmpeg y la CLI de Hyperframes. No fue probado. Alternativa: grabación de pantalla del flujo real con subtítulos.

## Después del envío

- La revisión suele tardar una o dos semanas (estimación; no es un plazo garantizado).
- Responder las observaciones el mismo día.
- Mientras tanto: beta con las tiendas que lleguen por agencias, usando el link de instalación directo.
