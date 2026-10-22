# Funciones compartidas por publicar.sh y crear-taller.sh (se cargan con «source»).
# Nunca escriben un secreto en la salida: lo que se lee de las API se oculta con
# ::add-mask:: (registro de GitHub Actions) antes de usarlo.
set -euo pipefail

WORKER=autovalue-web
CF_API=https://api.cloudflare.com/client/v4
SB_API=https://api.supabase.com/v1

fallo() { echo "::error::$*" >&2; exit 1; }
paso() { echo; echo "▸ $*"; }
ocultar() { [ -n "${1:-}" ] && echo "::add-mask::$1"; }

requiere() {
  local falta=()
  for v in "$@"; do [ -n "${!v:-}" ] || falta+=("$v"); done
  [ ${#falta[@]} -eq 0 ] || fallo "Faltan estos secretos en GitHub (Settings → Secrets and variables → Actions): ${falta[*]}. Ver docs/PUBLICAR.md."
}

cf() { # cf MÉTODO RUTA [JSON]
  local out
  out=$(curl -sS -X "$1" "$CF_API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"})
  [ "$(jq -r '.success' <<<"$out")" = true ] || fallo "Cloudflare rechazó $1 $2: $(jq -c '[.errors[]?.message]' <<<"$out"). Revisa los permisos del token (docs/PUBLICAR.md)."
  printf '%s' "$out"
}

sb() { # sb MÉTODO RUTA [JSON]
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X "$1" "$SB_API$2" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"})
  code=${out##*$'\n'}; out=${out%$'\n'*}
  [[ "$code" == 2* ]] || fallo "Supabase rechazó $1 $2 (HTTP $code). Revisa SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF."
  printf '%s' "$out"
}

# Dirección pública de la web: https://autovalue-web.<subdominio>.workers.dev
app_host() {
  # APP_HOST: solo para probar los scripts en local (scripts/publicar/test-local.sh).
  if [ -n "${APP_HOST:-}" ]; then echo "$APP_HOST"; return; fi
  local sub
  sub=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | jq -r '.result.subdomain // empty')
  [ -n "$sub" ] || fallo "La cuenta de Cloudflare aún no tiene subdominio workers.dev: entra en Workers & Pages una vez para crearlo."
  echo "$WORKER.$sub.workers.dev"
}

# Claves de la API de Supabase (publicable y secreta). Prefiere las nuevas (sb_publishable / sb_secret).
supabase_keys() {
  local keys
  keys=$(sb GET "/projects/$SUPABASE_PROJECT_REF/api-keys?reveal=true")
  SB_PUBLISHABLE=$(jq -r '([.[] | select(.type == "publishable")][0].api_key) // ([.[] | select(.name == "anon")][0].api_key) // empty' <<<"$keys")
  SB_SECRET=$(jq -r '([.[] | select(.type == "secret")][0].api_key) // ([.[] | select(.name == "service_role")][0].api_key) // empty' <<<"$keys")
  [ -n "$SB_PUBLISHABLE" ] && [ -n "$SB_SECRET" ] || fallo "No se han podido leer las claves de API del proyecto de Supabase."
  ocultar "$SB_PUBLISHABLE"; ocultar "$SB_SECRET"
}
