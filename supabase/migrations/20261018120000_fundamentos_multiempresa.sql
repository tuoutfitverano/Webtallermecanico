-- =====================================================================
-- Fase 0 · Fundamentos multiempresa
--
-- Idea central: TODAS las tablas con datos de un taller llevan
-- `workshop_id`. Las políticas RLS (Row Level Security) de PostgreSQL
-- deciden fila a fila quién puede ver o cambiar cada dato. Aunque alguien
-- manipule la web o llame directamente a la API, la base de datos solo le
-- devuelve lo que sus permisos permiten.
--
-- Roles:
--   · Administrador de plataforma: tabla platform_admins + 2FA obligatorio (aal2).
--   · Propietario / administrador del taller: gestionan su taller.
--   · Mecánico: trabaja con vehículos y clientes de su taller, sin gestionarlo.
--   · Cliente: NO accede a las tablas; solo a funciones "portal_*" que
--     devuelven exclusivamente sus propios datos y sin notas internas.
-- =====================================================================

-- Esquema privado para funciones auxiliares. No se publica en la API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.workshop_status as enum ('demo', 'activo', 'suspendido');
create type public.member_role as enum ('propietario', 'administrador', 'mecanico');
create type public.fuel_type as enum (
  'gasolina', 'diesel', 'hibrido', 'hibrido_enchufable', 'electrico', 'glp', 'gnc', 'hidrogeno', 'otro'
);
create type public.year_kind as enum ('fabricacion', 'primera_matriculacion');
create type public.data_source as enum ('manual', 'cliente', 'proveedor_externo');
create type public.verification_status as enum ('pendiente', 'verificado', 'rechazado');
create type public.request_kind as enum ('contacto', 'cita', 'presupuesto');
create type public.request_status as enum ('nueva', 'en_gestion', 'aceptada', 'rechazada', 'cerrada', 'spam');
create type public.contact_channel as enum ('telefono', 'whatsapp', 'email');
create type public.time_slot as enum ('manana', 'tarde', 'indiferente');

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table public.workshops (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  name        text not null check (length(btrim(name)) between 2 and 120),
  legal_name  text check (length(legal_name) <= 160),
  tax_id      text check (length(tax_id) <= 20),
  status      public.workshop_status not null default 'demo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.workshops is 'Cada taller cliente de la plataforma (un "inquilino").';

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);
comment on table public.platform_admins is 'Administradores de la plataforma. Solo se modifica con la clave secreta o desde SQL.';

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (length(full_name) <= 120),
  phone       text check (length(phone) <= 30),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.workshop_members (
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  primary key (workshop_id, user_id)
);
comment on table public.workshop_members is 'Empleados de cada taller y su rol. Una persona puede trabajar en varios talleres.';
create index workshop_members_user_idx on public.workshop_members (user_id) where active;

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  workshop_id         uuid not null references public.workshops (id) on delete cascade,
  full_name           text not null check (length(btrim(full_name)) between 2 and 120),
  phone               text check (length(phone) <= 30),
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id             uuid references auth.users (id) on delete set null,
  privacy_consent_at  timestamptz,
  marketing_consent   boolean not null default false,
  internal_notes      text check (length(internal_notes) <= 2000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  -- Permite que otras tablas exijan "cliente DEL MISMO taller" (ver vehicles).
  unique (id, workshop_id),
  unique (workshop_id, user_id)
);
comment on table public.customers is 'Clientes de cada taller. user_id enlaza con su cuenta del portal, si la tiene.';
comment on column public.customers.internal_notes is 'Solo para el personal del taller. Nunca se muestra al cliente.';
create index customers_workshop_idx on public.customers (workshop_id);
create index customers_user_idx on public.customers (user_id) where user_id is not null;

