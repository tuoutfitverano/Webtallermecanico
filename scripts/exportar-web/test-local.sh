#!/usr/bin/env bash
# Prueba en local desde-bd.sh contra una base con el esquema REAL (roles de
# Supabase + Supabase Auth + migraciones + datos de demostración), sin tocar
# Supabase: genera la copia de AutoValue, comprueba que la conexión es de solo
# lectura y que un taller inexistente se rechaza. Uso: bash scripts/exportar-web/test-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=exportar_web_prueba
AS=(); [ "$(id -u)" = 0 ] && AS=(runuser -u postgres --)
PSQL=("${AS[@]}" psql -X -q -v ON_ERROR_STOP=1)
# shellcheck source=../lib/supabase-auth.sh
source "$ROOT/scripts/lib/supabase-auth.sh"
OUT="$(mktemp -d)"
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; rm -rf "$OUT"' EXIT
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_harness/supabase_roles.sql" >/dev/null
auth_migrate "$DB" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null; done
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null

if [ -n "${PGPASSWORD:-}" ]; then
  # CI: PostgreSQL con usuario y contraseña ya dados (PGHOST, PGUSER, PGPASSWORD).
  URL="postgresql://${PGUSER:-postgres}:$PGPASSWORD@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
else
  PASS=$(openssl rand -hex 12)
  "${PSQL[@]}" -d postgres -c "alter role postgres password '$PASS'" >/dev/null
  URL="postgresql://postgres:$PASS@127.0.0.1:5432/$DB"
fi

if SUPABASE_DB_URL="$URL" TALLER=no-existe bash "$ROOT/scripts/exportar-web/desde-bd.sh" >/dev/null 2>&1; then
  echo "✘ debería fallar con un taller que no existe"; exit 1
fi
echo "✔ Un taller que no existe se rechaza"

if PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -X -q -c "update public.workshops set name = name" >/dev/null 2>&1; then
  echo "✘ la conexión de solo lectura ha podido escribir"; exit 1
fi
echo "✔ La conexión que usa es de solo lectura"

# En una carpeta temporal, para no pisar web-exportada/.
SUPABASE_DB_URL="$URL" TALLER=taller-demo SALIDA="$OUT/taller-demo" bash "$ROOT/scripts/exportar-web/desde-bd.sh"
[ -f "$OUT/taller-demo.zip" ] && [ -f "$OUT/taller-demo/index.html" ] || { echo "✘ no se ha creado la copia"; exit 1; }
echo "✔ Copia de AutoValue generada desde la base de datos y comprobada sin la plataforma"

# Con el diseño clásico (otros textos y otro formulario) y con el taller suspendido, que es
# cuando se la lleva: la web pública ya no se ve, pero la copia se genera igual.
"${PSQL[@]}" -d "$DB" -c "update public.workshop_sites set theme = jsonb_set(theme, '{design}', '\"clasico\"') where workshop_id = (select id from public.workshops where slug = 'taller-demo')" \
  -c "update public.workshops set status = 'suspendido' where slug = 'taller-demo'" >/dev/null
SUPABASE_DB_URL="$URL" TALLER=taller-demo SALIDA="$OUT/clasico" bash "$ROOT/scripts/exportar-web/desde-bd.sh" >/dev/null
grep -q 'class="hero' "$OUT/clasico/index.html" || { echo "✘ la copia no tiene el diseño clásico"; exit 1; }
echo "✔ Copia con el diseño clásico y el taller suspendido, comprobada sin la plataforma"
