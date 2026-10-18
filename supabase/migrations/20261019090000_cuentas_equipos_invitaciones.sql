-- =====================================================================
-- Fase 3 · Cuentas, equipos e invitaciones
--
-- Se apoya en lo que ya existe desde la Fase 0 (workshops, profiles,
-- workshop_members, platform_admins y sus políticas RLS) y SOLO añade:
--
--   · Datos de cuenta del taller: logotipo y contacto.
--   · Perfiles: el usuario solo puede editar su nombre y su teléfono.
--   · Membresías: cada persona ve su propia fila; nadie las cambia
--     directamente salvo la plataforma. El equipo se gestiona con funciones
--     que comprueban quién llama y qué rol tiene.
--   · Invitaciones: un propietario o administrador invita por correo; la
--     persona invitada acepta con su cuenta (correo confirmado y que
--     coincida). Nunca se puede invitar a alguien como propietario.
--   · Alta controlada de talleres: una función privada que solo puede
--     ejecutar el superusuario (SQL Editor de Supabase o migraciones).
--
-- Roles del taller (enum member_role, valores en español por convención):
--   propietario   = owner    · administrador = manager    · mecanico = mechanic
--
-- No borra ni reescribe datos existentes: solo añade columnas, tablas,
-- funciones y permisos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Talleres: logotipo y contacto de la cuenta
--    (los datos de contacto que se publican en la web siguen en
--    workshop_sites.content; estos son los de la cuenta del taller)
-- ---------------------------------------------------------------------
alter table public.workshops
  add column logo_url      text check (logo_url is null or (logo_url ~ '^https://' and length(logo_url) <= 500)),
  add column contact_email text check (contact_email is null
                                       or (length(contact_email) <= 254 and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column contact_phone text check (length(contact_phone) <= 30);
comment on column public.workshops.logo_url is 'Logotipo (dirección https). Opcional.';
comment on column public.workshops.contact_email is 'Correo de contacto de la cuenta del taller (no se publica en la web).';

-- ---------------------------------------------------------------------
-- 2. Perfiles: solo nombre y teléfono son editables por su dueño
-- ---------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 3. Membresías
-- ---------------------------------------------------------------------
alter table public.workshop_members
  add column updated_at timestamptz not null default now();
create trigger workshop_members_updated_at before update on public.workshop_members
  for each row execute function private.set_updated_at();

-- Una membresía nunca cambia de persona ni de taller (se crea otra).
create function private.workshop_members_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.workshop_id is distinct from old.workshop_id then
    raise exception 'Una membresía no puede cambiar de persona ni de taller.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.workshop_members_guard() from public, anon, authenticated;
create trigger workshop_members_guard before update on public.workshop_members
  for each row execute function private.workshop_members_guard();

-- Cada persona puede ver sus propias membresías (también las desactivadas).
create policy "members: propia fila" on public.workshop_members for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 4. Invitaciones
-- ---------------------------------------------------------------------
create type public.invitation_status as enum ('pendiente', 'aceptada', 'revocada');

create table public.workshop_invitations (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and length(email) <= 254
                                    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Nunca se invita como propietario: eso solo lo hace la plataforma.
  role         public.member_role not null check (role <> 'propietario'),
  -- Solo se guarda la huella (SHA-256) del código; el código en claro se
  -- muestra una única vez a quien invita.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status       public.invitation_status not null default 'pendiente',
  expires_at   timestamptz not null default now() + interval '7 days',
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_by  uuid references auth.users (id) on delete set null,
  accepted_at  timestamptz,
  revoked_by   uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz
);
comment on table public.workshop_invitations is 'Invitaciones para unirse al equipo de un taller. Se crean y aceptan solo mediante funciones.';
-- Como mucho una invitación pendiente por persona y taller.
create unique index workshop_invitations_one_pending on public.workshop_invitations (workshop_id, email)
  where status = 'pendiente';
create index workshop_invitations_workshop_idx on public.workshop_invitations (workshop_id, created_at desc);

revoke all on public.workshop_invitations from anon, authenticated;
grant all on public.workshop_invitations to service_role;
-- Lectura sin la huella del código.
grant select (id, workshop_id, email, role, status, expires_at, invited_by, created_at, accepted_by, accepted_at, revoked_at)
  on public.workshop_invitations to authenticated;
alter table public.workshop_invitations enable row level security;
create policy "invitations: lectura gestores" on public.workshop_invitations for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- 5. Funciones auxiliares (privadas)
-- ---------------------------------------------------------------------
create function private.require_user()
returns uuid language plpgsql stable set search_path = ''
as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Necesitas iniciar sesión.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- Rol activo de la persona que llama en un taller (null si no es miembro).
create function private.my_role_in(p_workshop_id uuid)
returns public.member_role language sql stable security definer set search_path = ''
as $$
  select m.role from public.workshop_members m
  where m.workshop_id = p_workshop_id and m.user_id = (select auth.uid()) and m.active;
$$;

create function private.invitation_token_hash(p_token text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex'); $$;

-- "ana.garcia@correo.es" -> "a***@correo.es"
create function private.mask_email(p_email text)
returns text language sql immutable set search_path = ''
as $$ select left(p_email, 1) || '***' || substr(p_email, strpos(p_email, '@')); $$;

revoke all on function private.require_user() from public, anon, authenticated;
revoke all on function private.my_role_in(uuid) from public, anon, authenticated;
revoke all on function private.invitation_token_hash(text) from public, anon, authenticated;
revoke all on function private.mask_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. API del equipo (funciones con comprobación de identidad y rol)
--
-- Reglas:
--   · Propietario: invita administradores y mecánicos; cambia el rol entre
--     administrador y mecánico; desactiva/reactiva a cualquiera que no sea
--     propietario.
--   · Administrador: invita mecánicos y desactiva/reactiva mecánicos.
--   · Mecánico: no gestiona el equipo.
--   · Nadie se cambia a sí mismo ni toca a un propietario (eso, la plataforma).
-- ---------------------------------------------------------------------

-- Talleres de la persona que llama, con su rol.
create function public.my_workshops()
returns table (workshop_id uuid, name text, slug text, status public.workshop_status, role public.member_role, logo_url text)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, w.slug, w.status, m.role, w.logo_url
  from public.workshop_members m
  join public.workshops w on w.id = m.workshop_id
  where m.user_id = (select auth.uid()) and m.active
  order by w.name;
$$;

-- Equipo de un taller. El correo solo lo ven propietarios y administradores.
create function public.workshop_team(p_workshop_id uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.member_role;
  v_admin boolean := private.is_platform_admin();
begin
  perform private.require_user();
  v_role := private.my_role_in(p_workshop_id);
  if v_role is null and not v_admin then
    raise exception 'No tienes acceso a este taller.' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.full_name,
           case when v_admin or v_role in ('propietario', 'administrador') then u.email::text end,
           m.role, m.active, m.created_at
    from public.workshop_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.workshop_id = p_workshop_id
      -- Los mecánicos solo ven a los compañeros activos.
      and (m.active or v_admin or v_role in ('propietario', 'administrador'))
    order by m.role, p.full_name nulls last;
end;
$$;

-- Crea una invitación y devuelve el código UNA sola vez.
create function public.create_workshop_invitation(p_workshop_id uuid, p_email text, p_role public.member_role)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role  public.member_role := private.my_role_in(p_workshop_id);
  v_admin boolean := private.is_platform_admin();
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  -- Mismo mensaje si el taller no existe o si no tienes permiso: no se revela nada.
  -- OJO: v_role es NULL si no es miembro. "IS NOT DISTINCT FROM" trata NULL
  -- como "no coincide"; con "=" la condición sería NULL y el IF no saltaría.
  if not (v_admin or v_role is not distinct from 'propietario'
          or (v_role is not distinct from 'administrador' and p_role is not distinct from 'mecanico')) then
    raise exception 'No tienes permiso para invitar con ese rol en este taller.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'propietario' then
    raise exception 'Solo la plataforma puede asignar propietarios.' using errcode = '42501';
  end if;
  if length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo electrónico no es válido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.workshops w where w.id = p_workshop_id and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.workshop_members m join auth.users u on u.id = m.user_id
    where m.workshop_id = p_workshop_id and m.active and lower(u.email) = v_email
  ) then
    raise exception 'Esa persona ya forma parte del equipo.' using errcode = '23505';
  end if;
  if (select count(*) from public.workshop_invitations i
      where i.workshop_id = p_workshop_id and i.created_at > now() - interval '1 day') >= 50 then
    raise exception 'Demasiadas invitaciones hoy. Inténtalo mañana.' using errcode = 'PT429';
  end if;

  -- Una invitación nueva sustituye a la pendiente anterior para el mismo correo.
  update public.workshop_invitations i
     set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where i.workshop_id = p_workshop_id and i.email = v_email and i.status = 'pendiente';

  -- 2 × 122 bits aleatorios (gen_random_uuid usa el generador seguro de PostgreSQL).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.workshop_invitations (workshop_id, email, role, token_hash, invited_by)
  values (p_workshop_id, v_email, p_role, private.invitation_token_hash(v_token), v_uid)
  returning id, workshop_invitations.expires_at into v_id, v_exp;

  return query select v_id, v_token, v_exp;
end;
$$;

create function public.revoke_workshop_invitation(p_invitation_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_inv  public.workshop_invitations;
  v_role public.member_role;
begin
  select * into v_inv from public.workshop_invitations i where i.id = p_invitation_id for update;
  v_role := private.my_role_in(v_inv.workshop_id);
  if v_inv.id is null
     or not (private.is_platform_admin() or v_role is not distinct from 'propietario'
             or (v_role is not distinct from 'administrador' and v_inv.role = 'mecanico')) then
    raise exception 'Invitación no encontrada.' using errcode = '42501';
  end if;
  if v_inv.status <> 'pendiente' then
    raise exception 'La invitación ya no está pendiente.' using errcode = '22023';
  end if;
  update public.workshop_invitations
     set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where id = v_inv.id;
end;
$$;

-- Datos de una invitación a partir de su código, para la pantalla de aceptar.
-- Solo para personas con sesión iniciada y sin revelar el correo completo.
create function public.get_workshop_invitation(p_token text)
returns table (workshop_name text, role public.member_role, email_hint text, email_matches boolean,
               expires_at timestamptz, state text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  return query
    select w.name, i.role, private.mask_email(i.email), i.email = v_email, i.expires_at,
           case
             when i.status = 'aceptada' then 'aceptada'
             when i.status = 'revocada' then 'revocada'
             when i.expires_at <= now() then 'caducada'
             when w.status = 'suspendido' then 'taller_suspendido'
             else 'pendiente'
           end
    from public.workshop_invitations i
    join public.workshops w on w.id = i.workshop_id
    where i.token_hash = private.invitation_token_hash(p_token);
end;
$$;

-- Aceptar: la base de datos decide el taller y el rol a partir del código;
-- el navegador no puede elegirlos.
create function public.accept_workshop_invitation(p_token text)
returns table (workshop_id uuid, role public.member_role)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_user();
  v_user     record;
  v_inv      public.workshop_invitations;
  v_existing public.workshop_members;
begin
  select u.email, u.email_confirmed_at, u.is_anonymous into v_user from auth.users u where u.id = v_uid;
  if v_user.email is null or coalesce(v_user.is_anonymous, false) then
    raise exception 'Necesitas una cuenta con correo electrónico.' using errcode = '42501';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'Confirma tu correo electrónico antes de aceptar la invitación.' using errcode = '42501';
  end if;

  select * into v_inv from public.workshop_invitations i
   where i.token_hash = private.invitation_token_hash(p_token) for update;
  if v_inv.id is null then
    raise exception 'La invitación no es válida.' using errcode = '22023';
  end if;
  if v_inv.status <> 'pendiente' then
    raise exception 'Esta invitación ya se ha usado o se ha anulado.' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'La invitación ha caducado. Pide una nueva.' using errcode = '22023';
  end if;
  if lower(v_user.email) <> v_inv.email then
    raise exception 'Esta invitación es para otra dirección de correo.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workshops w where w.id = v_inv.workshop_id and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '22023';
  end if;

  select * into v_existing from public.workshop_members m
   where m.workshop_id = v_inv.workshop_id and m.user_id = v_uid for update;
  if v_existing.user_id is not null and v_existing.active then
    raise exception 'Ya formas parte de este taller.' using errcode = '23505';
  elsif v_existing.user_id is not null then
    update public.workshop_members m set role = v_inv.role, active = true
     where m.workshop_id = v_inv.workshop_id and m.user_id = v_uid;
  else
    insert into public.workshop_members (workshop_id, user_id, role, created_by)
    values (v_inv.workshop_id, v_uid, v_inv.role, v_inv.invited_by);
  end if;

  update public.workshop_invitations
     set status = 'aceptada', accepted_by = v_uid, accepted_at = now()
   where id = v_inv.id;

  return query select v_inv.workshop_id, v_inv.role;
end;
$$;

create function public.set_member_role(p_workshop_id uuid, p_user_id uuid, p_role public.member_role)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_role   public.member_role := private.my_role_in(p_workshop_id);
  v_target public.workshop_members;
begin
  if not (v_role is not distinct from 'propietario' or private.is_platform_admin()) then
    raise exception 'Solo el propietario puede cambiar roles.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'No puedes cambiar tu propio rol.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'propietario' then
    raise exception 'Solo la plataforma puede asignar propietarios.' using errcode = '42501';
  end if;
  select * into v_target from public.workshop_members m
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id for update;
  if v_target.user_id is null then
    raise exception 'Esa persona no pertenece al taller.' using errcode = '22023';
  end if;
  if v_target.role = 'propietario' then
    raise exception 'El rol de un propietario solo lo cambia la plataforma.' using errcode = '42501';
  end if;
  update public.workshop_members m set role = p_role
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id;
end;
$$;

create function public.set_member_active(p_workshop_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_role   public.member_role := private.my_role_in(p_workshop_id);
  v_admin  boolean := private.is_platform_admin();
  v_target public.workshop_members;
begin
  if (v_role is null or v_role = 'mecanico') and not v_admin then
    raise exception 'No tienes permiso para gestionar el equipo de este taller.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'No puedes desactivarte ni reactivarte a ti mismo.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Falta indicar si la persona queda activa.' using errcode = '22023';
  end if;
  select * into v_target from public.workshop_members m
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id for update;
  if v_target.user_id is null then
    raise exception 'Esa persona no pertenece al taller.' using errcode = '22023';
  end if;
  if not v_admin and (v_target.role = 'propietario' or (v_role = 'administrador' and v_target.role <> 'mecanico')) then
    raise exception 'No tienes permiso para gestionar a esta persona.' using errcode = '42501';
  end if;
  update public.workshop_members m set active = p_active
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id;
end;
$$;

revoke all on function public.my_workshops() from public, anon, authenticated;
revoke all on function public.workshop_team(uuid) from public, anon, authenticated;
revoke all on function public.create_workshop_invitation(uuid, text, public.member_role) from public, anon, authenticated;
revoke all on function public.revoke_workshop_invitation(uuid) from public, anon, authenticated;
revoke all on function public.get_workshop_invitation(text) from public, anon, authenticated;
revoke all on function public.accept_workshop_invitation(text) from public, anon, authenticated;
revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public, anon, authenticated;
revoke all on function public.set_member_active(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.my_workshops() to authenticated, service_role;
grant execute on function public.workshop_team(uuid) to authenticated, service_role;
grant execute on function public.create_workshop_invitation(uuid, text, public.member_role) to authenticated, service_role;
grant execute on function public.revoke_workshop_invitation(uuid) to authenticated, service_role;
grant execute on function public.get_workshop_invitation(text) to authenticated, service_role;
grant execute on function public.accept_workshop_invitation(text) to authenticated, service_role;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated, service_role;
grant execute on function public.set_member_active(uuid, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Alta controlada de talleres (solo superusuario)
--
-- Se ejecuta desde el SQL Editor de Supabase (que trabaja como "postgres").
-- Ningún rol de la API (anon, authenticated, service_role) puede llamarla.
-- La persona propietaria debe haberse registrado y confirmado su correo.
-- ---------------------------------------------------------------------
create function private.create_workshop(
  p_slug text,
  p_name text,
  p_owner_email text,
  p_status public.workshop_status default 'activo'
)
returns uuid
language plpgsql volatile set search_path = ''
as $$
declare
  v_owner uuid;
  v_id    uuid;
begin
  select u.id into v_owner from auth.users u
   where lower(u.email) = lower(btrim(p_owner_email)) and u.email_confirmed_at is not null
     and not coalesce(u.is_anonymous, false);
  if v_owner is null then
    raise exception 'No hay ninguna cuenta con el correo % y el correo confirmado. Regístrate primero en /registro.', p_owner_email
      using errcode = '22023';
  end if;
  insert into public.workshops (slug, name, status) values (lower(btrim(p_slug)), btrim(p_name), p_status)
  returning id into v_id;
  -- La web nace sin publicar y sin contenido de demostración.
  insert into public.workshop_sites (workshop_id, published, is_demo_content) values (v_id, false, false);
  insert into public.workshop_members (workshop_id, user_id, role, created_by) values (v_id, v_owner, 'propietario', null);
  return v_id;
end;
$$;

-- Añadir (o devolver) la propiedad de un taller existente a otra cuenta.
create function private.add_workshop_owner(p_workshop_id uuid, p_owner_email text)
returns void
language plpgsql volatile set search_path = ''
as $$
declare v_owner uuid;
begin
  select u.id into v_owner from auth.users u
   where lower(u.email) = lower(btrim(p_owner_email)) and u.email_confirmed_at is not null
     and not coalesce(u.is_anonymous, false);
  if v_owner is null then
    raise exception 'No hay ninguna cuenta con el correo % y el correo confirmado.', p_owner_email using errcode = '22023';
  end if;
  insert into public.workshop_members (workshop_id, user_id, role, created_by)
  values (p_workshop_id, v_owner, 'propietario', null)
  on conflict (workshop_id, user_id) do update set role = 'propietario', active = true;
end;
$$;

revoke all on function private.create_workshop(text, text, text, public.workshop_status) from public, anon, authenticated, service_role;
revoke all on function private.add_workshop_owner(uuid, text) from public, anon, authenticated, service_role;
