# PRD · TierSaver for Klaviyo (MVP)

## Usuario

- **Merchant**: marca de Shopify con 5.000 a 150.000 perfiles en Klaviyo, sin agencia de retención. Quiere pagar menos sin perder ventas ni romper nada.
- **Agencia o freelancer de Klaviyo** (segunda etapa): maneja varias cuentas y hoy limpia a mano.

## Problema

El merchant paga por perfiles que nunca abren. Limpiar a mano es tedioso, hay que hacerlo antes del corte de facturación y da miedo suprimir a alguien que compra.

## Promesa

"Stop paying Klaviyo for people who never open." La app muestra el ahorro en dólares, simula antes de tocar nada, ejecuta en la fecha correcta y permite deshacer.

## Alcance del MVP

### 1. Instalación y conexión
- Instala desde Shopify (app embebida).
- Conecta Klaviyo con el método que resulte de la verificación en `02-ARQUITECTURA.md` (OAuth preferido).
- Conexión con OAuth de Klaviyo (confirmado: funciona sin estar listada en su marketplace).
- Paso de onboarding: activar el auto-downgrade de Klaviyo (Billing > Preferences; solo Owner o Admin) o comprometerse a bajar de plan a mano. Se explica que sin eso la factura no baja. Se vuelve a recordar antes de cada corrida.
- Aceptación: en menos de 3 minutos el merchant llega a la pantalla de auditoría.

### 2. Auditoría gratis (solo lectura)
- Muestra: perfiles activos, perfiles inactivos según las reglas por defecto, tramo actual, tramo posible, ahorro estimado en US$ por mes.
- Explica cómo se calculó cada cifra y rotula el ahorro como estimación.
- Aceptación: los conteos coinciden con los de la cuenta de Klaviyo de prueba dentro de ±1%.

### 3. Reglas de protección
Un perfil **nunca** se suprime si cumple alguna:
- Compró en los últimos N días (default 365), según pedidos de Shopify (fuente principal, comparando hashes de mail) y el evento "Placed Order" de Klaviyo. Si falta cobertura de alguna de las dos, el perfil queda protegido.
- Hizo clic en un mail en los últimos N días (default 180).
- Abrió un mail en los últimos N días (default 90). Las aperturas automáticas de Apple Mail inflan este dato; mostrarlo como señal débil.
- Se suscribió hace menos de N días (default 90).
- Tiene consentimiento de SMS activo.
- Pertenece a una lista o segmento que el merchant marcó como protegido (VIP).
- Fue reactivado en los últimos 90 días (no se puede volver a suprimir).

El merchant ajusta los N y los segmentos protegidos. Los defaults son conservadores.

### 4. Simulación
- Antes de cualquier ejecución: cuántos perfiles se suprimirían, por qué regla, muestra descargable (CSV), tramo resultante y ahorro estimado.
- Aceptación: no existe camino en la interfaz ni en la API interna para suprimir sin una simulación aprobada y vigente (menos de 24 horas).

### 5. Supresión
- Primera ejecución: manual, tras aprobar la simulación.
- Ejecución por lotes con cola, reintentos y respeto de límites de la API.
- Estado visible: en cola, en curso, completado, con errores.
- Aceptación: una ejecución interrumpida se reanuda sin duplicar ni saltear perfiles.

### 6. Programación
- El merchant carga su fecha de facturación de Klaviyo (o se lee por API si existe; ver dudas técnicas).
- La app programa la limpieza con margen: default 5 días antes del corte, por la demora de hasta 72 horas en el conteo.
- Antes de cada corrida programada: nueva simulación automática y aviso por mail con el resumen. Modo "aprobación requerida" (default) o "automático" (opt-in explícito).
- Alerta de tramo: aviso cuando la lista está a menos de 5% del tramo siguiente.

### 7. Reactivación
- Si un perfil suprimido por TierSaver compra o inicia checkout, se reactiva (opt-in, apagado por defecto).
- La interfaz avisa del bloqueo de 90 días antes de activar esta opción.

### 8. Registro y deshacer
- Bitácora de cada ejecución: fecha, origen (manual o programada), reglas, cantidad, resultado.
- Deshacer: reactiva exactamente los perfiles de una ejecución.
- Aceptación: tras deshacer, el conjunto de perfiles suprimidos por TierSaver vuelve al estado anterior.

### 9. Reporte
- Mail mensual: perfiles suprimidos, tramo antes y después (verificado con la Billing Usage API de Klaviyo), ahorro verificado, cargo de TierSaver.

### 10. Cobro
- Ver `04-PRECIO-Y-COBRO.md`. Se cobra solo cuando el ciclo nuevo de Klaviyo muestra un tramo más bajo.

### 11. Privacidad y desinstalación
- Webhooks obligatorios de Shopify implementados y verificados.
- Al desinstalar: se borran tokens y datos de la tienda. La app no reactiva perfiles al desinstalar (avisarlo en la ayuda).

## Fuera del MVP

Envío de mails, entregabilidad, SMS, otros proveedores, vista multi-cuenta para agencias, borrado de perfiles, detección de perfiles "zombie" que no existen en Shopify.

## Estados vacíos y errores a diseñar

- Klaviyo desconectado o token vencido.
- Cuenta en plan gratis de Klaviyo (no hay ahorro posible).
- Lista ya limpia: "You're already in the lowest tier we can get you to."
- Límite de API alcanzado: reintento automático con mensaje claro.
- Ejecución parcial.

## Métricas de producto

- Activación: % de instalaciones que completan la auditoría.
- Conversión: % de auditorías que aprueban una simulación.
- Valor: ahorro estimado mediano por cuenta.
- Seguridad: cantidad de ejecuciones deshechas (señal de reglas mal calibradas).
