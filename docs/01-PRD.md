# PRD · TierSaver: List Hygiene for Klaviyo (MVP)

Actualizado el 2026-11-25 con las cuatro decisiones de Facundo posteriores a `12-CUMPLIMIENTO-KLAVIYO.md`: precio fijo, sin reactivación automática, criterios de Klaviyo por defecto y reglas de texto obligatorias. Las reglas de producto de la sección 3.1 de ese documento valen para todo lo que sigue.

## Usuario

- **Merchant**: marca de Shopify con 5.000 a 150.000 perfiles en Klaviyo, sin agencia de retención. Quiere una lista sana sin trabajo manual, sin perder ventas ni romper nada.
- **Agencia o freelancer de Klaviyo** (segunda etapa): maneja varias cuentas y hoy limpia a mano.

## Problema

La lista del merchant acumula perfiles que nunca interactuaron. Limpiarla a mano es tedioso, hay que repetirlo todos los meses y da miedo suprimir a alguien que compra.

## Promesa

"Keeps your Klaviyo list clean by suppressing profiles that never engaged, using Klaviyo's own recommended criteria." La app simula antes de tocar nada, pide aprobación, corre todos los meses, registra todo y permite deshacer.

El efecto en el plan de Klaviyo no es la promesa. Se informa como hecho citado de Klaviyo y en segundo plano: "Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, you can move to a lower plan in Klaviyo's billing settings."

## Alcance del MVP

### 1. Instalación y conexión
- Instala desde Shopify (app embebida).
- Conecta Klaviyo con el método que resulte de la verificación en `02-ARQUITECTURA.md` (OAuth preferido).
- Conexión con OAuth de Klaviyo (confirmado: funciona sin estar listada en su marketplace).
- Paso informativo de onboarding: la app explica dónde está el auto-downgrade de Klaviyo (Billing > Preferences; solo Owner o Admin). La app nunca cambia el plan ni esa opción, y no le pide al merchant que se comprometa a bajar de plan. Aviso a mostrar: "Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo."
- Avisos antes de la primera aprobación, y resumidos antes de cada corrida (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 4.1): un perfil suprimido deja de recibir marketing aunque después compre; quitar una supresión bloquea volver a suprimir por 90 días; TierSaver no está afiliada a Klaviyo ni cuenta con su aval.
- Aceptación: en menos de 3 minutos el merchant llega a la pantalla de auditoría.

### 2. Auditoría gratis (solo lectura)
- Muestra: perfiles activos, perfiles que cumplen los criterios por defecto, cuántos quedan protegidos y por qué motivo, y el precio de TierSaver para ese tamaño de lista.
- Dato secundario, rotulado como estimación: en qué plan de Klaviyo caería el conteo resultante, según la tabla de precios de lista versionada. Nunca como titular, nunca como promesa, y nunca junto a controles que aflojan reglas ni como meta ("te faltan N perfiles").
- Explica cómo se calculó cada cifra.
- Aceptación: los conteos coinciden con los de la cuenta de Klaviyo de prueba dentro de ±1%.

### 3. Reglas

Implementadas en `packages/core/src/rules.ts`. Ante un dato que falta, el perfil queda protegido.

**Modo por defecto: los criterios publicados por Klaviyo** para sus recomendaciones de supresión (help.klaviyo.com/hc/en-us/articles/24312135764251, leído el 2026-11-25). Un perfil es candidato solo si cumple todo:

- Fue creado (o se suscribió, lo que sea más reciente) hace 365 días o más.
- Recibió 5 o más mails en las últimas ~72 semanas (504 días). Nadie es inactivo si nunca se le escribió.
- Nunca abrió un mail. Las aperturas automáticas de Apple Mail cuentan como apertura por defecto (lo conservador); solo una elección explícita del merchant las ignora.
- Nunca hizo clic en un mail.
- Nunca tuvo actividad en el sitio: visita, vista de producto ni checkout iniciado.
- Nunca compró, según los pedidos de Shopify (comparando hashes de mail) **y** el evento "Placed Order" de Klaviyo.

**Protegen siempre, en cualquier modo:**

- Consentimiento de SMS activo.
- Pertenecer a una lista o segmento que el merchant marcó como protegido (VIP).
- Datos incompletos: fecha de creación desconocida, historial de envíos desconocido, o historial de engagement o de compras que no cubre toda la ventana de la regla. Con "nunca", los datos tienen que llegar hasta antes de la creación del perfil.
- Haber sido restaurado (se le quitó la supresión, por deshacer o por cualquier otra vía) en los últimos 365 días.

**Modo ampliado (opt-in, con advertencia).** El merchant puede cambiar "nunca" por ventanas en días. Los pisos no se pueden bajar, ni en la interfaz ni en la base (`RULE_LIMITS` y los `CHECK` de la tabla `settings`):

| Señal | Por defecto | Piso del modo ampliado |
| --- | --- | --- |
| Compras | Ninguna, nunca | 365 días |
| Clics | Ninguno, nunca | 182 días |
| Aperturas | Ninguna, nunca | 182 días |
| Actividad en el sitio | Ninguna, nunca | 182 días |
| Antigüedad del perfil | 365 días | 180 días |
| Mails recibidos en 504 días | 5 | 5 (no se puede bajar) |
| Días sin ser candidato tras ser restaurado | 365 | 365 (no se puede bajar) |

El máximo de cada ventana es 1.095 días. El merchant también elige las listas y segmentos protegidos.

