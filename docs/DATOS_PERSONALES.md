# Datos personales: inventario y procedimientos

Documento técnico para preparar la política de privacidad y el registro de actividades. **No es un texto legal** y debe validarlo un asesor.

## 1. Qué se guarda y quién lo ve

| Datos | Para qué | Quién accede | Proveedor que los trata |
| --- | --- | --- | --- |
| **Solicitudes web**: nombre, teléfono o correo, vehículo, servicio, fecha deseada, mensaje, aceptación de la privacidad | Responder a la solicitud | Propietario y administradores del taller (`/panel/solicitudes`) | Supabase (base de datos), Cloudflare (web) |
| Huella antispam de la solicitud (HMAC del IP, rota cada día) | Limitar abusos | Nadie desde la aplicación (ni el personal) | Supabase. Se borra a los 2 días |
| **Cuentas**: correo, contraseña (cifrada por Supabase Auth), nombre y teléfono opcional | Acceso | La propia persona y la plataforma | Supabase Auth |
| **Equipo**: rol y estado en cada taller | Permisos | Personal del taller | Supabase |
| **Clientes del taller**: nombre, teléfono, correo, notas internas, cuenta del portal | Gestionar reparaciones | Personal del taller. El cliente ve sus datos en el portal, **nunca** las notas internas | Supabase |
| **Vehículos y órdenes**: matrícula, marca, modelo, año, combustible, estado, diagnosis, trabajo, mensajes al cliente, historial | Gestionar reparaciones | Gestores: todo. Mecánicos: solo las órdenes asignadas. Cliente: lo autorizado | Supabase |
| **Consultas de matrícula** (si se activan): matrícula y datos devueltos | Rellenar la ficha del vehículo | Personal del taller | **Openapi** (recibe la matrícula) |
| **Avisos**: título, texto, correo destinatario y estado de envío | Informar al cliente | Gestores (registro) y el cliente (sus avisos del portal) | **Resend** (si se activa; recibe correo, asunto y texto) |
| **Preferencias y consentimientos**: avisos por email, comerciales e historial de cambios | Respetar lo que quiere el cliente y poder demostrar el consentimiento | Personal; el registro, solo gestores | Supabase |
| Cookies | Ver `/cookies`: técnicas (sesión, seguridad, taller abierto, respuesta al aviso) y de preferencias (modo claro u oscuro, color del panel), estas solo si se aceptan en el aviso | — | Navegador de la persona |

**Registros técnicos** (`console`): solo códigos de evento y recuentos. Nunca correos, nombres, matrículas, contenidos ni claves. Se comprueba en las pruebas unitarias de matrículas y avisos.

**Contenido de los emails**: nombre del taller, título del aviso, vehículo, número de orden, estado y mensaje del taller. Nunca notas internas, diagnosis no autorizada ni enlaces con códigos de acceso.

## 2. Conservación (pendiente de decidir con el asesor)

Hoy **no hay borrado automático**, salvo:

- las huellas antispam (2 días);
- los avisos por email no enviados (se cancelan a los 2 días).

Hay que decidir y documentar plazos para:

- solicitudes web atendidas;
- avisos;
- registro de consentimientos (normalmente se conserva mientras pueda haber reclamaciones);
- cuentas inactivas;
- fichas de clientes sin actividad.

Cuando existan los plazos, se añadirán a `run_maintenance()`.

## 3. Derechos de las personas (procedimiento actual)

Todo se hace en Supabase → **SQL Editor**, con una persona autorizada. Las funciones no están expuestas en la API.

| Derecho | Cómo |
| --- | --- |
| **Acceso / portabilidad** (cliente de un taller) | `select private.export_customer_data('<id de la ficha>');` devuelve un JSON con ficha, vehículos, reparaciones, avisos, preferencias y consentimientos |
| **Rectificación** | El taller corrige la ficha en el panel. El cliente puede pedirlo; en el portal sus datos son de solo lectura |
| **Supresión** con historial que conservar | `select private.anonymize_customer('<id>');` borra o sustituye nombre, teléfono, correo, notas, acceso al portal, avisos del portal y mensajes. Conserva las reparaciones sin datos personales. Si la ficha no tiene órdenes, se puede borrar entera desde el panel |
| **Oposición a comunicaciones** | El cliente desde «Mis datos», o el taller en la ficha («Desactivar avisos por email» / «Retirar consentimiento de promociones») |
| **Solicitudes web** | Un gestor las borra desde **Panel → Solicitudes web → Borrar…** (dos pasos; permiso de borrado por RLS) |
| **Cuentas de usuario** | Supabase → Authentication → Users → borrar. Las fichas de cliente se quedan sin cuenta (`on delete set null`) y el historial se mantiene |

Antes de responder, compruebe la identidad de quien lo pide. Hay plazo de un mes según el RGPD: confirmar con el asesor.

## 4. Pendiente de validación legal

- **Responsables y encargados:** el taller es responsable de los datos de sus clientes y la plataforma es su encargada. Hace falta un contrato de encargado (art. 28) con cada taller.
- **Subencargados:** Supabase, Cloudflare y, si se activan, Resend y Openapi. Hay que revisar sus DPA, la región de los datos y las transferencias internacionales.
- **Textos:** las páginas `/privacidad`, `/aviso-legal`, `/cookies`, `/privacidad-cuenta` y `/condiciones` muestran hoy «Texto pendiente».
- **Bases jurídicas:**
  - avisos operativos: ejecución del servicio;
  - comerciales: consentimiento (LSSI art. 21);
  - consulta por matrícula: interés legítimo o ejecución, a validar.
- **Cookies:** hay aviso con «Aceptar» y «Rechazar» del mismo peso (`CookieBanner.astro`); las de preferencias solo se guardan si se aceptan y al rechazar se borran; la elección se cambia en `/cookies` y se vuelve a preguntar al año. Falta que el asesor valide los textos del aviso y de `/cookies`, que las técnicas están exentas y qué almacena Turnstile.
