# Checklist de lanzamiento (19-10-2026)

**Estados:**

- ✅ **Verificado**: con pruebas ejecutadas localmente en este repositorio.
- 🟡 **Pendiente de configuración**: hace falta acceso a Supabase o a un proveedor, o una decisión.
- ⚖️ **Revisión legal**: lo tiene que validar un profesional.
- ❌ **No superado**.

**Evidencia:** todas las pruebas se han ejecutado **localmente**, con PostgreSQL y las piezas reales de Supabase Auth y PostgREST, y con los proveedores externos **simulados**. No hay entorno de preproducción ni producción.

## Seguridad y datos

| Elemento | Estado | Evidencia |
| --- | --- | --- |
| Usuario sin sesión no entra en panel ni portal | ✅ | `panel.spec`, `portal.spec` (redirige a `/acceso`); RLS para `anon` (`12_auditoria`) |
| Un taller no ve datos de otro (interfaz y API) | ✅ | `01_aislamiento`, `08`, `panel.spec` (cookie y URL manipuladas), `avisos.spec`, `matriculas.spec` |
| Un cliente no ve reparaciones ni avisos ajenos | ✅ | `09_portal_clientes`, `11_notificaciones`, `portal.spec`, `avisos.spec` |
| Un empleado no eleva sus permisos | ✅ | `02_roles_y_privilegios`, `07_cuentas_y_equipos` |
| Orden con vehículo o cliente de otro taller: imposible | ✅ | Claves foráneas compuestas; `08`, `panel.spec` (API) |
| La revocación de acceso corta las consultas directas | ✅ | Membresía desactivada (`07`), portal desvinculado (`09`, `portal.spec`) |
| Redirecciones solo internas (sin phishing) | ✅ | `auth.spec` (`?next=` externo) y pruebas unitarias de `safeNext` |
| RLS en todas las tablas y funciones con permisos mínimos | ✅ | `12_auditoria` (reglas del catálogo) |
| Sin secretos en el código del navegador ni en el historial | ✅ | `scripts/check-client-bundle.mjs` (en cada build); búsqueda en el historial de Git |
| Dependencias sin vulnerabilidades conocidas | ✅ | `npm audit`: 0 |
| Cabeceras de seguridad y cookies `HttpOnly` | ✅ | `calidad.spec` (cabeceras); `auth.ts` |
| Webhook del proveedor de email firmado | ✅ | Pruebas unitarias y `avisos.spec` (firma falsa → 401) |
| Avisos al destinatario correcto | ✅ | `12_auditoria` (cambio de cliente o de correo → cancelado) |
| Copias de seguridad configuradas y restauración probada | 🟡 | Depende del plan de Supabase: no verificable desde aquí |
| Ajustes de Supabase Auth en producción (SMTP, límites, redirecciones) | 🟡 | `PUESTA_EN_MARCHA.md` §3 |
| Alertas de errores en producción | 🟡 | Solo Workers Logs. Sin servicio de alertas |

## Funcionalidad

| Elemento | Estado | Evidencia |
| --- | --- | --- |
| Web pública y formularios (validación, antispam, «recibido» solo si se guarda) | ✅ | `solicitudes.spec`, pruebas unitarias del endpoint |
| Las solicitudes llegan al panel del taller | ✅ | `solicitudes.spec` (bandeja, Fase 8) |
| Registro, confirmación, acceso, recuperación y sesión caducada | ✅ | `auth.spec`, `portal.spec` (correo real de Supabase Auth a un buzón local) |
| Equipo: invitaciones, roles y desactivación | ✅ | `07`, `auth.spec`, `panel.spec` |
| Clientes, vehículos y órdenes; estados e historial coherentes | ✅ | `08`, `panel.spec`, `11` (vuelta atrás conserva historial) |
| Portal del cliente: rutas, filtros y detalle | ✅ | `portal.spec`, `calidad.spec` |
| Alta manual de vehículos sin API de matrículas | 🟡 | Pruebas unitarias (`no_configurado`) y alta manual en `matriculas.spec`. El navegador siempre se prueba con el proveedor simulado activo |
| Consulta de matrículas real | 🟡 | Sin contrato ni credenciales de Openapi (`CONSULTA_MATRICULAS.md`) |
| Avisos en el portal | ✅ | `11`, `avisos.spec` |
| Email real | 🟡 | Sin cuenta, dominio ni webhook de Resend ni cron (`NOTIFICACIONES.md`) |
| Migraciones reproducibles en un entorno nuevo | ✅ | `test:db` las aplica desde cero; prueba con una transacción por archivo |
| Pantallas en móvil y escritorio, accesibilidad básica | ✅ | `calidad.spec`: 31 pantallas, axe sin fallos graves ni críticos, sin desbordes, teclado |
| Vídeo de portada (bucle con fundido) y «reducir movimiento» | ✅ | `panel.spec` (vídeo) y `FadingVideo.astro` |
| Coche que gira con el scroll y zoom hasta la ventanilla (taller demo) | ✅ | `panel.spec` (web pública: giro, zoom, «reducir movimiento»). Sin JavaScript queda la imagen fija |
| Despliegue real en Cloudflare | 🟡 | No realizado (falta autorización y cuenta). Guía en `DESPLIEGUE.md` |

## Legal y negocio

| Elemento | Estado |
| --- | --- |
| Aviso legal, privacidad, cookies, privacidad de cuentas y condiciones | ⚖️ Páginas creadas como «Texto pendiente», sin texto inventado |
| Contrato de encargado del tratamiento con cada taller y DPA con Supabase, Cloudflare, Resend y Openapi | ⚖️ |
| Plazos de conservación de datos | ⚖️ 🟡 (`DATOS_PERSONALES.md` §2) |
| Datos de la empresa (titular, NIF, domicilio) | 🟡 Faltan; hay marcadores |
| Contenido real de cada taller (sin demo) | 🟡 |

## Conclusión

No queda ningún problema crítico ni alto **abierto** en el código.

Antes de trabajar con datos reales de talleres faltan:

- configurar los servicios (Supabase de producción, SMTP, copias de seguridad, Cloudflare, cron);
- completar los textos legales y los contratos.

Recomendación: **listo para pruebas en preproducción**, y para un **piloto controlado** cuando se cierren los puntos 🟡 de seguridad y los ⚖️ legales.
