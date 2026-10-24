# Auditoría final antes de vender (24-10-2026)

**Alcance:** todo el repositorio en la rama `claude/kind-dijkstra-ay7d9o`, ejecutado en local con PostgreSQL 16, Supabase Auth y PostgREST reales y proveedores externos (correo, WhatsApp, matrículas) **simulados**. **No hay entorno de producción ni de preproducción**: nada de lo de abajo se ha probado contra Supabase o Cloudflare reales.

**Punto de partida:** commit `9fcb998` (está en GitHub; además, etiqueta local `auditoria-inicio-2026-10-24`, que el entorno no deja subir). Cualquier cambio de esta auditoría se puede deshacer volviendo a ese commit.

**Informe de partida:** `Informe_auditoria_codigo_talleres.md` (ChatGPT). Sus hallazgos H01–H10 se han **reproducido uno a uno** antes de corregirlos: cada prueba nueva **falla con el código original** y pasa con el corregido (ver `RESULTADOS_PRUEBAS.md`, «Antes y después»). El ZIP de pruebas que menciona el informe no se adjuntó, así que no se ha podido ejecutar.

## Decisión

> **NO-GO** para vender y usar el producto con datos reales el lunes 26-10-2026 tal como se anuncia (con facturación).
>
> **GO CON LIMITACIONES** solo para **demostración y preventa**: enseñar la demo y firmar pilotos, **sin datos reales de clientes y sin emitir facturas**, hasta cerrar los bloqueos de `PENDIENTE_ANTES_DE_VENDER.md`.

Motivos (detalle abajo):

1. **Bloqueo legal (P0):** el módulo de facturas es un sistema informático de facturación no adaptado a VERI\*FACTU. Según la normativa, los fabricantes debían ofrecerlo ya adaptado desde el 29-07-2025.
2. **Bloqueo de puesta en marcha (P0):** no existe entorno de producción configurado ni probado, y faltan los datos legales del titular de la plataforma.
3. En el código **no queda ningún P0 ni P1 abierto**. El aislamiento entre talleres se ha comprobado de forma exhaustiva y no se ha encontrado ninguna fuga.

## Fallos encontrados

Gravedad: **P0** bloquea el lanzamiento · **P1** fallo importante · **P2** moderado · **P3** menor.

