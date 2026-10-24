# Resultados de las pruebas (24-10-2026)

Todos los resultados son **reales**, de ejecuciones en este repositorio. Los registros completos están en la carpeta de trabajo de la sesión.

**Entorno:**

- Node 22.22.0, npm 10.9.4, PostgreSQL 16.15.
- Supabase Auth (GoTrue) y PostgREST v13.0.7 reales, en local.
- Chromium de Playwright.
- Proveedores de correo, WhatsApp y matrículas **simulados**.

**No probado contra:** Supabase, Cloudflare, Resend, Meta, Openapi ni Turnstile reales.

## Resumen

| Batería | Comando | Inicio (código original) | Final (código corregido) |
|---|---|---|---|
| Instalación limpia | `npm ci` | ✔ (avisos de versión de Node) | ✔ |
| Revisión de código | `npm run lint` | ✔ | ✔ |
| Tipos | `npm run check` | ✔ 0 errores | ✔ 0 errores, 0 avisos |
| Unitarias | `npm test` | 213 ✔ (143 web + 70 core) | **227 ✔** (153 web + 74 core), 0 ✘ |
| Compilación y secretos | `npm run build` | ✔ | ✔ (37 archivos del navegador sin secretos) |
| Base de datos y permisos | `npm run test:db` | 884 ✔ (23 archivos + seed) | **921 ✔** (26 archivos + seed), 0 ✘ |
| Concurrencia (nueva) | `npm run test:concurrencia` | — | **10 ✔** con 8 sesiones simultáneas |
| Copia cifrada y restauración | `bash scripts/backup/test-restore.sh` | — | **10 ✔** (41 tablas, 99 filas idénticas) |
| Navegador (e2e) | `npm run test:e2e` | 198 ✔ · 0 ✘ · 72 omitidas (20,4 min) | **199 ✔ · 0 ✘ · 73 omitidas** (20,8 min) |
| Dependencias | `npm audit` | ✘ 6 avisos (1 alto, 5 moderados) | **0** |

## Antes y después: las pruebas nuevas demuestran los fallos

Las pruebas nuevas se copiaron sobre el **código original** (commit `9fcb998`, en una copia aparte) y se ejecutaron **sin corregir nada**:

| Prueba | Con el código original | Con el corregido |
|---|---|---|
| Web unitarias | **6 pruebas fallan** (H01 Resend, H01 Meta, H04 ×2, H05, H06) y `body.test.ts` no carga (H02: no existía el límite) | ✔ |
| Core unitarias | **7 pruebas fallan** (H03 ×6, H07) | ✔ |
| `24_nif_control.test.sql` | ✘ no existía la comprobación de control | ✔ 13 |
| `25_zona_horaria.test.sql` | ✘ 13 funciones sin la hora de Madrid fija. **La factura emitida con la sesión en UTC+14 salía con fecha 2026-10-25** en vez de 2026-10-24 | ✔ 4 |
| `26_aislamiento_completo.test.sql` | ✔ 16 (el aislamiento ya funcionaba; versión sin los casos «después de irse») | ✔ 20 |
| `Prefer: timezone` en PostgREST v13 | Comprobado a mano: `Pacific/Kiritimati` → la fecha de la sesión pasa a 25-10 | La función fija la hora de Madrid (prueba 25) |

## Navegador (e2e)

| Ejecución | Resultado |
|---|---|
| Inicio (código original) | **198 ✔ · 0 ✘ · 72 omitidas** · 20,4 min |
| Final, 1.ª ejecución | 198 ✔ · **1 ✘** · 73 omitidas. El fallo era de la **prueba nueva**: Playwright recalcula la cabecera `content-length`, así que la longitud falsa que se quería probar no llegaba a enviarse. Esa parte está cubierta por `body.test.ts`. La parte principal (413 con un cuerpo de 20.000 bytes reales) **sí pasó**. Se quitó esa línea de la prueba. |
| **Final, 2.ª ejecución** (todos los cambios, incluidas las etiquetas de estado más grandes) | **199 ✔ · 0 ✘ · 73 omitidas** · 20,8 min (la prueba nueva de tamaño suma una) |

**Pruebas omitidas, por diseño:**

- Pruebas de API que basta con ejecutar una vez y no se repiten en móvil (`auth`, `solicitudes`, `panel`, `matriculas`, `avisos`…).
- Capturas de pantalla.
- La vista previa, que solo corre con `VISTA_PREVIA_DIR`.
- La aceptación legal, que solo se prueba en escritorio porque queda guardada.

**Tamaños y modos:** `calidad.spec.ts` recorre 9 tamaños, de 320 px a 1920 px, en vertical y horizontal (móvil, tablet y PC), en modo claro y oscuro. Pasa axe (WCAG A/AA) en cada pantalla principal y en cada color del panel, y comprueba consola, red, enlaces, teclado y CSP.

**Flujo de una persona sin conocimientos informáticos:** `aceptacion.spec.ts`, en escritorio y móvil: cliente → vehículo → orden → estados → historial → portal del cliente.

Presupuesto enviado y aceptado desde el portal: `gestion.spec`. Factura en modo de prueba: `gestion.spec`. Cerrar sesión: `auth.spec` («cerrar sesión la termina de verdad»; páginas privadas sin caché).

Las trazas de Playwright de los fallos se guardan en `apps/web/test-results/` (no se suben a Git).

## Comprobaciones a mano

- **Migraciones nuevas sobre una base con datos antiguos** (esquema original más datos): se aplican sin error y conservan las filas. Una ficha antigua con NIF erróneo no se deja editar hasta corregirlo, que es lo buscado.
- **Diagnóstico de la prueba de aislamiento:**
  - las 35 inserciones cruzadas se bloquean con el código 42501 (permisos o RLS), nunca por otro error que pudiera ocultar una fuga;
  - de unas 93 llamadas a la API con identificadores de B, las de la propietaria de A devuelven vacío, ceros o «no encontrado»;
  - las del propietario de B (control) devuelven sus datos.

## Limitaciones (no probado o probado solo en parte)

- **Ningún servicio real.** Supabase y Cloudflare de producción no existen todavía. Correo, WhatsApp y matrículas, solo simulados.
- **PostgreSQL 16 en local.** El CI y Supabase usan 17; el CI repite las mismas pruebas en 17.
- **Excel / LibreOffice:** la protección contra fórmulas del CSV no se ha comprobado abriendo los archivos.
- **Caída de la base de datos a mitad de uso:** no se ha simulado. Lo que sí existe:
  - prueba del endpoint de solicitudes con el almacenamiento caído (503);
  - reintentos de avisos con proveedor caído (`avisos.spec`).
- **Carga:** no se ha hecho prueba de carga (muchos usuarios durante horas). Solo concurrencia de 8 sesiones sobre los puntos críticos.
- **Fuentes legales:** desde este entorno no se pueden abrir boe.es ni la sede de la AEAT (la red lo bloquea). Se leyeron a través del buscador limitado a esos dominios.
- **El ZIP de pruebas** del informe externo (`Auditoria_codigo_talleres_pruebas.zip`) no se adjuntó y no se ha podido ejecutar.
