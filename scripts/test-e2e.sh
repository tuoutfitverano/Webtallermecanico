#!/usr/bin/env bash
# Prueba de extremo a extremo de los formularios con una base de datos REAL:
#
#   navegador (Playwright) → web Astro → /api/solicitudes → supabase-js
#   → API REST (PostgREST, la misma pieza que usa Supabase) → PostgreSQL con RLS
#
# No necesita Docker. Usa PostgreSQL local, descarga PostgREST si hace falta
# (a .cache/) y genera claves de PRUEBA que solo valen aquí.
#
# Variables opcionales: PGHOST, PGPORT, PGUSER, PGPASSWORD, POSTGREST_BIN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=talleres_e2e
WEB_PORT=4329
PGRST_PORT=3001
PROXY_PORT=54329
POSTGREST_VERSION=v13.0.7
JWT_SECRET="secreto-solo-para-pruebas-e2e-0123456789abcdef"
AUTH_PASS="authenticator-e2e"

if [ "$(id -u)" = "0" ] && [ -z "${PGUSER:-}" ]; then PSQL=(runuser -u postgres -- psql); else PSQL=(psql); fi
PSQL+=(-X -q -v ON_ERROR_STOP=1)

# --- PostgREST ---
PGRST="${POSTGREST_BIN:-}"
if [ -z "$PGRST" ]; then PGRST="$(command -v postgrest || true)"; fi
if [ -z "$PGRST" ]; then
  PGRST="$ROOT/.cache/postgrest/postgrest"
  if [ ! -x "$PGRST" ]; then
    echo "▸ Descargando PostgREST $POSTGREST_VERSION en .cache/"
    mkdir -p "$ROOT/.cache/postgrest"
    curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" \
      | tar xJ -C "$ROOT/.cache/postgrest"
  fi
fi

pids=()
cleanup() {
  (cd "$ROOT/apps/web" && npx astro dev stop >/dev/null 2>&1) || true
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Base de datos: imitación de Supabase + migraciones + datos de demo ---
echo "▸ Preparando base de datos $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_harness/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null; done
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -d postgres >/dev/null <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password '$AUTH_PASS';
  else
    alter role authenticator login password '$AUTH_PASS';
  end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
SQL

# --- API REST (PostgREST) + pasarela tipo Supabase ---
PGRST_DB_URI="postgres://authenticator:$AUTH_PASS@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=$PGRST_PORT PGRST_LOG_LEVEL=crit \
  "$PGRST" >/dev/null 2>&1 & pids+=($!)
node "$ROOT/scripts/e2e/rest-proxy.mjs" $PROXY_PORT "http://127.0.0.1:$PGRST_PORT" & pids+=($!)
for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break; sleep 0.5; done

ANON_KEY="$(node "$ROOT/scripts/e2e/jwt.mjs" "$JWT_SECRET" anon)"
SERVICE_KEY="$(node "$ROOT/scripts/e2e/jwt.mjs" "$JWT_SECRET" service_role)"

# --- Web Astro con las claves de prueba ---
echo "▸ Arrancando la web"
(cd "$ROOT/apps/web" && npx astro dev stop >/dev/null 2>&1 || true)
(cd "$ROOT/apps/web" && \
  SUPABASE_URL="http://127.0.0.1:$PROXY_PORT" SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" SUPABASE_SECRET_KEY="$SERVICE_KEY" \
  REQUEST_HASH_SECRET="hash-de-pruebas" ASTRO_TELEMETRY_DISABLED=1 \
  npx astro dev --port $WEB_PORT --host 127.0.0.1 --background >/dev/null 2>&1)
ready=0
for i in $(seq 1 60); do
  if curl -sf -o /dev/null -H "host: demo.localhost:$WEB_PORT" "http://127.0.0.1:$WEB_PORT/privacidad"; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "✘ La web no muestra el taller de demostración (demo.localhost). Registro de Astro:" >&2
  (cd "$ROOT/apps/web" && npx astro dev logs 2>&1 | tail -30) >&2
  exit 1
fi

echo "▸ Ejecutando pruebas de extremo a extremo"
cd "$ROOT/apps/web"
E2E_BASE_URL="http://demo.localhost:$WEB_PORT" E2E_API_URL="http://127.0.0.1:$WEB_PORT" E2E_REST_URL="http://127.0.0.1:$PROXY_PORT/rest/v1" \
E2E_PROXY_URL="http://127.0.0.1:$PROXY_PORT" E2E_ANON_KEY="$ANON_KEY" E2E_SERVICE_KEY="$SERVICE_KEY" \
  npx playwright test "$@"
