# Copias de seguridad y restauración

Qué se copia, dónde, cada cuánto y **cómo se recupera**. Nada de esto funciona en producción hasta completar «Puesta en marcha». La copia y la restauración se prueban solas en local y en CI con `npm run test:backup`.

## Copia de cada taller (la descarga el propio taller)

Además de la copia de la plataforma, cada taller puede bajarse **sus** datos cuando quiera desde **Panel → Taller → Copia de seguridad** (`/panel/copia`):

- **Copia completa** (JSON): clientes, vehículos, órdenes e historial, presupuestos, facturas y cobros, mantenimientos, avisos, recordatorios, solicitudes de la web, ajustes y equipo.
- **Tablas para Excel** (CSV con «;» y tildes correctas): clientes, vehículos, órdenes, trabajos, presupuestos, facturas, cobros y mantenimientos.
- Solo el **propietario** y los **administradores**, y solo de su taller: lo decide la base de datos (`export_workshop_data`). Sin huellas de enlaces, invitaciones ni antispam.
- Cada descarga queda anotada (quién y cuándo) y se ve en la misma página.
- La copia lleva datos personales: el taller debe guardarla en un sitio seguro. Recomendado: una vez al mes y antes de cambios grandes.
- Pruebas: `supabase/tests/19_copia_taller.test.sql` (incluida la comprobación de que ninguna tabla del taller se queda fuera) y `apps/web/e2e/gestion.spec.ts`.

Esta copia **no sustituye** a la de la plataforma: es la del taller, para que la tenga él (y para la portabilidad de sus datos). No restaura nada por sí sola.

## Qué protege cada cosa

| Qué | Lo que da el proveedor | Lo que hacemos nosotros |
|---|---|---|
| **Base de datos** (talleres, clientes, vehículos, órdenes, historial, presupuestos, facturas, cobros, cuentas) | Supabase Pro: copia diaria guardada 7 días, **dentro de Supabase**. La restauración a un minuto concreto (PITR) es un extra de pago | Copia diaria **cifrada** fuera de Supabase (`.github/workflows/copias.yml`): datos de `public`, `private` y las cuentas (`auth.users`, `auth.identities`), más el esquema del momento y un inventario para comprobar la restauración |
| **Esquema** (tablas, permisos, funciones) | — | Está en Git (`supabase/migrations/`): se reconstruye aplicando las migraciones |
| **Código** | GitHub guarda el historial, pero en un solo proveedor | El día 1 de cada mes, una copia cifrada del repositorio completo (`git bundle`) junto a la copia de datos |
| **Archivos subidos** | — | Hoy no hay: la aplicación no sube fotos ni documentos. Cuando los haya, habrá que añadirlos aquí |
| **Configuración** | — | Nombres de variables en `apps/web/.env.example`; `apps/web/wrangler.jsonc` en Git; los **valores** de los secretos, en un gestor de contraseñas del propietario (nunca en Git) |

El historial de Git, la sincronización entre dispositivos o la «alta durabilidad» del proveedor **no** son copias de seguridad: no protegen frente a un borrado, un error o un acceso indebido.

## Cifrado

- Se usa [age](https://age-encryption.org). La **clave pública** está en GitHub y solo sirve para cifrar.
- La **clave privada** es la única que descifra: guárdala en el gestor de contraseñas **y** en una copia fuera de línea (USB o papel en sitio seguro). Sin ella, las copias no sirven. Nunca la subas a GitHub, Supabase ni Cloudflare.
- `dump.sh` se niega a escribir una copia sin cifrar.

## Puesta en marcha (cuando haya producción)

1. **Clave**: en tu ordenador, `age-keygen -o clave-copias.txt`. Guarda el archivo como se explica arriba; la línea `# public key: age1…` es la clave pública.
2. **Almacenamiento externo** (recomendado), compatible con S3 y en la UE (p. ej. Cloudflare R2):
   - un bucket privado;
   - una credencial que **solo pueda escribir** en él;
   - reglas de borrado automático: `diaria/` a los 35 días; `mensual/` el tiempo que indique tu asesoría (las facturas se conservan años).
3. **GitHub** → Settings → Secrets and variables → Actions:
   - secreto `BACKUP_DATABASE_URL`: cadena de conexión del **Session pooler** de Supabase (Project Settings → Database). Los ejecutores de GitHub no tienen IPv6 y la conexión directa no funciona;
   - variable `BACKUP_AGE_RECIPIENT`: la clave pública;
   - si hay almacenamiento externo: variables `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` y secretos `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`;
   - opcional: variable `BACKUP_PG_MAJOR` si Supabase no usa PostgreSQL 17.
4. Lanza la copia a mano (Actions → «Copia de seguridad» → Run workflow) y comprueba que aparece en el almacenamiento.
5. Sin almacenamiento externo, la copia cifrada queda 30 días como artefacto de GitHub: es mejor que nada, pero depende de GitHub.

## Restaurar (siempre en una base NUEVA)

`restore.sh` nunca escribe sobre datos existentes: se niega si la base ya tiene talleres o si su nombre no coincide con `--confirmar`.

1. Crea un proyecto nuevo de Supabase (región UE) y aplica el esquema: `npx supabase link --project-ref <ref>` y `npx supabase db push`. **No** cargues `seed.sql`.
2. Descarga la carpeta de la copia (`<fecha>/`) del almacenamiento y ten a mano la clave privada.
3. Restaura con la cadena del pooler del proyecto nuevo:
   ```bash
   TARGET_DATABASE_URL='postgresql://…' BACKUP_AGE_IDENTITY=clave-copias.txt \
     bash scripts/backup/restore.sh <carpeta de la copia> --confirmar postgres
   ```
   Carga cuentas y datos en una sola transacción y compara filas y huellas de cada tabla con `manifest.json`. Si algo no cuadra, lo dice y termina con error.
4. Configura el proyecto nuevo igual que el anterior: Auth (SMTP, plantillas, URLs, límites) y los secretos del Worker apuntando a él (ver `docs/DESPLIEGUE.md`). Prueba a iniciar sesión.
5. Código, si hiciera falta: `age -d -i clave-copias.txt codigo.bundle.age > codigo.bundle` y `git clone codigo.bundle autovalue`.

## Prueba periódica (obligatoria)

- **Cada mes**: restaura la última copia en el proyecto de **preproducción** (pasos 1–4) y comprueba que se puede entrar y ver órdenes y facturas. Anota la fecha y el resultado.
- **En cada cambio**: CI ejecuta `scripts/backup/test-restore.sh`:
  - crea una base con el esquema real y datos de prueba (orden con historial, factura emitida con su registro encadenado);
  - hace la copia cifrada y comprueba que ningún dato se lee sin la clave;
  - la restaura en una base nueva y verifica cada tabla, la cadena de facturas y que los avisos y el historial no se dupliquen;
  - comprueba también las protecciones (no sobrescribir, no copiar sin cifrar).

## Objetivos

- **Pérdida máxima de datos**: 24 h con la copia diaria (minutos si se contrata PITR en Supabase).
- **Tiempo de recuperación**: unas horas (proyecto nuevo, migraciones, restauración y configuración).
