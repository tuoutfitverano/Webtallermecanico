#!/usr/bin/env bash
# Restaura una copia de scripts/backup/dump.sh en una base de datos NUEVA.
#
#   TARGET_DATABASE_URL=postgres://…  BACKUP_AGE_IDENTITY=clave.txt \
#     bash scripts/backup/restore.sh <carpeta de la copia> --confirmar <nombre de la base de destino>
#
# Antes: la base de destino debe tener el esquema creado con las migraciones
# (proyecto nuevo de Supabase + `supabase db push`, o el arnés local). El script
# se NIEGA a escribir en una base que ya tenga talleres: nunca sobrescribe datos.
# Carga las cuentas y los datos en una sola transacción con los disparadores
# desactivados (el historial y los avisos se restauran tal cual, sin duplicarse)
# y comprueba filas y huellas contra manifest.json.
set -euo pipefail

SRC="${1:?Uso: restore.sh <carpeta> --confirmar <base de destino>}"
[ "${2:-}" = "--confirmar" ] || { echo "✘ Falta --confirmar <nombre de la base de destino>" >&2; exit 1; }
CONFIRM="${3:?Falta el nombre de la base de destino}"
: "${TARGET_DATABASE_URL:?Falta TARGET_DATABASE_URL}"
PSQL=(psql "$TARGET_DATABASE_URL" -X -q -v ON_ERROR_STOP=1)

actual="$("${PSQL[@]}" -A -t -c "select current_database()")"
if [ "$actual" != "$CONFIRM" ]; then
  echo "✘ La base de destino es «$actual», no «$CONFIRM». No se toca nada." >&2
  exit 1
fi
if [ "$("${PSQL[@]}" -A -t -c "select count(*) from public.workshops")" != "0" ]; then
  echo "✘ La base de destino ya tiene talleres: la restauración solo se hace en una base nueva." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for f in auth.dump app.dump; do
  if [ -f "$SRC/$f.age" ]; then
    : "${BACKUP_AGE_IDENTITY:?Falta BACKUP_AGE_IDENTITY (archivo con la clave privada de age)}"
    age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$TMP/$f" "$SRC/$f.age"
  else
    cp "$SRC/$f" "$TMP/$f"
  fi
  pg_restore --data-only --no-owner --file="$TMP/$f.sql" "$TMP/$f"
done

# Una sola transacción: o se restaura todo, o nada.
"${PSQL[@]}" --single-transaction \
  -c "set session_replication_role = replica" \
  -f "$TMP/auth.dump.sql" -f "$TMP/app.dump.sql" >/dev/null

"${PSQL[@]}" -A -t -f "$(dirname "$0")/manifest.sql" > "$TMP/manifest.json"
if python3 - "$SRC/manifest.json" "$TMP/manifest.json" <<'PY'
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:3])
bad = [t for t in a if a[t] != b.get(t)]
for t in bad: print(f"  ✘ {t}: copia {a[t]} · restaurada {b.get(t)}")
sys.exit(1 if bad else 0)
PY
then
  echo "✔ Restauración completa: $(python3 -c "import json,sys;d=json.load(open('$SRC/manifest.json'));print(len(d),'tablas,',sum(v['rows'] for v in d.values()),'filas idénticas')")"
else
  echo "✘ La restauración no coincide con la copia" >&2
  exit 1
fi
