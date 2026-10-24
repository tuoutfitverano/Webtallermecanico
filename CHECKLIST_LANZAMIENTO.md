# Checklist de lanzamiento (actualizada el 24-10-2026)

Sustituye a `docs/CHECKLIST_LANZAMIENTO.md` (19-10-2026), que se conserva como histórico.

**Estados:**

- ✅ **Verificado**: con pruebas ejecutadas en local en este repositorio.
- 🟡 **Pendiente**: hace falta configuración, una cuenta o una decisión.
- ⚖️ **Revisión profesional** (abogado o asesor fiscal).
- ⛔ **Bloqueo**.

Cada punto 🟡 o ⛔ indica **quién** lo hace. Las acciones en producción (despliegue, migraciones, claves) necesitan la **autorización expresa** del propietario.

## 1. Preparación de producción

| Paso | Estado | Quién / cómo |
|---|---|---|
| Proyecto Supabase de producción (región UE) | 🟡 | Propietario. `docs/PUESTA_EN_MARCHA.md` |
| Migraciones aplicadas **en orden**, incluidas `20261104090000_nif_control` y `20261104090100_zona_horaria_funciones` | 🟡 | Flujo «Publicar versión real» (`docs/PUBLICAR.md`), con autorización |
| Tras migrar: `select count(*) from pg_proc …` igual que `25_zona_horaria` (ninguna función con fechas sin la hora de Madrid) | 🟡 | Comprobación de 1 minuto en el SQL Editor |
| Worker de Cloudflare desplegado desde `main` con CI en verde | 🟡 | `docs/DESPLIEGUE.md` |
| Sin datos de demostración en producción (`supabase/seed.sql` **no** se carga) | 🟡 | `docs/DESPLIEGUE.md` |
| Node 22.22.3 (`.nvmrc`) en CI y en la máquina que despliega | ✅ | CI usa `.nvmrc` |

## 2. Variables de entorno (Cloudflare → Workers → Variables and Secrets)

| Variable | Obligatoria | Secreta | Nota |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Sí | No | |
| `SUPABASE_SECRET_KEY` | Sí | **Sí** | Nunca en el navegador (lo comprueba el build) |
| `APP_URL` | Sí | No | Sin ella, los enlaces de los correos dependen del dominio de la petición |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Sí | **Sí** (la secreta) | Una clave de **prueba** de Cloudflare en producción hace que los formularios respondan 503 (protección nueva) |
| `REQUEST_HASH_SECRET` | Sí | **Sí** | `openssl rand -hex 32` |
| `NOTIFICATIONS_CRON_SECRET` | Para avisos y mantenimiento | **Sí** | ≥ 24 caracteres |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Opcional | **Sí** (claves) | Sin ellas, los avisos quedan «pendientes» |
| `WHATSAPP_*` | Opcional | **Sí** (token y secreto) | Plantilla `reparacion_estado_v1` aprobada en Meta |
| `VEHICLE_LOOKUP_PROVIDER`, `OPENAPI_AUTOMOTIVE_TOKEN` | Opcional | **Sí** (token) | Sin ellas, el alta de vehículos es manual |

## 3. Dominio y HTTPS

| Paso | Estado |
|---|---|
| Dominio del área privada (`APP_URL`) y de cada taller en Workers → Domains & Routes | 🟡 Propietario |
| HTTPS (lo gestiona Cloudflare) y HSTS (lo añade la aplicación) | ✅ en código (`calidad.spec` comprueba las cabeceras) |
| Supabase Auth: Site URL = `APP_URL`, Redirect URLs = `APP_URL/**` | 🟡 |

## 4. Autenticación

| Punto | Estado | Evidencia |
|---|---|---|
| Registro, confirmación, acceso, recuperación, sesión caducada | ✅ | `auth.spec`, `portal.spec` |
| 2FA (TOTP) para cuentas de gestión y obligatoria en `/admin` | ✅ | `admin.spec`, `21_admin_y_salida` |
| Contraseñas: mínimo 10 con mayúsculas, minúsculas y números (también en Supabase de producción) | 🟡 | Ajustar en el panel de Supabase: `supabase/config.toml` no se aplica solo |
| SMTP propio en Supabase Auth (el de serie tiene límites) | 🟡 | `docs/PUESTA_EN_MARCHA.md` §3 |
| Límites de intentos (rate limits) de Supabase Auth revisados | 🟡 | Panel de Supabase |

