-- Imitación mínima de los roles y permisos que Supabase trae de serie, para
-- poder probar las migraciones en un PostgreSQL normal (sin Docker).
-- Se aplica ANTES de las migraciones de Supabase Auth. NO se usa en producción.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- El esquema "auth" (auth.users, auth.uid(), auth.jwt()…) NO se imita: lo crean
-- las migraciones oficiales de Supabase Auth (scripts/lib/supabase-auth.sh).

-- Supabase concede por defecto todo en "public" a estos roles; lo replicamos
-- para comprobar que las migraciones cierran bien los permisos.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Utilidades de prueba
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
$$;
create function tests.logout() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
$$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

create function tests.eq(p_got anyelement, p_want anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FALLO: % (obtenido: %, esperado: %)', p_msg, p_got, p_want; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Comprueba que una sentencia falla (y opcionalmente con un mensaje concreto).
create function tests.throws(p_sql text, p_msg text, p_like text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_like is not null and sqlerrm not ilike p_like then
      raise exception 'FALLO: % (falló, pero con otro error: %)', p_msg, sqlerrm;
    end if;
    raise notice 'ok - %', p_msg;
    return;
  end;
  raise exception 'FALLO: % (la sentencia no falló)', p_msg;
end $$;

-- Número de filas afectadas por una sentencia (para comprobar que RLS la ignora).
create function tests.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
