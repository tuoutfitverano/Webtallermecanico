# Pendiente antes de vender (24-10-2026)

Lo que queda abierto tras la auditoría (`AUDITORIA_FINAL.md`). En el **código** no queda ningún fallo P0 ni P1 abierto. Lo que falta son decisiones, datos reales, servicios y revisiones profesionales.

## 1. Bloqueos: sin esto no se vende con datos reales

| # | Qué | Quién | Por qué bloquea |
|---|---|---|---|
| B1 | **Facturación: decidido (27-10-2026) que el programa NO emite facturas**; las antiguas «facturas» son «resúmenes de servicios» (seguimiento). Falta que **un asesor fiscal lo confirme** (ver §2, opción 2) | Asesor fiscal | El módulo de facturas no está adaptado a VERI\*FACTU. Según el RD 1007/2023, los fabricantes debían ofrecer los sistemas adaptados desde el 29-07-2025. Venderlo sin adaptar puede suponer sanciones al fabricante o comercializador (art. 201 bis LGT: 150.000 € por año y tipo de sistema). |
| B2 | **Datos reales del titular** de la plataforma en `apps/web/src/lib/legal/platform.ts`: razón social, NIF, domicilio, correo y registro | Propietario | LSSI art. 10. Las condiciones y el contrato de encargo salen con «[Falta: …]». |
| B3 | **Revisión por un abogado** de los seis textos legales y del contrato de encargo (art. 28 RGPD) | Abogado | Los textos los redactó el equipo técnico, sin validación jurídica. |
| B4 | **Entorno de producción** (Supabase y Cloudflare), con migraciones aplicadas y las variables de `CHECKLIST_LANZAMIENTO.md` | Propietario (con autorización expresa) | No existe todavía. Nada se ha probado contra servicios reales. |
| B5 | **DPA (contratos de encargo)** aceptados con Supabase y Cloudflare, y con Resend, Meta y Openapi si se activan | Propietario | RGPD art. 28.4 (subencargados). |
| B6 | **Copias de seguridad en producción**: plan de Supabase con copias diarias, o el flujo cifrado de `scripts/backup`, y **una restauración de prueba en el entorno real** | Propietario | La restauración solo se ha probado en local. |

## 2. Facturación: alternativas comerciales seguras (decisión del propietario)

No se ha desactivado nada. El módulo sigue funcionando y diciendo en pantalla y en las condiciones que **no** está certificado. Opciones:

1. **Vender sin facturación** (recomendada para el lunes): presupuestos, órdenes, cobros, avisos, portal y web, pero **sin emitir facturas** desde el programa. El taller factura con su programa certificado. Hace falta una opción para ocultar la emisión de facturas (no existe aún: unas horas de trabajo y sus pruebas). En la oferta comercial no se debe decir «facturación».
2. **«Documento de cobro / proforma»**: renombrar lo que hoy se llama factura a un documento que **no** es factura, sin numeración fiscal, más una exportación de los datos al programa certificado del taller. Hay que confirmar con un asesor fiscal que así no se considera un SIF.
3. **Adaptar a VERI\*FACTU**:
   - registro de facturación según la Orden HAC/1177/2024 (huella encadenada, QR, leyenda);
   - registro de eventos;
   - remisión a la AEAT con certificado;
   - declaración responsable por versión;
   - pruebas en el entorno de pruebas de la AEAT.

   Son **varias semanas** de trabajo; no es viable para el lunes.

Fuentes: ver la tabla «Legal» de `AUDITORIA_FINAL.md`. Desde aquí no se pudieron abrir directamente boe.es ni la sede de la AEAT: un asesor fiscal debe confirmar la lectura.

## 3. Cuestiones que deben validar profesionales

- **Asesor fiscal:**
  - si el módulo actual, marcado «no certificado», ya cuenta como comercializar un SIF;
  - la opción del §2;
  - las fechas de la factura electrónica B2B (RD 238/2026 y Orden HAC/1028/2026: obligatoria 12 o 24 meses después de la Orden, según la facturación del taller);
  - que la factura de un taller de reparación lleve todos los datos obligatorios.
- **Abogado:** aviso legal, privacidad (taller y plataforma), cookies, condiciones del servicio, contrato de encargo, plazos de conservación (`docs/DATOS_PERSONALES.md`) y limitación de responsabilidad.
- **Normativa de talleres por comunidad autónoma:** el resguardo de depósito y la garantía siguen el RD 1457/1986. Cada comunidad puede tener normas propias.

## 4. Riesgos que **sí** aceptaríamos (piloto con limitaciones)

- **Proveedores simulados en las pruebas.** Correo, WhatsApp y consulta de matrículas solo se han probado con simuladores. Sin proveedor configurado, los avisos quedan «pendientes» (nunca se dan por enviados) y el alta de vehículos es manual. Antes de activar cada uno: prueba real con claves de prueba.
- **Sin alertas automáticas.** Solo los registros de Cloudflare (Workers Logs). Aceptable en un piloto con pocos talleres y revisión diaria.
- **Versiones de PostgreSQL.** Pruebas locales en PostgreSQL 16; CI y Supabase usan 17. El CI ejecuta las mismas pruebas en 17.
- **CSV.** La protección contra fórmulas está probada a nivel de texto, pero **no** abriendo los archivos en Excel o LibreOffice.
- **Fichas antiguas con NIF erróneo.** No se pueden editar hasta corregir el NIF. Hoy no hay datos reales.
- **WhatsApp «sin justificante».** Si Meta responde sin identificador, el aviso queda para revisión manual (no se reintenta solo, para no duplicar).

## 5. Riesgos que **no** deberíamos aceptar

- Emitir o anunciar «facturas» con este módulo a clientes reales sin resolver el §2.
- Usar datos reales de clientes sin los datos del titular, sin la revisión legal y sin los DPA (B2, B3 y B5).
- Abrir sin una restauración de copia probada **en el entorno real** (B6).
- Poner en producción una clave de PRUEBA de Turnstile. El código ya lo impide: el formulario respondería 503.
- Desplegar sin `APP_URL`. Los enlaces de los correos dependerían del dominio de la petición.
- Activar un proveedor (email, WhatsApp, matrículas) sin una prueba real previa con sus claves de prueba.
