# Puesta en marcha: conectar la plataforma a Supabase y Cloudflare

Lo que está hecho funciona y está probado **en local** con las piezas reales de Supabase (PostgreSQL, el servidor de Supabase Auth y la API REST). Para que funcione en internet faltan pasos que necesitan **tus cuentas**. Algunos no se pueden deshacer sin cuidado: léelos antes y, si algo no cuadra, pregunta.

> Nunca pegues claves secretas en el chat, en el código ni en capturas de pantalla.

## 1. Proyecto de Supabase

1. Crea una cuenta en supabase.com y un proyecto nuevo. Región: **París (eu-west-3) o Fráncfort (eu-central-1)**, para que los datos personales queden en la UE.
2. Guarda la contraseña de la base de datos en un gestor de contraseñas.
3. En **Project Settings → API Keys** apunta:
   - la **URL del proyecto**,
   - la **clave publicable** (`sb_publishable_…`),
   - la **clave secreta** (`sb_secret_…`). Es como la llave maestra: se salta todos los permisos. Solo va al servidor.

## 2. Crear las tablas y permisos (migraciones)

Desde la carpeta del proyecto, en tu ordenador:

```bash
npm run test:db              # antes de nada: todas las pruebas deben pasar
npx supabase login
npx supabase link --project-ref TU_REFERENCIA_DE_PROYECTO
npx supabase db push         # aplica supabase/migrations/* — NO carga los datos de demostración
```

Las migraciones se aplican en orden y **ninguna borra datos**:

| Archivo | Qué hace |
| --- | --- |
| `20261018120000_fundamentos_multiempresa.sql` | Talleres, perfiles, membresías, clientes, vehículos, web pública, RLS |
| `20261018160000_solicitudes_web.sql` | Solicitudes de la web (cita, presupuesto, contacto) |
| `20261019090000_cuentas_equipos_invitaciones.sql` | Logotipo y contacto del taller, invitaciones, gestión del equipo, alta controlada |
| `20261020090000_ordenes_reparacion.sql` | Órdenes de reparación, historial de cambios, búsquedas y resumen del panel |
| `20261021090000_portal_clientes.sql` | Portal del cliente: invitaciones de clientes, mensaje para el cliente, funciones `portal_*` |

`db push` modifica la base de datos de producción. Solo aplica las migraciones que falten.

## 3. Configurar el inicio de sesión (Supabase → Authentication)

Decide primero el **dominio del área privada**, por ejemplo `https://app.tudominio.es`. Es donde el personal inicia sesión (las webs de los talleres no guardan sesiones). Lo llamaremos `APP_URL`.

### 3.1 URL Configuration

- **Site URL**: `APP_URL` (p. ej. `https://app.tudominio.es`).
- **Redirect URLs**: añade `https://app.tudominio.es/**`. Para probar en tu ordenador, añade también `http://localhost:4321/**` y `http://demo.localhost:4321/**`.

### 3.2 Sign In / Providers → Email

- **Enable email signups**: activado. (Una cuenta sola no da acceso a ningún taller: hace falta una invitación.)
- **Confirm email**: activado.
- **Secure password change**: activado.
- **Minimum password length**: 10. **Password requirements**: minúsculas, mayúsculas y números. La web pide exactamente esto.
- **Anonymous sign-ins**: desactivado.
- Si tu plan lo incluye, activa **Leaked password protection** (comprueba que la contraseña no esté en filtraciones conocidas).

### 3.3 Plantillas de correo (Authentication → Emails → Templates)

Copia el HTML de estos archivos del repositorio (están en español y usan el enlace recomendado para webs que gestionan la sesión en el servidor):

| Plantilla | Archivo | Asunto sugerido |
| --- | --- | --- |
| Confirm signup | `supabase/templates/confirmation.html` | Confirma tu correo · Área de talleres |
| Reset password | `supabase/templates/recovery.html` | Cambiar la contraseña · Área de talleres |

Si no cambias las plantillas, también funciona (la web acepta los dos formatos de enlace), pero los correos llegarán en inglés y los enlaces solo funcionarán si se abren en el **mismo navegador** donde se pidieron.

### 3.4 Correo saliente (SMTP) — imprescindible para producción

El servidor de correo que trae Supabase **solo envía a las direcciones del equipo del proyecto** y con un límite muy bajo de correos por hora (documentación oficial: *Send emails with custom SMTP*). Para que tus clientes reciban los correos:

1. Crea una cuenta en un servicio de correo (por ejemplo Resend, Postmark, Amazon SES o Brevo) y verifica tu dominio (registros SPF/DKIM que te indicará el servicio).
2. En **Authentication → Emails → SMTP Settings** pon el servidor, el puerto, el usuario, la contraseña y un remitente como `no-responder@tudominio.es`.
3. Ajusta **Rate limits** para correos (por ejemplo, 30 por hora al principio).

### 3.5 Antirrobots en el acceso (recomendado)

En **Authentication → Attack Protection** puedes activar Cloudflare Turnstile para el registro y el inicio de sesión. **Todavía no está conectado en la web** (queda pendiente): no lo actives hasta hacerlo, o el registro dejará de funcionar.

## 4. Antispam de los formularios (Cloudflare Turnstile)

