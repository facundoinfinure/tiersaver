# Pendientes de validación

**Corrida incompleta** (`independent_verification_unavailable`): no hubo verificadores independientes.

No hay ningún registro `needs_validation`. La skill no permite anotar como `needs_validation` un candidato que no pasó por un verificador independiente.

Lo que quedó sin resolver vive en `coverage-ledger.json` como dos unidades en estado `candidate`:

| Fingerprint | Qué falta |
| --- | --- |
| `tiersaver/billing/charge-confirmation-fails-open` | Verificador independiente. Prueba local en sandbox: cargo `pending`, sin conexión de Klaviyo (o con más de 10 jobs), retención vencida; observar que `settleRunCharge` devuelve `estimated` en cada tick y nunca `charged`. |
| `tiersaver/billing/open-charges-head-of-line` | Verificador independiente. Prueba local en sandbox: 6 cargos inconfirmables y 1 `failed` en D1 local; observar qué filas devuelve `runsWithOpenCharges` en ticks sucesivos. |

Bloqueos comunes a ambos: sin herramienta de delegación en la sesión, y sin sandbox del sistema operativo para ejecutar las pruebas del repositorio.

Hechos de despliegue que el código no muestra y que conviene que el dueño mire por su cuenta (sin tráfico de auditoría): valor de `SUPPRESSION_ENABLED` y de `SUPPRESSION_ALLOWED_ACCOUNT_ID` en el Worker desplegado, y la lista de URLs de redirección permitidas en la app de Klaviyo.
