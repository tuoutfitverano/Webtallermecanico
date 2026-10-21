-- =====================================================================
-- Historial del vehículo y planificación del trabajo.
--
--  · Vehículo: versión, VIN (bastidor), kilometraje y próxima revisión
--    (fecha y/o kilómetros) con su recomendación.
--  · Cliente: datos fiscales opcionales (para facturas).
--  · Orden: kilómetros a la entrada, prioridad, día planificado, fecha
--    prevista de entrega (INTERNA: nunca se enseña al cliente) y tiempo
--    estimado. Solo la oficina (propietario, administrador, recepción)
--    planifica; el mecánico no.
--  · Líneas de la orden (mano de obra, piezas, otros): lo que se ha hecho de
--    verdad. Alimentan el historial del vehículo y la factura.
--  · Registro de tiempo real por persona (empezar / parar), con la hora del
--    servidor: nadie se inventa horas.
--
-- No borra ni modifica datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vehículo y cliente
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column version text check (version is null or length(btrim(version)) between 1 and 80),
  -- 17 caracteres sin I, O ni Q (ISO 3779). Vehículos antiguos pueden no tenerlo.
  add column vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  add column mileage integer check (mileage is null or mileage between 0 and 3000000),
  add column mileage_at timestamptz,
  add column next_service_date date,
  add column next_service_km integer check (next_service_km is null or next_service_km between 0 and 3000000),
  add column next_service_notes text check (length(next_service_notes) <= 500);
comment on column public.vehicles.mileage is 'Último kilometraje conocido (lo actualizan las órdenes con kilómetros mayores).';
comment on column public.vehicles.next_service_notes is 'Recomendación de mantenimiento: la ve el cliente en su portal.';
create unique index vehicles_vin_key on public.vehicles (workshop_id, vin) where vin is not null;

-- VIN siempre en mayúsculas y sin espacios.
create function private.vehicles_normalize_extra()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.vin := nullif(upper(regexp_replace(coalesce(new.vin, ''), '\s', '', 'g')), '');
  new.version := nullif(btrim(new.version), '');
  new.next_service_notes := nullif(btrim(new.next_service_notes), '');
  if new.mileage is distinct from (case when tg_op = 'UPDATE' then old.mileage end) then
    new.mileage_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.vehicles_normalize_extra() from public, anon, authenticated;
create trigger vehicles_normalize_extra before insert or update on public.vehicles
  for each row execute function private.vehicles_normalize_extra();

alter table public.customers
  add column tax_id text check (tax_id is null or tax_id ~ '^[A-Z0-9]{8,12}$'),
  add column address_line text check (length(address_line) <= 200),
  add column postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  add column city text check (length(city) <= 80),
  add column province text check (length(province) <= 80);
comment on column public.customers.tax_id is 'NIF/NIE/CIF (opcional; necesario para factura completa).';

-- Dirección del taller (cabecera de presupuestos y facturas).
alter table public.workshops
  add column address_line text check (length(address_line) <= 200),
  add column postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  add column city text check (length(city) <= 80),
  add column province text check (length(province) <= 80);

-- ---------------------------------------------------------------------
-- 2. Orden: planificación
-- ---------------------------------------------------------------------
create type public.order_priority as enum ('baja', 'normal', 'alta', 'urgente');

alter table public.repair_orders
  add column mileage_in integer check (mileage_in is null or mileage_in between 0 and 3000000),
  add column priority public.order_priority not null default 'normal',
  add column scheduled_on date,
  add column due_at timestamptz,
  add column estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 1 and 100000);
comment on column public.repair_orders.due_at is 'Fecha prevista de entrega. INTERNA: no se enseña al cliente (no es una fecha prometida).';
grant insert (mileage_in, priority, scheduled_on, due_at, estimated_minutes) on public.repair_orders to authenticated;
grant update (mileage_in, priority, scheduled_on, due_at, estimated_minutes) on public.repair_orders to authenticated;
create index repair_orders_plan_idx on public.repair_orders (workshop_id, scheduled_on) where scheduled_on is not null;
create index repair_orders_due_idx on public.repair_orders (workshop_id, due_at) where due_at is not null and status <> 'entregado';

-- Solo la oficina planifica (prioridad, día, entrega prevista, estimación).
create function private.repair_orders_plan_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not private.can_manage(new.workshop_id)
     and (new.priority is distinct from old.priority or new.scheduled_on is distinct from old.scheduled_on
          or new.due_at is distinct from old.due_at or new.estimated_minutes is distinct from old.estimated_minutes) then
    raise exception 'Solo la oficina del taller (propietario, administrador o recepción) planifica las órdenes.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.repair_orders_plan_guard() from public, anon, authenticated;
create trigger repair_orders_plan_guard before update on public.repair_orders
  for each row execute function private.repair_orders_plan_guard();

-- Los kilómetros de la orden actualizan el kilometraje del vehículo (si son mayores).
create function private.repair_orders_mileage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.mileage_in is not null and (tg_op = 'INSERT' or new.mileage_in is distinct from old.mileage_in) then
    update public.vehicles v set mileage = new.mileage_in
     where v.id = new.vehicle_id and v.workshop_id = new.workshop_id
       and (v.mileage is null or v.mileage < new.mileage_in);
  end if;
  return null;
end;
$$;
revoke all on function private.repair_orders_mileage() from public, anon, authenticated;
create trigger repair_orders_mileage after insert or update of mileage_in on public.repair_orders
  for each row execute function private.repair_orders_mileage();

-- ---------------------------------------------------------------------
-- 3. Líneas de la orden (trabajo realizado y piezas)
-- ---------------------------------------------------------------------
create type public.line_kind as enum ('mano_obra', 'pieza', 'otro');

