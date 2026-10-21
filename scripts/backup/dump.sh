#!/usr/bin/env bash
# Copia de seguridad de los DATOS de AutoValue (no del esquema: el esquema se
# reconstruye con las migraciones de supabase/migrations, que están en Git).
#
#   DATABASE_URL=postgres://…  BACKUP_AGE_RECIPIENT=age1…  bash scripts/backup/dump.sh <carpeta>
#
# Genera en <carpeta>/<fecha>/:
#   auth.dump.age     cuentas (auth.users, auth.identities): sin ellas nadie podría entrar
#   app.dump.age      todos los datos de public y private (talleres, clientes,
#                     vehículos, órdenes, historial, presupuestos, facturas…)
#   schema.sql.age    esquema en el momento de la copia (para comprobar diferencias)
#   manifest.json     filas y huella de cada tabla (sin datos personales), para
#                     comprobar la restauración
# Todo se cifra con age (clave PÚBLICA en BACKUP_AGE_RECIPIENT; la privada nunca
# está en el servidor ni en GitHub). Sin clave, no se escribe nada salvo que se
# pida explícitamente para la prueba local (BACKUP_PLAINTEXT_FOR_TESTS=1).
set -euo pipefail

OUT_ROOT="${1:?Uso: dump.sh <carpeta de salida>}"
: "${DATABASE_URL:?Falta DATABASE_URL (cadena de conexión de la base de datos)}"
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
if [ -z "$RECIPIENT" ] && [ "${BACKUP_PLAINTEXT_FOR_TESTS:-}" != "1" ]; then
  echo "✘ Falta BACKUP_AGE_RECIPIENT: no se hacen copias sin cifrar." >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
OUT="$OUT_ROOT/$STAMP"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Esquemas propios; el resto (storage, realtime…) lo gestiona Supabase.
pg_dump "$DATABASE_URL" --format=custom --data-only --no-owner \
  --table=auth.users --table=auth.identities --file="$TMP/auth.dump"
pg_dump "$DATABASE_URL" --format=custom --data-only --no-owner \
  --schema=public --schema=private --file="$TMP/app.dump"
pg_dump "$DATABASE_URL" --schema-only --no-owner \
  --schema=public --schema=private --file="$TMP/schema.sql"
psql "$DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -f "$(dirname "$0")/manifest.sql" > "$OUT/manifest.json"

for f in auth.dump app.dump schema.sql; do
  if [ -n "$RECIPIENT" ]; then
    age --encrypt --recipient "$RECIPIENT" --output "$OUT/$f.age" "$TMP/$f"
  else
    cp "$TMP/$f" "$OUT/$f"
  fi
done
echo "✔ Copia en $OUT ($(du -sh "$OUT" | cut -f1))"
