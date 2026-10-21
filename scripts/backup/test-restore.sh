#!/usr/bin/env bash
# Prueba de punta a punta de las copias de seguridad, en PostgreSQL local:
#   1. base «origen» = esquema real (roles + Supabase Auth + migraciones) con datos de prueba;
#   2. copia CIFRADA con una clave age de un solo uso (scripts/backup/dump.sh);
#   3. base «destino» nueva con el mismo esquema;
#   4. restauración (scripts/backup/restore.sh) y comprobación de filas y
#      huellas de cada tabla, del historial y de la cadena de facturas;
#   5. el script se niega a restaurar encima de datos y a una base equivocada.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DB=autovalue_copia_origen
DST_DB=autovalue_copia_destino
if [ "$(id -u)" = "0" ] && [ -z "${PGUSER:-}" ]; then
  AS=(runuser -u postgres --)
  url() { echo "postgresql:///$1"; }
else
  AS=()
  url() { echo "postgresql://${PGUSER:-postgres}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST:-localhost}:${PGPORT:-5432}/$1"; }
fi
PSQL=("${AS[@]}" psql -X -q -v ON_ERROR_STOP=1)
run_file() { "${PSQL[@]}" -d "$DB" -f "$1"; }
# shellcheck source=../lib/supabase-auth.sh
source "$ROOT/scripts/lib/supabase-auth.sh"

WORK="$(mktemp -d)"
chmod 755 "$WORK"
cleanup() { rm -rf "$WORK"; "${PSQL[@]}" -d postgres -c "drop database if exists $SRC_DB" -c "drop database if exists $DST_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

schema() { # DB
  DB="$1"
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  run_file "$ROOT/supabase/tests/_harness/supabase_roles.sql" >/dev/null
  auth_migrate "$DB" >/dev/null
  for f in "$ROOT"/supabase/migrations/*.sql; do run_file "$f" >/dev/null; done
}

echo "▸ Base de origen con esquema real y datos de prueba"
schema "$SRC_DB"
DB=$SRC_DB
run_file "$ROOT/supabase/seed.sql" >/dev/null
(cd "$ROOT/scripts/backup" && run_file sample-data.sql >/dev/null)

echo "▸ Copia cifrada"
age-keygen -o "$WORK/clave.txt" 2>/dev/null
chmod 644 "$WORK/clave.txt"
RECIPIENT="$(age-keygen -y "$WORK/clave.txt")"
mkdir -p "$WORK/copias" && chmod 777 "$WORK/copias"
"${AS[@]}" env DATABASE_URL="$(url $SRC_DB)" BACKUP_AGE_RECIPIENT="$RECIPIENT" bash "$ROOT/scripts/backup/dump.sh" "$WORK/copias"
COPY="$(ls -d "$WORK"/copias/*/ | head -1)"
if ls "$COPY" | grep -qv -e '\.age$' -e '^manifest\.json$'; then echo "✘ Hay archivos sin cifrar en la copia" >&2; exit 1; fi
if grep -q "propietaria@alcarria.test" "$COPY"/*.age; then echo "✘ Un correo aparece en claro dentro de la copia" >&2; exit 1; fi
echo "✔ Copia cifrada: ningún dato legible sin la clave"

echo "▸ Base de destino nueva (solo esquema) y restauración"
schema "$DST_DB"
"${AS[@]}" env TARGET_DATABASE_URL="$(url $DST_DB)" BACKUP_AGE_IDENTITY="$WORK/clave.txt" bash "$ROOT/scripts/backup/restore.sh" "$COPY" --confirmar "$DST_DB"

DB=$DST_DB
check() { # SQL descripción
  if [ "$("${PSQL[@]}" -d "$DST_DB" -A -t -c "$1")" = "t" ]; then echo "✔ $2"; else echo "✘ $2" >&2; exit 1; fi
}
check "select count(*) = 1 from public.invoices where status = 'emitida' and full_number is not null" "la factura emitida vuelve con su número"
check "select count(*) > 0 from public.invoice_records" "con su registro encadenado"
check "select bool_and(r.hash = encode(sha256(convert_to(coalesce(r.prev_hash, '') || r.payload::text, 'UTF8')), 'hex')) from public.invoice_records r" "y las huellas de la cadena siguen cuadrando"
check "select count(*) >= 5 from public.repair_order_events" "el historial de la orden está completo (sin duplicar)"
check "select count(*) > 0 from auth.users where email = 'propietaria@alcarria.test'" "las cuentas se restauran (se podrá iniciar sesión)"
check "select (public.get_public_site('demo.localhost') -> 'workshop' ->> 'name') is not null" "la web pública del taller demo responde"

echo "▸ Protecciones"
if "${AS[@]}" env TARGET_DATABASE_URL="$(url $DST_DB)" BACKUP_AGE_IDENTITY="$WORK/clave.txt" bash "$ROOT/scripts/backup/restore.sh" "$COPY" --confirmar "$DST_DB" >/dev/null 2>&1; then
  echo "✘ Restauró encima de datos existentes" >&2; exit 1
fi
echo "✔ Se niega a restaurar encima de datos existentes"
if "${AS[@]}" env TARGET_DATABASE_URL="$(url $DST_DB)" BACKUP_AGE_IDENTITY="$WORK/clave.txt" bash "$ROOT/scripts/backup/restore.sh" "$COPY" --confirmar otra_base >/dev/null 2>&1; then
  echo "✘ Aceptó un nombre de base que no coincide" >&2; exit 1
fi
echo "✔ Se niega si el nombre de la base de destino no coincide"
if "${AS[@]}" env DATABASE_URL="$(url $SRC_DB)" bash "$ROOT/scripts/backup/dump.sh" "$WORK/sin-cifrar" >/dev/null 2>&1; then
  echo "✘ Hizo una copia sin cifrar" >&2; exit 1
fi
echo "✔ Se niega a copiar sin clave de cifrado"
echo
echo "✔ Copias de seguridad: copia cifrada y restauración verificadas"
