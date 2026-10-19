# Integración del producto (19-10-2026)

Revisión de que cada función que ya existía en la base de datos o el servidor sea accesible desde la interfaz, respete los permisos y funcione de principio a fin. **No se han añadido funciones comerciales nuevas ni cambios en la base de datos.**

**Leyenda:**

- **Pantalla**: existe la página.
- **Conectada**: la página lee y guarda con la base de datos real (token del usuario y RLS).
- **Verificada**: cubierta por una prueba de navegador (`npm run test:e2e`) que recorre el flujo completo, incluido el intento de un usuario sin permisos.

## 1. Inventario antes de los cambios

Se revisaron las 40 rutas, los menús de panel y portal, y el uso de cada función y tabla de la base de datos desde la web.

| Área | Estado encontrado |
| --- | --- |
| Web pública (portada, servicios, formularios de cita/presupuesto/contacto) | Conectada y verificada. Acceso al área privada **solo** con un enlace del pie, «Acceso del taller», poco visible para clientes |
| Acceso, registro, recuperación, salir, sesión caducada, reparto por rol (`/mi-area`) | Conectada y verificada |
| Panel: inicio, órdenes, vehículos, clientes | Conectada y verificada (búsquedas, filtros, alta, edición, estados, asignación, historial, borrado en dos pasos) |
| Equipo: roles y desactivación | Conectada y verificada en `/panel/equipo` |
| Equipo: **invitaciones** | Conectadas, pero **fuera del panel**, en `/cuenta`, que además repetía la lista del equipo |
| Avisos (panel): registro, reintentos, ajustes | Conectada y verificada |
| Solicitudes web (panel) | Bandeja y cambio de estado. **Borrar** (permitido por RLS a gestores) solo era posible desde Supabase |
| **Datos del taller** (nombre, razón social, NIF, contacto, logotipo) | Backend listo (RLS + `workshops_guard` + pruebas SQL), **sin pantalla** |
| Web pública, dominios, servicios conectados | Sin pantalla (solo SQL) |
| **Registro de consentimientos** (`communication_consent_log`) | Se guardaba, pero no se veía en ningún sitio |
| Portal del cliente (inicio, vehículos, reparaciones, detalle, avisos, datos y preferencias, invitación) | Conectada y verificada |
| Menú móvil del panel | 6 pestañas. **Sin acceso** a «Mi cuenta», ni a «Solicitudes web» salvo desde el inicio |
| Funciones `portal_my_vehicles` y `portal_my_workshops` | Sin uso (de la Fase 0, sustituidas por `portal_*`). Se mantienen: son seguras y tienen pruebas |
| Lint | **1 error** (importación sin usar en `panel/solicitudes.astro`): CI en rojo |

## 2. Cambios

| Cambio | Archivos |
| --- | --- |
| Nueva sección **Taller** (`/panel/taller`, solo gestores): datos editables con validación doble y estado de solo lectura de la cuenta, la web pública, los dominios y los servicios conectados (sin mostrar claves) | `pages/panel/taller.astro`, `packages/core/src/workshop.ts` (`workshopProfileSchema`) |
| **Invitaciones del equipo** dentro de `/panel/equipo`. `/cuenta` ya no duplica el equipo: enlaza a él | `pages/panel/equipo.astro`, `pages/cuenta/index.astro` |
| **Menú móvil**: 4 pestañas fijas y «Más» con el resto de secciones (según el rol) y «Mi cuenta». Funciona sin JavaScript | `layouts/PanelLayout.astro`, `styles/panel.css` |
| **Borrar solicitudes web** en dos pasos (spam o derecho de supresión) | `pages/panel/solicitudes.astro` (corrige también el error de lint) |
| **Historial de cambios de comunicaciones** en la ficha del cliente (solo gestores, como dice RLS) | `pages/panel/clientes/[id].astro` |
| Enlace **«Área de clientes»** en el menú de la web pública; el pie dice «Área de clientes y talleres» | `components/SiteHeader.astro`, `components/SiteFooter.astro` |
| Pruebas | `e2e/integracion.spec.ts` (nueva); `e2e/auth.spec.ts` (invitaciones desde el panel); `e2e/calidad.spec.ts` (+2 pantallas); pruebas unitarias del esquema del taller |

## 3. Flujos verificados de extremo a extremo (navegador + base de datos real)

- **Web pública → «Área de clientes» → acceso** (escritorio y móvil).
- **Navegación por rol:**
  - la administradora ve todas las secciones;
  - el mecánico no ve Avisos, Solicitudes ni Taller, y si escribe la dirección ve «Solo el propietario o un administrador».
- **Menú «Más» en móvil** (administradora y mecánico), sin desbordar la pantalla.
- **Datos del taller:**
  - error de validación visible;
  - guardado, que persiste al recargar y en la base de datos.
  - Un mecánico recibe 403 al enviar el formulario, y la API no cambia nada.
- **Solicitud web:**
  - se envía desde la web, aparece en el panel y se borra en dos pasos;
  - desaparece al recargar y de la base de datos;
  - el mecánico recibe 403 por la API.
- **Comunicaciones del cliente:** el taller desactiva los avisos por email, el cambio queda en el historial y el mecánico no lo ve.
- **Invitaciones desde el panel:**
  - invitar, crear la cuenta, confirmar el correo, aceptar y entrar como mecánico;
  - el enlace no sirve dos veces ni para otra cuenta;
  - el mecánico no ve el formulario.
- Todo lo anterior a esta revisión (Fases 2 a 8) sigue pasando: auth, panel, portal, matrículas (proveedor simulado), avisos (email simulado), solicitudes y calidad (axe, consola, enlaces, móvil).

## 4. Pendiente y por qué

| Pendiente | Motivo |
| --- | --- |
| Editar textos, aspecto y dominios de la web pública desde el panel | La base de datos lo permite (`workshop_sites`), pero el contenido es un JSON libre. Una pantalla segura y útil es una función nueva: fuera del alcance de esta revisión |
| Consulta real de matrículas y email real | Dependen de contratar Openapi y Resend (credenciales). Probado solo con simuladores |
| Antispam real (Turnstile) | Necesita las claves de Cloudflare. Sin ellas la web responde 503 y no finge envíos |
| Vídeo sincronizado con el scroll | Hecho después de esta revisión (coche que gira en la portada del taller demo) |
| Textos legales | Pendientes de un asesor |
