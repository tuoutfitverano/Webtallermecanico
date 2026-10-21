#!/usr/bin/env bash
# Prueba de extremo a extremo con las piezas REALES de Supabase:
#
#   navegador (Playwright) → web Astro → supabase-js / @supabase/ssr
#   → pasarela tipo Supabase → API REST (PostgREST) + Supabase Auth (GoTrue)
#   → PostgreSQL con RLS
#
# Los correos que envía Supabase Auth (confirmación, recuperación) llegan a
# un buzón de pruebas local (scripts/e2e/mail-sink.mjs).
#
# No necesita Docker. Usa PostgreSQL local, descarga PostgREST y Supabase Auth
# si hace falta (a .cache/) y genera claves de PRUEBA que solo valen aquí.
#
# Variables opcionales: PGHOST, PGPORT, PGUSER, PGPASSWORD, POSTGREST_BIN, AUTH_BIN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=talleres_e2e
WEB_PORT=4329
PGRST_PORT=3001
PROXY_PORT=54329
AUTH_PORT=9998
SMTP_PORT=2525
MAIL_PORT=2580
PLATE_PORT=4998
PLATE_TOKEN="token-simulado-solo-para-pruebas"
EMAIL_PORT=4997
EMAIL_KEY="re_simulada_solo_para_pruebas"
WHATSAPP_PORT=4996
WHATSAPP_TOKEN="token-whatsapp-simulado-solo-para-pruebas"
WHATSAPP_APP_SECRET="secreto-app-whatsapp-de-pruebas-e2e"
WHATSAPP_VERIFY_TOKEN="verificacion-whatsapp-de-pruebas"
# Secretos de PRUEBA (solo valen aquí).
WEBHOOK_SECRET="whsec_$(printf 'secreto-de-webhook-de-pruebas-e2e' | base64)"
CRON_SECRET="cron-secreto-de-pruebas-e2e-0123456789"
TEST_PASSWORD="Clave-de-prueba-1"   # cumple las reglas de supabase/config.toml
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
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_harness/supabase_roles.sql" >/dev/null
# shellcheck source=lib/supabase-auth.sh
source "$ROOT/scripts/lib/supabase-auth.sh"
auth_migrate "$DB"
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

# --- Buzón de correo de pruebas + Supabase Auth ---
# Si quedó un servidor de una ejecución anterior, las pruebas hablarían con él.
for port in $AUTH_PORT $SMTP_PORT $MAIL_PORT $PROXY_PORT $PGRST_PORT $PLATE_PORT $EMAIL_PORT $WHATSAPP_PORT; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "✘ El puerto $port ya está en uso (¿quedó una prueba anterior abierta?). Ciérrala y repite." >&2; exit 1
  fi
done
node "$ROOT/scripts/e2e/mail-sink.mjs" $SMTP_PORT $MAIL_PORT "$ROOT/supabase/templates" & pids+=($!)
# Proveedor de matrículas SIMULADO (nunca se llama al real en las pruebas).
node "$ROOT/scripts/e2e/plate-provider-mock.mjs" $PLATE_PORT "$PLATE_TOKEN" & pids+=($!)
# Proveedor de email SIMULADO (ningún correo sale de este ordenador).
node "$ROOT/scripts/e2e/email-provider-mock.mjs" $EMAIL_PORT "$EMAIL_KEY" & pids+=($!)
# WhatsApp SIMULADO (ningún mensaje sale de este ordenador).
node "$ROOT/scripts/e2e/whatsapp-provider-mock.mjs" $WHATSAPP_PORT "$WHATSAPP_TOKEN" & pids+=($!)
SITE="http://demo.localhost:$WEB_PORT"
(cd "$ROOT/.cache/auth" && \
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="$(auth_db_url "$DB")" GOTRUE_DB_MIGRATIONS_PATH=./migrations \
  GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT API_EXTERNAL_URL="http://127.0.0.1:$PROXY_PORT" \
  GOTRUE_SITE_URL="$SITE" GOTRUE_URI_ALLOW_LIST="$SITE/**" \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_PASSWORD_MIN_LENGTH=10 \
  GOTRUE_PASSWORD_REQUIRED_CHARACTERS="abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789" \
  GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true \
  GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=$SMTP_PORT GOTRUE_SMTP_ADMIN_EMAIL=no-responder@talleres.test \
  GOTRUE_SMTP_SENDER_NAME="Área de talleres" GOTRUE_SMTP_MAX_FREQUENCY=1s \
  GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify \
  GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify \
  GOTRUE_MAILER_TEMPLATES_CONFIRMATION="http://127.0.0.1:$MAIL_PORT/templates/confirmation.html" \
  GOTRUE_MAILER_SUBJECTS_CONFIRMATION="Confirma tu correo · Área de talleres" \
  GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_VERIFY=1000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 \
  GOTRUE_LOG_LEVEL=warn \
  exec ./auth serve >"$ROOT/.cache/auth/serve.log" 2>&1) & pids+=($!)

