# Cuentas de cliente multitaller

Una persona tiene **una sola cuenta de AutoValue** y puede ser cliente de varios talleres. Cada taller sigue siendo dueño de sus datos: solo ve sus fichas, y el cliente solo ve lo suyo en cada taller.

## Modelo de datos

| Concepto | Dónde vive | Notas |
|---|---|---|
| Identidad global | Supabase Auth (`auth.users`) + `profiles` | Una cuenta por correo. Registro abierto, pero **sin privilegios**: una cuenta sola no ve nada |
| Taller | `workshops` (+ `workshop_sites` para logotipo, colores y contacto público; `workshop_domains` para sus dominios) | Estado comercial (`demo`, `activo`, `suspendido`) solo lo cambia la plataforma |
| Personal del taller | `workshop_members` (rol por taller: propietario, administrador, recepcionista, mecánico; activo o no) | Altas solo con invitación o alta controlada de la plataforma |
| Cliente en un taller | `customers` (una **ficha por taller**) con `user_id` = cuenta vinculada | Una cuenta tiene como mucho una ficha por taller (`unique (workshop_id, user_id)`) |
| Relación cliente ↔ taller | Vigente: `customers.user_id`. Historial: `customer_account_links` (activa o revocada, origen, fechas, quién la retiró) | El estado que ve el panel sale de `customer_link_overview`: activa, invitación pendiente, invitación caducada, acceso retirado o sin acceso |
| Invitaciones | `customer_invitations` (clientes) y `workshop_invitations` (equipo) | Código de un solo uso; solo se guarda su **huella**; caduca a los 7 días; exige el **mismo correo, confirmado** |
| Registro de accesos | `access_events` | Altas, roles y bajas del equipo, invitaciones creadas, revocadas y aceptadas, vinculaciones y desvinculaciones, y sesiones de soporte. Sin tokens, contraseñas ni correos |
| Administración global | `platform_admins` + 2FA + `platform_support_sessions` | Ver «Administración de la plataforma» |

Vehículos, órdenes, presupuestos, facturas, cobros, avisos, mantenimientos, etc. llevan siempre `workshop_id` y la ficha del cliente de ese taller. Las claves foráneas compuestas impiden mezclar datos de dos talleres.

**Fichas duplicadas:** si dos talleres registraron a la misma persona, son dos fichas y así siguen (cada taller conserva su expediente). La misma cuenta se vincula a las dos, cada una con **su** invitación. Nunca se fusionan fichas automáticamente por coincidir el nombre, el correo o el teléfono. Dentro de un mismo taller, una cuenta no puede quedar unida a dos fichas: el taller debe revisar la duplicada.

## Seguridad (en la base de datos)

- **RLS** en todas las tablas. El cliente **no lee tablas**: solo funciones `portal_*`, que filtran por `private.portal_customer_ids()`, es decir, sus fichas vinculadas en talleres no suspendidos.
- **Taller elegido en el portal:**
  - el servidor comprueba que el taller es de los de la cuenta y lo envía en la cabecera `x-portal-taller`;
  - `private.portal_scope()` la lee y `portal_customer_ids()` **solo puede estrechar**: con un identificador ajeno o mal formado se ve lo mismo o nada, nunca más;
  - `?taller=` y la cookie `portal_taller` son solo preferencias.
- **Personal:** cada operación comprueba el rol en el servidor de base de datos (`office_workshop_ids()`, `manager_workshop_ids()`, disparadores). Un mecánico no invita, no desvincula y no cambia roles.
- **Cambiar un identificador en la URL** (orden, factura, vehículo, taller) no sirve de nada: la base de datos devuelve vacío o «no encontrado».
- **Retirar el acceso** (`unlink_customer_account`):
  - la cuenta deja de ver ese taller al instante;
  - la ficha, los vehículos, las reparaciones y las facturas se conservan;
  - el historial guarda la retirada.

## Flujos

### Invitar a un cliente (panel)

1. Panel → Clientes → ficha → **Invitar al área de cliente**. Pueden hacerlo el propietario, el administrador y recepción; el mecánico no.
2. La base de datos crea el código (`create_customer_invitation`) para esa ficha y ese taller. El navegador no decide ninguno de los dos.
3. Si la plataforma tiene correo (Resend), se envía y el panel dice «aceptada por el proveedor». Si no, dice **«pendiente de envío»** y muestra el enlace para compartirlo. Nunca se simula un envío.
4. Se puede **anular** mientras esté pendiente, y crear otra anula la anterior.

### Aceptar (cliente)

1. Abre el enlace. Si no ha iniciado sesión, va a «Acceso» y después vuelve. Si no tiene cuenta, la crea y confirma su correo.
2. **Si ya tiene cuenta por otro taller, entra con ella**: no se crea otra.
3. `accept_customer_invitation` comprueba:
   - que el código existe, está pendiente y no ha caducado;
   - que el correo coincide y está confirmado;
   - que el taller no está suspendido;
   - que la ficha no tiene ya otra cuenta;
   - que la cuenta no tiene otra ficha en ese taller.
