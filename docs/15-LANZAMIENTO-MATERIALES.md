# Materiales de lanzamiento (Fase 5) · borradores

Escrito el 2026-11-26. Nada de esto se envió a ningún lado. El envío a revisión lo dispara Facundo.

## Capturas

`docs/launch/screenshots/` tiene cinco capturas del recorrido: inicio, auditoría, revisión y aprobación, limpieza terminada y ajustes. **Salen del entorno local** (`shopify/preview/`, datos de ejemplo, sin el marco del admin de Shopify), así que sirven para elegir qué mostrar y para el sitio, **no para la ficha**: Shopify pide capturas reales de la app (`07-LANZAMIENTO.md`). Para la ficha hay que repetirlas en la tienda de desarrollo, a 1600 × 900, con la cuenta de prueba.

Para regenerarlas: `npm run preview:app` en `shopify/` y, en otra terminal, `node preview/walk.mjs <carpeta>`.

Cuidado al elegirlas (regla 4.3.3 de Shopify y `12-CUMPLIMIENTO-KLAVIYO.md` 3.2): ninguna captura de la ficha puede mostrar cifras como promesa. Las de auditoría y revisión muestran números del merchant; en la ficha conviene acompañarlas con un título que hable del control ("Review every profile before anything changes"), no del resultado.

## Instrucciones de prueba para el revisor de Shopify (borrador, en inglés)

```
TierSaver for Klaviyo keeps a merchant's Klaviyo list clean by suppressing profiles that never engaged,
after the merchant reviews and approves a simulation. Nothing is deleted and every cleanup can be undone.

What you need
- A Klaviyo account. A free account works. We can provide a test account with sample profiles: [CREDENTIALS, sent separately].

Steps
1. Install the app and open it. The home page shows "Get started".
2. Click "Connect Klaviyo" and approve the access request in Klaviyo. You return to the app with "Klaviyo is connected".
3. Click "Run the free audit". It is read-only and takes one or two minutes. It creates one segment in the
   Klaviyo account ("TierSaver: long-term inactive profiles (managed, do not edit)") and nothing else.
4. Click "Review and approve". Download the candidate list (CSV), tick the confirmation and click "Approve simulation".
5. Click "Review pricing in Shopify" and approve the test charge. Pricing is a flat monthly price by list size,
   charged only in a month when a cleanup suppresses profiles.
6. Click "Start cleanup". The run page shows progress and, when finished, "Check jobs in Klaviyo".
7. On the same page, "Restore" undoes the cleanup.
8. "Settings" holds the rules, protected lists and the monthly schedule. "History" lists every cleanup and restore.
9. Home → "Disconnect Klaviyo" removes the app's access to Klaviyo.

Notes
- With the default rules the app only suppresses profiles that never purchased, checked against the store's
  full order history. On a store without order history access, the audit keeps every profile active and says so.
- Uninstalling deletes the store's data from our systems. It does not unsuppress profiles in Klaviyo.
```

Pendiente para que estas instrucciones sean verdad: credenciales de una cuenta de Klaviyo para el revisor, supresión encendida en producción, cobro probado y acceso a datos protegidos.

## Estado del checklist de `07-LANZAMIENTO.md`

| Punto | Estado |
| --- | --- |
| Instala y desinstala limpio | Instalación probada en la tienda de desarrollo. Desinstalación y reinstalación en una tienda nueva: **sin probar** |
| OAuth de Shopify sin pantallas propias | Cumple |
| Todas las pantallas en Polaris, sin errores de consola | Cumple en el entorno local (recorrido automático, 23 pasos, sin errores). Dentro del admin: vistas por Facundo, sin revisar la consola |
| Estados vacíos y de error | Hechos: sin conexión, reconexión, auditoría fallida, sin historial de pedidos, lista limpia, simulación vencida o desactualizada, corrida detenida. Falta: límite de API con mensaje propio |
| Cobro en modo test | **Sin probar contra Shopify** (espera la distribución pública). Probado con Shopify simulado: aceptar, cargo, ciclo sin limpieza, segundo cargo antes de 28 días, limpieza deshecha |
| Webhooks de cumplimiento con HMAC | Cumple (smoke test en cada despliegue) |
| Scopes mínimos | `read_orders` hoy; `read_all_orders` y datos protegidos por pedir |
| Capturas reales | Borradores del entorno local; faltan las reales |
| Video | Sin hacer |
| Privacidad y términos publicados | Publicados como borrador en el staging; faltan cláusulas (ver abajo) |
| Mail y URL de soporte | Las casillas no existen todavía |
| Monitoreo de errores | Logs de Workers activos; sin alertas |
| Centro de ayuda | Hecho (9 artículos) |
| Bot de soporte | Sin hacer |

## Lo que falta definir para publicar el sitio en serio

Está publicado como **staging, sin indexar**, en https://tiersaver-site.tiersaver.workers.dev. Para la publicación real en tiersaver.com:

1. Dominio: se puede mover a la cuenta TierSaver desde el 2026-12-05.
2. Términos, sección 12 (limitación de responsabilidad): hoy dice "to be drafted by counsel". Necesita texto definitivo.
3. Términos, sección 14: ley aplicable y jurisdicción.
4. Privacidad: lista de subencargados (hoy Cloudflare; se suma el proveedor de mails cuando exista), retención de registros de facturación, y el párrafo sobre mails de aviso.
5. Fecha de vigencia de las dos páginas.
6. URL de la ficha del App Store para el botón "Run my free list audit" (hoy no lleva a ningún lado). Hasta que exista la ficha puede apuntar a una lista de espera o al mail de contacto.
7. Casillas hello@ y support@.
