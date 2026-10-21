-- =====================================================================
-- El cliente añade y quita vehículos desde su portal.
--
--  · Añadir: el cliente registra un vehículo en SU ficha (matrícula, marca,
--    modelo y año obligatorios). Queda como dato «del cliente», verificación
--    pendiente. Límite: 10 altas al día por ficha.
--  · Quitar: el vehículo NO se borra. Pasa a la papelera del cliente
--    (portal_hidden_at) y desaparece de su portal; durante 30 días puede
--    recuperarlo. Pasado ese plazo deja de verlo en la papelera, pero el
--    vehículo, sus órdenes, revisiones, presupuestos y facturas se conservan
--    SIEMPRE para el taller (propietario, administración, recepción y mecánicos).
--  · No se puede quitar un vehículo con una reparación en curso. Si el taller
--    abre una orden nueva para un vehículo quitado, vuelve al portal.
--  · Solo estas funciones cambian portal_hidden_at y added_by_customer.
--
-- No borra ni modifica datos existentes.
-- =====================================================================

alter table public.vehicles
  add column portal_hidden_at timestamptz,
  add column added_by_customer boolean not null default false;
comment on column public.vehicles.portal_hidden_at is 'El cliente lo quitó de su portal (papelera 30 días). El taller lo conserva siempre.';
comment on column public.vehicles.added_by_customer is 'Lo dio de alta el propio cliente desde su portal.';

-- Nadie cambia estas columnas escribiendo en la tabla: solo las funciones del portal.
-- Si el taller cambia el cliente del vehículo, la papelera del anterior deja de aplicar.
create function private.vehicles_portal_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.portal_hidden_at := null;
      new.added_by_customer := false;
    elsif new.portal_hidden_at is distinct from old.portal_hidden_at
       or new.added_by_customer is distinct from old.added_by_customer then
      raise exception 'Estos datos solo los cambia el cliente desde su portal.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.customer_id is distinct from old.customer_id then
    new.portal_hidden_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.vehicles_portal_guard() from public, anon, authenticated;
create trigger vehicles_portal_guard before insert or update on public.vehicles
  for each row execute function private.vehicles_portal_guard();

-- Una orden nueva devuelve el vehículo al portal del cliente.
create function private.repair_orders_unhide_vehicle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.vehicles set portal_hidden_at = null
   where id = new.vehicle_id and portal_hidden_at is not null;
  return null;
end;
$$;
revoke all on function private.repair_orders_unhide_vehicle() from public, anon, authenticated;
create trigger repair_orders_unhide_vehicle after insert on public.repair_orders
  for each row execute function private.repair_orders_unhide_vehicle();

-- Ficha del cliente que pertenece a la sesión (o error).
create function private.require_portal_customer(p_customer_id uuid)
returns public.customers language plpgsql stable security definer set search_path = ''
as $$
declare v public.customers;
begin
  perform private.require_user();
  select * into v from public.customers c
   where c.id = p_customer_id and c.id in (select private.portal_customer_ids());
  if v.id is null then
    raise exception 'Ficha no encontrada.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function private.require_portal_customer(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Añadir
-- ---------------------------------------------------------------------
create function public.portal_add_vehicle(
  p_customer_id uuid, p_plate text, p_make text, p_model text, p_year integer,
  p_year_kind public.year_kind, p_fuel public.fuel_type default null)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_c     public.customers := private.require_portal_customer(p_customer_id);
  v_plate text := private.normalize_plate(coalesce(p_plate, ''));
  v_old   public.vehicles;
  v_id    uuid;
