#!/usr/bin/env bash
# Copia de la web de un taller con los datos de la base de datos REAL, en SOLO
# LECTURA (no cambia nada). La usa el flujo de GitHub «Exportar la web de un
# taller» (docs/EXPORTAR_WEB.md); se puede probar en local con test-local.sh.
#   SUPABASE_DB_URL=… TALLER=<identificador> bash scripts/exportar-web/desde-bd.sh
# Deja la carpeta y el .zip en web-exportada/<identificador> (o en SALIDA).
source "$(dirname "$0")/../publicar/comun.sh"
cd "$(dirname "$0")/../.."

requiere SUPABASE_DB_URL TALLER
ocultar "$SUPABASE_DB_URL"
[[ "$TALLER" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || fallo "El identificador del taller no es válido (minúsculas, números y guiones, como «taller-garcia»)."

datos="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/datos-$TALLER.json"
trap 'rm -f "$datos"' EXIT
paso "Datos de la web de $TALLER (solo lectura)"
# default_transaction_read_only: aunque algo fallara, esta conexión no puede escribir.
# La consulta va por la entrada estándar: psql solo sustituye :'var' ahí, no con -c.
PGOPTIONS='-c default_transaction_read_only=on' psql "$SUPABASE_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -v slug="$TALLER" \
  <<<"select private.exported_site(:'slug')" > "$datos"
[ "$(head -c1 "$datos")" = "{" ] || fallo "No hay ningún taller con el identificador «$TALLER»."

paso "Copia de la web"
node scripts/exportar-web/exportar.mjs "$datos" --salida "${SALIDA:-web-exportada/$TALLER}"
