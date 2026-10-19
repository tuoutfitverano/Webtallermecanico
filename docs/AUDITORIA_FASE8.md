# Auditoría integral (Fase 8) — 19-10-2026

Alcance: todo el repositorio (web pública, formularios, acceso, equipos, clientes, vehículos, órdenes, portal, matrículas, avisos, base de datos y despliegue). Todo lo de abajo se ha **comprobado ejecutando pruebas o consultas**, salvo lo marcado como «pendiente».

## 1. Cómo se ha auditado

| Qué | Cómo | Resultado |
| --- | --- | --- |
| Estado inicial | lint, tipos, unitarias, build, `test:db`, `test:e2e` | Todo en verde (449 SQL, 133 unitarias, 89 navegador) |
| Permisos de la base de datos | Consultas al catálogo de PostgreSQL con todas las migraciones aplicadas: RLS por tabla, políticas, permisos por rol y columna, funciones `security definer`, funciones ejecutables por `anon`/`PUBLIC` | Ver §2. Convertido en pruebas permanentes (`supabase/tests/12_auditoria.test.sql`) |
| Migraciones en limpio | Base de datos nueva; cada migración en su propia transacción (como `supabase db push`); después `seed.sql` | Las 8 migraciones y el seed se aplican sin errores |
| Secretos | Búsqueda de patrones de claves (Supabase, Resend, Stripe, JWT, claves privadas, AWS, GitHub) en **todo el historial** de Git y en el código que llega al navegador | Ninguno. Los `.dev.vars.example` antiguos solo tenían marcadores (`sb_secret_...`) |
| Dependencias | `npm audit` | 0 vulnerabilidades |
| Calidad de las pantallas | Nueva prueba `e2e/calidad.spec.ts`: axe-core (WCAG 2.1 A/AA), errores de consola, peticiones fallidas, enlaces rotos, desbordamiento en móvil, cabeceras, teclado | 31 pantallas revisadas en escritorio y móvil |

## 2. Hallazgos

No se ha encontrado ninguna exposición de datos entre talleres o clientes: las pruebas de aislamiento de las fases 3 a 7 y las nuevas reglas del catálogo pasan.

