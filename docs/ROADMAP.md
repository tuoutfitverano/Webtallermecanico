# Plan por fases

Cada fase termina con algo que funciona y se ha probado. No se empieza una fase sin cerrar la anterior.

## ✅ Fase 0 · Cimientos

- Monorepo: `apps/web`, `packages/core`, `supabase`.
- Base de datos multiempresa con permisos RLS para los 4 roles.
- Matrículas españolas y validación del formulario de vehículos.
- Aplicación Astro mínima en el entorno de Cloudflare. CI en GitHub Actions.

## ✅ Fase 1 · Herramientas y prototipos

- Playwright MCP para que Claude use un navegador real (nube y ordenador local).
- Demo comercial estática (`demo/`) y portada ATRIUM MTL (`atrium-mtl/`).
- Figma: investigado y aparcado (sin cuenta; no aporta valor todavía).

## ✅ Fase 2 · Web del taller funcional y backend de solicitudes

- Web pública del taller en Astro con el diseño de la demo, resuelta por dominio (multiempresa).
- Formularios **reales** de cita, presupuesto y contacto: validación compartida navegador/servidor,
  errores claros, indicador de envío, éxito solo tras guardar, sin envíos duplicados.
- Endpoint `POST /api/solicitudes` con comprobación de origen, campo trampa, Cloudflare Turnstile
  y límite de envíos en la base de datos.
- Tabla `web_requests` con estado inicial `nueva` (pendiente), asociada al taller, sin acceso para visitantes.
- Páginas legales marcadas como **pendientes de redactar** (no se inventa texto legal).
- Pruebas: unitarias, SQL de permisos y de extremo a extremo con base de datos real.

Pendiente de esta fase que requiere tu acción: crear el proyecto de Supabase, aplicar las migraciones,
configurar Turnstile y las variables en Cloudflare, y redactar los textos legales.

## Fase 3 · Acceso y panel del taller

- Inicio de sesión del personal, invitaciones a empleados y 2FA para propietarios.
- Bandeja de solicitudes web (nueva → en gestión → aceptada/rechazada) y avisos de nuevas solicitudes.
- Fichas de clientes y formulario de vehículos (usa `packages/core`).

## Fase 4 · Órdenes de reparación y portal del cliente

- Órdenes con estados, asignación de mecánicos y notas internas separadas.
- Invitación del cliente a su portal: solo sus vehículos y reparaciones autorizadas.

## Fase 5 · Notificaciones y automatizaciones

- Correo transaccional (confirmación de solicitud al cliente, aviso al taller), cambios de estado, recordatorios.
- WhatsApp Business (plantillas aprobadas) cuando haya volumen.

## Fase 6 · Administración de la plataforma y SEO

- Alta de talleres, dominios personalizados (Cloudflare for SaaS), publicación y suspensión.
- Páginas por servicio para SEO local, datos estructurados `AutoRepair`, sitemap, banner de cookies si se usan cookies no esenciales.

## Fase 7 · Integraciones de datos de vehículos

- Consultas a proveedores externos desde el servidor, con registro de origen y verificación.

## Fuera de alcance (por ahora)

Contabilidad, facturación fiscal (VeriFactu/TicketBAI), inventario de recambios y nóminas.
