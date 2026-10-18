#!/usr/bin/env bash
# Prueba las migraciones y los permisos (RLS) en un PostgreSQL local.
#
# Crea una base de datos temporal, aplica una imitación mínima de Supabase,
# todas las migraciones y ejecuta cada archivo de supabase/tests/*.test.sql.
# Cada prueba se ejecuta dentro de una transacción que se deshace al final.
#
# Variables opcionales: PGHOST, PGPORT, PGUSER (superusuario), TEST_DB.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TEST_DB:-talleres_test}"

# En este contenedor PostgreSQL se ejecuta como el usuario del sistema "postgres".
if [ "$(id -u)" = "0" ] && [ -z "${PGUSER:-}" ]; then
  PSQL=(runuser -u postgres -- psql)
else
  PSQL=(psql)
fi
PSQL+=(-X -q -v ON_ERROR_STOP=1)

if ! "${PSQL[@]}" -d postgres -c "select 1" >/dev/null 2>&1; then
  echo "✘ No puedo conectar con PostgreSQL. ¿Está arrancado? (en este contenedor: pg_ctlcluster 16 main start)" >&2
  exit 1
fi
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1

run_file() { "${PSQL[@]}" -d "$DB" -f "$1"; }

echo "▸ Preparando base de datos de prueba ($DB)"
run_file "$ROOT/supabase/tests/_harness/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "▸ Migración $(basename "$f")"
  run_file "$f" >/dev/null
done

passed=0
failed=0
for f in "$ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  if out="$(cd "$ROOT/supabase/tests" && run_file "$f" 2>&1)"; then
    n="$(grep -c 'NOTICE:  ok - ' <<<"$out" || true)"
    passed=$((passed + n))
    echo "✔ $name ($n comprobaciones)"
  else
    failed=$((failed + 1))
    echo "✘ $name"
    grep -E 'ERROR|FALLO' <<<"$out" | sed 's/^/    /'
  fi
done

# Los datos de demostración también deben cargarse sin errores.
if run_file "$ROOT/supabase/seed.sql" >/dev/null 2>&1; then
  echo "✔ seed.sql se carga correctamente"
else
  failed=$((failed + 1))
  echo "✘ seed.sql no se puede cargar"
  run_file "$ROOT/supabase/seed.sql" 2>&1 | grep ERROR | sed 's/^/    /' || true
fi

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
echo
if [ "$failed" -gt 0 ]; then
  echo "✘ $failed archivo(s) de prueba con fallos ($passed comprobaciones correctas)"
  exit 1
fi
echo "✔ Todas las pruebas de base de datos pasan ($passed comprobaciones)"