create table public.vehicles (
  id                   uuid primary key default gen_random_uuid(),
  workshop_id          uuid not null references public.workshops (id) on delete cascade,
  customer_id          uuid,
  plate                text not null check (plate ~ '^[A-Z0-9]{2,12}$'),
  make                 text not null check (length(btrim(make)) between 1 and 60),
  model                text not null check (length(btrim(model)) between 1 and 80),
  year                 smallint check (year between 1900 and 2100),
  year_kind            public.year_kind,
  fuel                 public.fuel_type,
  internal_notes       text check (length(internal_notes) <= 2000),
  data_source          public.data_source not null default 'manual',
  verification_status  public.verification_status not null default 'pendiente',
  verified_at          timestamptz,
  verified_by          uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_by           uuid default auth.uid(),
  -- Una matrícula solo puede existir una vez en cada taller.
  unique (workshop_id, plate),
  -- Si hay año, hay que decir qué año es (fabricación o 1.ª matriculación).
  check ((year is null and year_kind is null) or (year is not null and year_kind is not null)),
  -- El propietario tiene que ser un cliente del MISMO taller.
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete set null (customer_id)
);
comment on column public.vehicles.plate is 'Matrícula normalizada: solo A-Z y 0-9 (p. ej. 1950BXF).';
comment on column public.vehicles.internal_notes is 'Solo para el personal del taller. Nunca se muestra al cliente.';
create index vehicles_customer_idx on public.vehicles (customer_id) where customer_id is not null;

create table public.workshop_sites (
  workshop_id      uuid primary key references public.workshops (id) on delete cascade,
  published        boolean not null default false,
  is_demo_content  boolean not null default true,
  theme            jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object'),
  content          jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid()
);
comment on table public.workshop_sites is 'Configuración de la web pública de cada taller. Solo es visible si published = true.';
comment on column public.workshop_sites.is_demo_content is 'true = textos/datos de demostración que la web debe identificar como tales.';

