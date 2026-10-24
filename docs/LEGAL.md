# Información legal

Qué textos legales tiene la plataforma, de dónde salen los datos y qué falta. **Los textos los ha redactado el equipo técnico a partir de la normativa; antes de abrir al público, un abogado debe revisarlos.**

## Páginas

| Página | Para quién | Responsable | De dónde salen los datos |
|---|---|---|---|
| `/aviso-legal` | Visitantes de la web de un taller | El taller | Panel → Taller (razón social, NIF, dirección, correo legal, inscripción registral) |
| `/privacidad` | Visitantes y clientes del taller | El taller (la plataforma es su encargada) | Igual que el aviso legal + los proveedores que estén **activados** |
| `/cookies` | Todos | El taller (en su web) o la plataforma (en el área privada) | Inventario real del código |
| `/condiciones` | Talleres que usan la plataforma | La plataforma | `apps/web/src/lib/legal/platform.ts` |
| `/encargo` | Talleres (contrato de encargo, RGPD art. 28) | La plataforma | `platform.ts` + lista de subencargados |
| `/privacidad-cuenta` | Cualquier persona con cuenta | La plataforma | `platform.ts` |

Si falta un dato obligatorio, la página lo dice arriba y marca el hueco con **«[Falta: …]»**. Nunca se inventa.

## Lo que tiene que hacer el titular

1. **Datos de la plataforma:** rellenar `holder`, `taxId`, `address`, `email` (y `registry` si está inscrito) en `apps/web/src/lib/legal/platform.ts`. Revisar `deletionDays` (días para descargar la copia tras la baja; hoy 30).
2. **Cada taller:** completar Panel → Taller → Datos del taller, y que la **propietaria** acepte las condiciones y el contrato de encargo (Panel → Taller → «Condiciones y protección de datos»). El inicio del panel lo recuerda mientras falte.
3. **Revisión por un abogado** de los seis textos (en especial: limitación de responsabilidad, plazos, jurisdicción y el contrato de encargo).
4. **Proveedores:** firmar o aceptar el contrato de encargo (DPA) de cada proveedor activado (Supabase, Cloudflare y, si se activan, Resend, Meta y Openapi) y confirmar sus garantías de transferencia internacional. Si cambia un proveedor, actualizar `SUBPROCESSORS` en `platform.ts` y avisar a los talleres con 30 días.
5. **Registro de actividades de tratamiento** (RGPD art. 30) de la plataforma como encargada: puede basarse en la tabla de `/encargo` y en `docs/DATOS_PERSONALES.md`.

## Versiones y aceptaciones

- `LEGAL_VERSION` (hoy `1.0`) en `platform.ts`. Si cambian las condiciones o el encargo, se sube la versión: el panel vuelve a pedir la aceptación.
- La aceptación queda en `workshop_legal_acceptances` (taller, documento, versión, quién y cuándo). Solo la escribe `accept_platform_terms`, solo la propietaria, y no se cambia ni se borra. Entra en la copia del taller.

## Normativa de talleres (Real Decreto 1457/1986)

- **Resguardo de depósito:** Orden → «Resguardo de depósito» (para imprimir y firmar). Lleva los datos del taller, la orden, fecha de entrada, cliente, vehículo, kilómetros, trabajo pedido, las casillas para pedir o renunciar al presupuesto previo, la garantía y la mención a las hojas de reclamaciones.
- **Presupuesto previo por escrito:** Presupuestos (con aceptación por enlace o en el área de clientes).
- **Garantía:** las facturas de reparaciones indican la garantía del art. 16 (al menos 3 meses o 2.000 km; 15 días o 2.000 km en vehículos industriales; mayor si la pieza la tiene).
- **Cartel informativo y hojas de reclamaciones:** son físicos, en el taller. El programa no los sustituye.
- Las comunidades autónomas tienen normas propias: cada taller debe comprobar las suyas.

## Facturación (VERI*FACTU)

Las facturas son **operativas, NO certificadas VERI*FACTU** (Real Decreto 1007/2023). Según el Real Decreto-ley 15/2025, será obligatorio el **1 de enero de 2027** para sociedades y el **1 de julio de 2027** para el resto (autónomos). Hasta adaptar y certificar el programa (declaración responsable del fabricante y envío de registros a la AEAT), los talleres deben emitir sus facturas legales con un programa certificado. Las condiciones del servicio lo dicen expresamente.

## Copia de la web (taller que se va)

Un taller que ha pagado su web recibe una copia que funciona sin la plataforma (`docs/EXPORTAR_WEB.md`). En la copia, el aviso legal, la privacidad y las cookies cambian: no hay formularios, ni área de clientes, ni cookies; el responsable es el taller y su alojamiento puede registrar datos técnicos. Si al taller le faltan datos legales, la copia no se genera. El texto propuesto para el contrato de web (cláusula 4) está en ese documento y también debe revisarlo un abogado.

## Conservación

- Solicitudes de la web: **12 meses** (las borra `run_maintenance`).
- Huella antispam: 2 días.
- Facturas y documentos contables: 6 años (Código de Comercio, art. 30); los conserva el taller.
- Resto: mientras dure la relación. Ver `docs/DATOS_PERSONALES.md`.

## Pruebas

`supabase/tests/23_legal.test.sql` (datos públicos del titular, aceptación solo por la propietaria, inmutable, borrado a 12 meses) y `apps/web/e2e/legal.spec.ts` (los datos salen en las páginas, lo que falta se marca, aceptación, resguardo). `calidad.spec.ts` pasa accesibilidad por `/encargo` y por el resguardo.
