-- Recuperar la cuenta cuando se pierde el móvil de la verificación en dos pasos.
--
-- Tres caminos, de más a menos fuerte:
--  1. Códigos de recuperación: 10 códigos de un solo uso que se enseñan UNA vez
--     al activar la verificación (solo se guarda su huella). Con uno, se quita
--     la verificación y la persona vuelve a activarla con su móvil nuevo.
--  2. Por correo: contraseña escrita hace menos de 15 minutos + un código que
--     llega al correo de la cuenta (lo envía Supabase Auth). Las dos cosas en la
--     misma recuperación. No vale para la administración de la plataforma.
--  3. La administración de la plataforma, desde el SQL Editor y con un motivo
--     (private.admin_reset_mfa), después de comprobar quién es.
--
-- Quitar la verificación = borrar los factores de auth.mfa_factors del usuario
-- (lo mismo que hace la API de administración de Supabase Auth). Todo queda en
-- access_events, sin códigos ni correos.

alter table public.access_events drop constraint access_events_kind_check;
alter table public.access_events add constraint access_events_kind_check check (kind in (
  'miembro_alta', 'miembro_rol', 'miembro_activo', 'miembro_inactivo',
  'invitacion_equipo_creada', 'invitacion_equipo_revocada', 'invitacion_equipo_aceptada',
  'invitacion_cliente_creada', 'invitacion_cliente_revocada', 'invitacion_cliente_aceptada',
  'cliente_vinculado', 'cliente_desvinculado',
  'soporte_abierto', 'soporte_cerrado', 'soporte_consulta',
  'dos_pasos_codigos', 'dos_pasos_recuperada_codigo', 'dos_pasos_recuperada_correo', 'dos_pasos_retirada_admin'));

-- ---------------------------------------------------------------------
-- Tablas (nadie las lee ni escribe directamente: solo las funciones)
-- ---------------------------------------------------------------------
create table public.mfa_recovery_codes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
comment on table public.mfa_recovery_codes is 'Huellas (SHA-256) de los códigos de recuperación de la verificación en dos pasos. Nunca el código.';
create index mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;

-- Intentos fallidos con códigos (límite: 5 cada 15 minutos por cuenta).
create table public.mfa_recovery_failures (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  at        timestamptz not null default now()
);
create index mfa_recovery_failures_user_idx on public.mfa_recovery_failures (user_id, at desc);
alter table public.mfa_recovery_failures enable row level security;
revoke all on public.mfa_recovery_failures from anon, authenticated;

-- Peticiones de recuperación por correo (caducan a los 15 minutos; 3 por hora).
create table public.mfa_email_recoveries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  completed_at  timestamptz
);
create index mfa_email_recoveries_user_idx on public.mfa_email_recoveries (user_id, created_at desc);
alter table public.mfa_email_recoveries enable row level security;
revoke all on public.mfa_email_recoveries from anon, authenticated;

-- ---------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------
-- Código «ABCD-EFGH-JKLM-NPQR»: 16 letras y cifras sin las que se confunden (0/O, 1/I).
create function private.new_recovery_code()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  out text := '';
begin
  -- 16 caracteres; cada uno sale de un byte distinto de dos UUID aleatorios (≈ 80 bits).
  for i in 0..15 loop
    out := out || substr(alphabet, (get_byte(bytes, i * 2 + 1) % 32) + 1, 1);
  end loop;
  return substr(out, 1, 4) || '-' || substr(out, 5, 4) || '-' || substr(out, 9, 4) || '-' || substr(out, 13, 4);
end;
$$;
revoke all on function private.new_recovery_code() from public, anon, authenticated;

