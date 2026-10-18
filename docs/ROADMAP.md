# Plan por fases

Cada fase termina con algo que funciona y se ha probado. No se empieza una fase sin cerrar la anterior.

## ✅ Fase 0 · Cimientos

- Estructura del proyecto (monorepo: `apps/web`, `packages/core`, `supabase`).
- Base de datos multiempresa con permisos RLS para los 4 roles, probada con 73 comprobaciones.
- Matrículas españolas: normalización, formatos y validación del formulario de vehículos (22 pruebas).
- Aplicación Astro mínima funcionando en el entorno de Cloudflare.
- Documentación de arquitectura y CI (GitHub Actions).

## Fase 1 · Web comercial de un taller (plantilla multi-taller)

- Resolver el taller por dominio y pintar su web con su marca.
- Páginas: inicio, taller, servicios (una página por servicio, preparada para SEO local), marcas, contacto con mapa, preguntas frecuentes.
- Botones de llamada y WhatsApp siempre visibles en móvil.
- Formularios de contacto, cita y presupuesto con antispam (Cloudflare Turnstile) y límite de envíos.
- Aviso legal, privacidad y cookies (solo banner si se usan cookies no esenciales).
- Metadatos SEO, `sitemap.xml`, datos estructurados `AutoRepair`.
- Contenido de demostración claramente identificado. Sin reseñas, precios ni certificaciones inventados.

## Fase 2 · Acceso y panel del taller

- Inicio de sesión del personal, invitaciones a empleados y 2FA para propietarios.
- Bandeja de solicitudes web (nueva → en gestión → aceptada/rechazada).
- Fichas de clientes y **formulario profesional de vehículos** (usa `packages/core`).
- Empieza React solo en las pantallas que lo necesiten.

## Fase 3 · Órdenes de reparación y portal del cliente

- Órdenes de reparación con estados, asignación de mecánicos y notas internas separadas.
- Invitación del cliente a su portal; ve solo sus vehículos y reparaciones autorizadas.

## Fase 4 · Notificaciones y automatizaciones

- Email transaccional y avisos de cambio de estado; recordatorios.
- WhatsApp Business (plantillas aprobadas) cuando haya volumen.

## Fase 5 · Administración de la plataforma

- Alta de talleres, dominios personalizados (Cloudflare for SaaS), publicación de webs, suspensión.

## Fase 6 · Integraciones de datos de vehículos

- Consultas a proveedores externos desde el servidor, con registro de origen y verificación.

## Fuera de alcance (por ahora)

Contabilidad, facturación fiscal (VeriFactu/TicketBAI), inventario de recambios y nóminas.
