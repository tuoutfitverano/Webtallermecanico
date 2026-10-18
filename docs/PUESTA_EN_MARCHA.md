# Puesta en marcha: conectar la web a una base de datos real

Lo que está hecho funciona y está probado con una base de datos real **en local**. Para que funcione en internet faltan pasos que necesitan **tus cuentas**. Ningún paso de esta guía se puede deshacer sin cuidado: léelos antes y, si algo no cuadra, pregunta.

> Nunca pegues claves secretas en el chat, en el código ni en capturas de pantalla.

## 1. Proyecto de Supabase

1. Crea una cuenta en supabase.com y un proyecto nuevo. Región: **París (eu-west-3) o Fráncfort (eu-central-1)**, para que los datos personales queden en la UE.
2. Guarda la contraseña de la base de datos en un gestor de contraseñas.
3. En **Project Settings → API Keys** apunta:
   - la **URL del proyecto**,
   - la **clave publicable** (`sb_publishable_…`),
   - la **clave secreta** (`sb_secret_…`). Esta última es como la llave maestra: se salta todos los permisos.

## 2. Crear las tablas y permisos (migraciones)

Desde la carpeta del proyecto, en tu ordenador:

```bash
npx supabase login
npx supabase link --project-ref TU_REFERENCIA_DE_PROYECTO
npx supabase db push        # aplica supabase/migrations/* — NO carga los datos de demostración
```

`db push` modifica la base de datos de producción: hazlo solo cuando las pruebas (`npm run test:db`) pasen.

## 3. Antispam (Cloudflare Turnstile)

1. En el panel de Cloudflare: **Turnstile → Add widget**.
2. Añade los dominios de las webs de los talleres.
3. Apunta la **clave de sitio** (pública) y la **clave secreta**.

## 4. Probar en local con Supabase

Copia `apps/web/.env.example` como `apps/web/.env` y rellena los valores (genera `REQUEST_HASH_SECRET` con `openssl rand -hex 32`). Después:

```bash
npm run dev
```

Para ver un taller en local hace falta que exista en la base de datos con el dominio `demo.localhost` (ver paso 5).

## 5. Dar de alta un taller y publicar su web

Mientras no exista el panel de administración (fase de administración de la plataforma), se hace con SQL en el **SQL Editor** de Supabase. Ejemplo para un taller de prueba:

```sql
insert into public.workshops (slug, name, status) values ('taller-ejemplo', 'Taller Ejemplo', 'demo') returning id;
-- Con el id devuelto:
insert into public.workshop_sites (workshop_id, published, is_demo_content, theme, content)
values ('ID', true, true, '{"accent":"#e4572e"}', '{"tagline":"…","phone":"…","services":[{"id":"frenos","name":"Frenos","description":""}]}');
insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at)
values ('www.dominio-del-taller.es', 'ID', true, now());
```

Pon `is_demo_content = false` **solo** cuando todos los datos sean reales y el taller haya autorizado su publicación.

## 6. Publicar en Cloudflare

En Cloudflare → **Workers & Pages**, configura las variables. Las claves secretas, como **Secret**:

| Variable | Tipo |
| --- | --- |
| `SUPABASE_URL` | Texto |
| `SUPABASE_PUBLISHABLE_KEY` | Texto |
| `SUPABASE_SECRET_KEY` | **Secret** |
| `TURNSTILE_SITE_KEY` | Texto |
| `TURNSTILE_SECRET_KEY` | **Secret** |
| `REQUEST_HASH_SECRET` | **Secret** |

En producción, si falta Turnstile o Supabase, los formularios responden "no disponible" en lugar de aceptar envíos.

Antes de publicar una web real:

- [ ] Textos de **aviso legal** y **política de privacidad** redactados por el titular con su asesor (las páginas actuales lo indican como pendiente).
- [ ] Decidir cuánto tiempo se conservan las solicitudes y anotarlo en la política de privacidad.
- [ ] Revisar que no queda contenido de demostración.

## 7. Ver las solicitudes recibidas

Hasta que exista el panel del taller, las solicitudes se ven en Supabase → **Table Editor → web_requests**. Las nuevas tienen `status = nueva` (pendientes de confirmar).