1. En el panel de Cloudflare: **Turnstile → Add widget**.
2. Añade los dominios de las webs de los talleres.
3. Apunta la **clave de sitio** (pública) y la **clave secreta**.

## 5. Probar en local con tu proyecto de Supabase

Copia `apps/web/.env.example` como `apps/web/.env` y rellena los valores (genera `REQUEST_HASH_SECRET` con `openssl rand -hex 32`). Deja `APP_URL` vacío en local. Después:

```bash
npm install
npm run dev     # http://localhost:4321 → web; http://localhost:4321/acceso → área privada
```

## 6. Crear el primer taller y su propietario

No hay ninguna pantalla pública para crear talleres ni para hacerse propietario: se hace desde el **SQL Editor** de Supabase (que trabaja como superusuario). La API no puede llamar a estas funciones.

1. La persona propietaria crea su cuenta en `APP_URL/registro` y **confirma su correo**.
2. En **SQL Editor**:

   ```sql
   select private.create_workshop('taller-garcia', 'Talleres García', 'propietaria@correo.es');
   -- Devuelve el id del taller. La web del taller nace SIN publicar.
   ```

3. La propietaria entra en `APP_URL/panel` (el panel del taller) y en `APP_URL/cuenta` podrá **invitar** a administradores y mecánicos. Cada invitación genera un enlace que se envía por WhatsApp o correo; solo funciona con el correo invitado, una vez y durante 7 días.
4. Para publicar la web del taller, rellena su contenido y su dominio:

   ```sql
   update public.workshop_sites
      set content = '{"tagline":"…","phone":"…","services":[{"id":"frenos","name":"Frenos","description":""}]}',
          is_demo_content = false,   -- solo si TODOS los datos son reales y el taller lo autoriza
          published = true
    where workshop_id = 'ID_DEL_TALLER';
   insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at)
   values ('www.dominio-del-taller.es', 'ID_DEL_TALLER', true, now());
   ```

Para cada taller nuevo se repiten los pasos 1 y 2. Para añadir otro propietario a un taller existente (o devolverle la propiedad a alguien): `select private.add_workshop_owner('ID_DEL_TALLER', 'correo@…');`.

### Administración de la plataforma (opcional, para ti)

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'tu-correo@…';
```

Los privilegios de administrador **solo funcionan con 2FA** (sesión `aal2`); sin 2FA no ve nada de los talleres. La pantalla para activar el 2FA llegará con el panel (Fase 4).

### Dar acceso al portal a un cliente

1. En el panel, abre la ficha del cliente → **Acceso al portal** → **Crear invitación al portal** (usa su correo o el que indiques).
2. Copia el enlace que aparece (solo se muestra una vez) y envíaselo por WhatsApp o correo. **La plataforma todavía no envía este correo sola.**
3. El cliente abre el enlace, crea su cuenta (o entra) **con ese mismo correo**, lo confirma y pulsa "Aceptar". Desde entonces ve `/portal`.
4. Para quitarle el acceso: ficha del cliente → **Retirar el acceso…**. La ficha y las reparaciones se conservan.

En cada orden decides qué ve el cliente: el **mensaje para el cliente** y la casilla **"Mostrar la diagnosis y el trabajo realizado"**. Las notas internas nunca se le muestran.

## 7. Publicar en Cloudflare

En Cloudflare → **Workers & Pages**, configura las variables. Las claves secretas, como **Secret**:

| Variable | Tipo |
| --- | --- |
| `SUPABASE_URL` | Texto |
| `SUPABASE_PUBLISHABLE_KEY` | Texto |
| `SUPABASE_SECRET_KEY` | **Secret** |
| `TURNSTILE_SITE_KEY` | Texto |
| `TURNSTILE_SECRET_KEY` | **Secret** |
| `REQUEST_HASH_SECRET` | **Secret** |
| `APP_URL` | Texto (p. ej. `https://app.tudominio.es`) |

Añade el dominio de `APP_URL` al Worker (Workers → Settings → Domains & Routes).

En producción, si falta Turnstile o Supabase, los formularios responden "no disponible" y el acceso dice "servicio no disponible": nunca se simula un envío ni un inicio de sesión.

Antes de abrir al público:

- [ ] Textos de **aviso legal**, **política de privacidad** de cada web y **privacidad de las cuentas** (`/privacidad-cuenta`) redactados con un asesor (ahora dicen "pendiente").
- [ ] SMTP propio configurado (paso 3.4).
- [ ] Decidir cuánto tiempo se conservan las solicitudes y las cuentas, y anotarlo en la política de privacidad.
- [ ] Revisar que no queda contenido de demostración.

## 8. Ver las solicitudes recibidas

El panel todavía no tiene bandeja de solicitudes web (llegará en una fase siguiente): de momento se ven en Supabase → **Table Editor → web_requests**. Las nuevas tienen `status = nueva` (pendientes de confirmar).

## 9. Pruebas

| Comando | Qué necesita |
| --- | --- |
| `npm run lint && npm run check && npm test && npm run build` | Nada más |
| `npm run test:db` | PostgreSQL local (descarga Supabase Auth en `.cache/` la primera vez) |
| `npm run test:e2e` | PostgreSQL local y Chromium (descarga PostgREST y Supabase Auth en `.cache/`) |
