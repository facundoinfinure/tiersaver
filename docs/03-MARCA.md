# Marca

## Nombre

- Marca madre: **TierSaver**.
- Producto: **TierSaver for Klaviyo**. "for Klaviyo" va al final para no usar la marca de un tercero como nombre propio. Confirmar las reglas de nombres en los requisitos vigentes del App Store y en las pautas de marca de Klaviyo.
- Dominio: tiersaver.com.
- Futuro: otras integraciones con precio por tramos llevan su propio apellido ("TierSaver for …").

Cuidado: en el Shopify App Store "tier" suele leerse como descuento por volumen. El subtítulo de la ficha y el primer titular del sitio tienen que decir sin ambigüedad qué hace el producto: higiene de lista para Klaviyo. No encabezan con la factura de Klaviyo (`12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2).

**Decisión abierta de Facundo, no aplicada:** el nombre "TierSaver" alude a bajar de tramo y va en sentido contrario al posicionamiento. Las opciones de `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.3, son: (1) mantener "TierSaver for Klaviyo" y asumirlo; (2) mantener la marca y cambiar el descriptor a "TierSaver: List Hygiene for Klaviyo"; (3) cambiar la marca por una de higiene. Hasta que decida, el nombre sigue siendo "TierSaver for Klaviyo".

Uso de la marca de Klaviyo: "Klaviyo" solo como texto descriptivo de compatibilidad. Sin su logo, tipografía ni colores, y sin "official", "certified", "recommended by" ni "partner".

## Posicionamiento

Actualizado el 2026-11-25, después de la revisión de políticas: **higiene de lista automática para Klaviyo**. Motivo: la Acceptable Use Policy de Klaviyo prohíbe usar el servicio de forma "designed to avoid or circumvent bills… or other fees", y alcanza a quien construye la integración. No se vende pagar menos, ni ahorros, ni el momento de la corrida respecto de la facturación. No es una herramienta de entregabilidad ni de email marketing.

- **Para**: marcas de Shopify con listas de Klaviyo llenas de perfiles que nunca interactuaron.
- **Promesa**: mantener la lista limpia sin trabajo manual, sin tocar a nadie que compra.
- **Cómo**: audita, simula, cruza cada perfil con los pedidos de Shopify y suprime, con aprobación del merchant, a quienes cumplen los criterios publicados por Klaviyo. Corre todos los meses y termina antes de que se renueve el plan.
- **Por qué creerlo**: usa los criterios de Klaviyo por defecto; nada se toca sin simulación aprobada; los compradores quedan protegidos con datos de Shopify; todo queda registrado y se puede deshacer; nada se borra; precio fijo, y el mes sin limpieza no se cobra.

## Mensajes

Revisados el 2026-11-25 después de la revisión de políticas. Facundo había aprobado la versión anterior ese mismo día, antes de la revisión: esta versión está pendiente de que la vuelva a aprobar. La guía completa en inglés está en `brand/messaging.md`.

| Uso | Texto |
| --- | --- |
| Titular | Automatic list hygiene for Klaviyo. |
| Subtítulo | TierSaver keeps your Klaviyo list clean by suppressing profiles that never engaged, using Klaviyo's own recommended criteria. Every cleanup is simulated first, approved by you and logged. Nothing is deleted. |
| Prueba 1 | Every profile is checked against your Shopify orders before anything changes. |
| Prueba 2 | Every cleanup is simulated first, approved by you, and can be undone. |
| Prueba 3 | A flat monthly price by list size. A month with no cleanup is not charged. |
| CTA | Run my free list audit |
| Programación | Runs monthly and finishes before your plan renews, so Klaviyo's count is up to date. |
| Efecto en el plan (segundo plano, nunca titular) | Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, you can move to a lower plan in Klaviyo's billing settings. |

## Voz

- Inglés simple, frases cortas, números con contexto.
- Honesta: no se promete ningún resultado sobre lo que el merchant le paga a Klaviyo. Si se muestra el plan en que caería el conteo, es dato secundario, sale de los datos del merchant y dice "estimated". En la ficha de Shopify no va ninguna cifra, porcentaje ni garantía (requisito 4.3.3).
- Tranquila con lo delicado: la app toca la lista del merchant, así que el tono es de control, no de urgencia.
- Sin signos de exclamación, sin jerga de growth.
- Nunca hablar de "evitar", "esquivar" o "ganarle" a los precios de Klaviyo, ni dejar mal a Klaviyo. El efecto en el plan se cuenta como lo cuenta Klaviyo: los perfiles suprimidos no cuentan para el plan, según su propia ayuda.

Textos que no se usan (lista completa en `12-CUMPLIMIENTO-KLAVIYO.md`, sección 3.2, y en `brand/messaging.md`): pagarle menos a Klaviyo como titular, subtítulo o palabra clave principal; el momento de la corrida respecto de la facturación como promesa; que el producto se paga solo; cobrar según lo que confirme Klaviyo o según lo que el merchant deje de pagar; suprimir y volver a activar en la misma promesa; cifras, porcentajes o garantías.

Objeciones a responder en el sitio y la ayuda:
- "¿Voy a perder clientes?" → por defecto solo se suprime a quien nunca abrió, hizo clic, visitó ni compró; cruce con pedidos de Shopify; simulación aprobada; deshacer.
- "¿Se borran mis datos?" → se suprime, no se borra; el historial queda.
- "¿Klaviyo no hace esto solo?" → recomienda a quién suprimir y permite hacerlo a mano; TierSaver lo repite todos los meses con los mismos criterios, cruza cada perfil con los pedidos de Shopify, simula antes y deja registro. Sin comparaciones que dejen mal a Klaviyo.
- "¿Y si un perfil suprimido compra después?" → sigue suprimido en Klaviyo hasta que vuelve a suscribirse o el merchant quita la supresión a mano. TierSaver no lo cambia por su cuenta.
- "¿Qué pasa si desinstalo?" → los perfiles quedan suprimidos; la supresión se puede quitar desde Klaviyo.
- "¿Cómo se cobra?" → precio fijo mensual por tamaño de lista; el mes sin limpieza no se cobra; la auditoría es gratis.

## Identidad visual

Base: sistema Infinure v3 en su tema claro ("papel"), sin el logo ni el nombre de Infinure. TierSaver necesita logo propio.

### Color

| Token | Valor | Uso |
| --- | --- | --- |
| bg | #eeeeec | Fondo de página |
| surface-1 | #ffffff | Tarjetas |
| surface-2 | #e4e4e1 | Tiles, fondos de controles |
| surface-3 | #dadad6 | Tarjeta de énfasis |
| surface-deep | #101010 | Paneles oscuros de cierre |
| line | #dedcd7 | Hairlines |
| line-strong | #85827b | Bordes de controles |
| ink | #141414 | Texto principal |
| ink-2 | #2b2a27 | Texto secundario |
| muted | #5f5e59 | Etiquetas y metadatos |
| faint | #7f7c76 | Solo titulares de 24 px o más |
| accent-warm | #e8c9a2 | Único acento, sobre paneles oscuros |
| alert | #b34a23 | Solo para lo que requiere atención |
| success-bg / success-ink | #dcebd5 / #24502a | Estados de éxito |

Interfaz neutra: el color aparece poco y con significado.

### Tipografía

- Inter Tight (300 y 400) para todo lo que se lee.
- IBM Plex Mono para etiquetas, cifras técnicas y métodos, en mayúsculas con separador "·".
- Cifras tabulares siempre.
- Titular en dos tonos: contexto en `faint`, lo importante en `ink`.

### Formas

- Todo lo que se toca es pill. Tarjetas con radio 20 px, paneles grandes 28 px, tiles 14 px.
- Sin sombras en tarjetas; se separan por superficie y hairline.
- Un solo protagonista por pantalla: una cifra, una decisión.

### Dentro de la app

La app embebida usa Polaris por requisito de Shopify. La identidad se expresa en el ícono, las ilustraciones mínimas, el tono de los textos y el sitio; no se pisa el estilo de Polaris.

### Logo e ícono (Fase 2)

- Pedido original: marca simple, legible a 32 px, que sugiera bajar un escalón (tier) sin usar la imagen de Klaviyo ni de Shopify. Facundo eligió la opción B el 2026-11-25 (`brand/README.md`). `12-CUMPLIMIENTO-KLAVIYO.md`, sección 2.2, marca que ese pedido va en sentido contrario al posicionamiento de higiene: revisar el logo queda atado a la decisión abierta sobre el nombre; no se cambió nada.
- Ícono de la app: 1200 × 1200 px, JPEG o PNG.
- Presentar tres opciones a Facundo antes de aplicar.