-- Huella del código: igual con o sin guiones, en mayúsculas o minúsculas.
create function private.recovery_code_hash(p_code text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex'); $$;
revoke all on function private.recovery_code_hash(text) from public, anon, authenticated;

create function private.has_verified_factor(p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified'); $$;
revoke all on function private.has_verified_factor(uuid) from public, anon, authenticated;

-- ¿La sesión actual se abrió con este método hace menos de p_seconds? (claim «amr» de Supabase Auth)
create function private.session_method_since(p_methods text[], p_since timestamptz)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
     where a ->> 'method' = any (p_methods)
       and to_timestamp(coalesce((a ->> 'timestamp')::double precision, 0)) >= p_since);
$$;
revoke all on function private.session_method_since(text[], timestamptz) from public, anon, authenticated;

-- Quita la verificación en dos pasos de una cuenta y sus códigos.
create function private.remove_mfa(p_user uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from auth.mfa_factors where user_id = p_user;
  delete from public.mfa_recovery_codes where user_id = p_user;
end;
$$;
revoke all on function private.remove_mfa(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Códigos de recuperación
-- ---------------------------------------------------------------------
-- Códigos nuevos (sustituyen a los anteriores). Solo con la sesión ya verificada (aal2).
create function public.create_mfa_recovery_codes()
returns setof text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_code text;
begin
  if coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' or not private.has_verified_factor(v_uid) then
    raise exception 'Para crear códigos de recuperación hay que entrar con la verificación en dos pasos.' using errcode = '42501';
  end if;
  delete from public.mfa_recovery_codes where user_id = v_uid;
  for i in 1..10 loop
    v_code := private.new_recovery_code();
    insert into public.mfa_recovery_codes (user_id, code_hash) values (v_uid, private.recovery_code_hash(v_code));
    return next v_code;
  end loop;
  perform private.log_access(null, 'dos_pasos_codigos', v_uid, null, '{}'::jsonb);
end;
$$;
revoke all on function public.create_mfa_recovery_codes() from public, anon;
grant execute on function public.create_mfa_recovery_codes() to authenticated;

-- Cuántos códigos le quedan a la persona (sin enseñarlos).
create function public.mfa_recovery_status()
returns table (codes_left integer, codes_created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select count(*) filter (where c.used_at is null)::integer, max(c.created_at)
    from public.mfa_recovery_codes c
   where c.user_id = (select auth.uid());
$$;
revoke all on function public.mfa_recovery_status() from public, anon;
grant execute on function public.mfa_recovery_status() to authenticated;

-- Entrar con un código: quita la verificación (la persona la vuelve a activar con su móvil nuevo).
-- Devuelve {"ok":true} o {"ok":false,"reason":"incorrecto"|"demasiados"|"sin_verificacion"}.
create function public.use_mfa_recovery_code(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id bigint;
begin
  if not private.has_verified_factor(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'sin_verificacion');
  end if;
  if (select count(*) from public.mfa_recovery_failures f where f.user_id = v_uid and f.at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'demasiados');
  end if;
  select c.id into v_id from public.mfa_recovery_codes c
   where c.user_id = v_uid and c.used_at is null and c.code_hash = private.recovery_code_hash(p_code)
   for update;
  if v_id is null then
    delete from public.mfa_recovery_failures where user_id = v_uid and at < now() - interval '1 day';
    insert into public.mfa_recovery_failures (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'reason', 'incorrecto');
  end if;
  update public.mfa_recovery_codes set used_at = now() where id = v_id;
  perform private.remove_mfa(v_uid);
  delete from public.mfa_recovery_failures where user_id = v_uid;
  perform private.log_access(null, 'dos_pasos_recuperada_codigo', v_uid, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.use_mfa_recovery_code(text) from public, anon;
grant execute on function public.use_mfa_recovery_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Por correo (contraseña + código del correo)
-- ---------------------------------------------------------------------
-- Paso 1, con la sesión abierta con la CONTRASEÑA hace menos de 15 minutos.
-- Devuelve {"ok":true} o {"ok":false,"reason":"contrasena"|"administracion"|"demasiados"|"sin_verificacion"}.
-- Si ok, la web pide a Supabase Auth que envíe el código al correo de la cuenta.
create function public.start_mfa_email_recovery()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if not private.has_verified_factor(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'sin_verificacion');
  end if;
  if exists (select 1 from public.platform_admins pa where pa.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'administracion');
  end if;
  if not private.session_method_since(array['password'], now() - interval '15 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'contrasena');
  end if;
  if (select count(*) from public.mfa_email_recoveries r where r.user_id = v_uid and r.created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'demasiados');
  end if;
  insert into public.mfa_email_recoveries (user_id, expires_at) values (v_uid, now() + interval '15 minutes');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.start_mfa_email_recovery() from public, anon;
grant execute on function public.start_mfa_email_recovery() to authenticated;

-- Paso 2, con la sesión NUEVA que abre el código del correo (método «otp» o «magiclink»,
-- posterior a la petición). Quita la verificación. Devuelve {"ok":true} o {"ok":false,"reason":…}.
create function public.finish_mfa_email_recovery()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_req public.mfa_email_recoveries;
begin
  select * into v_req from public.mfa_email_recoveries r
   where r.user_id = v_uid and r.completed_at is null and r.expires_at > now()
   order by r.created_at desc limit 1
   for update;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'caducada');
  end if;
  if not private.session_method_since(array['otp', 'magiclink'], v_req.created_at - interval '5 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'correo');
  end if;
  if exists (select 1 from public.platform_admins pa where pa.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'administracion');
  end if;
  update public.mfa_email_recoveries set completed_at = now() where id = v_req.id;
  perform private.remove_mfa(v_uid);
  perform private.log_access(null, 'dos_pasos_recuperada_correo', v_uid, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.finish_mfa_email_recovery() from public, anon;
grant execute on function public.finish_mfa_email_recovery() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Administración de la plataforma (solo SQL Editor, con motivo)
-- ---------------------------------------------------------------------
create function private.admin_reset_mfa(p_email text, p_reason text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'Escribe el motivo y cómo has comprobado que es la persona (mínimo 10 caracteres).' using errcode = '22023';
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No hay ninguna cuenta con ese correo.' using errcode = 'P0002';
  end if;
  perform private.remove_mfa(v_uid);
  perform private.log_access(null, 'dos_pasos_retirada_admin', v_uid, null, jsonb_build_object('motivo', left(btrim(p_reason), 500)));
end;
$$;
revoke all on function private.admin_reset_mfa(text, text) from public, anon, authenticated, service_role;