| # | Gravedad | Fallo | Cómo se reproducía | Archivos | Solución | Pruebas | Estado |
|---|---|---|---|---|---|---|---|
| F01 | **P0 legal** | La facturación no está adaptada a VERI\*FACTU (RD 1007/2023). Vender un sistema de facturación no adaptado puede ser infracción del fabricante o comercializador (art. 201 bis LGT). | Revisión normativa con fuentes oficiales (ver «Legal») | `supabase/migrations/*facturacion*`, `panel/facturas/*`, `InvoicePrint.astro` | No se toca sin decisión del propietario. Alternativas en `PENDIENTE_ANTES_DE_VENDER.md` | — | **Abierto (decisión del propietario + jurídico)** |
| F02 | **P0 puesta en marcha** | Faltan los datos del titular de la plataforma (razón social, NIF, domicilio, correo) en los textos legales. Las páginas los marcan «[Falta: …]». | `/condiciones`, `/encargo`, `/privacidad-cuenta` | `apps/web/src/lib/legal/platform.ts` | Rellenar con datos reales. No se inventan. | `legal.spec` (comprueba que se marcan) | **Abierto (datos del propietario)** |
| F03 | **P1** (nuevo) | Cualquier usuario podía cambiar la zona horaria de su sesión con la cabecera `Prefer: timezone=…` de la API. Con ello la base de datos creía que ya era «mañana». Consecuencias: factura emitida con fecha de mañana (y el 31-12, con el año y la serie siguientes), facturas de hoy bloqueadas, y vencimientos, presupuestos y estadísticas en el día equivocado. | Probado contra PostgREST v13: con `Prefer: timezone=Pacific/Kiritimati` la fecha pasaba a 25-10. Con el esquema original, una factura emitida así llevaba fecha 2026-10-25 en lugar de 2026-10-24. | 13 funciones de la base de datos | Migración `20261104090100_zona_horaria_funciones.sql`: cada función con fechas fija `timezone = Europe/Madrid` | `25_zona_horaria.test.sql` (4 comprobaciones; también vigila funciones futuras) | **Corregido** |
| F04 | **P1** (H03) | El NIF/NIE/CIF solo se comprobaba por su forma. `12345678A` (la letra correcta es la Z) o `B12345678` se guardaban y llegaban a las facturas. | `isTaxIdShape('12345678A') === true` | `packages/core/src/documents.ts`, `workshop.ts`, `CustomerFields.astro` | `checkTaxId()` con letra o dígito de control (NIF, NIF K/L/M, NIE, CIF, prefijo ES). Extranjeros solo con el prefijo del país. La misma regla en la base de datos (`private.tax_id_kind`, restricciones `NOT VALID`, que no rechazan datos ya guardados). | `documents.test.ts` (4), `workshop.test.ts`, `24_nif_control.test.sql` (13), `panel.spec` (navegador) | **Corregido** |
| F05 | **P2** (H01) | Una respuesta 2xx de Resend o de Meta **sin identificador** del mensaje se marcaba «enviado», sin justificante. | `outcomeFromResend(200,'sin JSON')` → aceptado | `lib/notifications/{resend,whatsapp,types,labels}.ts` | Ya no cuenta como enviado. **Resend:** se reintenta con la misma clave de idempotencia (no duplica). **WhatsApp:** queda «fallido · sin justificante»; Meta no tiene idempotencia, así que reintentar solo podría duplicar, y la gerencia decide. | `notifications.test.ts`, `whatsapp.test.ts` | **Corregido** |
| F06 | **P2** (H02) | `/api/solicitudes`, los webhooks y **todos los formularios del área privada** leían el cuerpo entero antes de medirlo. Además se medía en caracteres, no en bytes. | 10.000 «ñ» (20.000 bytes) pasaban el límite de 16 KB | `lib/server/body.ts` (nuevo), `middleware.ts`, `auth-page.ts`, `api/solicitudes.ts`, `api/notificaciones/{webhook,whatsapp}.ts`, `api/preferencias.ts`, `presupuesto/[token].astro` | Lectura por partes con límite en bytes, que se corta al pasarse. 413 inmediato si la longitud declarada es mayor. | `body.test.ts` (6), `solicitudes.spec` (413) | **Corregido** |
| F07 | **P2** (nuevo) | Dependencias con avisos de seguridad: `undici` (alto) y `fast-uri` (moderado), en herramientas de compilación y desarrollo (wrangler, miniflare, astro check). | `npm audit`: 6 avisos | `package.json`, `package-lock.json` | Versiones corregidas forzadas (`overrides`: undici 7.30.1, fast-uri 3.1.9). Son subidas de parche; el resto de dependencias, sin cambios. | `npm audit` → 0; lint, tipos, build y todas las pruebas pasan | **Corregido** |
| F08 | **P3** (H04) | La verificación anti-bots (Turnstile) aceptaba respuestas sin dominio, sin formulario o sin fecha. | Respuesta simulada `{success:true}` → aceptada | `lib/requests/antispam.ts`, `config.ts` | Exige dominio, acción y que el código no tenga más de 5 minutos (según la documentación de Cloudflare). Una clave de PRUEBA de Cloudflare en producción equivale a «sin antispam» (responde 503) y nunca a «aprobar todo». | `handler.test.ts` (2 pruebas nuevas) | **Corregido** |
| F09 | **P3** (H05) | En el CSV, la protección contra fórmulas solo miraba el primer carácter. `" =1+2"` o `"​=1+2"` pasaban. | `toCsv([{a:' =1+2'}])` | `lib/panel/export.ts` | Ignora espacios e invisibles al detectar una fórmula y cubre `= + - @`, sus versiones de ancho completo y tabulador o salto de línea. | `export.test.ts` | **Corregido** (no probado abriendo el archivo en Excel) |
| F10 | **P3** (H06) | Estadísticas: el «máximo 400 días» admitía 401. | 01-01-2025 → 05-02-2026 aceptado | `lib/panel/periods.ts` | Se cuentan los dos extremos | `periods.test.ts` | **Corregido** |
| F11 | **P3** (H07) | Un mantenimiento que vence **hoy** salía «Pronto» y no «Le toca ya». Con los km sí salía bien. | `serviceDueState({dueOn: hoy})` | `packages/core/src/maintenance.ts` | `daysLeft <= 0` → vencido | `maintenance.test.ts` | **Corregido** |
| F12 | **P3** (nuevo) | Al reintentar un aviso, el servidor tomaba del formulario (manipulable) la orden cuyos avisos enviaba con la clave secreta. No exponía datos, pero adelantaba envíos de otra orden. | Revisión de código de las rutas con clave secreta | `pages/panel/avisos.astro` | La orden se lee de la base de datos con los permisos del usuario | `avisos.spec` (reintento manual) | **Corregido** |
| F13 | **P3** (H10) | El rango de Node declarado (≥22.12) era menor que el que exigen Astro y el linter (22.22.3). | `npm ci` → avisos EBADENGINE | `package.json`, `.nvmrc`, `README.md`, `DESPLIEGUE.md` | Rango real y `.nvmrc` 22.22.3 | CI usa `.nvmrc` | **Corregido** |
| F14 | Informativo | Una ficha antigua con el NIF mal no se puede editar hasta corregir el NIF. Es un efecto de F04. | Migración aplicada sobre datos antiguos | — | Es lo buscado. Hoy no hay datos reales. | Comprobado a mano (ver resultados) | Aceptado |

