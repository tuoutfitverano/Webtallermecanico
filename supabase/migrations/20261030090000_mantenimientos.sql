-- =====================================================================
-- Mantenimientos periódicos (cambio de aceite, revisión, pre-ITV, correa…)
--
--  · Cada taller tiene SU lista (service_intervals): nombre y cada cuántos
--    meses y/o kilómetros. La cambian el propietario y los administradores.
--    Nace con una lista de partida orientativa que el taller ajusta a su
--    criterio (y a lo que diga cada fabricante). No se borran: se desactivan,
--    para no perder el historial.
--  · En cada orden se marca qué mantenimientos se han hecho (order_services).
--  · Al ENTREGAR el vehículo, la base de datos calcula para ese vehículo el
--    último hecho y el próximo (vehicle_services): fecha de entrega + meses y
--    kilómetros de entrada + km. La oficina puede anotar a mano uno hecho
--    fuera del taller (set_vehicle_service).
--  · Recordatorios: en el mantenimiento programado, igual que la revisión
--    (regla «revisión» del taller; al cliente solo si él lo pidió).
--  · El cliente ve en su portal los mantenimientos de SUS vehículos
--    (portal_vehicle_services).
--
-- No borra ni modifica datos existentes.
-- =====================================================================

create table public.service_intervals (
  id            uuid primary key default gen_random_uuid(),
  workshop_id   uuid not null references public.workshops (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 2 and 80),
  every_months  integer check (every_months between 1 and 240),
  every_km      integer check (every_km between 500 and 500000),
  active        boolean not null default true,
  position      integer not null default 0 check (position between 0 and 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (every_months is not null or every_km is not null),
  unique (id, workshop_id)
);
comment on table public.service_intervals is 'Mantenimientos periódicos de cada taller (cada cuántos meses y/o km). Los edita la gerencia.';
create unique index service_intervals_name_idx on public.service_intervals (workshop_id, lower(btrim(name)));
create trigger service_intervals_updated_at before update on public.service_intervals
  for each row execute function private.set_updated_at();

create function private.service_intervals_normalize()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  return new;
end;
$$;
revoke all on function private.service_intervals_normalize() from public, anon, authenticated;
create trigger service_intervals_normalize before insert or update on public.service_intervals
  for each row execute function private.service_intervals_normalize();

-- Lista de partida (orientativa: cada taller la ajusta).
create function private.default_service_intervals(p_ws uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.service_intervals (workshop_id, name, every_months, every_km, position) values
    (p_ws, 'Cambio de aceite y filtro', 12, 15000, 1),
    (p_ws, 'Revisión general', 12, 15000, 2),
    (p_ws, 'Pre-ITV', 12, null, 3),
    (p_ws, 'Filtros de aire y habitáculo', 24, 30000, 4),
    (p_ws, 'Líquido de frenos', 24, null, 5),
    (p_ws, 'Correa de distribución', 60, 100000, 6)
  on conflict do nothing;
$$;
revoke all on function private.default_service_intervals(uuid) from public, anon, authenticated;
select private.default_service_intervals(id) from public.workshops;

create function private.workshops_service_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.default_service_intervals(new.id);
  return null;
end;
$$;
revoke all on function private.workshops_service_defaults() from public, anon, authenticated;
create trigger workshops_service_defaults after insert on public.workshops
  for each row execute function private.workshops_service_defaults();

-- Mantenimientos hechos en cada orden.
create table public.order_services (
  order_id     uuid not null,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  interval_id  uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (order_id, interval_id),
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id) on delete cascade,
  foreign key (interval_id, workshop_id) references public.service_intervals (id, workshop_id) on delete cascade
);
comment on table public.order_services is 'Mantenimientos periódicos hechos en una orden (al entregarla, cuentan para el vehículo).';
create index order_services_interval_idx on public.order_services (interval_id);

-- Último hecho y próximo, por vehículo y mantenimiento. Lo escribe solo la base de datos.
create table public.vehicle_services (
  vehicle_id    uuid not null,
  workshop_id   uuid not null references public.workshops (id) on delete cascade,
  interval_id   uuid not null,
  last_done_on  date not null,
  last_done_km  integer check (last_done_km is null or last_done_km between 0 and 3000000),
  next_due_on   date,
  next_due_km   integer,
  source        text not null check (source in ('orden', 'manual')),
  order_id      uuid references public.repair_orders (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (vehicle_id, interval_id),
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id) on delete cascade,
  foreign key (interval_id, workshop_id) references public.service_intervals (id, workshop_id) on delete cascade
);
comment on table public.vehicle_services is 'Último mantenimiento hecho y el próximo previsto por vehículo. Solo lo calcula la base de datos.';
create index vehicle_services_due_idx on public.vehicle_services (workshop_id, next_due_on);

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on public.service_intervals, public.order_services, public.vehicle_services from anon, authenticated;
grant all on public.service_intervals, public.order_services, public.vehicle_services to service_role;
grant select on public.service_intervals, public.order_services, public.vehicle_services to authenticated;
grant insert (workshop_id, name, every_months, every_km, active, position) on public.service_intervals to authenticated;
grant update (name, every_months, every_km, active, position) on public.service_intervals to authenticated;
grant insert (order_id, workshop_id, interval_id) on public.order_services to authenticated;
grant delete on public.order_services to authenticated;
alter table public.service_intervals enable row level security;
alter table public.order_services enable row level security;
alter table public.vehicle_services enable row level security;

create policy "mantenimientos: lectura personal" on public.service_intervals for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "mantenimientos: alta gerencia" on public.service_intervals for insert to authenticated
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "mantenimientos: edición gerencia" on public.service_intervals for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- En la orden: quien puede ver la orden (el mecánico, solo las suyas); entregada, solo la oficina.
create policy "mantenimientos de la orden: lectura" on public.order_services for select to authenticated
  using (order_id in (select id from public.repair_orders));
create policy "mantenimientos de la orden: marcar" on public.order_services for insert to authenticated
  with check (order_id in (select id from public.repair_orders o
                            where o.workshop_id = order_services.workshop_id
                              and (o.status <> 'entregado' or o.workshop_id in (select private.office_workshop_ids()))));
create policy "mantenimientos de la orden: desmarcar" on public.order_services for delete to authenticated
  using (order_id in (select id from public.repair_orders o
                       where o.status <> 'entregado' or o.workshop_id in (select private.office_workshop_ids())));

create policy "mantenimientos del vehículo: lectura personal" on public.vehicle_services for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- Cálculo del último hecho y el próximo
-- ---------------------------------------------------------------------
create function private.refresh_vehicle_service(p_vehicle uuid, p_interval uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_iv  public.service_intervals;
  v_ws  uuid;
  v_ord record;
  v_man record;
  v_on  date;
  v_km  integer;
  v_src text;
  v_oid uuid;
begin
  select * into v_iv from public.service_intervals where id = p_interval;
  select workshop_id into v_ws from public.vehicles where id = p_vehicle;
  if v_iv.id is null or v_ws is null then return; end if;
  -- La última orden ENTREGADA de este vehículo con ese mantenimiento.
  select o.id, (o.delivered_at at time zone 'Europe/Madrid')::date as done_on, o.mileage_in as km into v_ord
    from public.order_services s
    join public.repair_orders o on o.id = s.order_id
   where s.interval_id = p_interval and o.vehicle_id = p_vehicle and o.status = 'entregado' and o.delivered_at is not null
   order by o.delivered_at desc
   limit 1;
  select last_done_on, last_done_km into v_man
    from public.vehicle_services where vehicle_id = p_vehicle and interval_id = p_interval and source = 'manual';
  if v_ord.id is not null and (v_man.last_done_on is null or v_ord.done_on >= v_man.last_done_on) then
    v_on := v_ord.done_on; v_km := v_ord.km; v_src := 'orden'; v_oid := v_ord.id;
  elsif v_man.last_done_on is not null then
    v_on := v_man.last_done_on; v_km := v_man.last_done_km; v_src := 'manual'; v_oid := null;
  else
    delete from public.vehicle_services where vehicle_id = p_vehicle and interval_id = p_interval;
    return;
  end if;
  insert into public.vehicle_services (vehicle_id, workshop_id, interval_id, last_done_on, last_done_km, next_due_on, next_due_km, source, order_id)
  values (p_vehicle, v_ws, p_interval, v_on, v_km,
          case when v_iv.every_months is not null then (v_on + make_interval(months => v_iv.every_months))::date end,
          case when v_iv.every_km is not null and v_km is not null then v_km + v_iv.every_km end,
          v_src, v_oid)
  on conflict (vehicle_id, interval_id) do update
     set last_done_on = excluded.last_done_on, last_done_km = excluded.last_done_km,
         next_due_on = excluded.next_due_on, next_due_km = excluded.next_due_km,
         source = excluded.source, order_id = excluded.order_id, updated_at = now();
end;
$$;
revoke all on function private.refresh_vehicle_service(uuid, uuid) from public, anon, authenticated;

create function private.order_services_refresh()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.order_services := coalesce(new, old);
begin
  perform private.refresh_vehicle_service(o.vehicle_id, v_row.interval_id)
     from public.repair_orders o where o.id = v_row.order_id;
  return null;
end;
$$;
revoke all on function private.order_services_refresh() from public, anon, authenticated;
create trigger order_services_refresh after insert or delete on public.order_services
  for each row execute function private.order_services_refresh();

-- Al entregar (o deshacer la entrega, o cambiar de vehículo) se recalcula.
create function private.repair_orders_services_refresh()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.refresh_vehicle_service(v.vehicle_id, s.interval_id)
     from public.order_services s
     cross join (select distinct unnest(array[old.vehicle_id, new.vehicle_id]) as vehicle_id) v
    where s.order_id = new.id and v.vehicle_id is not null;
  return null;
end;
$$;
revoke all on function private.repair_orders_services_refresh() from public, anon, authenticated;
create trigger repair_orders_services_refresh after update of status, vehicle_id, mileage_in on public.repair_orders
  for each row when (old.status is distinct from new.status or old.vehicle_id is distinct from new.vehicle_id
                     or old.mileage_in is distinct from new.mileage_in)
  execute function private.repair_orders_services_refresh();

-- Si el taller cambia los meses o km de un mantenimiento, se recalculan los próximos.
create function private.service_intervals_refresh()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.vehicle_services
     set next_due_on = case when new.every_months is not null then (last_done_on + make_interval(months => new.every_months))::date end,
         next_due_km = case when new.every_km is not null and last_done_km is not null then last_done_km + new.every_km end,
         updated_at = now()
   where interval_id = new.id;
  return null;
end;
$$;
revoke all on function private.service_intervals_refresh() from public, anon, authenticated;
create trigger service_intervals_refresh after update of every_months, every_km on public.service_intervals
  for each row execute function private.service_intervals_refresh();

-- La oficina anota uno hecho fuera del taller (o lo quita con fecha nula).
create function public.set_vehicle_service(p_vehicle_id uuid, p_interval_id uuid, p_done_on date, p_done_km integer default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select v.workshop_id into v_ws
    from public.vehicles v
    join public.service_intervals i on i.id = p_interval_id and i.workshop_id = v.workshop_id
   where v.id = p_vehicle_id;
  if v_ws is null or v_ws not in (select private.office_workshop_ids()) then
    raise exception 'Vehículo o mantenimiento no encontrado.' using errcode = '42501';
  end if;
  if p_done_on is not null and (p_done_on > current_date or p_done_on < date '1950-01-01') then
    raise exception 'La fecha no puede ser futura.' using errcode = '22023';
  end if;
  if p_done_km is not null and (p_done_km < 0 or p_done_km > 3000000) then
    raise exception 'Kilómetros no válidos.' using errcode = '22023';
  end if;
  if p_done_on is null then
    delete from public.vehicle_services where vehicle_id = p_vehicle_id and interval_id = p_interval_id and source = 'manual';
  else
    insert into public.vehicle_services (vehicle_id, workshop_id, interval_id, last_done_on, last_done_km, source)
    values (p_vehicle_id, v_ws, p_interval_id, p_done_on, p_done_km, 'manual')
    on conflict (vehicle_id, interval_id) do update
       set last_done_on = excluded.last_done_on, last_done_km = excluded.last_done_km, source = 'manual', order_id = null;
  end if;
  perform private.refresh_vehicle_service(p_vehicle_id, p_interval_id);
end;
$$;
revoke all on function public.set_vehicle_service(uuid, uuid, date, integer) from public, anon;
grant execute on function public.set_vehicle_service(uuid, uuid, date, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Portal del cliente: los mantenimientos de SUS vehículos
-- ---------------------------------------------------------------------
create function public.portal_vehicle_services(p_vehicle_id uuid)
returns table (name text, last_done_on date, next_due_on date, next_due_km integer)
language sql stable security definer set search_path = ''
as $$
  select i.name, s.last_done_on, s.next_due_on, s.next_due_km
    from public.vehicle_services s
    join public.service_intervals i on i.id = s.interval_id and i.active
    join public.vehicles v on v.id = s.vehicle_id
   where s.vehicle_id = p_vehicle_id
     and v.customer_id in (select private.portal_customer_ids())
     and v.portal_hidden_at is null
   order by s.next_due_on nulls last, i.position, i.name;
$$;
revoke all on function public.portal_vehicle_services(uuid) from public, anon;
grant execute on function public.portal_vehicle_services(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Recordatorios (mismas reglas que la revisión)
-- ---------------------------------------------------------------------
create function private.generate_service_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  -- Por fecha.
  for r in
    select s.vehicle_id, s.interval_id, s.workshop_id, s.next_due_on, i.name, v.customer_id, v.make, v.model, v.plate
      from public.vehicle_services s
      join public.service_intervals i on i.id = s.interval_id and i.active
      join public.vehicles v on v.id = s.vehicle_id
      join public.reminder_settings rs on rs.workshop_id = s.workshop_id and rs.revision_enabled
      join public.workshops w on w.id = s.workshop_id and w.status <> 'suspendido'
     where v.customer_id is not null and s.next_due_on is not null
       and s.next_due_on between current_date and current_date + rs.revision_days_before
  loop
    if private.add_reminder(r.workshop_id, 'revision', 'mant:' || r.vehicle_id || ':' || r.interval_id || ':' || r.next_due_on, r.next_due_on,
         left(format('%s de tu %s %s', r.name, r.make, r.model), 200), r.customer_id, r.vehicle_id, null, null, 'recordatorio_revision',
         format(E'A tu %s %s (%s) le toca «%s» el %s.\nLlámanos o escríbenos para reservar día.', r.make, r.model, r.plate, r.name, to_char(r.next_due_on, 'DD/MM/YYYY')),
         '/portal/vehiculos/' || r.vehicle_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Por kilómetros (según el último kilometraje conocido del vehículo).
  for r in
    select s.vehicle_id, s.interval_id, s.workshop_id, s.next_due_km, i.name, v.customer_id, v.make, v.model, v.plate
      from public.vehicle_services s
      join public.service_intervals i on i.id = s.interval_id and i.active
      join public.vehicles v on v.id = s.vehicle_id
      join public.reminder_settings rs on rs.workshop_id = s.workshop_id and rs.revision_enabled
      join public.workshops w on w.id = s.workshop_id and w.status <> 'suspendido'
     where v.customer_id is not null and s.next_due_km is not null and v.mileage is not null
       and s.next_due_km - v.mileage <= rs.revision_km_margin
  loop
    if private.add_reminder(r.workshop_id, 'revision', 'mantkm:' || r.vehicle_id || ':' || r.interval_id || ':' || r.next_due_km, current_date,
         left(format('%s de tu %s %s', r.name, r.make, r.model), 200), r.customer_id, r.vehicle_id, null, null, 'recordatorio_revision',
         format(E'Tu %s %s (%s) se acerca a los %s km en los que le toca «%s».\nLlámanos o escríbenos para reservar día.', r.make, r.model, r.plate, r.next_due_km, r.name),
         '/portal/vehiculos/' || r.vehicle_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.generate_service_reminders() from public, anon, authenticated;

create or replace function public.run_maintenance()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hashes    integer;
  v_lookups   integer;
  v_quotes    integer;
  v_reminders integer;
  v_services  integer;
begin
  update public.web_requests set client_hash = null
   where client_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_hashes = row_count;
  update public.vehicle_lookups set status = 'error', completed_at = now()
   where status = 'pendiente' and created_at < now() - interval '10 minutes';
  get diagnostics v_lookups = row_count;
  v_quotes := private.expire_quotes();
  v_reminders := private.generate_reminders();
  v_services := private.generate_service_reminders();
  return jsonb_build_object('huellas_borradas', v_hashes, 'consultas_cerradas', v_lookups,
                            'presupuestos_caducados', v_quotes, 'recordatorios_nuevos', v_reminders,
                            'mantenimientos_nuevos', v_services);
end;
$$;