# --- API REST (PostgREST) + pasarela tipo Supabase ---
PGRST_DB_URI="postgres://authenticator:$AUTH_PASS@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=$PGRST_PORT PGRST_LOG_LEVEL=crit \
  "$PGRST" >/dev/null 2>&1 & pids+=($!)
node "$ROOT/scripts/e2e/rest-proxy.mjs" $PROXY_PORT "http://127.0.0.1:$PGRST_PORT" "http://127.0.0.1:$AUTH_PORT" & pids+=($!)
for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$PGRST_PORT/" && break; sleep 0.5; done
auth_ready=0
for i in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$AUTH_PORT/health" && { auth_ready=1; break; }; sleep 0.5; done
if [ "$auth_ready" != 1 ]; then
  echo "✘ Supabase Auth no arranca. Registro:" >&2; tail -30 "$ROOT/.cache/auth/serve.log" >&2; exit 1
fi

ANON_KEY="$(node "$ROOT/scripts/e2e/jwt.mjs" "$JWT_SECRET" anon)"
SERVICE_KEY="$(node "$ROOT/scripts/e2e/jwt.mjs" "$JWT_SECRET" service_role)"

# --- Cuentas y talleres de prueba (API de administración de Supabase Auth) ---
create_user() { # correo nombre
  curl -sf -o /dev/null -X POST "http://127.0.0.1:$PROXY_PORT/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "authorization: Bearer $SERVICE_KEY" -H "content-type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$TEST_PASSWORD\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"$2\"}}" \
    || { echo "✘ No se pudo crear la cuenta de prueba $1" >&2; tail -20 "$ROOT/.cache/auth/serve.log" >&2; exit 1; }
}
create_user propietaria@e2e.test "Paula Propietaria"
create_user mecanico@e2e.test "Marcos Mecánico"
create_user otro@e2e.test "Óscar Otro Taller"
create_user gestora@e2e.test "Gloria Gestora"
create_user temporal@e2e.test "Tomás Temporal"
create_user recepcion@e2e.test "Raquel Recepción"
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
-- Taller demo: propietaria, administradora, recepción y mecánicos. Otro taller con sus propios datos.
select private.add_workshop_owner('d0000000-0000-0000-0000-000000000001', 'propietaria@e2e.test');
insert into public.workshop_members (workshop_id, user_id, role)
  select 'd0000000-0000-0000-0000-000000000001', id,
         case email when 'gestora@e2e.test' then 'administrador'::public.member_role
                    when 'recepcion@e2e.test' then 'recepcionista'::public.member_role else 'mecanico'::public.member_role end
  from auth.users where email in ('mecanico@e2e.test', 'gestora@e2e.test', 'temporal@e2e.test', 'recepcion@e2e.test');
select private.create_workshop('taller-otro', 'Taller Otro', 'otro@e2e.test');
insert into public.vehicles (workshop_id, plate, make, model, year, year_kind)
  select id, '9999ZZZ', 'Renault', 'Clio', 2015, 'fabricacion' from public.workshops where slug = 'taller-otro';
SQL

