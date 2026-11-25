# TierSaver — instrucciones del proyecto

TierSaver es una app embebida de Shopify que suprime perfiles inactivos de Klaviyo antes de cada fecha de facturación, para que el merchant quede en un tramo de precio más bajo. Cobra una parte del ahorro. Dueño: Facundo Bonfigli. Marca independiente (no mencionar Infinure, dnuvi ni Alupont en nada público).

Leé primero `docs/00-HANDOVER.md`. Es la fuente de verdad sobre decisiones y estado.

## Reglas de trabajo

- Trabajá fase por fase según `docs/00-HANDOVER.md`. Al cerrar cada fase, actualizá `docs/STATUS.md` con lo hecho, lo verificado y lo pendiente.
- Antes de usar una API de Shopify o de Klaviyo, leé su documentación vigente. Las versiones y reglas de este paquete son de noviembre de 2026 y pueden haber cambiado. Si la documentación contradice este paquete, gana la documentación; anotá la diferencia en `docs/STATUS.md`.
- Las dudas listadas como "a verificar" en `docs/02-ARQUITECTURA.md` se resuelven antes de escribir el código que depende de ellas.
- No inventes cifras. Todo número que vea un merchant sale de sus datos reales o está rotulado como estimación.
- Commits chicos y descriptivos. Rama `main` protegida; trabajo en ramas por fase.
- Tests antes de dar algo por terminado: unitarios para reglas de inactividad y cálculo de ahorro; de integración contra la cuenta de Klaviyo de prueba.

## Reglas de producto que no se negocian

1. **Nunca se suprime sin simulación previa aprobada por el merchant.** La primera ejecución siempre es manual.
2. **Defaults conservadores.** Ante la duda, un perfil queda activo.
3. **Todo es reversible y queda registrado**: quién, cuándo, qué perfiles, por qué regla.
4. **Suprimir, nunca borrar.** La app no elimina perfiles.
5. **Mínimo de permisos** en Shopify y en Klaviyo. No pedir scopes que el MVP no usa.
6. **Si no hay ahorro, no se cobra.**
7. **Datos personales**: guardar lo mínimo (IDs y hashes antes que mails en claro cuando alcance), cifrar tokens en reposo, borrar todo al desinstalar según los webhooks de privacidad de Shopify.

## Frenos: parar y preguntarle a Facundo

- Cualquier acción que gaste dinero, cree cuentas, acepte términos o publique algo.
- Enviar mails u otros mensajes a terceros (agencias, merchants). Se dejan como borrador.
- Enviar la app a revisión de Shopify.
- Ejecutar supresiones sobre una cuenta de Klaviyo que no sea la de prueba.
- Cambiar una decisión de `docs/00-HANDOVER.md`.
- Instalar herramientas de terceros con acceso amplio a la máquina (por ejemplo REA): mostrar el plan de instalación y esperar aprobación.

## Stack

Ver `docs/02-ARQUITECTURA.md`. Resumen: plantilla oficial de app de Shopify (React Router), Polaris, Postgres en Supabase, deploy en Vercel, jobs con cola. Landing y centro de ayuda en el mismo repo, carpeta `site/`.

## Idioma

- Código, comentarios, commits y todo lo que ve el merchant: inglés.
- Documentos internos y comunicación con Facundo: español rioplatense.

## Herramientas opcionales

- Modern Web Guidance (`npx modern-web-guidance@latest install`) antes de programar frontend y landing.
- brag (skill de video de lanzamiento) en la fase de lanzamiento.
- REA en la fase de teardown.

Ninguna fue probada todavía. Instalalas solo desde su fuente oficial y con aprobación.
