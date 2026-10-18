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

- Web pública del taller en Astro, resuelta por dominio (multiempresa). Rediseño con estética "cristal líquido" (fondo negro, titulares en serif cursiva, animaciones de desenfoque y vídeo de fondo opcional por taller).
- Formularios **reales** de cita, presupuesto y contacto: validación compartida navegador/servidor,
  errores claros, indicador de envío, éxito solo tras guardar, sin envíos duplicados.
- Endpoint `POST /api/solicitudes` con comprobación de origen, campo trampa, Cloudflare Turnstile
  y límite de envíos en la base de datos.
- Tabla `web_requests` con estado inicial `nueva` (pendiente), asociada al taller, sin acceso para visitantes.
- Páginas legales marcadas como **pendientes de redactar** (no se inventa texto legal).
- Pruebas: unitarias, SQL de permisos y de extremo a extremo con base de datos real.

Pendiente de esta fase que requiere tu acción: crear el proyecto de Supabase, aplicar las migraciones,
configurar Turnstile y las variables en Cloudflare, y redactar los textos legales.

## ✅ Fase 3 · Base de datos, autenticación y arquitectura multitaller

- Supabase Auth (correo + contraseña) con sesión en cookies gestionada en el servidor (`@supabase/ssr`, flujo PKCE).
- Pantallas: iniciar sesión, crear cuenta, confirmar correo, recuperar y cambiar contraseña, cerrar sesión, mi cuenta.
- Redirecciones seguras (solo rutas del propio sitio), protección CSRF, cabeceras anti-caché.
- Talleres con logotipo y contacto; perfiles (solo nombre y teléfono editables); membresías con roles
  `propietario` / `administrador` / `mecanico` (owner / manager / mechanic) y estado activo.
- Invitaciones validadas en la base de datos: código de un solo uso, ligado al correo, caduca en 7 días;
  nadie puede invitar como propietario ni invitar en un taller ajeno.
- Alta controlada de talleres y propietarios (función privada solo para el SQL Editor).
- Pruebas: 189 comprobaciones SQL de permisos con el esquema `auth` real de Supabase, y pruebas de navegador
  con el servidor real de Supabase Auth (registro, confirmación por correo, recuperación, invitación, aislamiento por API).

Pendiente que requiere tu acción: ver `docs/PUESTA_EN_MARCHA.md` (proyecto de Supabase, migraciones,
URLs de Auth, plantillas de correo, SMTP propio, primer taller).

## Fase 4 · Panel de gestión del taller

- Bandeja de solicitudes web (nueva → en gestión → aceptada/rechazada) y avisos de nuevas solicitudes.
- Gestión del equipo en pantalla: cambiar rol, desactivar y reactivar (las funciones de base de datos ya existen y están probadas).
- Fichas de clientes y vehículos (usa `packages/core`).
- 2FA obligatorio para propietarios y administración de la plataforma.

## Fase 5 · Órdenes de reparación y portal del cliente

- Órdenes con estados, historial de cambios, asignación de mecánicos y notas internas separadas.
- Invitación del cliente a su portal: solo sus vehículos y reparaciones autorizadas.

## Fase 6 · Notificaciones y automatizaciones

- Correo transaccional (confirmación de solicitud al cliente, aviso al taller, invitaciones), cambios de estado, recordatorios.
- WhatsApp Business (plantillas aprobadas) cuando haya volumen.

## Fase 7 · Administración de la plataforma y SEO

- Panel de alta de talleres, dominios personalizados (Cloudflare for SaaS), publicación y suspensión.
- Páginas por servicio para SEO local, datos estructurados `AutoRepair`, sitemap, banner de cookies si se usan cookies no esenciales.

## Fase 8 · Integraciones de datos de vehículos

- Consultas a proveedores externos desde el servidor, con registro de origen y verificación.

## Fuera de alcance (por ahora)

Contabilidad, facturación fiscal (VeriFactu/TicketBAI), inventario de recambios y nóminas.
