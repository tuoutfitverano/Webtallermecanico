# Publicar la versión real (sin coste)

La versión real es la misma aplicación de las pruebas, publicada en internet:
- **Cloudflare Workers** (plan gratuito) sirve la web, el panel y el portal;
- **Supabase** (plan gratuito) guarda los datos y las cuentas.

Lo que escribas en el panel o en el portal se guarda de verdad.

La publicación la hace GitHub con el flujo «Publicar versión real» (`.github/workflows/publicar.yml`). Las claves se guardan como secretos de GitHub: nunca se escriben en el código, en el chat ni en el registro.

## Qué incluye y qué no

| Funciona | Queda pendiente (no inventado) |
|---|---|
| Web pública de AutoValue en `https://autovalue-web.<tu-subdominio>.workers.dev` | Dominio propio (se añade después) |
| Registro, acceso, panel del taller y portal del cliente, con datos guardados | Correos a clientes: hace falta un proveedor de email (Resend) y SMTP propio. Sin ellos, los avisos se ven en el portal y los correos quedan «pendientes» |
| Formularios de la web con antispam (Turnstile) | WhatsApp y consulta por matrícula (servicios de pago, apagados) |
| Mantenimiento automático cada 5 minutos | Copias externas: ver `docs/COPIAS_SEGURIDAD.md` |

**Planes gratuitos, a tener en cuenta:**
- **Supabase gratis:**
  - pausa el proyecto tras 7 días sin actividad; se reactiva desde su panel;
  - no guarda copias de seguridad;
  - su correo de serie solo envía a los miembros de tu equipo de Supabase y con un límite bajo por hora.

  Tu cuenta de propietario no lo necesita: el paso 2 confirma tu correo.
- **Cloudflare Workers gratis:** 100.000 visitas al día.

## 1. Crear las cuentas (una vez)

1. **Supabase** (supabase.com → *Start your project*):
   - crea un proyecto nuevo, región **EU (Frankfurt o París)**;
   - **apunta la contraseña de la base de datos**.
2. **Cloudflare** (dash.cloudflare.com → registrarse):
   - entra una vez en **Workers & Pages** para que se cree tu subdominio `*.workers.dev`.

## 2. Sacar los 5 datos y guardarlos en GitHub

En GitHub: repositorio → **Settings → Secrets and variables → Actions → New repository secret**. Crea estos cinco:

| Secreto | Dónde se saca |
|---|---|
| `SUPABASE_PROJECT_REF` | El código del proyecto: lo que va en `https://supabase.com/dashboard/project/<ESTO>` |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → tu avatar → **Access Tokens** → *Generate new token* |
| `SUPABASE_DB_URL` | En el proyecto → botón **Connect** → **Session pooler** → copia la cadena `postgresql://…` y cambia `[YOUR-PASSWORD]` por la contraseña de la base de datos |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → **Workers & Pages**: aparece como *Account ID* a la derecha |
| `CLOUDFLARE_API_TOKEN` | Ver abajo |

Para crear `CLOUDFLARE_API_TOKEN`:
1. dash.cloudflare.com → tu perfil → **API Tokens** → *Create Token* → plantilla **Edit Cloudflare Workers**.
2. Añade el permiso **Account → Turnstile → Edit**.
3. En *Account Resources* elige tu cuenta y créalo.

## 3. Publicar

1. **Paso 1:**
   - GitHub → **Actions** → **Publicar versión real** → *Run workflow*;
   - en `paso`, elige `1-publicar` y escribe `PUBLICAR` en `confirmar`.

   Aplica la base de datos, configura el acceso y el antispam y publica la web. Al terminar, el resumen muestra la dirección.
2. **Regístrate** en `https://…workers.dev/registro` con **el mismo correo con el que creaste la cuenta de Supabase**. Sin SMTP propio, Supabase solo acepta correos de su equipo. No hace falta que llegue el correo de confirmación.
3. **Paso 2:**
   - lánzalo igual, eligiendo `2-crear-taller`;
   - pon tu correo en `correo_propietario` y escribe `PUBLICAR`.

   Confirma tu cuenta, crea el taller AutoValue con su web y te hace propietario.
4. Entra en `https://…workers.dev/acceso`: verás el panel del taller. Desde **Equipo** invitas a tus empleados y desde cada ficha de cliente, a tus clientes al portal.

Para publicar cambios nuevos del código, se repite solo el paso 1. Los datos no se tocan; solo se aplican las migraciones nuevas.

## Riesgos

- El paso 1 cambia la base de datos **real**. Las migraciones solo añaden y nunca borran datos, pero una vez aplicadas no se deshacen solas.
- La web de AutoValue lleva el aviso de taller de demostración, porque sus textos son de ejemplo. Lo que tú guardes en el panel es real.

## Comprobar los scripts sin publicar

`bash scripts/publicar/test-local.sh` prueba el paso 2 contra una base local con el esquema real.