## 5. Copias de seguridad

| Punto | Estado | Evidencia |
|---|---|---|
| Copia cifrada (age) + restauración **en local** | ✅ | `scripts/backup/test-restore.sh`: 41 tablas y 99 filas idénticas, cadena de facturas íntegra |
| Copias diarias en producción (plan de Supabase o `copias.yml` con su clave) | 🟡 | Propietario |
| **Una restauración de prueba en el entorno real**, antes de abrir | ⛔ | Sin esto no se abre |
| Copia por taller descargable (`/panel/copia`) | ✅ | `19_copia_taller` |

## 6. Monitorización

| Punto | Estado |
|---|---|
| Registros de Cloudflare (Workers Logs). Solo códigos de evento, sin datos personales | ✅ en código · 🟡 activar en Cloudflare |
| Alertas (errores 5xx, cron que no corre, avisos fallidos) | 🟡 No hay servicio de alertas. En un piloto: revisión diaria de los registros y de Panel → Avisos |
| Comprobar a diario que el cron (`/api/notificaciones/procesar`) corre | 🟡 |

## 7. Alta de talleres

| Paso | Estado |
|---|---|
| `private.create_workshop(...)` desde el SQL Editor (`docs/PUESTA_EN_MARCHA.md`) | ✅ probado en `test:db` |
| Archivo del taller en `talleres/<taller>.json` → `npm run taller:sql` | ✅ |
| La propietaria rellena Panel → Taller (NIF con control) y **acepta** condiciones y encargo | ✅ en código · 🟡 por cada taller |
| Decidir qué se ofrece de facturación (ver `PENDIENTE_ANTES_DE_VENDER.md` §2) | ⛔ |

## 8. Protección de datos

| Punto | Estado |
|---|---|
| Aislamiento entre talleres: tablas, API, roles, cuentas desactivadas y clientes que se van | ✅ `26_aislamiento_completo`, `01`, `08`, `09`, `20`, `21` |
| RLS en todas las tablas; nada para visitantes salvo la web pública | ✅ `12_auditoria` |
| Sin secretos en el navegador ni en Git | ✅ build (`check-client-bundle`) |
| Dependencias sin avisos de seguridad | ✅ `npm audit`: 0 (24-10-2026) |
| Datos del titular de la plataforma (`lib/legal/platform.ts`) | ⛔ Propietario |
| Revisión legal de los textos y del contrato de encargo | ⚖️ ⛔ |
| DPA con Supabase y Cloudflare (y con cada proveedor que se active) | 🟡 Propietario |
| Registro de actividades de tratamiento (RGPD art. 30) | 🟡 base en `docs/DATOS_PERSONALES.md` |

## 9. Documentación y soporte

| Punto | Estado |
|---|---|
| Guía del propietario (`docs/GUIA_PROPIETARIO.md`) | ✅ |
| Canal de soporte y plazo de respuesta en las condiciones | 🟡 Propietario |
| Sesión de soporte con motivo y registro (`/admin`) | ✅ `admin.spec` |

## 10. Procedimiento de recuperación

1. **Despliegue roto:** Cloudflare → Workers → Deployments → «Rollback» a la versión anterior. Las migraciones **no** se deshacen solas: cada migración nueva debe poder convivir con el código anterior (las de esta auditoría sí pueden).
2. **Migración con error:** no se edita una migración aplicada. Se corrige con otra nueva, probada antes con `npm run test:db`.
3. **Pérdida o corrupción de datos:** restaurar la última copia en una base **nueva** (`scripts/backup/restore.sh`: se niega a pisar datos), comprobar y cambiar la conexión.
4. **Clave filtrada:** rotarla en el proveedor (Supabase, Resend, Meta, Turnstile) y actualizar el secreto en Cloudflare. Nunca pegar la clave en un chat ni en el código.
5. **Proveedor caído:** los avisos quedan «pendientes» y se reintentan solos (5 veces con espera). Nada se da por enviado.

## Conclusión

**NO-GO** para vender con datos reales el 26-10-2026 (ver `AUDITORIA_FINAL.md`). **GO CON LIMITACIONES** solo para demostración y preventa, sin datos reales y sin emitir facturas.