# --- Web Astro con las claves de prueba ---
echo "▸ Arrancando la web"
(cd "$ROOT/apps/web" && npx astro dev stop >/dev/null 2>&1 || true)
(cd "$ROOT/apps/web" && \
  SUPABASE_URL="http://127.0.0.1:$PROXY_PORT" SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" SUPABASE_SECRET_KEY="$SERVICE_KEY" \
  REQUEST_HASH_SECRET="hash-de-pruebas" ASTRO_TELEMETRY_DISABLED=1 E2E=1 \
  VEHICLE_LOOKUP_PROVIDER=openapi OPENAPI_AUTOMOTIVE_TOKEN="$PLATE_TOKEN" OPENAPI_AUTOMOTIVE_URL="http://127.0.0.1:$PLATE_PORT" \
  VEHICLE_LOOKUP_TIMEOUT_MS=2000 \
  EMAIL_PROVIDER=resend EMAIL_FROM=avisos@talleres.test RESEND_API_KEY="$EMAIL_KEY" RESEND_API_URL="http://127.0.0.1:$EMAIL_PORT" \
  RESEND_WEBHOOK_SECRET="$WEBHOOK_SECRET" NOTIFICATIONS_CRON_SECRET="$CRON_SECRET" \
  WHATSAPP_PROVIDER=meta WHATSAPP_TOKEN="$WHATSAPP_TOKEN" WHATSAPP_PHONE_NUMBER_ID=100000000000001 \
  WHATSAPP_API_URL="http://127.0.0.1:$WHATSAPP_PORT/v21.0" WHATSAPP_APP_SECRET="$WHATSAPP_APP_SECRET" WHATSAPP_VERIFY_TOKEN="$WHATSAPP_VERIFY_TOKEN" \
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

# Calentamiento: la primera visita a cada página hace que Vite prepare sus dependencias y
# reinicie el entorno de Workers; si eso pasa en mitad de una prueba, la petición falla
# ("fetch failed"). Se visitan las páginas principales hasta que todas respondan bien
# dos rondas seguidas.
# Todas las páginas (las de parámetro, con un identificador cualquiera): cada una
# importa sus propios módulos y Vite los descubre la primera vez que se piden.
WARM=()
while IFS= read -r f; do
  route="${f#"$ROOT/apps/web/src/pages"}"; route="${route%.astro}"; route="${route%.ts}"; route="${route%/index}"
  route="$(sed -E 's/\[[^]]+\]/00000000-0000-0000-0000-000000000000/g' <<<"$route")"
  case "$route" in */api/*) continue ;; esac
  WARM+=("${route:-/}")
done < <(find "$ROOT/apps/web/src/pages" \( -name '*.astro' -o -name '*.ts' \) ! -name '*.test.ts' | sort)
stable=0
for round in $(seq 1 15); do
  ok=1
  for path in "${WARM[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "host: demo.localhost:$WEB_PORT" "http://127.0.0.1:$WEB_PORT$path" || echo 000)
    case "$code" in 2*|3*|404) ;; *) ok=0 ;; esac
  done
  if [ "$ok" = 1 ]; then stable=$((stable + 1)); else stable=0; fi
  [ "$stable" -ge 2 ] && break
  sleep 2
done

# Vídeo de prueba local para comprobar el vídeo de la portada (los reales están en otro servidor).
TEST_VIDEO=""
if command -v ffmpeg >/dev/null 2>&1; then
  mkdir -p "$ROOT/.cache/e2e"
  TEST_VIDEO="$ROOT/.cache/e2e/portada.webm"
  [ -s "$TEST_VIDEO" ] || ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=320x180:rate=24:duration=3" -c:v libvpx-vp9 -b:v 200k "$TEST_VIDEO"
fi

echo "▸ Ejecutando pruebas de extremo a extremo"
cd "$ROOT/apps/web"
E2E_BASE_URL="http://demo.localhost:$WEB_PORT" E2E_API_URL="http://127.0.0.1:$WEB_PORT" E2E_REST_URL="http://127.0.0.1:$PROXY_PORT/rest/v1" \
E2E_PROXY_URL="http://127.0.0.1:$PROXY_PORT" E2E_ANON_KEY="$ANON_KEY" E2E_SERVICE_KEY="$SERVICE_KEY" \
E2E_PLATE_MOCK_URL="http://127.0.0.1:$PLATE_PORT" E2E_EMAIL_MOCK_URL="http://127.0.0.1:$EMAIL_PORT" \
E2E_WEBHOOK_SECRET="$WEBHOOK_SECRET" E2E_CRON_SECRET="$CRON_SECRET" \
E2E_WHATSAPP_MOCK_URL="http://127.0.0.1:$WHATSAPP_PORT" E2E_WHATSAPP_APP_SECRET="$WHATSAPP_APP_SECRET" E2E_WHATSAPP_VERIFY_TOKEN="$WHATSAPP_VERIFY_TOKEN" E2E_MAIL_URL="http://127.0.0.1:$MAIL_PORT" E2E_PASSWORD="$TEST_PASSWORD" E2E_VIDEO="$TEST_VIDEO" \
  npx playwright test "$@"
