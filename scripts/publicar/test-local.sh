#!/usr/bin/env bash
# Prueba en local el paso 2 (crear-taller.sh) contra una base con el esquema REAL
# (roles de Supabase + Supabase Auth + migraciones), sin Cloudflare ni Supabase:
# cuenta sin confirmar → se confirma → taller creado con su web y su dominio →
# repetirlo no falla ni duplica nada. Uso: bash scripts/publicar/test-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=autovalue_publicar_prueba
AS=(); [ "$(id -u)" = 0 ] && AS=(runuser -u postgres --)
PSQL=("${AS[@]}" psql -X -q -v ON_ERROR_STOP=1)
# shellcheck source=../lib/supabase-auth.sh
source "$ROOT/scripts/lib/supabase-auth.sh"
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_harness/supabase_roles.sql" >/dev/null
auth_migrate "$DB" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null; done
"${PSQL[@]}" -d "$DB" -c "insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'duena@prueba.test', 'authenticated', 'authenticated')"

PASS=$(openssl rand -hex 12)
"${PSQL[@]}" -d postgres -c "alter role postgres password '$PASS'" >/dev/null
URL="postgresql://postgres:$PASS@127.0.0.1:5432/$DB"
run() { APP_HOST=autovalue-web.prueba.workers.dev SIN_COMPROBAR_WEB=1 SUPABASE_DB_URL="$URL" CORREO_PROPIETARIO="$1" bash "$ROOT/scripts/publicar/crear-taller.sh"; }
q() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }

if run nadie@prueba.test >/dev/null 2>&1; then echo "✘ debería fallar sin cuenta"; exit 1; fi
echo "✔ Sin cuenta, se niega"
run Duena@Prueba.test > /dev/null
[ "$(q "select count(*) from auth.users where email = 'duena@prueba.test' and email_confirmed_at is not null")" = 1 ] && echo "✔ Correo confirmado"
[ "$(q "select count(*) from workshop_members m join workshops w on w.id = m.workshop_id join auth.users u on u.id = m.user_id where w.slug = 'taller-demo' and m.role = 'propietario' and u.email = 'duena@prueba.test'")" = 1 ] && echo "✔ Propietaria del taller"
[ "$(q "select count(*) from workshop_domains d join workshops w on w.id = d.workshop_id where w.slug = 'taller-demo' and d.hostname = 'autovalue-web.prueba.workers.dev'")" = 1 ] && echo "✔ Dominio real"
[ "$(q "select (public.get_public_site('autovalue-web.prueba.workers.dev') -> 'workshop' ->> 'name')")" = AutoValue ] && echo "✔ La web pública responde con AutoValue"
run duena@prueba.test > /dev/null
[ "$(q "select count(*) from workshops")" = 1 ] && [ "$(q "select count(*) from workshop_members")" = 1 ] && echo "✔ Repetirlo no duplica nada"