### Lo que se comprobó y NO tenía fallos

- **Aislamiento entre talleres (H09):** se llenó el taller B con datos en **las 35 tablas** que llevan `workshop_id`. Se probó con 8 cuentas: las 4 de A (propietaria, administradora, recepción, mecánico), una clienta solo de A, una persona sin taller, un mecánico de B desactivado y una clienta que dejó B. Con cada una se intentó, tabla por tabla, leer, cambiar, borrar, crear copias y mover filas propias a B. Además se llamó a **cada función de la API** (~80) con los identificadores de B. Resultado: **ninguna fuga**. La huella de los datos de B no cambia. Las 35 inserciones cruzadas se bloquean por permisos (código 42501), no por otro error que pudiera ocultar una fuga. Hay un control positivo: el propietario de B sí accede, así que la prueba detecta accesos.
- **Rutas del servidor con clave secreta** (matrículas, avisos, cron, webhooks, presupuesto por enlace): no se fían de identificadores del navegador. La única excepción era F12, ya corregida.
- **Almacenamiento de archivos (Storage):** el producto no lo usa. No hay buckets que proteger.
- **Concurrencia real** (8 sesiones a la vez):
  - numeración de facturas sin huecos ni repetidos;
  - los cobros nunca superan el total;
  - un presupuesto aceptado a la vez no duplica las líneas de la orden;
  - dos mecánicos no se quedan la misma orden;
  - la misma matrícula a la vez da un solo vehículo.
- **Copia cifrada y restauración real:** 41 tablas y 99 filas idénticas; la cadena de facturas cuadra; la restauración se niega a pisar datos.
- **Migraciones nuevas sobre una base con datos antiguos:** se aplican sin perder nada.
- **XSS y redirecciones:** no hay HTML sin escapar con datos de usuarios y las redirecciones pasan por `safeNext`. Lo cubren las pruebas existentes (`calidad.spec`: un script inyectado no se ejecuta).

## Legal (fuentes oficiales, consultadas el 24-10-2026)