4. Entra en el portal **con ese taller elegido**, y el taller aparece en «Mis talleres».

### Entrar desde la web de un taller

1. Botón «Área de clientes» → `/area-cliente` en el dominio del taller. El servidor sabe qué taller es **por el dominio**.
2. Va al área privada (`APP_URL/portal/entrar/<identificador>`), que pide iniciar sesión.
3. `workshop_entry` dice si la cuenta está vinculada a ese taller:
   - **sí:** entra en el portal con ese taller;
   - **es personal del taller:** va al panel;
   - **no:** se explica, se avisa si tiene una invitación pendiente y se ofrece pegar el enlace o el código, o contactar con el taller.

   Nunca se crea un vínculo por visitar la web o conocer el nombre del taller.

### «Mis talleres» y cambio de taller

- `/portal/talleres` muestra:
  - cada taller vinculado: nombre, logotipo, localidad y contacto públicos;
  - un resumen real de lo del cliente en ese taller;
  - el taller seleccionado;
  - un campo para pegar una invitación.
- El selector de la cabecera (si hay más de un taller) cambia de taller. Cada pantalla muestra **solo** el taller elegido, sin mezclar datos.

## Administración de la plataforma (mínimo privilegio)

- Hace falta estar en `platform_admins` **y** haber entrado con 2FA (`aal2`).
- **Sin sesión de soporte** no ve datos de talleres ni de personas. Solo ve `admin_workshops_overview()`: talleres, estado y recuentos, sin datos personales.
- **Con una sesión de soporte** (`admin_open_support_session(motivo, taller, minutos)`):
  - el motivo tiene entre 10 y 500 caracteres y la sesión dura de 5 a 120 minutos;
  - queda registrada con su motivo;
  - permite diagnosticar vinculaciones (`admin_link_diagnosis(correo)`: queda registrada con el correo enmascarado) y ver el registro de accesos (`admin_access_events`).

  La sesión se cierra con `admin_close_support_session()` o caduca sola.
- **Pantalla web `/admin`** (solo la ve quien está en `platform_admins`; al resto le responde «no encontrada»): resumen de talleres, abrir y cerrar la sesión de soporte (motivo, taller y duración), diagnóstico de vinculación por correo y registro de accesos. Sin 2FA solo explica cómo activarla. `admin_status()` le dice a la pantalla si la persona es de la plataforma, si ha entrado con 2FA y si tiene sesión de soporte.
- **Verificación en dos pasos (cualquier cuenta):** `/cuenta/seguridad` la activa (código QR o clave para la app y un código de 6 cifras para confirmar; Supabase Auth MFA TOTP) y la desactiva (en dos pasos). Con ella activada, tras la contraseña se pide el código en `/acceso/verificar`; mientras falte, el área privada trata la sesión como si no hubiera entrado (`authPage`). Para el personal y los clientes es una comprobación de la web; para la administración de la plataforma, además, la exige la base de datos (`aal2`).
- Durante una sesión de soporte el acceso de lectura es **global**, no solo del taller indicado (el taller queda anotado para la auditoría). Ver «Riesgos».
- Si alguien pierde el móvil con la app: la plataforma le retira el factor desde el panel de Supabase (Authentication → Users) tras comprobar su identidad.

## Pruebas

- Base de datos: `supabase/tests/20_multitaller.test.sql` cubre:
  - cuenta única con dos talleres y cambio de taller;
  - sin vínculo no se ve nada y no se ven facturas ajenas;
  - aislamiento entre talleres y roles;
  - invitaciones válidas, caducadas, revocadas y usadas;
  - fichas parecidas sin fusionar;
  - manipulación de identificadores;
  - revocación con historial;
  - datos antiguos accesibles;
  - registro de accesos y sesiones de soporte.

  Las pruebas `02` y `08` comprueban además que el administrador no ve nada sin sesión de soporte.
- Navegador: `apps/web/e2e/multitaller.spec.ts` (escritorio y móvil) y `calidad.spec.ts` (`/portal/talleres`).

## Riesgos y pendientes

- Una sesión de soporte da lectura **global** mientras dura. Para limitarla a un taller habría que cambiar todas las políticas que usan `is_platform_admin()`.
- No hay estado propio de «cuenta global» (bloqueada o activa) aparte del de Supabase Auth (`banned_until`, borrado de la cuenta).
- El cliente **puede dejar de ver un taller** desde «Mis talleres» (`portal_leave_workshop`, en dos pasos). No se borra nada: el taller conserva la ficha y su historial, el historial dice que lo retiró el propio cliente y para volver hace falta una invitación nueva.
- Directorio público de talleres: no se ha hecho. Se podría construir sobre `workshop_sites` publicados, sin inventar perfiles ni valoraciones.