begin
  if v_plate !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'Matrícula no válida.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_make, ''))) not between 1 and 60 or length(btrim(coalesce(p_model, ''))) not between 1 and 80 then
    raise exception 'Indica la marca y el modelo.' using errcode = '22023';
  end if;
  if p_year is null or p_year_kind is null or p_year not between 1900 and extract(year from now())::integer + 1 then
    raise exception 'Indica el año del vehículo y si es de fabricación o de primera matriculación.' using errcode = '22023';
  end if;

  select * into v_old from public.vehicles ve where ve.workshop_id = v_c.workshop_id and ve.plate = v_plate;
  if v_old.id is not null then
    if v_old.customer_id is distinct from v_c.id then
      raise exception 'Esa matrícula ya está registrada en el taller. Pídele al taller que la asocie a tu ficha.' using errcode = '22023';
    elsif v_old.portal_hidden_at is null then
      raise exception 'Ese vehículo ya está en tu portal.' using errcode = '22023';
    end if;
    -- Estaba en su papelera (o la papelera ya caducó): vuelve tal cual, con su historial.
    update public.vehicles set portal_hidden_at = null where id = v_old.id;
    return v_old.id;
  end if;

  if (select count(*) from public.vehicles ve
       where ve.customer_id = v_c.id and ve.added_by_customer and ve.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Has añadido muchos vehículos hoy. Inténtalo mañana o díselo al taller.' using errcode = '22023';
  end if;

  insert into public.vehicles (workshop_id, customer_id, plate, make, model, year, year_kind, fuel,
                               data_source, verification_status, added_by_customer, created_by, updated_by)
  values (v_c.workshop_id, v_c.id, v_plate, btrim(p_make), btrim(p_model), p_year, p_year_kind, p_fuel,
          'cliente', 'pendiente', true, auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Quitar (a la papelera) y recuperar
-- ---------------------------------------------------------------------
create function public.portal_remove_vehicle(p_vehicle_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v public.vehicles;
begin
  perform private.require_user();
  select * into v from public.vehicles ve
   where ve.id = p_vehicle_id and ve.customer_id in (select private.portal_customer_ids()) and ve.portal_hidden_at is null;
  if v.id is null then
    raise exception 'Vehículo no encontrado.' using errcode = '42501';
  end if;
  if exists (select 1 from public.repair_orders o where o.vehicle_id = v.id and o.status <> 'entregado') then
    raise exception 'No puedes quitar un vehículo con una reparación en curso.' using errcode = '22023';
  end if;
  update public.vehicles set portal_hidden_at = now() where id = v.id;
end;
$$;

create function public.portal_restore_vehicle(p_vehicle_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v public.vehicles;
begin
  perform private.require_user();
  select * into v from public.vehicles ve
   where ve.id = p_vehicle_id and ve.customer_id in (select private.portal_customer_ids())
     and ve.portal_hidden_at > now() - interval '30 days';
  if v.id is null then
    raise exception 'Ese vehículo ya no está en tu papelera.' using errcode = '42501';
  end if;
  update public.vehicles set portal_hidden_at = null where id = v.id;
end;
$$;

-- Papelera: lo quitado en los últimos 30 días, con la fecha límite para recuperarlo.
create function public.portal_vehicle_trash()
returns table (id uuid, workshop_name text, plate text, make text, model text, removed_at timestamptz, restorable_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.id, w.name, v.plate, v.make, v.model, v.portal_hidden_at, v.portal_hidden_at + interval '30 days'
    from public.vehicles v
    join public.workshops w on w.id = v.workshop_id
   where v.customer_id in (select private.portal_customer_ids())
     and v.portal_hidden_at > now() - interval '30 days'
   order by v.portal_hidden_at desc;
$$;

-- ---------------------------------------------------------------------
-- El portal deja de enseñar los vehículos quitados (y sus reparaciones en las listas)
-- ---------------------------------------------------------------------
create or replace function public.portal_vehicles()
returns table (id uuid, workshop_id uuid, workshop_name text, plate text, make text, model text,
               year smallint, year_kind public.year_kind, fuel public.fuel_type,
               active_order_id uuid, active_order_number integer, active_status public.repair_status,
               version text, mileage integer, next_service_date date, next_service_km integer, next_service_notes text)
language sql stable security definer set search_path = ''
as $$
  select v.id, w.id, w.name, v.plate, v.make, v.model, v.year, v.year_kind, v.fuel,
         a.id, a.number, a.status,
         v.version, v.mileage, v.next_service_date, v.next_service_km, v.next_service_notes
  from public.vehicles v
  join public.workshops w on w.id = v.workshop_id
  left join lateral (
    select o.id, o.number, o.status from public.repair_orders o
    where o.vehicle_id = v.id and o.status <> 'entregado'
      and o.customer_id in (select private.portal_customer_ids())
    order by o.received_at desc limit 1
  ) a on true
  where v.customer_id in (select private.portal_customer_ids())
    and v.portal_hidden_at is null
  order by v.plate;
$$;

create or replace function public.portal_orders(p_filter text default 'todas', p_vehicle_id uuid default null)
returns table (id uuid, number integer, workshop_name text, vehicle_id uuid, plate text, make text, model text,
               status public.repair_status, received_at timestamptz, last_update timestamptz,
               delivered_at timestamptz, problem_description text, customer_notes text)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.number, w.name, v.id, v.plate, v.make, v.model, o.status, o.received_at,
         coalesce(private.order_last_public_update(o.id), o.received_at), o.delivered_at,
         o.problem_description, o.customer_notes
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.workshops w on w.id = o.workshop_id
  where o.customer_id in (select private.portal_customer_ids())
    and v.portal_hidden_at is null
    and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
    and case coalesce(p_filter, 'todas')
          when 'en_curso' then o.status in ('recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion')
          when 'listas' then o.status = 'listo'
          when 'finalizadas' then o.status = 'entregado'
          else true
        end
  order by o.received_at desc;
$$;

revoke all on function public.portal_add_vehicle(uuid, text, text, text, integer, public.year_kind, public.fuel_type) from public, anon;
revoke all on function public.portal_remove_vehicle(uuid) from public, anon;
revoke all on function public.portal_restore_vehicle(uuid) from public, anon;
revoke all on function public.portal_vehicle_trash() from public, anon;
grant execute on function public.portal_add_vehicle(uuid, text, text, text, integer, public.year_kind, public.fuel_type) to authenticated;
grant execute on function public.portal_remove_vehicle(uuid) to authenticated;
grant execute on function public.portal_restore_vehicle(uuid) to authenticated;
grant execute on function public.portal_vehicle_trash() to authenticated;