| Requisito | Situación | Clasificación |
|---|---|---|
| **VERI\*FACTU: obligaciones del fabricante y del comercializador** (RD 1007/2023, art. 3.2; Orden HAC/1177/2024, en vigor desde el 29-10-2024) | Deben ofrecer los productos **plenamente adaptados en 9 meses desde la Orden**: hasta el **29-07-2025**. El RDL 15/2025 aplazó las fechas de los **usuarios**, **no** las de los fabricantes. Nuestro módulo no genera el registro oficial, el QR ni la leyenda, no remite a la AEAT y no tiene declaración responsable. | **Aplicable · no implementado · BLOQUEANTE** |
| Declaración responsable del fabricante (la incorpora el propio programa, por versión) | No existe. **No se ha generado:** el sistema no cumple. | Aplicable · no implementado |
| Sanciones (art. 201 bis LGT) | Fabricar o comercializar sistemas que no cumplen: **150.000 € por ejercicio y tipo de sistema**. Falta de certificado: **1.000 € por sistema vendido**. Para el usuario (el taller), tenencia: **50.000 € por ejercicio**, desde el 01-01-2027 (sociedades) o el 01-07-2027 (resto). | Aplicable · **interpretación por un asesor fiscal** de si un módulo «operativo, no certificado» ya es comercialización de un SIF |
| Plazos para los talleres (RDL 15/2025, BOE-A-2025-24446) | 01-01-2027 (Impuesto sobre Sociedades) / 01-07-2027 (resto) | Aplicable a los clientes |
| **Factura electrónica B2B** (Ley 18/2022; RD 238/2026, BOE-A-2026-7295; Orden HAC/1028/2026, BOE-A-2026-20587, del 05-10-2026) | Es **distinta de VERI\*FACTU**. Es obligatoria 12 meses (más de 8 M€ de facturación) o 24 meses (resto) después de la Orden. Exige formato estructurado (UBL…) e intercambio por plataformas o por la solución pública. **No implementado.** No afecta a particulares (B2C). | Aplicable más adelante · no implementado · fechas exactas a confirmar por un asesor |
| Integridad, trazabilidad e inalterabilidad | Hay facturas inmutables, numeración sin huecos y cadena `invoice_records`, pero **no** siguen la especificación oficial. | Parcial · no válido como cumplimiento |
| RGPD / LOPDGDD, contrato de encargo (art. 28) y subencargados | Textos y aceptación implementados (`docs/LEGAL.md`). Faltan los datos del titular, la revisión por un abogado y los DPA firmados con Supabase y Cloudflare (y Resend, Meta y Openapi si se activan). | Implementado · **pendiente de revisión jurídica** |
| Información legal de las webs (LSSI art. 10) | Datos del taller desde el panel; si falta uno, se marca. Faltan los datos de la plataforma (F02). | Implementado · faltan datos reales |
| Conservación, exportación y borrado | Solicitudes web 12 meses; copia por taller; exportación y anonimización RGPD (solo desde el SQL Editor). | Implementado · plazos a validar por un abogado |

Fuentes:

- [RDL 15/2025 (BOE-A-2025-24446)](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-24446)
- [RD 1007/2023 consolidado](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840)
- [Orden HAC/1177/2024](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2024-22138)
- [AEAT · FAQ declaración responsable](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html)
- [AEAT · aclaraciones a desarrolladores (dic. 2025)](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)
- [Ley 11/2021 (art. 201 bis LGT)](https://www.boe.es/buscar/doc.php?id=BOE-A-2021-11473)
- [RD 238/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295)
- [Orden HAC/1028/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-20587)

**Limitación:** desde este entorno no se pueden abrir boe.es ni la sede de la AEAT (la red lo bloquea). Los textos se han leído a través del buscador, limitado a esos dominios oficiales. Un asesor fiscal debe confirmarlos antes de decidir.

## Archivos modificados en esta auditoría

- **Código:**
  - `apps/web/src/lib/notifications/{types,resend,whatsapp,labels}.ts`
  - `apps/web/src/lib/server/{body.ts (nuevo),auth-page.ts,config.ts}`
  - `apps/web/src/middleware.ts`
  - `apps/web/src/pages/api/{solicitudes,preferencias}.ts`, `apps/web/src/pages/api/notificaciones/{webhook,whatsapp}.ts`
  - `apps/web/src/pages/presupuesto/[token].astro`, `apps/web/src/pages/panel/avisos.astro`
  - `apps/web/src/lib/requests/antispam.ts`, `apps/web/src/lib/panel/{export,periods}.ts`
  - `apps/web/src/components/panel/CustomerFields.astro`
  - `packages/core/src/{documents,workshop,maintenance}.ts`
- **Base de datos:** `supabase/migrations/20261104090000_nif_control.sql`, `supabase/migrations/20261104090100_zona_horaria_funciones.sql`.
- **Pruebas nuevas o ampliadas:**
  - `body.test.ts`, `notifications.test.ts`, `whatsapp.test.ts`, `handler.test.ts`, `export.test.ts`, `periods.test.ts`
  - `documents.test.ts`, `workshop.test.ts`, `maintenance.test.ts`
  - `supabase/tests/24_nif_control`, `25_zona_horaria`, `26_aislamiento_completo`
  - `scripts/test-concurrencia.sh` (`npm run test:concurrencia`, también en CI)
  - e2e: `solicitudes.spec`, `panel.spec`
  - Datos de prueba con NIF válidos: `16`, `20`, `23`, `gestion.spec`, `legal.spec`
- **Otros:** `package.json` (Node y `overrides`), `package-lock.json`, `.nvmrc`, `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`, `docs/DESPLIEGUE.md`.
