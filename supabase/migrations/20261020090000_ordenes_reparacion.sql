-- =====================================================================
-- Fase 4 · Órdenes de reparación e historial
--
-- Se apoya en lo existente (workshops, workshop_members, customers,
-- vehicles) y SOLO añade:
--
--   · repair_orders: la orden de trabajo. Vehículo, cliente y mecánico
--     asignado tienen que ser DEL MISMO TALLER: lo garantizan claves
--     foráneas compuestas (id, workshop_id), no la interfaz.
--   · repair_order_events: historial de cambios. Solo lo escriben los
--     disparadores de la base de datos; nadie lo puede editar desde la API.
--   · Funciones de búsqueda y resumen con los permisos de quien llama
--     (security invoker: RLS se aplica igual que en una consulta normal).
--
-- Permisos:
--   · Propietario y administrador: ven, crean y modifican todas las órdenes
--     de su taller.
--   · Mecánico: ve SOLO las órdenes asignadas a él; en ellas puede cambiar
--     el estado (menos "entregado"), la diagnosis, el trabajo realizado y
--     las notas internas. No reasigna, no cambia vehículo ni cliente.
--   · Nadie borra órdenes desde la API (se conserva el historial).
--
-- No borra ni modifica datos existentes.
-- =====================================================================

create type public.repair_status as enum (
  'recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado'
);
create type public.repair_event_kind as enum ('creada', 'estado', 'asignacion', 'datos');

-- Permite exigir "vehículo DEL MISMO taller" desde otras tablas (como ya
-- existía para clientes). No cambia ningún dato: el id ya era único.
alter table public.vehicles add constraint vehicles_id_workshop_key unique (id, workshop_id);

-- ---------------------------------------------------------------------
-- Numeración correlativa por taller (OR-1, OR-2…). Solo la usan los disparadores.
-- ---------------------------------------------------------------------
create table public.workshop_counters (
  workshop_id        uuid primary key references public.workshops (id) on delete cascade,
  last_order_number  integer not null default 0 check (last_order_number >= 0)
);
revoke all on public.workshop_counters from anon, authenticated;
grant all on public.workshop_counters to service_role;
alter table public.workshop_counters enable row level security;

-- ---------------------------------------------------------------------
-- Órdenes de reparación
-- ---------------------------------------------------------------------
create table public.repair_orders (
  id                   uuid primary key default gen_random_uuid(),
  workshop_id          uuid not null references public.workshops (id) on delete cascade,
  number               integer not null check (number > 0),
  vehicle_id           uuid not null,
  customer_id          uuid not null,
  assigned_to          uuid,
  status               public.repair_status not null default 'recibido',
  received_at          timestamptz not null default now(),
  -- Lo que se podrá enseñar al cliente en su portal (fase posterior):
  problem_description  text not null check (length(btrim(problem_description)) between 3 and 4000),
  diagnosis            text check (length(diagnosis) <= 4000),
  work_done            text check (length(work_done) <= 4000),
  -- Solo para el personal del taller. Nunca se muestra al cliente.
  internal_notes       text check (length(internal_notes) <= 4000),
  status_changed_at    timestamptz not null default now(),
  delivered_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by           uuid default auth.uid() references auth.users (id) on delete set null,
  unique (workshop_id, number),
  -- Vehículo, cliente y mecánico: siempre del mismo taller que la orden.
  -- NO ACTION: no se puede borrar un vehículo o cliente con órdenes (se conserva el historial).
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id),
  -- Desactivar a un empleado NO borra su membresía: la orden conserva quién la llevaba.
  foreign key (workshop_id, assigned_to) references public.workshop_members (workshop_id, user_id)
    on delete set null (assigned_to)
);
comment on table public.repair_orders is 'Órdenes de reparación. Vehículo, cliente y mecánico siempre del mismo taller.';
comment on column public.repair_orders.internal_notes is 'Solo para el personal del taller. Nunca se muestra al cliente.';
create index repair_orders_board_idx on public.repair_orders (workshop_id, status, updated_at desc);
create index repair_orders_assignee_idx on public.repair_orders (workshop_id, assigned_to) where assigned_to is not null;
create index repair_orders_vehicle_idx on public.repair_orders (vehicle_id);
create index repair_orders_customer_idx on public.repair_orders (customer_id);

