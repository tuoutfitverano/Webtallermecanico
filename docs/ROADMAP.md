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

## ✅ Fase 4 · Panel de gestión del taller (pendiente de tu revisión)

- Panel en `/panel`: barra lateral en escritorio, pestañas inferiores en móvil, cabecera con taller y persona, selector de taller.
- Inicio con indicadores reales (activas, pendientes de diagnosis, esperando recambios, listas para recoger) y últimas órdenes.
- Clientes: lista, búsqueda (nombre, teléfono, correo), alta con aviso de posible duplicado, ficha, edición, borrado con confirmación.
- Vehículos: matrícula normalizada y única por taller, datos manuales con fuente y verificación visibles, historial de reparaciones.
- Órdenes de reparación (`repair_orders`): seis estados, asignación a personas activas del taller, información para el cliente
  separada de las notas internas, filtros por estado y empleado, búsqueda por número/matrícula/cliente.
- Historial de cambios (`repair_order_events`) escrito solo por la base de datos.
- Equipo: roles, órdenes activas por persona, cambio de rol y desactivación según permisos.
- Pruebas: 261 comprobaciones SQL y 66 pruebas de navegador con Supabase Auth real.

Pendiente para fases siguientes: bandeja de solicitudes web dentro del panel, 2FA obligatorio para propietarios
y administración de la plataforma, avisos/notificaciones.

## ✅ Fase 5 · Portal del cliente

- Portal en `/portal`: inicio (saludo, avisos "listo para recoger", resumen, última reparación), mis vehículos, mis reparaciones
  con filtros (todas, en curso, listas, finalizadas), detalle con pasos, mensajes del taller e historial, y mis datos.
- Vinculación cuenta ↔ ficha **solo por invitación del taller** (enlace personal de un solo uso, 7 días, ligado al correo,
  guardado como huella SHA-256). Nunca por matrícula, nombre, correo o teléfono.
- Panel: tarjeta "Acceso al portal" en la ficha del cliente (invitar, ver invitaciones pendientes, anular, retirar el acceso
  sin borrar ficha ni historial). En cada orden: mensaje para el cliente y casilla para mostrarle diagnosis y trabajo.
- Los clientes no tienen acceso a ninguna tabla: solo a funciones `portal_*` con columnas elegidas a mano.
- `/mi-area` lleva a cada uno a su sitio tras iniciar sesión; un cliente que abre `/panel` recibe "acceso denegado" (403).
- Pruebas: 322 comprobaciones SQL y 80 pruebas de navegador (14 del portal).

Pendiente: envío automático del enlace de invitación por correo (hoy se copia y se comparte a mano).

## ✅ Fase 6 · Datos de vehículos por matrícula (pendiente de contrato con el proveedor)

- «Consultar datos» en el alta de vehículos, con proveedor intercambiable (hoy Openapi «Spanish Car Check»).
- Revisión antes de usar los datos; nada se guarda sin «Guardar vehículo»; lo escrito a mano no se pisa sin marcarlo.
- Registro de cada consulta, procedencia campo a campo, límites por persona y por taller, reutilización sin coste dentro del taller.
- Pruebas: 368 comprobaciones SQL, 26 unitarias nuevas y 5 de navegador con proveedor **simulado**.
- Pendiente: contratar Openapi, revisar sus términos, confirmar los campos con una consulta de prueba y configurar el token (`docs/CONSULTA_MATRICULAS.md`).

## ✅ Fase 7 · Notificaciones y automatizaciones (email pendiente de credenciales)

- Avisos automáticos por cada cambio real de estado (patrón outbox en la base de datos), con reglas por taller.
- Portal: `/portal/avisos` con no leídos, marcar como leído y enlace a la reparación.
- Email con Resend: plantilla HTML + texto, idempotencia, reintentos limitados, webhook firmado de entrega, proceso programado.
- Panel → Avisos: registro con estado real, motivo del fallo, reintento manual y ajustes.
- Preferencias del cliente y consentimiento comercial separado (solo lo da el cliente), con registro.
- Pruebas: 449 comprobaciones SQL, 18 unitarias nuevas y 4 de navegador con email **simulado**.
- Pendiente: cuenta de Resend y dominio, webhook, Supabase Cron, revisión legal; WhatsApp/SMS sin implementar (`docs/NOTIFICACIONES.md`).

## ✅ Fase 8 · Auditoría, seguridad y preparación para producción

- Auditoría completa (`docs/AUDITORIA_FASE8.md`): sin exposición de datos. Corregidos 2 hallazgos altos (destinatario de los emails al cambiar cliente o correo; bandeja de solicitudes web en el panel) y 9 medios (cabeceras, cookies HttpOnly, campos de auditoría, mantenimiento, derechos RGPD, accesibilidad, páginas legales, pruebas intermitentes, permisos por columna).
- Pruebas: 477 comprobaciones SQL, 138 unitarias y pruebas de navegador ampliadas (calidad y accesibilidad en 31 pantallas).
- Guía de despliegue, checklist de lanzamiento e inventario de datos personales.
- Pendiente: configuración real (Supabase de producción, copias de seguridad, SMTP, Cloudflare, cron, proveedores) y textos legales.

## Fase 9 · Administración de la plataforma y SEO

- Panel de alta de talleres, dominios personalizados (Cloudflare for SaaS), publicación y suspensión.
- Páginas por servicio para SEO local, datos estructurados `AutoRepair`, sitemap, banner de cookies si se usan cookies no esenciales.

## Fuera de alcance (por ahora)

Contabilidad, facturación fiscal (VeriFactu/TicketBAI), inventario de recambios y nóminas.