### 4. Simulación
- Antes de cualquier ejecución: cuántos perfiles se suprimirían y por qué motivo, cuántos quedan protegidos y por qué, muestra descargable (CSV) para revisar candidatos antes de aprobar, y el precio de TierSaver para ese ciclo. El plan de Klaviyo estimado resultante va como dato secundario, igual que en la auditoría.
- El CSV es para revisar antes de aprobar. La app no exporta listas de suprimidos ni las sincroniza con otros proveedores.
- Aceptación: no existe camino en la interfaz ni en la API interna para suprimir sin una simulación aprobada y vigente (menos de 24 horas).

### 5. Supresión
- Primera ejecución: manual, tras aprobar la simulación.
- Ejecución por lotes con cola, reintentos y respeto de límites de la API.
- Estado visible: en cola, en curso, completado, con errores.
- Aceptación: una ejecución interrumpida se reanuda sin duplicar ni saltear perfiles.

### 6. Programación
- La limpieza corre una vez por mes y termina antes de que se renueve el plan de Klaviyo, para que el conteo de Klaviyo esté al día. Texto permitido: "Runs monthly and finishes before your plan renews, so Klaviyo's count is up to date."
- Para eso la app usa el día de renovación del plan (leído por API si está disponible, o cargado por el merchant) y un margen: default 5 días, mínimo 4, por la demora de hasta 72 horas en el conteo.
- El momento de la corrida es un detalle de operación, no un argumento de venta: no se presenta como "antes de la fecha de facturación" ni como ventaja frente a Klaviyo.
- Antes de cada corrida programada: nueva simulación automática y aviso por mail con el resumen. Modo "aprobación requerida" (default) o "automático" (opt-in explícito).
- Aviso de crecimiento: cuando la lista está a menos de 5% del límite de su plan de Klaviyo. Es informativo, sin llamado a suprimir más.

### 7. Reactivación automática: quitada del MVP

Quitada el 2026-11-25. Ver "Fuera del MVP". La app no le quita la supresión a nadie por comprar ni por iniciar un checkout.

### 8. Registro y deshacer
- Bitácora de cada ejecución: fecha, origen (manual o programada), reglas, cantidad, resultado, quién aprobó.
- Deshacer es corrección de errores: restaura exactamente los perfiles de una ejecución. Está siempre disponible (regla de producto 3).
- Un perfil restaurado no vuelve a ser candidato por 365 días. Además, Klaviyo no permite volver a suprimirlo hasta 90 días después de la supresión anterior; la interfaz lo avisa antes de deshacer.
- Aceptación: tras deshacer, el conjunto de perfiles suprimidos por TierSaver vuelve al estado anterior.
- Pendiente de diseño (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.1, reglas 5 y 6): confirmación con advertencia si la corrida ya fue contada en una renovación, y detector de ciclos que pausa la programación si aparecen activos perfiles que TierSaver suprimió.

### 9. Reporte
- Mail mensual: perfiles suprimidos y por qué motivo, perfiles activos antes y después, perfiles protegidos, cargo de TierSaver.
- Dato informativo, si la conexión tiene el scope opcional `usage:read`: el conteo y el límite del plan que informa Klaviyo, antes y después. No se usa para calcular el cargo.

### 10. Cobro
- Ver `04-PRECIO-Y-COBRO.md`. Precio fijo mensual por tamaño de lista. Se cobra solo el ciclo en que una limpieza suprimió perfiles; como máximo un cargo cada 28 días.

### 11. Privacidad y desinstalación
- Webhooks obligatorios de Shopify implementados y verificados.
- Al desinstalar: se borran tokens y datos de la tienda. La app no quita supresiones al desinstalar (avisarlo en la ayuda): los perfiles quedan suprimidos y se manejan desde Klaviyo.

## Fuera del MVP

- **Reactivación automática por compra o checkout.** Estaba en el alcance y se quitó el 2026-11-25. Motivo (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 2.5): es un ciclo de suprimir y volver a activar ejecutado por la app, el patrón que la regla de 90 días de Klaviyo limita; iniciar un checkout no alcanza como señal; y volver a activar no registra consentimiento. Klaviyo documenta que un perfil suprimido sigue suprimido aunque compre, y que la supresión manual se levanta cuando el perfil vuelve a suscribirse o cuando el merchant la quita a mano. Si alguna vez vuelve, las condiciones mínimas están en la sección 3.1, regla 4, de ese documento. Falta verificar en la cuenta de prueba si la sincronización de consentimiento de Shopify cuenta como resuscripción.
- Envío de mails, entregabilidad, SMS, otros proveedores, vista multi-cuenta para agencias, borrado de perfiles, detección de perfiles "zombie" que no existen en Shopify.
- Cualquier cosa que cambie el plan de Klaviyo del merchant o toque su auto-downgrade.

## Estados vacíos y errores a diseñar

- Klaviyo desconectado, token vencido o acceso revocado (`invalid_grant`): frenar corridas, avisar y no reintentar.
- Cuenta en plan gratis de Klaviyo: la auditoría funciona igual; no se muestra estimación de plan.
- Lista ya limpia: "Your list is already clean. No profiles match the cleanup criteria, so there is nothing to suppress and nothing to charge."
- Lista por encima del último tramo de precio (150.000 perfiles activos, límite provisional): precio por acuerdo; no se cobra automáticamente.
- Falta cobertura de datos (por ejemplo, pedidos de Shopify de menos tiempo que la ventana): todos quedan protegidos y la app lo explica.
- Límite de API alcanzado: reintento automático con mensaje claro.
- Ejecución parcial.

## Métricas de producto

- Activación: % de instalaciones que completan la auditoría.
- Conversión: % de auditorías que aprueban una simulación.
- Valor: perfiles suprimidos por limpieza (mediana por cuenta) y % de cuentas que siguen con la limpieza mensual.
- Seguridad: cantidad de ejecuciones deshechas (señal de reglas mal calibradas) y perfiles restaurados a mano por el merchant en Klaviyo.
