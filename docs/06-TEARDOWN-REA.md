# Teardown de competidores con REA

## Qué es REA

REA (github.com/morluto/rea) es un servidor MCP que conecta a un agente con herramientas para inspeccionar software sin su código fuente. Analiza sitios web, apps JavaScript y Electron, binarios nativos, apps Android, .NET, firmware y actividad de red grabada. Corre local. Se instala con `npx rea-agents setup` desde un directorio de confianza fuera del proyecto a analizar.

No fue instalado ni probado todavía.

## Qué sirve y qué no en este proyecto

| Objetivo | ¿Sirve? | Motivo |
| --- | --- | --- |
| Frontend embebido de ListSweep y Nae | Sí | Corre en el navegador dentro del admin de Shopify |
| Tráfico de red de esas apps | Sí | Muestra qué endpoints de Klaviyo usan, en qué orden y con qué límites |
| Lógica de servidor de los competidores | No | Corre en sus servidores |
| Klaviyo | No hace falta | Su API es pública y está documentada |

## Pasos

1. **Facundo** instala ListSweep y Nae: Ghost Profile Auditor en la tienda de desarrollo y las conecta a la cuenta de Klaviyo de prueba.
2. **Facundo** recorre en cada una: onboarding, auditoría, pantalla de ahorro, supresión, configuración y precios. Con las herramientas de desarrollo del navegador abiertas, exporta el archivo HAR y guarda capturas.
3. **Claude** presenta el plan de instalación de REA y espera aprobación. Se instala solo desde el repo oficial o el paquete `rea-agents`.
4. **Claude** analiza HAR y JavaScript y responde:
   - ¿Cómo se conectan a Klaviyo: OAuth o clave privada? ¿Qué scopes piden?
   - ¿Cómo definen "inactivo"? ¿Qué umbrales y qué señales?
   - ¿Cómo calculan el ahorro y de dónde sacan la tabla de precios?
   - ¿Cómo obtienen el tramo actual y la fecha de facturación (o no la obtienen)?
   - ¿Suprimen por segmento o por lote de mails? ¿Cómo manejan límites y errores?
   - ¿Qué permisos de Shopify piden?
   - ¿Qué fricción tiene su onboarding y dónde se confunde un usuario nuevo?
5. **Claude** escribe `docs/teardown-notas.md`: qué adoptamos como patrón, qué hacemos distinto y qué ajusta del PRD.

## Límites

- El repo restringe su uso a investigación legal, interoperabilidad y software que uno está autorizado a examinar. Observar el frontend y el tráfico de una app instalada en la propia tienda es lo habitual; copiar código de un competidor no.
- El HAR puede contener tokens: no subirlo al repo; borrarlo al terminar.
- No se copia código, textos ni diseño. Se toman patrones y se anotan decisiones.
- Esto no es opinión legal. Si el producto termina pareciéndose mucho a uno de ellos, consultar a un abogado.

## Teardown sin REA (si no se aprueba la instalación)

El mismo cuestionario se responde leyendo el HAR a mano y las fichas públicas de las apps. REA acelera, no es imprescindible.

## Lo que ya se sabe de las fichas públicas (25 de noviembre de 2026)

- **ListSweep: Klaviyo Cleaner**: audita la lista, muestra el ahorro mensual y suprime inactivos en un clic. "Free plan available", sin planes pagos visibles. Sin reseñas.
- **Nae: Ghost Profile Auditor**: lanzada el 25 de febrero de 2026, gratis. Cruza pedidos de Shopify con engagement de Klaviyo, detecta perfiles "zombie" que no existen en Shopify, supresión manual en un clic. Sin reseñas.
- Ninguna muestra supresión programada contra la fecha de facturación.