-- ---------------------------------------------------------------------
-- Historial (solo lo escriben los disparadores)
-- ---------------------------------------------------------------------
create table public.repair_order_events (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.repair_orders (id) on delete cascade,
  workshop_id     uuid not null references public.workshops (id) on delete cascade,
  kind            public.repair_event_kind not null,
  from_status     public.repair_status,
  to_status       public.repair_status,
  from_assignee   uuid,
  to_assignee     uuid,
  changed_fields  text[],
  actor           uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
comment on table public.repair_order_events is 'Historial de cada orden: quién cambió qué y cuándo. Solo lo escribe la base de datos.';
create index repair_order_events_order_idx on public.repair_order_events (order_id, id);

-- ---------------------------------------------------------------------
-- Funciones auxiliares (privadas)
-- ---------------------------------------------------------------------
create function private.next_order_number(p_workshop_id uuid)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare v integer;
begin
  insert into public.workshop_counters (workshop_id, last_order_number) values (p_workshop_id, 1)
  on conflict (workshop_id) do update set last_order_number = public.workshop_counters.last_order_number + 1
  returning last_order_number into v;
  return v;
end;
$$;

create function private.is_active_member(p_workshop_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.workshop_members m
                 where m.workshop_id = p_workshop_id and m.user_id = p_user_id and m.active);
$$;

-- OJO: SECURITY INVOKER a propósito. is_privileged() mira el usuario actual de
-- PostgreSQL; dentro de una función SECURITY DEFINER ese usuario sería el dueño
-- (postgres) y diría que TODO el mundo es gestor.
create function private.can_manage(p_workshop_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select private.is_privileged() or p_workshop_id in (select private.manager_workshop_ids());
$$;

-- Reglas que se aplican SIEMPRE, venga el cambio de donde venga.
create function private.repair_orders_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_manager boolean := private.can_manage(new.workshop_id);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_order_number(new.workshop_id);
    new.created_by := auth.uid();
    new.created_at := now();
    new.status_changed_at := now();
    new.delivered_at := case when new.status = 'entregado' then now() end;
  else
    -- Campos de sistema: no se tocan.
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;

    if not v_manager then
      if new.vehicle_id is distinct from old.vehicle_id or new.customer_id is distinct from old.customer_id
         or new.assigned_to is distinct from old.assigned_to or new.received_at is distinct from old.received_at
         or new.problem_description is distinct from old.problem_description then
        raise exception 'Solo el propietario o un administrador puede cambiar el vehículo, el cliente, la asignación o la descripción.'
          using errcode = '42501';
      end if;
      if new.status = 'entregado' and old.status is distinct from 'entregado' then
        raise exception 'Solo el propietario o un administrador puede marcar una orden como entregada.' using errcode = '42501';
      end if;
    end if;

    if new.status is distinct from old.status then
      new.status_changed_at := now();
      new.delivered_at := case when new.status = 'entregado' then now() end;
    else
      new.status_changed_at := old.status_changed_at;
      new.delivered_at := old.delivered_at;
    end if;
  end if;

  new.updated_by := auth.uid();
  new.problem_description := btrim(new.problem_description);
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.work_done := nullif(btrim(new.work_done), '');
  new.internal_notes := nullif(btrim(new.internal_notes), '');

  -- Solo se asigna a personas ACTIVAS del taller (la clave foránea ya exige que sean del taller).
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not private.is_active_member(new.workshop_id, new.assigned_to) then
    raise exception 'La persona asignada no pertenece al equipo activo de este taller.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create function private.repair_orders_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.repair_order_events (order_id, workshop_id, kind, to_status, to_assignee, actor)
    values (new.id, new.workshop_id, 'creada', new.status, new.assigned_to, auth.uid());
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.repair_order_events (order_id, workshop_id, kind, from_status, to_status, actor)
    values (new.id, new.workshop_id, 'estado', old.status, new.status, auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.repair_order_events (order_id, workshop_id, kind, from_assignee, to_assignee, actor)
    values (new.id, new.workshop_id, 'asignacion', old.assigned_to, new.assigned_to, auth.uid());
  end if;
  if new.problem_description is distinct from old.problem_description then v_fields := array_append(v_fields, 'problem_description'); end if;
  if new.diagnosis is distinct from old.diagnosis then v_fields := array_append(v_fields, 'diagnosis'); end if;
  if new.work_done is distinct from old.work_done then v_fields := array_append(v_fields, 'work_done'); end if;
  if new.internal_notes is distinct from old.internal_notes then v_fields := array_append(v_fields, 'internal_notes'); end if;
  if new.vehicle_id is distinct from old.vehicle_id then v_fields := array_append(v_fields, 'vehicle_id'); end if;
  if new.customer_id is distinct from old.customer_id then v_fields := array_append(v_fields, 'customer_id'); end if;
  if new.received_at is distinct from old.received_at then v_fields := array_append(v_fields, 'received_at'); end if;
  if cardinality(v_fields) > 0 then
    insert into public.repair_order_events (order_id, workshop_id, kind, changed_fields, actor)
    values (new.id, new.workshop_id, 'datos', v_fields, auth.uid());
  end if;
  return null;
end;
$$;

-- El historial no se reescribe nunca (ni siquiera con la clave secreta).
create function private.repair_order_events_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'El historial de una orden no se puede modificar.' using errcode = '42501';
end;
$$;

-- El disparador (que se ejecuta con los permisos de quien escribe) la necesita;
-- el esquema private no está publicado en la API.
revoke all on function private.next_order_number(uuid) from public, anon;
grant execute on function private.next_order_number(uuid) to authenticated, service_role;
revoke all on function private.repair_orders_guard() from public, anon, authenticated;
revoke all on function private.repair_orders_history() from public, anon, authenticated;
revoke all on function private.repair_order_events_immutable() from public, anon, authenticated;
-- Estas dos se usan dentro de políticas y disparadores con los permisos de quien llama.
revoke all on function private.is_active_member(uuid, uuid) from public, anon;
revoke all on function private.can_manage(uuid) from public, anon;
grant execute on function private.is_active_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_manage(uuid) to authenticated, service_role;

create trigger repair_orders_keep_workshop before update on public.repair_orders
  for each row execute function private.keep_workshop_id();
create trigger repair_orders_updated_at before update on public.repair_orders
  for each row execute function private.set_updated_at();
create trigger repair_orders_guard before insert or update on public.repair_orders
  for each row execute function private.repair_orders_guard();
create trigger repair_orders_history after insert or update on public.repair_orders
  for each row execute function private.repair_orders_history();
create trigger repair_order_events_immutable before update or delete on public.repair_order_events
  for each row execute function private.repair_order_events_immutable();

-- ---------------------------------------------------------------------
-- Permisos de tabla + RLS
-- ---------------------------------------------------------------------
revoke all on public.repair_orders, public.repair_order_events from anon, authenticated;
grant all on public.repair_orders to service_role;
grant select, insert on public.repair_order_events to service_role;

grant select on public.repair_orders to authenticated;
grant insert (workshop_id, vehicle_id, customer_id, assigned_to, status, received_at,
              problem_description, diagnosis, work_done, internal_notes)
  on public.repair_orders to authenticated;
grant update (vehicle_id, customer_id, assigned_to, status, received_at,
              problem_description, diagnosis, work_done, internal_notes)
  on public.repair_orders to authenticated;
grant select on public.repair_order_events to authenticated;

alter table public.repair_orders enable row level security;
alter table public.repair_order_events enable row level security;

create policy "orders: lectura" on public.repair_orders for select to authenticated
  using (
    workshop_id in (select private.manager_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  );
create policy "orders: alta gestores" on public.repair_orders for insert to authenticated
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "orders: edición" on public.repair_orders for update to authenticated
  using (
    workshop_id in (select private.manager_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  )
  with check (
    workshop_id in (select private.manager_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  );

-- Se ve el historial de las órdenes que se pueden ver.
create policy "events: lectura" on public.repair_order_events for select to authenticated
  using (exists (select 1 from public.repair_orders o where o.id = order_id));

-- ---------------------------------------------------------------------
-- Búsquedas y resumen (SECURITY INVOKER: RLS se aplica como a quien llama;
-- el parámetro del taller solo filtra, nunca da permisos).
-- ---------------------------------------------------------------------
create function private.like_pattern(p text)
returns text language sql immutable set search_path = ''
as $$ select '%' || replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'; $$;
create function private.digits(p text)
returns text language sql immutable set search_path = ''
as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g'); $$;
revoke all on function private.like_pattern(text) from public, anon;
revoke all on function private.digits(text) from public, anon;
grant execute on function private.like_pattern(text) to authenticated, service_role;
grant execute on function private.digits(text) to authenticated, service_role;

create function public.search_customers(p_workshop_id uuid, p_query text default '', p_limit integer default 50)
returns table (id uuid, full_name text, phone text, email text, created_at timestamptz,
               vehicle_count bigint, open_orders bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.full_name, c.phone, c.email, c.created_at,
         (select count(*) from public.vehicles v where v.customer_id = c.id),
         (select count(*) from public.repair_orders o where o.customer_id = c.id and o.status <> 'entregado')
  from public.customers c
  where c.workshop_id = p_workshop_id
    and (
      btrim(coalesce(p_query, '')) = ''
      or c.full_name ilike private.like_pattern(btrim(p_query))
      or c.email ilike private.like_pattern(btrim(p_query))
      or (length(private.digits(p_query)) >= 3 and private.digits(c.phone) like '%' || private.digits(p_query) || '%')
    )
  order by c.full_name
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Posibles duplicados al crear o editar un cliente (mismo teléfono o correo).
create function public.find_customer_duplicates(p_workshop_id uuid, p_phone text, p_email text, p_exclude uuid default null)
returns table (id uuid, full_name text, phone text, email text)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.full_name, c.phone, c.email
  from public.customers c
  where c.workshop_id = p_workshop_id
    and (p_exclude is null or c.id <> p_exclude)
    and (
      (length(private.digits(p_phone)) >= 9 and right(private.digits(c.phone), 9) = right(private.digits(p_phone), 9))
      or (nullif(btrim(p_email), '') is not null and lower(c.email) = lower(btrim(p_email)))
    )
  limit 5;
$$;

create function public.search_vehicles(p_workshop_id uuid, p_query text default '', p_limit integer default 50)
returns table (id uuid, plate text, make text, model text, year smallint, fuel public.fuel_type,
               customer_id uuid, customer_name text, data_source public.data_source,
               verification_status public.verification_status, open_orders bigint)
language sql stable security invoker set search_path = ''
as $$
  select v.id, v.plate, v.make, v.model, v.year, v.fuel, v.customer_id, c.full_name, v.data_source, v.verification_status,
         (select count(*) from public.repair_orders o where o.vehicle_id = v.id and o.status <> 'entregado')
  from public.vehicles v
  left join public.customers c on c.id = v.customer_id
  where v.workshop_id = p_workshop_id
    and (
      btrim(coalesce(p_query, '')) = ''
      or (length(private.normalize_plate(p_query)) >= 2 and v.plate like '%' || private.normalize_plate(p_query) || '%')
      or v.make ilike private.like_pattern(btrim(p_query))
      or v.model ilike private.like_pattern(btrim(p_query))
      or c.full_name ilike private.like_pattern(btrim(p_query))
    )
  order by v.plate
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create function public.search_repair_orders(
  p_workshop_id uuid,
  p_query text default '',
  p_status public.repair_status default null,
  p_assigned_to uuid default null,
  p_only_active boolean default false,
  p_limit integer default 100
)
returns table (id uuid, number integer, status public.repair_status, received_at timestamptz, updated_at timestamptz,
               problem_description text, assigned_to uuid, vehicle_id uuid, plate text, make text, model text,
               customer_id uuid, customer_name text)
language sql stable security invoker set search_path = ''
as $$
  select o.id, o.number, o.status, o.received_at, o.updated_at, o.problem_description, o.assigned_to,
         v.id, v.plate, v.make, v.model, c.id, c.full_name
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.customers c on c.id = o.customer_id
  where o.workshop_id = p_workshop_id
    and (p_status is null or o.status = p_status)
    and (p_assigned_to is null or o.assigned_to = p_assigned_to)
    and (not coalesce(p_only_active, false) or o.status <> 'entregado')
    and (
      btrim(coalesce(p_query, '')) = ''
      or o.number::text = regexp_replace(btrim(p_query), '^(OR-?)', '', 'i')
      or (length(private.normalize_plate(p_query)) >= 2 and v.plate like '%' || private.normalize_plate(p_query) || '%')
      or c.full_name ilike private.like_pattern(btrim(p_query))
    )
  order by o.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- Resumen del panel: cuenta solo lo que quien llama puede ver
-- (un mecánico ve el resumen de SUS trabajos).
create function public.workshop_dashboard(p_workshop_id uuid)
returns table (active bigint, pending_diagnosis bigint, waiting_parts bigint, in_repair bigint, ready bigint,
               delivered_30d bigint, customers bigint, vehicles bigint)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*) filter (where o.status <> 'entregado'),
    count(*) filter (where o.status in ('recibido', 'diagnosis')),
    count(*) filter (where o.status = 'esperando_recambios'),
    count(*) filter (where o.status = 'en_reparacion'),
    count(*) filter (where o.status = 'listo'),
    count(*) filter (where o.status = 'entregado' and o.delivered_at > now() - interval '30 days'),
    (select count(*) from public.customers c where c.workshop_id = p_workshop_id),
    (select count(*) from public.vehicles v where v.workshop_id = p_workshop_id)
  from public.repair_orders o
  where o.workshop_id = p_workshop_id;
$$;

revoke all on function public.search_customers(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.find_customer_duplicates(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.search_vehicles(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.search_repair_orders(uuid, text, public.repair_status, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.workshop_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.search_customers(uuid, text, integer) to authenticated, service_role;
grant execute on function public.find_customer_duplicates(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.search_vehicles(uuid, text, integer) to authenticated, service_role;
grant execute on function public.search_repair_orders(uuid, text, public.repair_status, uuid, boolean, integer) to authenticated, service_role;
grant execute on function public.workshop_dashboard(uuid) to authenticated, service_role;
