#!/usr/bin/env bash
# PASO 2 de la versión real (ver docs/PUBLICAR.md), cuando ya te has registrado en la web:
#   1. Confirma el correo de TU cuenta (sin depender del envío de correos de Supabase).
#   2. Crea el taller AutoValue con su web en la dirección real y te hace propietario.
#      Si el taller ya existe, actualiza su web y te añade como propietario.
#   3. Comprueba que la web del taller responde.
# Uso: CORREO_PROPIETARIO=tu@correo bash scripts/publicar/crear-taller.sh
source "$(dirname "$0")/comun.sh"
cd "$(dirname "$0")/../.."

[ -n "${APP_HOST:-}" ] || requiere CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
requiere SUPABASE_DB_URL CORREO_PROPIETARIO
ocultar "$SUPABASE_DB_URL"
EMAIL=$(tr '[:upper:]' '[:lower:]' <<<"$CORREO_PROPIETARIO" | xargs)
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fallo "El correo no es válido."

HOST=$(app_host)
APP_URL="https://$HOST"
# Las consultas van por la entrada estándar: psql solo sustituye :'var' ahí, no con -c.
db() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

paso "Tu cuenta"
user=$(db -At -v email="$EMAIL" <<<"select id from auth.users where lower(email) = lower(:'email')")
[ -n "$user" ] || fallo "No hay ninguna cuenta con ese correo. Regístrate primero en $APP_URL/registro."
db -v id="$user" <<<"update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = :'id'::uuid"
echo "  ✔ cuenta encontrada y correo confirmado"

paso "Taller y web"
slug=$(jq -r .slug talleres/autovalue.json)
exists=$(db -At -v slug="$slug" <<<"select count(*) from public.workshops where slug = :'slug'")
sql="${RUNNER_TEMP:-/tmp}/taller.sql"
if [ "$exists" = 0 ]; then
  node scripts/publicar/taller-sql.ts talleres/autovalue.json "$HOST" "$EMAIL" > "$sql"
else
  node scripts/publicar/taller-sql.ts talleres/autovalue.json "$HOST" > "$sql"
fi
db -f "$sql"
rm -f "$sql"
if [ "$exists" != 0 ]; then
  db -v slug="$slug" -v email="$EMAIL" <<<"select private.add_workshop_owner((select id from public.workshops where slug = :'slug'), :'email')" > /dev/null
fi
echo "  ✔ taller listo y tú como propietario"

paso "Comprobación"
if [ -n "${SIN_COMPROBAR_WEB:-}" ]; then echo "  (omitida: prueba local)"; exit 0; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/")
[ "$code" = 200 ] || fallo "La web del taller no responde bien en $APP_URL/ (HTTP $code)."
echo "  ✔ $APP_URL/ responde"
{
  echo "### Taller creado"
  echo
  echo "- Web: $APP_URL/"
  echo "- Panel del taller: $APP_URL/panel (entra con tu cuenta)"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
