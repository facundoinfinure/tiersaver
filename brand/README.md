# brand/ · Marca de TierSaver (Fase 2)

Estado: **Facundo eligió el logo B (Lower Step) y aprobó los mensajes el 2026-11-25.** Los archivos a usar están en `logo/final/` (copia de `option-b/`). Las carpetas `option-a/` y `option-c/` y `options.png` quedan como archivo de la decisión. Pendiente: búsqueda de marcas parecidas y chequeo de las reglas vigentes de ícono del App Store.

Fuente de verdad: `docs/03-MARCA.md`. Si algo de acá lo contradice, gana ese documento.

## Qué hay en la carpeta

| Archivo | Qué es |
| --- | --- |
| `options.png` | Hoja de contacto con las tres opciones lado a lado: tamaño grande, 32 px y 16 px, sobre fondo claro (#eeeeec), blanco y superficie oscura (#101010), más el ícono de app. Empezá por acá. |
| `logo/option-a/`, `option-b/`, `option-c/` | Una carpeta por opción, con los mismos archivos en cada una (ver abajo). |
| `tokens.css` | Tokens de color, tipografía y radios como custom properties de CSS. |
| `tokens.json` | Los mismos tokens en JSON, con el uso de cada uno. |
| `messaging.md` | Guía de mensajes en inglés (titular, subtítulo, pruebas, CTA, voz, objeciones, palabras prohibidas). Borrador. |

Archivos dentro de cada `logo/option-*/`:

- `mark.svg`: solo la marca, para fondos claros. Grilla de 64 × 64.
- `mark-dark.svg`: la marca para superficie oscura.
- `logo.svg`: marca + "TierSaver" para fondos claros. El texto está convertido a trazos (Inter Tight 400), así que no depende de ninguna fuente web.
- `logo-dark.svg`: lo mismo para superficie oscura.
- `app-icon.svg` y `app-icon.png`: ícono de app de Shopify, 1200 × 1200 px exactos, cuadrado, sin transparencia y sin texto. La marca queda dentro del 56 % central para que el recorte redondeado de Shopify no la toque.

Todos los colores salen de la tabla de tokens. El acento cálido aparece solo sobre oscuro, como pide la guía.

## Las tres opciones

### A · Step Line

Un disco con una línea que baja un escalón: la forma de un precio por tramos cuando pasás al tramo de abajo. Es la más "de producto": habla el mismo idioma que las pills del sistema y el disco le da presencia a 16 px. Riesgo: la línea sola puede leerse como una S o un 2 angulosos si se la mira sin contexto.

### B · Lower Step

Un bloque macizo de dos niveles con un punto apoyado en el nivel de abajo. Es la más literal y la más cálida: el punto es el merchant (o su lista) ya parado en el escalón más bajo. Funciona muy bien como ícono de app porque el punto en acento se lleva la mirada. Riesgo: a 16 px el punto y el bloque quedan muy juntos, y la silueta puede recordar a un ícono genérico de "usuario" o de carpeta.

### C · Dropped T

La T de TierSaver con el brazo derecho un escalón más abajo. Es la única que ata la marca al nombre, y la idea de "bajar un tramo" queda en la letra misma. Sobre oscuro, el brazo caído va en el acento cálido y el gesto se entiende solo. Es la que mejor aguanta 16 px. Riesgo: al lado de la palabra "TierSaver" hay dos T seguidas; en el logo horizontal se ve bien, pero conviene mirarlo.

## Recomendación

**C · Dropped T.** Motivos:

1. Es la más legible en chico (favicon, lista de apps de Shopify, pestaña del navegador).
2. Es la única propia: una T con el brazo caído no se confunde con un ícono genérico, y sirve igual para futuros "TierSaver for …".
3. Cuenta la idea (bajar un escalón) sin dibujar gráficos de precios ni flechas hacia abajo, que empujarían la lectura hacia "pagá menos" y no hacia higiene de lista.

Segunda opción: **A**, si se prefiere un símbolo abstracto en vez de una inicial.

## Pendiente y sin verificar

- **Elegir logo** (Facundo). Recién ahí se aplica en `site/`, en la app y en la ficha.
- **Aprobar los mensajes** de `messaging.md`.
- No se hizo búsqueda de marcas registradas ni de parecidos con logos existentes. Las tres evitan a propósito la bolsa de Shopify y la bandera de Klaviyo, pero falta un chequeo formal antes de publicar.
- Falta confirmar contra los requisitos vigentes del App Store el formato del ícono (hoy: 1200 × 1200 px, JPEG o PNG) y las reglas de nombre.
- El ícono se exporta con esquinas rectas; Shopify aplica su propio recorte.

## Cómo se generó

Los SVG están escritos a mano sobre una grilla de 64 × 64. El PNG del ícono y `options.png` se renderizaron con Chromium a partir de esos SVG. La palabra "TierSaver" se trazó desde Inter Tight 400 (licencia SIL OFL 1.1, que permite este uso).