create table public.workshop_domains (
  hostname     text primary key
               check (hostname = lower(hostname) and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  is_primary   boolean not null default false,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index workshop_domains_workshop_idx on public.workshop_domains (workshop_id);
create unique index workshop_domains_one_primary on public.workshop_domains (workshop_id) where is_primary;

create table public.web_requests (
  id                   uuid primary key default gen_random_uuid(),
  workshop_id          uuid not null references public.workshops (id) on delete cascade,
  kind                 public.request_kind not null,
  status               public.request_status not null default 'nueva',
  name                 text not null check (length(btrim(name)) between 2 and 120),
  phone                text check (length(phone) <= 30),
  email                text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  preferred_contact    public.contact_channel,
  plate                text check (plate ~ '^[A-Z0-9]{2,12}$'),
  vehicle              text check (length(vehicle) <= 120),
  service              text check (length(service) <= 120),
  preferred_date       date,
  preferred_time       public.time_slot,
  message              text check (length(message) <= 2000),
  privacy_accepted_at  timestamptz not null,
  source_path          text check (length(source_path) <= 300),
  created_at           timestamptz not null default now(),
  handled_by           uuid references auth.users (id) on delete set null,
  handled_at           timestamptz,
  check (phone is not null or email is not null)
);
comment on table public.web_requests is 'Solicitudes de contacto, cita o presupuesto desde la web. Una cita "nueva" NO está confirmada.';
create index web_requests_inbox_idx on public.web_requests (workshop_id, status, created_at desc);

-- ---------------------------------------------------------------------
-- Funciones auxiliares de permisos (privadas)
--
-- Son SECURITY DEFINER para poder leer workshop_members sin que las
-- políticas se llamen a sí mismas en bucle. Fijan search_path vacío para
-- que nadie pueda "colarles" objetos con el mismo nombre.
-- ---------------------------------------------------------------------
create function private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
     -- Exige que la sesión se haya verificado con segundo factor (2FA).
     and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

-- Talleres en los que el usuario actual tiene alguno de esos roles.
create function private.workshops_with_role(roles public.member_role[])
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.workshop_id
  from public.workshop_members m
  where m.user_id = (select auth.uid()) and m.active and m.role = any (roles);
$$;

create function private.staff_workshop_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select private.workshops_with_role('{propietario,administrador,mecanico}'); $$;

create function private.manager_workshop_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select private.workshops_with_role('{propietario,administrador}'); $$;

-- Operaciones de sistema: migraciones, clave secreta (service_role) o admin de plataforma.
create function private.is_privileged()
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin') or (select private.is_platform_admin());
$$;

create function private.normalize_plate(p text)
returns text
language sql immutable strict set search_path = ''
as $$ select regexp_replace(upper(p), '[^A-Z0-9]', '', 'g'); $$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Disparadores (reglas que se aplican siempre, venga de donde venga el cambio)
-- ---------------------------------------------------------------------
create function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Un dato nunca puede "mudarse" de un taller a otro.
create function private.keep_workshop_id()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.workshop_id is distinct from old.workshop_id then
    raise exception 'No se puede cambiar el taller de un registro existente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.workshops_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.slug is distinct from old.slug or new.status is distinct from old.status)
     and not private.is_privileged() then
    raise exception 'Solo la administración de la plataforma puede cambiar el identificador o el estado del taller.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.customers_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Enlazar una ficha de cliente con una cuenta de usuario le da acceso a sus
  -- datos. Se hará mediante invitación (fase del portal), no a mano.
  if (tg_op = 'INSERT' and new.user_id is not null
      or tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)
     and not private.is_privileged() then
    raise exception 'La cuenta del cliente solo se enlaza mediante invitación.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.vehicles_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.plate := private.normalize_plate(new.plate);
  new.make := btrim(new.make);
  new.model := btrim(new.model);
  new.updated_by := auth.uid();

  -- "Proveedor externo" solo lo puede poner el servidor tras una consulta real.
  if new.data_source = 'proveedor_externo'
     and (tg_op = 'INSERT' or old.data_source is distinct from new.data_source)
     and not private.is_privileged() then
    raise exception 'El origen "proveedor externo" solo lo asigna el sistema.' using errcode = '42501';
  end if;

  -- Verificar datos es tarea del propietario o administrador del taller.
  if tg_op = 'INSERT' and new.verification_status <> 'pendiente'
     or tg_op = 'UPDATE' and new.verification_status is distinct from old.verification_status then
    if not (private.is_privileged() or new.workshop_id in (select private.manager_workshop_ids())) then
      raise exception 'Solo el propietario o un administrador del taller puede verificar los datos.' using errcode = '42501';
    end if;
    if new.verification_status = 'pendiente' then
      new.verified_at := null;
      new.verified_by := null;
    else
      new.verified_at := now();
      new.verified_by := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
  end if;
  return new;
end;
$$;

create function private.web_requests_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'), 120), ''));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger workshops_updated_at before update on public.workshops for each row execute function private.set_updated_at();
create trigger workshops_guard before update on public.workshops for each row execute function private.workshops_guard();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger customers_keep_workshop before update on public.customers for each row execute function private.keep_workshop_id();
create trigger customers_guard before insert or update on public.customers for each row execute function private.customers_guard();
create trigger vehicles_updated_at before update on public.vehicles for each row execute function private.set_updated_at();
create trigger vehicles_keep_workshop before update on public.vehicles for each row execute function private.keep_workshop_id();
create trigger vehicles_guard before insert or update on public.vehicles for each row execute function private.vehicles_guard();
create trigger workshop_sites_updated_at before update on public.workshop_sites for each row execute function private.set_updated_at();
create trigger workshop_domains_keep_workshop before update on public.workshop_domains for each row execute function private.keep_workshop_id();
create trigger web_requests_keep_workshop before update on public.web_requests for each row execute function private.keep_workshop_id();
create trigger web_requests_guard before update on public.web_requests for each row execute function private.web_requests_guard();
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Permisos de tabla (qué operaciones existen) + RLS (sobre qué filas)
-- Se parte de cero: anon (visitante sin sesión) no toca ninguna tabla.
-- ---------------------------------------------------------------------
revoke all on public.workshops, public.platform_admins, public.profiles, public.workshop_members,
  public.customers, public.vehicles, public.workshop_sites, public.workshop_domains, public.web_requests
  from anon, authenticated;
grant all on public.workshops, public.platform_admins, public.profiles, public.workshop_members,
  public.customers, public.vehicles, public.workshop_sites, public.workshop_domains, public.web_requests
  to service_role;

grant select, insert, update, delete on public.workshops, public.workshop_members, public.customers,
  public.vehicles, public.workshop_sites, public.workshop_domains to authenticated;
grant select on public.platform_admins to authenticated;
grant select, update on public.profiles to authenticated;
-- En las solicitudes web el personal solo puede cambiar el estado.
grant select, delete on public.web_requests to authenticated;
grant update (status) on public.web_requests to authenticated;

alter table public.workshops enable row level security;
alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.workshop_members enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.workshop_sites enable row level security;
alter table public.workshop_domains enable row level security;
alter table public.web_requests enable row level security;

-- Talleres
create policy "workshops: lectura personal" on public.workshops for select to authenticated
  using (id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "workshops: edición gestores" on public.workshops for update to authenticated
  using (id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "workshops: alta admin" on public.workshops for insert to authenticated
  with check ((select private.is_platform_admin()));
create policy "workshops: baja admin" on public.workshops for delete to authenticated
  using ((select private.is_platform_admin()));

-- Administradores de plataforma: cada uno ve solo su propia fila.
create policy "platform_admins: propia fila" on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Perfiles
create policy "profiles: propio" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_platform_admin()));
create policy "profiles: editar propio" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Miembros: el personal ve a sus compañeros. Altas, bajas y cambios de rol
-- solo los hace la plataforma (en la fase de equipos habrá invitaciones
-- seguras para que el propietario gestione su equipo sin poder escalar).
create policy "members: lectura personal" on public.workshop_members for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "members: gestión admin" on public.workshop_members for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

-- Clientes del taller
create policy "customers: lectura personal" on public.customers for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "customers: alta personal" on public.customers for insert to authenticated
  with check (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "customers: edición personal" on public.customers for update to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "customers: borrado gestores" on public.customers for delete to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- Vehículos
create policy "vehicles: lectura personal" on public.vehicles for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "vehicles: alta personal" on public.vehicles for insert to authenticated
  with check (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "vehicles: edición personal" on public.vehicles for update to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "vehicles: borrado gestores" on public.vehicles for delete to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- Web pública: el personal la ve; los gestores la editan; alta/baja y dominios, la plataforma.
create policy "sites: lectura personal" on public.workshop_sites for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "sites: edición gestores" on public.workshop_sites for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "sites: alta y baja admin" on public.workshop_sites for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

create policy "domains: lectura personal" on public.workshop_domains for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "domains: gestión admin" on public.workshop_domains for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

-- Solicitudes web: solo propietario/administrador (contienen datos personales).
create policy "requests: lectura gestores" on public.web_requests for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "requests: estado gestores" on public.web_requests for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "requests: borrado gestores" on public.web_requests for delete to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- API pública y del portal (funciones con salida controlada)
-- ---------------------------------------------------------------------

-- Datos para pintar la web de un taller a partir del dominio.
-- Solo responde si el dominio está verificado y la web publicada.
create function public.get_public_site(p_hostname text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'workshop', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'site', jsonb_build_object('is_demo_content', s.is_demo_content, 'theme', s.theme, 'content', s.content)
  )
  from public.workshop_domains d
  join public.workshops w on w.id = d.workshop_id
  join public.workshop_sites s on s.workshop_id = w.id
  where d.hostname = lower(btrim(p_hostname))
    and d.verified_at is not null
    and s.published
    and w.status <> 'suspendido';
$$;

-- Registrar una solicitud desde la web. Solo la llama el servidor (clave
-- secreta) DESPUÉS de comprobar el antispam; el navegador nunca escribe directamente.
create function public.submit_web_request(
  p_workshop_id uuid,
  p_kind public.request_kind,
  p_name text,
  p_phone text,
  p_email text,
  p_preferred_contact public.contact_channel,
  p_plate text,
  p_vehicle text,
  p_service text,
  p_preferred_date date,
  p_preferred_time public.time_slot,
  p_message text,
  p_privacy_accepted boolean,
  p_source_path text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_plate text := nullif(private.normalize_plate(coalesce(p_plate, '')), '');
  v_id uuid;
begin
  if not coalesce(p_privacy_accepted, false) then
    raise exception 'Es necesario aceptar la política de privacidad.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workshop_sites s join public.workshops w on w.id = s.workshop_id
    where s.workshop_id = p_workshop_id and s.published and w.status <> 'suspendido'
  ) then
    raise exception 'Taller no disponible.' using errcode = '22023';
  end if;
  if p_preferred_date is not null and p_preferred_date < current_date then
    raise exception 'La fecha preferida no puede estar en el pasado.' using errcode = '22023';
  end if;
  if v_plate is not null and length(v_plate) not between 2 and 12 then
    v_plate := null;
  end if;

  insert into public.web_requests (
    workshop_id, kind, status, name, phone, email, preferred_contact, plate, vehicle, service,
    preferred_date, preferred_time, message, privacy_accepted_at, source_path
  ) values (
    p_workshop_id, p_kind, 'nueva', btrim(p_name), nullif(btrim(p_phone), ''), nullif(lower(btrim(p_email)), ''),
    p_preferred_contact, v_plate, nullif(btrim(p_vehicle), ''), nullif(btrim(p_service), ''),
    p_preferred_date, p_preferred_time, nullif(btrim(p_message), ''), now(), p_source_path
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Portal del cliente: sus talleres.
create function public.portal_my_workshops()
returns table (workshop_id uuid, workshop_name text, customer_id uuid, customer_name text)
language sql stable security definer set search_path = ''
as $$
  select w.id, w.name, c.id, c.full_name
  from public.customers c
  join public.workshops w on w.id = c.workshop_id
  where c.user_id = (select auth.uid()) and w.status <> 'suspendido';
$$;

-- Portal del cliente: sus vehículos, sin notas internas.
create function public.portal_my_vehicles()
returns table (
  id uuid, workshop_id uuid, plate text, make text, model text,
  year smallint, year_kind public.year_kind, fuel public.fuel_type
)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.workshop_id, v.plate, v.make, v.model, v.year, v.year_kind, v.fuel
  from public.vehicles v
  join public.customers c on c.id = v.customer_id and c.workshop_id = v.workshop_id
  join public.workshops w on w.id = v.workshop_id
  where c.user_id = (select auth.uid()) and w.status <> 'suspendido'
  order by v.plate;
$$;

-- PostgreSQL deja ejecutar funciones a cualquiera por defecto: lo cerramos
-- y abrimos solo lo necesario.
revoke all on function public.get_public_site(text) from public, anon, authenticated;
revoke all on function public.submit_web_request(uuid, public.request_kind, text, text, text, public.contact_channel, text, text, text, date, public.time_slot, text, boolean, text) from public, anon, authenticated;
revoke all on function public.portal_my_workshops() from public, anon, authenticated;
revoke all on function public.portal_my_vehicles() from public, anon, authenticated;

grant execute on function public.get_public_site(text) to anon, authenticated, service_role;
grant execute on function public.submit_web_request(uuid, public.request_kind, text, text, text, public.contact_channel, text, text, text, date, public.time_slot, text, boolean, text) to service_role;
grant execute on function public.portal_my_workshops() to authenticated, service_role;
grant execute on function public.portal_my_vehicles() to authenticated, service_role;
