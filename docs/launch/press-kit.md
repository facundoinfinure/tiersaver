# Press kit · TierSaver for Klaviyo

Preparado el 2026-11-26. Para creadores, agencias y prensa. Los textos en inglés se copian tal cual; nada de esto se envió a nadie (los mensajes a terceros quedan como borrador hasta que Facundo los mande).

**Estado al 2026-11-26: la app todavía no está publicada en el Shopify App Store.** No decir que lo está. Cuando haya ficha, se agrega el link acá.

## What it is

```
TierSaver for Klaviyo is a Shopify app for list hygiene. It audits your Klaviyo list, finds the profiles that meet the criteria Klaviyo publishes for suppressing unengaged profiles (never opened, clicked, visited or purchased), checks each one against your Shopify orders, and shows you a simulation with the exact list. Nothing changes until you approve it. Profiles are suppressed, never deleted, every cleanup is logged, and a cleanup can be restored from the app. TierSaver is not affiliated with or endorsed by Klaviyo.
```

One line:

```
List hygiene for Klaviyo: suppress the profiles that never engaged, after you review and approve a simulation.
```

## Three honest points

```
- You approve first. Every cleanup starts from a simulation you can download and check, and the first one is always started by hand.
- Conservative by default. Buyers in your Shopify orders, profiles with SMS consent, new profiles and the lists and segments you protect stay active. When a profile cannot be checked, it stays active.
- It suppresses, it does not delete. Each cleanup is logged with who approved it and why, and Restore removes the suppression that cleanup added. Restore has limits, and the help center lists them.
```

What it is not: a deliverability tool, an email marketing tool, or a way to reactivate profiles. It sends no email.

## Founder line

```
TierSaver is built by Facundo Bonfigli and operated by Digital Solvers LLC, Miami, Florida.
```

Contact: `hello@tiersaver.com` (press and partnerships), `support@tiersaver.com` (support). Las dos casillas todavía no existen.

## Logo files

Todos en `brand/logo/final/`. Reglas de uso en `brand/README.md`.

| Archivo | Uso |
| --- | --- |
| `logo.svg` | Marca + "TierSaver", sobre fondos claros. Es el que va por defecto |
| `logo-dark.svg` | Lo mismo sobre fondo oscuro |
| `mark.svg` · `mark-dark.svg` | Solo la marca, para espacios chicos o cuadrados |
| `app-icon.png` · `app-icon.svg` | Ícono de app, 1200 × 1200, sin texto |
| `klaviyo-app-logo.svg` | Solo para la ficha de Klaviyo (48 × 48) |

No estirar ni recolorear, y no ponerlo junto al logo de Klaviyo o de Shopify de un modo que sugiera una alianza.

## Screenshots

Los cinco de `docs/launch/screenshots/2026-11-27/listing/` (1600 × 900, datos de ejemplo, sin precios):

1. `01-audit.png` · See which profiles never engaged
2. `02-review-and-approve.png` · Review the candidates before you approve
3. `03-cleanup-running.png` · Follow each cleanup, or stop it
4. `04-cleanup-log-and-restore.png` · A log of every cleanup, with Restore
5. `05-settings.png` · Your criteria, protected lists and schedule

Imagen de portada: `00-feature-image.png`. Si alguien necesita la pantalla entera, están las de `raw/` (muestran el precio del plan). Los números de todas las capturas son de ejemplo y hay que decirlo si se publican: "Example data".

Video: hay un borrador mudo de 88 segundos (`docs/launch/video-draft.webm`); no es la versión final (`docs/launch/video.md`).

## Questions people ask

**What does it cost?**

```
It is free to install, and connecting Klaviyo, the audit and the simulation need no plan. The plan starts when you approve your first cleanup: $9 a month for lists up to 10,000 active profiles, $19 up to 25,000, $39 up to 75,000 and $79 up to 150,000. Shopify bills it every 30 days, whether or not a cleanup runs that month, until you cancel in Settings or uninstall. A higher price only applies after you approve it in Shopify. For lists above 150,000 active profiles, write to hello@tiersaver.com.
```

**What data does it touch?**

```
In Shopify it has one permission, reading orders, to know which email addresses have bought. It has no write access to the store. In Klaviyo it reads profiles, lists, segments, metrics and the account's usage figures, creates and maintains one segment of its own, and suppresses or unsuppresses profiles in the cleanups you approve. It has no access to campaigns, flows or templates and cannot send messages. It stores Klaviyo profile IDs and keyed hashes of email addresses, not readable email addresses, names, postal addresses or order contents. Tokens are encrypted, and the store's data is deleted after you uninstall.
```

**What does suppressing do?**

```
A suppressed profile stops receiving marketing email and most flow email from Klaviyo, even if the person buys later. Flows that Klaviyo treats as transactional still send, and SMS and push are not changed. The profile and its history stay in Klaviyo: nothing is deleted. Suppressing is not an unsubscribe and does not record an opt-out. A person who subscribes again is unsuppressed by Klaviyo. According to Klaviyo's help center, suppressed profiles do not count toward the active profiles of a Klaviyo email plan; your Klaviyo plan does not change on its own.
```

**How do I undo a cleanup?**

```
Open the cleanup in History and select Restore. It removes the suppression that cleanup added, so those profiles can receive marketing email again. It does not change consent: profiles that unsubscribed or bounced stay as they are. A restored profile is left out of TierSaver cleanups for 365 days. Restore needs the app installed and connected, and restoring does not refund the month. The help center lists the other limits.
```

**Will I lose customers?**

```
By default TierSaver only suppresses profiles that never opened, clicked, visited or purchased, and every profile is checked against your Shopify orders. You see the list before anything runs. If a profile cannot be checked against your order history, it stays active.
```

**Does it run on its own?**

```
Only if you turn that on. The monthly schedule runs the audit and waits for your approval. Automatic cleanups are off by default, need at least one cleanup you approved and ran yourself, and can be turned off at any time.
```

**Who is behind it?**

```
TierSaver is an independent product operated by Digital Solvers LLC, 153 E Flagler St, Miami, FL 33131, United States, and built by Facundo Bonfigli. It is not affiliated with or endorsed by Klaviyo or Shopify.
```

**Is it on the Shopify App Store?**

```
Not yet. The listing has not been submitted for review. Write to hello@tiersaver.com to hear when it is available.
```

## Para quien escriba sobre TierSaver

Pedido a creadores y agencias, en una línea: describirla como higiene de lista; no prometer cuánto baja la factura de Klaviyo ni usar eso de titular; no decir que Klaviyo la aprueba o la respalda; decir "suppress", no "delete"; y no publicar números de las capturas como si fueran resultados.

Fuentes de cada respuesta: precios, `packages/core/src/charge.ts` y `brand/messaging.md`; datos, `site/src/pages/help/permissions.html` y `help/data-and-privacy.html`; suprimir, la pantalla "Before you approve" de la app; restaurar, `site/src/pages/help/undo.html` y el diálogo de la app; titular, `site/src/pages/terms.html`.