| # | Gravedad | Hallazgo | Estado |
| --- | --- | --- | --- |
| A1 | **Alto** | **Avisos por email al destinatario equivocado.** Un email «Listo para recoger» en cola se enviaba a la dirección guardada al crearlo, aunque la orden hubiera cambiado de cliente o el cliente hubiera cambiado de correo. | **Corregido.** Antes de enviar se comprueba que el cliente de la orden y su correo actual coinciden; si no, el email se cancela (`destinatario_cambiado`). Pruebas SQL |
| A2 | **Alto** | **Solicitudes de la web sin bandeja.** Las citas, presupuestos y contactos solo se veían desde Supabase, no desde el panel: un taller real no las habría visto. | **Corregido.** Nueva página `/panel/solicitudes` (solo gestores, por RLS), con contador en el inicio. Prueba de navegador de la web al panel |
| M1 | Medio | **Cabeceras de seguridad incompletas.** Faltaban en la web pública y en la API (incrustación en otras webs, *nosniff*, permisos del navegador, HSTS). | **Corregido** en `src/middleware.ts` para todas las respuestas. Prueba de navegador |
| M2 | Medio | **Cookies de sesión sin `HttpOnly`.** Un fallo de XSS podría haber leído la sesión. | **Corregido**: el navegador nunca usa la sesión directamente |
| M3 | Medio | **Datos que el personal podía falsear o tocar.** Quién y cuándo creó una ficha o un vehículo, y los campos antiguos de consentimiento de `customers` (sustituidos en la Fase 7 y que no respetaban la regla «solo el cliente consiente»). | **Corregido** con disparadores. Pruebas SQL |
| M4 | Medio | **Huellas antispam conservadas de más.** Solo se borraban cuando llegaba otra solicitud. | **Corregido**: `run_maintenance()` desde el proceso programado. Falta configurar el cron (pendiente) |
| M5 | Medio | **Sin procedimiento para los derechos RGPD** de acceso y supresión. | **Corregido**: `private.export_customer_data` y `private.anonymize_customer` (solo SQL Editor). Pruebas SQL. Ver `DATOS_PERSONALES.md` |
| M6 | Medio | **Accesibilidad**: el botón «Salir» y el logotipo tenían un nombre accesible distinto del texto visible (WCAG 2.5.3), en todas las pantallas. | **Corregido**. axe sin fallos graves ni críticos |
| M7 | Medio | **Faltaban páginas legales**: no había página de cookies ni de condiciones del servicio; la de privacidad no mencionaba portal, avisos ni proveedores. | **Parcial**: `/cookies` (inventario real de cookies), `/condiciones` y listas de privacidad ampliadas. **El texto legal sigue pendiente** (asesor) |
| M8 | Medio | **Pruebas intermitentes**: la primera ejecución tras compilar fallaba (el servidor de desarrollo se reiniciaba). | **Corregido**: `test-e2e.sh` calienta las páginas antes de probar |
| M9 | Medio | **Personal con acceso a datos internos de las solicitudes**: leía la huella antispam y la clave de idempotencia. | **Corregido** con permisos por columna |
| B1 | Bajo | Funciones de disparador ejecutables por `PUBLIC` (inofensivo). | Corregido (revocado) |
| B2 | Bajo | Sin página 404 propia. | Corregido |
| B3 | Bajo | Consultas de matrícula que podían quedarse «pendientes» para siempre si el servidor caía. | Corregido (`run_maintenance`) |
| B4 | Bajo | `portal_my_vehicles` y `portal_my_workshops` (Fase 0) sin uso. | Se mantienen: son seguras y tienen pruebas |
| B5 | Bajo | Si una orden cambia de cliente, el cliente anterior conserva los avisos del portal que ya recibió (título, vehículo y número). | **Abierto**: aceptable para un piloto |
| B6 | Bajo | El CSP no limita los scripts (la web usa scripts en línea y Turnstile). | **Abierto**: mejora futura |
| B7 | Bajo | No hay vídeo sincronizado con el scroll; el vídeo de portada en bucle funciona y respeta «reducir movimiento». | **Abierto**: funcionalidad no implementada |
| B8 | Bajo | El alta manual de vehículos **sin** proveedor de matrículas solo está probada con pruebas unitarias: el entorno de navegador siempre tiene el proveedor simulado. | Abierto (verificación parcial) |

## 3. Pruebas añadidas

- **`supabase/tests/12_auditoria.test.sql`** (28 comprobaciones). Reglas permanentes del esquema:
  - RLS en todas las tablas;
  - `anon` sin acceso a tablas y solo a `get_public_site`;
  - ninguna función ejecutable por `PUBLIC`;
  - `search_path` fijado y sin `is_privileged` dentro de `security definer`;
  - nadie escribe directamente avisos, historial ni consentimientos;
  - toda tabla con `workshop_id` apunta al taller.

  Además cubre el destinatario correcto, los campos de auditoría, el mantenimiento y la exportación y anonimización de clientes.
- **`apps/web/e2e/calidad.spec.ts`**: accesibilidad, consola, red, enlaces, móvil, cabeceras y teclado en 31 pantallas.
- **`apps/web/e2e/solicitudes.spec.ts`**: bandeja de solicitudes, de la web al panel, y permisos.
- **`apps/web/src/lib/schema-sync.test.ts`**: los valores de `packages/core` coinciden con los tipos de la base de datos.

## 4. Lo que no se ha podido verificar

- **Configuración real de Supabase:** copias de seguridad, plan contratado, SMTP, ajustes de Auth y límites. No hay acceso a un proyecto real.
- **Despliegue en Cloudflare:** no se ha desplegado, por falta de autorización y de cuenta.
- **Proveedores reales:** Openapi y Resend están sin credenciales; solo se han probado con simulaciones.
- **Revisión legal:** textos, bases jurídicas, plazos de conservación y contratos con encargados.