create table public.repair_order_items (
  id                uuid primary key default gen_random_uuid(),
  workshop_id       uuid not null references public.workshops (id) on delete cascade,
  order_id          uuid not null,
  position          integer not null default 0,
  kind              public.line_kind not null,
  description       text not null check (length(btrim(description)) between 1 and 300),
  part_number       text check (length(part_number) <= 60),
  quantity          numeric(10, 2) not null check (quantity > 0 and quantity <= 100000),
  unit_price_cents  bigint not null check (unit_price_cents between 0 and 100000000),
  discount_pct      numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate          numeric(5, 2) not null check (tax_rate between 0 and 100),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id) on delete cascade
);
comment on table public.repair_order_items is 'Trabajo realizado y piezas montadas en una orden. Importes en céntimos.';
create index repair_order_items_order_idx on public.repair_order_items (order_id, position);

revoke all on public.repair_order_items from anon, authenticated;
grant all on public.repair_order_items to service_role;
grant select, delete on public.repair_order_items to authenticated;
grant insert (workshop_id, order_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  on public.repair_order_items to authenticated;
grant update (position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  on public.repair_order_items to authenticated;
alter table public.repair_order_items enable row level security;

-- Quien puede ver/editar la orden (oficina o mecánico asignado) ve y edita sus líneas.
create function private.can_work_on_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.repair_orders o
    where o.id = p_order_id
      and (o.workshop_id in (select private.office_workshop_ids())
           or (o.assigned_to = (select auth.uid()) and o.workshop_id in (select private.staff_workshop_ids()))
           or private.is_platform_admin())
  );
$$;
revoke all on function private.can_work_on_order(uuid) from public, anon;
grant execute on function private.can_work_on_order(uuid) to authenticated, service_role;

create policy "order items: lectura" on public.repair_order_items for select to authenticated
  using ((select private.can_work_on_order(order_id)));
create policy "order items: alta" on public.repair_order_items for insert to authenticated
  with check ((select private.can_work_on_order(order_id)));
create policy "order items: edición" on public.repair_order_items for update to authenticated
  using ((select private.can_work_on_order(order_id))) with check ((select private.can_work_on_order(order_id)));
create policy "order items: borrado" on public.repair_order_items for delete to authenticated
  using ((select private.can_work_on_order(order_id)));

create function private.items_normalize()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.description := btrim(new.description);
  new.part_number := nullif(btrim(new.part_number), '');
  return new;
end;
$$;
revoke all on function private.items_normalize() from public, anon, authenticated;
create trigger repair_order_items_normalize before insert or update on public.repair_order_items
  for each row execute function private.items_normalize();
create trigger repair_order_items_keep_workshop before update on public.repair_order_items
  for each row execute function private.keep_workshop_id();

-- ---------------------------------------------------------------------
-- 4. Tiempo real (empezar / parar)
-- ---------------------------------------------------------------------
create table public.repair_order_work_logs (
  id           bigint generated always as identity primary key,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  order_id     uuid not null,
  user_id      uuid references auth.users (id) on delete set null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  check (ended_at is null or ended_at >= started_at),
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id) on delete cascade
);
comment on table public.repair_order_work_logs is 'Tiempo real trabajado. Lo escriben solo start_work/stop_work (hora del servidor).';
-- Una persona solo tiene un trabajo en marcha a la vez.
create unique index work_logs_one_open on public.repair_order_work_logs (user_id) where ended_at is null;
create index work_logs_order_idx on public.repair_order_work_logs (order_id);

revoke all on public.repair_order_work_logs from anon, authenticated;
grant all on public.repair_order_work_logs to service_role;
grant select on public.repair_order_work_logs to authenticated;
alter table public.repair_order_work_logs enable row level security;
create policy "work logs: lectura" on public.repair_order_work_logs for select to authenticated
  using ((select private.can_work_on_order(order_id)));

create function public.start_work(p_order_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_ws  uuid;
begin
  if not private.can_work_on_order(p_order_id) then
    raise exception 'No puedes trabajar en esta orden.' using errcode = '42501';
  end if;
  select o.workshop_id into v_ws from public.repair_orders o where o.id = p_order_id and o.status <> 'entregado';
  if v_ws is null then
    raise exception 'La orden ya está entregada.' using errcode = '22023';
  end if;
  -- Lo que tuviera en marcha (otra orden) se para ahora.
  update public.repair_order_work_logs set ended_at = now() where user_id = v_uid and ended_at is null;
  insert into public.repair_order_work_logs (workshop_id, order_id, user_id) values (v_ws, p_order_id, v_uid);
end;
$$;

create function public.stop_work(p_order_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  update public.repair_order_work_logs set ended_at = now()
   where user_id = v_uid and order_id = p_order_id and ended_at is null;
  if not found then
    raise exception 'No tienes tiempo en marcha en esta orden.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.start_work(uuid) from public, anon;
revoke all on function public.stop_work(uuid) from public, anon;
grant execute on function public.start_work(uuid) to authenticated;
grant execute on function public.stop_work(uuid) to authenticated;

-- Al entregar una orden, se para el tiempo que quedara en marcha.
create function private.repair_orders_stop_logs()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'entregado' and old.status is distinct from 'entregado' then
    update public.repair_order_work_logs set ended_at = now() where order_id = new.id and ended_at is null;
  end if;
  return null;
end;
$$;
revoke all on function private.repair_orders_stop_logs() from public, anon, authenticated;
create trigger repair_orders_stop_logs after update of status on public.repair_orders
  for each row execute function private.repair_orders_stop_logs();
