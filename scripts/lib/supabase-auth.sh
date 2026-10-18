# Funciones compartidas para preparar el esquema "auth" REAL de Supabase
# en un PostgreSQL normal (sin Docker). Se carga con `source`.
#
# Descarga el servidor oficial de Supabase Auth (GoTrue) en .cache/auth y
# ejecuta sus propias migraciones: así las pruebas usan las mismas tablas
# (auth.users, sesiones…) y funciones (auth.uid(), auth.jwt()) que Supabase.
#
# Requiere que el script que lo carga defina ROOT y PSQL (array con psql).

AUTH_VERSION="${AUTH_VERSION:-v2.190.0}"
AUTH_ADMIN_PASS="${AUTH_ADMIN_PASS:-auth-admin-solo-pruebas}"

auth_bin() {
  if [ -n "${AUTH_BIN:-}" ]; then echo "$AUTH_BIN"; return; fi
  local dir="$ROOT/.cache/auth"
  if [ ! -x "$dir/auth" ] || [ "$(cat "$dir/.version" 2>/dev/null)" != "$AUTH_VERSION" ]; then
    echo "▸ Descargando Supabase Auth $AUTH_VERSION en .cache/" >&2
    rm -rf "$dir" && mkdir -p "$dir"
    curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar xz -C "$dir"
    echo "$AUTH_VERSION" > "$dir/.version"
  fi
  echo "$dir/auth"
}

# auth_db_url DB → cadena de conexión del usuario que usa el servidor de Auth.
auth_db_url() {
  echo "postgres://supabase_auth_admin:$AUTH_ADMIN_PASS@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$1?search_path=auth"
}

# auth_migrate DB → crea el esquema auth con las migraciones oficiales.
auth_migrate() {
  local db="$1" bin
  bin="$(auth_bin)"
  "${PSQL[@]}" -d postgres >/dev/null <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login createrole password '$AUTH_ADMIN_PASS';
  else
    alter role supabase_auth_admin login password '$AUTH_ADMIN_PASS';
  end if;
end \$\$;
SQL
  "${PSQL[@]}" -d "$db" >/dev/null <<SQL
create schema if not exists auth authorization supabase_auth_admin;
grant create on database "$db" to supabase_auth_admin;
SQL
  (cd "$(dirname "$bin")" && \
    GOTRUE_DB_DRIVER=postgres DATABASE_URL="$(auth_db_url "$db")" GOTRUE_DB_MIGRATIONS_PATH=./migrations \
    API_EXTERNAL_URL=http://127.0.0.1:9999 GOTRUE_SITE_URL=http://localhost \
    GOTRUE_JWT_SECRET=solo-para-migrar-0123456789abcdef0123456789 \
    "$bin" migrate >/dev/null 2>"$ROOT/.cache/auth/migrate.log") || {
      echo "✘ No se pudieron aplicar las migraciones de Supabase Auth:" >&2
      tail -20 "$ROOT/.cache/auth/migrate.log" >&2
      return 1
    }
  # Lo que Supabase concede de serie sobre el esquema auth.
  "${PSQL[@]}" -d "$db" >/dev/null <<SQL
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
SQL
}
