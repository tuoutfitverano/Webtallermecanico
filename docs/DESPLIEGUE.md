# Despliegue: desarrollo, pruebas y producción

**No despliegues ni apliques migraciones en producción sin decidirlo expresamente.** Cada paso marcado con ⚠ cambia algo real.

## 1. Entornos

| Entorno | Para qué | Base de datos | Proveedores |
| --- | --- | --- | --- |
| **Desarrollo** (tu ordenador) | Programar | Ninguna (demo local) o un proyecto Supabase **de desarrollo** en `apps/web/.env` | Sin configurar, o en modo pruebas (Openapi `test.`, Resend con dominio de pruebas) |
| **Pruebas automáticas** (local o GitHub Actions) | `npm run test:db` y `npm run test:e2e` | PostgreSQL local temporal con las piezas reales de Supabase (Auth, PostgREST). Se crea y se borra en cada ejecución | **Simulados** (`scripts/e2e/*-mock.mjs`). Nunca reales |
| **Preproducción** (recomendado antes del piloto) | Probar el despliegue real | Un **segundo** proyecto Supabase | Credenciales de prueba |
| **Producción** | Talleres reales | Proyecto Supabase de producción (región UE) | Credenciales reales |

Nunca uses la base de datos de producción para pruebas, ni copies datos reales a desarrollo.

## 2. Requisitos

- Node 22 (ver `.nvmrc`).
- Cuenta de Cloudflare (Workers) y de Supabase.
- Dominio para el área privada (`APP_URL`, p. ej. `https://app.tudominio.es`) y dominio de cada taller.

## 3. Antes de cada despliegue (obligatorio)

```bash
npm ci
npm run lint && npm run check && npm test && npm run build   # build incluye la comprobación de secretos
npm run test:db                                                # migraciones + permisos
npm run test:e2e                                               # flujo completo con servicios simulados
```

Si algo falla, no se despliega. El CI de GitHub ejecuta lo mismo en cada `push`.

## 4. Supabase (producción o preproducción)

1. Crea el proyecto en una **región de la UE**.
2. **Authentication**, según `docs/PUESTA_EN_MARCHA.md` §3:
   - Site URL = `APP_URL`;
   - Redirect URLs = `APP_URL/**`;
   - plantillas de correo del repositorio;
   - **SMTP propio**;
   - contraseñas de 10 caracteres o más con mayúsculas, minúsculas y números;
   - revisar los límites de envío de correos y de intentos (Auth → Rate Limits);
   - si el plan lo permite, activar la protección contra contraseñas filtradas.
3. ⚠ **Migraciones:** `npx supabase link --project-ref <ref>`, después `npx supabase db push`.
   - Aplica `supabase/migrations/*` en orden, y solo las que falten. Ninguna borra datos.
   - **No** cargues `seed.sql`: es la demo.
4. ⚠ Alta del primer taller: SQL de `docs/PUESTA_EN_MARCHA.md` §6.
5. **Copias de seguridad:** dependen del plan contratado. Compruébalo en **Database → Backups** antes del piloto.
   - Recomendado: plan con copias diarias (y PITR si se puede), más una copia propia periódica con `npx supabase db dump`, guardada cifrada fuera de Supabase.
   - **Prueba a restaurar una copia en preproducción al menos una vez.**
6. **Mantenimiento y avisos programados:** Supabase Cron, ver `docs/NOTIFICACIONES.md` §6.3. Llama cada minuto a `/api/notificaciones/procesar`, que envía los emails pendientes y hace el mantenimiento: borrar huellas antispam caducadas y cerrar consultas a medias.

## 5. Cloudflare Workers

1. Crea el Worker. El nombre por defecto está en `apps/web/dist/server/wrangler.json` (`talleres-web`).
2. **Variables:** Workers → Settings → Variables and Secrets. Las marcadas como secreto, siempre como **Secret**.

| Variable | Obligatoria | Secreto |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Sí | No |
| `SUPABASE_SECRET_KEY` | Sí | **Sí** |
| `TURNSTILE_SITE_KEY` | Sí (formularios) | No |
| `TURNSTILE_SECRET_KEY` | Sí (formularios) | **Sí** |
| `REQUEST_HASH_SECRET` | Sí | **Sí** |
| `APP_URL` | Sí | No |
| `NOTIFICATIONS_CRON_SECRET` | Para avisos y mantenimiento | **Sí** |
| `EMAIL_PROVIDER`, `EMAIL_FROM` | Para email | No |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Para email | **Sí** |
| `VEHICLE_LOOKUP_PROVIDER` | Para matrículas | No |
| `OPENAPI_AUTOMOTIVE_TOKEN` | Para matrículas | **Sí** |

3. ⚠ **Desplegar:** `npm run build`, después `cd apps/web && npx wrangler login && npx wrangler deploy`.
   - El adaptador de Astro deja la configuración en `dist/server/wrangler.json`, y `wrangler` la encuentra sola.
   - **Pendiente de verificar en el primer despliegue:** esa configuración declara un espacio KV `SESSION` (sesiones de Astro, que esta aplicación no usa). Comprueba si `wrangler` lo crea solo o si hay que crearlo o desactivarlo.
4. **Dominios** (Workers → Settings → Domains & Routes): `APP_URL` y el de cada taller. Cloudflare gestiona el HTTPS. La aplicación añade HSTS en HTTPS.
5. **Registros:** la configuración generada activa `observability` (Workers Logs). Los registros solo llevan códigos de evento. No hay servicio de alertas de errores: pendiente de decidir (p. ej. alertas de Cloudflare o un servicio externo).
6. **Si algo sale mal:**
   - **Volver atrás:** Workers → Deployments → **Rollback** a la versión anterior, o `npx wrangler rollback`.
   - **Migraciones:** no se deshacen. Si una da problemas, se corrige con una **migración nueva**. Por eso conviene probar cada migración antes en preproducción y tener una copia de seguridad reciente.

## 6. Proveedores opcionales

- **Email (Resend):** `docs/NOTIFICACIONES.md` §6. Dominio verificado, webhook y cron.
- **Matrículas (Openapi):** `docs/CONSULTA_MATRICULAS.md` §7.

Sin ellos, la aplicación funciona igual: avisos solo en el portal y alta manual de vehículos.

## 7. Después de desplegar (comprobación manual)

1. La web del taller carga, y una solicitud de prueba llega a **Panel → Solicitudes web**.
2. Registro, confirmación por correo, inicio de sesión y recuperación de contraseña, con un correo de prueba real.
3. Invitar a un empleado de prueba y comprobar que solo ve lo que le corresponde.
4. Crear cliente, vehículo y orden. Invitar al cliente al portal y cambiar el estado: el aviso aparece en su portal (y por email si está activado).
5. Con otra cuenta de otro taller, comprobar que no se ve nada del primero.
6. Revisar las cabeceras con las herramientas del navegador: `content-security-policy`, `strict-transport-security`, `x-content-type-options`.
