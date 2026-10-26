-- =====================================================================
-- Cambio de titular de un vehículo (se vende a otra persona).
--
--  · El comprador lo pide desde su portal con la matrícula, o el taller lo
--    hace en el mostrador. Saber la matrícula NUNCA basta.
--  · Se confirma de una de estas formas:
--      - el titular anterior contesta en su portal «Sí, lo he vendido»;
--      - la oficina del taller (propietario, administración o recepción)
--        comprueba el permiso de circulación a nombre del comprador o la app
--        miDGT, y anota cuál vio (no se guarda copia del documento).
--    Si el titular anterior dice «No lo he vendido», no se hace sola: decide
--    la oficina con los papeles delante. Los mecánicos no intervienen.
--  · Al confirmarse: el vehículo pasa a la ficha del comprador; el anterior
--    deja de verlo pero conserva sus reparaciones y facturas (van a su
--    nombre); se cancelan sus recordatorios pendientes de ese vehículo y
--    queda registrado quién, cuándo y cómo.
--  · No se cambia con una reparación en curso.
--  · El titular de un vehículo que ya tiene uno solo cambia con estas
--    funciones (vehicles_owner_guard).
-- =====================================================================

create table public.vehicle_transfers (
  id                  uuid primary key default gen_random_uuid(),
  workshop_id         uuid not null references public.workshops (id) on delete cascade,
  vehicle_id          uuid not null,
  from_customer_id    uuid,
  to_customer_id      uuid not null,
  origin              text not null check (origin in ('portal', 'taller')),
  status              text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'rechazado', 'anulado')),
  seller_answer       text check (seller_answer in ('vendido', 'no_vendido')),
  seller_answered_at  timestamptz,
  method              text check (method in ('vendedor', 'permiso', 'midgt', 'correccion')),
  requested_at        timestamptz not null default now(),
  decided_at          timestamptz,
  decided_by          uuid references auth.users (id) on delete set null,
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id) on delete cascade,
  foreign key (from_customer_id, workshop_id) references public.customers (id, workshop_id) on delete set null (from_customer_id),
  foreign key (to_customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade,
  check ((status = 'confirmado') = (method is not null)),
  check (from_customer_id is distinct from to_customer_id)
);
comment on table public.vehicle_transfers is 'Cambios de titular de vehículos: quién lo pidió, cómo se comprobó y quién lo confirmó. Solo lo escriben las funciones.';
create unique index vehicle_transfers_one_open on public.vehicle_transfers (vehicle_id, to_customer_id) where status = 'pendiente';
create index vehicle_transfers_ws_idx on public.vehicle_transfers (workshop_id, requested_at desc);
create index vehicle_transfers_from_idx on public.vehicle_transfers (from_customer_id) where status = 'pendiente';
create index vehicle_transfers_to_idx on public.vehicle_transfers (to_customer_id);

alter table public.vehicle_transfers enable row level security;
revoke all on public.vehicle_transfers from anon, authenticated;
grant select on public.vehicle_transfers to authenticated;
grant all on public.vehicle_transfers to service_role;
create policy vehicle_transfers_office_read on public.vehicle_transfers for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()));

-- El titular de un vehículo que ya tiene uno no se cambia escribiendo en la tabla.
create function private.vehicles_owner_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.customer_id is not null and new.customer_id is distinct from old.customer_id then
    raise exception 'Para cambiar el titular usa «Cambiar de titular»: queda registrado cómo se comprobó.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.vehicles_owner_guard() from public, anon, authenticated;
create trigger vehicles_owner_guard before update of customer_id on public.vehicles
  for each row execute function private.vehicles_owner_guard();

-- Hace el cambio (dentro de las funciones de abajo, que ya han comprobado permisos).
create function private.do_vehicle_transfer(p_id uuid, p_method text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  t public.vehicle_transfers;
  v public.vehicles;
  w text;
begin
  select * into t from public.vehicle_transfers where id = p_id and status = 'pendiente' for update;
  if t.id is null then
    raise exception 'Esta solicitud ya no está pendiente.' using errcode = '22023';
  end if;
  select * into v from public.vehicles where id = t.vehicle_id for update;
  if v.customer_id is distinct from t.from_customer_id then
    raise exception 'El vehículo ha cambiado de titular mientras tanto. Vuelve a cargar la página.' using errcode = '22023';
  end if;
  if exists (select 1 from public.repair_orders o where o.vehicle_id = v.id and o.status <> 'entregado') then
    raise exception 'Hay una reparación en curso con este vehículo: entrégala antes de cambiar el titular.' using errcode = '22023';
  end if;

  update public.vehicles set customer_id = t.to_customer_id where id = v.id;
  update public.vehicle_transfers
     set status = 'confirmado', method = p_method, decided_at = now(), decided_by = auth.uid()
   where id = t.id;
  -- Otras peticiones abiertas sobre el mismo vehículo dejan de tener sentido.
  update public.vehicle_transfers set status = 'anulado', decided_at = now()
   where vehicle_id = v.id and status = 'pendiente' and id <> t.id;
  -- Los recordatorios pendientes del titular anterior sobre este vehículo, fuera.
  if t.from_customer_id is not null then
    update public.reminders set status = 'descartado', dismissed_at = now()
     where vehicle_id = v.id and customer_id = t.from_customer_id and status = 'pendiente';
  end if;

  select name into w from public.workshops where id = v.workshop_id;
  if t.from_customer_id is not null then
    perform private.enqueue_notice(t.from_customer_id, 'cambio_titular', 'Tu vehículo ha cambiado de titular',
      left(format('%s %s (%s) ha pasado a otra persona y ya no aparece en tu portal. Tus reparaciones y facturas anteriores se conservan.',
                  v.make, v.model, v.plate), 600),
      '/portal/reparaciones', null, 'titular:' || t.id || ':anterior');
  end if;
  perform private.enqueue_notice(t.to_customer_id, 'cambio_titular', 'Ya tienes tu vehículo en tu portal',
    left(format('%s %s (%s) está ya a tu nombre en %s.', v.make, v.model, v.plate, w), 600),
    '/portal/vehiculos/' || v.id, null, 'titular:' || t.id || ':nuevo');
end;
$$;
revoke all on function private.do_vehicle_transfer(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Portal
-- ---------------------------------------------------------------------
-- El comprador lo pide con la matrícula (3 al día por ficha). Devuelve la solicitud.
create function public.portal_request_vehicle_transfer(p_customer_id uuid, p_plate text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  c public.customers;
  v public.vehicles;
  v_plate text := private.normalize_plate(coalesce(p_plate, ''));
  v_id uuid;
begin
  c := private.require_portal_customer(p_customer_id);
  if v_plate !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'Matrícula no válida.' using errcode = '22023';
  end if;
  select * into v from public.vehicles ve where ve.workshop_id = c.workshop_id and ve.plate = v_plate;
  if v.id is null then
    raise exception 'Esa matrícula no está registrada en el taller: añádela como vehículo nuevo.' using errcode = '22023';
  end if;
  if v.customer_id = c.id then
    raise exception 'Ese vehículo ya está a tu nombre.' using errcode = '22023';
  end if;
  select id into v_id from public.vehicle_transfers
   where vehicle_id = v.id and to_customer_id = c.id and status = 'pendiente';
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.vehicle_transfers
       where to_customer_id = c.id and origin = 'portal' and requested_at > now() - interval '1 day') >= 3 then
    raise exception 'Has pedido varios cambios hoy. Inténtalo mañana o díselo al taller.' using errcode = '22023';
  end if;
  insert into public.vehicle_transfers (workshop_id, vehicle_id, from_customer_id, to_customer_id, origin)
  values (c.workshop_id, v.id, v.customer_id, c.id, 'portal')
  returning id into v_id;
  -- Al titular actual se le pregunta (sin decirle quién lo pide).
  if v.customer_id is not null then
    perform private.enqueue_notice(v.customer_id, 'cambio_titular', '¿Has vendido tu vehículo?',
      left(format('Han pedido poner %s %s (%s) a otro nombre. Entra en tu portal y di si lo has vendido.', v.make, v.model, v.plate), 600),
      '/portal/vehiculos', null, 'titular:' || v_id || ':pregunta');
  end if;
  return v_id;
end;
$$;
revoke all on function public.portal_request_vehicle_transfer(uuid, text) from public, anon;
grant execute on function public.portal_request_vehicle_transfer(uuid, text) to authenticated;

-- Lo que ve el cliente: como comprador, sus peticiones; como titular, las pendientes sobre sus vehículos.
create function public.portal_vehicle_transfers()
returns table (id uuid, role text, vehicle_id uuid, plate text, make text, model text,
               status text, seller_answer text, requested_at timestamptz, decided_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select t.id, 'comprador', t.vehicle_id, v.plate, v.make, v.model, t.status, null::text, t.requested_at, t.decided_at
    from public.vehicle_transfers t join public.vehicles v on v.id = t.vehicle_id
   where t.to_customer_id in (select private.portal_customer_ids())
     and (t.status = 'pendiente' or t.decided_at > now() - interval '30 days')
  union all
  select t.id, 'vendedor', t.vehicle_id, v.plate, v.make, v.model, t.status, t.seller_answer, t.requested_at, t.decided_at
    from public.vehicle_transfers t join public.vehicles v on v.id = t.vehicle_id
   where t.from_customer_id in (select private.portal_customer_ids()) and t.status = 'pendiente'
   order by 9 desc;
$$;
revoke all on function public.portal_vehicle_transfers() from public, anon;
grant execute on function public.portal_vehicle_transfers() to authenticated;

-- El titular contesta. «Vendido» hace el cambio; «No vendido» lo deja para la oficina.
create function public.portal_answer_vehicle_transfer(p_transfer_id uuid, p_sold boolean)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare t public.vehicle_transfers;
begin
  perform private.require_user();
  select * into t from public.vehicle_transfers
   where id = p_transfer_id and status = 'pendiente' and from_customer_id in (select private.portal_customer_ids())
   for update;
  if t.id is null or p_sold is null then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;
  update public.vehicle_transfers
     set seller_answer = case when p_sold then 'vendido' else 'no_vendido' end, seller_answered_at = now()
   where id = t.id;
  if p_sold then
    perform private.do_vehicle_transfer(t.id, 'vendedor');
    return 'confirmado';
  end if;
  return 'no_vendido';
end;
$$;
revoke all on function public.portal_answer_vehicle_transfer(uuid, boolean) from public, anon;
grant execute on function public.portal_answer_vehicle_transfer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Oficina del taller (propietario, administración y recepción)
-- ---------------------------------------------------------------------
create function private.office_transfer(p_transfer_id uuid)
returns public.vehicle_transfers language plpgsql stable security definer set search_path = ''
as $$
declare t public.vehicle_transfers;
begin
  perform private.require_user();
  select * into t from public.vehicle_transfers where id = p_transfer_id;
  if t.id is null or t.workshop_id not in (select private.office_workshop_ids()) then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;
  if t.status <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente.' using errcode = '22023';
  end if;
  return t;
end;
$$;
revoke all on function private.office_transfer(uuid) from public, anon, authenticated;

-- Confirmar una petición tras ver el permiso de circulación o la app miDGT.
create function public.confirm_vehicle_transfer(p_transfer_id uuid, p_method text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.office_transfer(p_transfer_id);
  if p_method is null or p_method not in ('permiso', 'midgt') then
    raise exception 'Indica qué documento has comprobado: el permiso de circulación o la app miDGT.' using errcode = '22023';
  end if;
  perform private.do_vehicle_transfer(p_transfer_id, p_method);
end;
$$;
revoke all on function public.confirm_vehicle_transfer(uuid, text) from public, anon;
grant execute on function public.confirm_vehicle_transfer(uuid, text) to authenticated;

create function public.reject_vehicle_transfer(p_transfer_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare t public.vehicle_transfers; v public.vehicles;
begin
  t := private.office_transfer(p_transfer_id);
  update public.vehicle_transfers set status = 'rechazado', decided_at = now(), decided_by = auth.uid() where id = t.id;
  select * into v from public.vehicles where id = t.vehicle_id;
  perform private.enqueue_notice(t.to_customer_id, 'cambio_titular', 'No se ha hecho el cambio de titular',
    left(format('El taller no ha podido comprobar que %s %s (%s) esté a tu nombre. Llévale el permiso de circulación o enséñale la app miDGT.',
                v.make, v.model, v.plate), 600),
    '/portal/vehiculos', null, 'titular:' || t.id || ':rechazado');
end;
$$;
revoke all on function public.reject_vehicle_transfer(uuid) from public, anon;
grant execute on function public.reject_vehicle_transfer(uuid) to authenticated;

-- En el mostrador, sin petición previa: pasar el vehículo a otra ficha del taller.
-- «correccion» = se registró en la ficha equivocada (no hubo venta).
create function public.transfer_vehicle(p_vehicle_id uuid, p_customer_id uuid, p_method text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare v public.vehicles; v_id uuid;
begin
  perform private.require_user();
  select * into v from public.vehicles where id = p_vehicle_id;
  if v.id is null or v.workshop_id not in (select private.office_workshop_ids()) then
    raise exception 'Vehículo no encontrado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.workshop_id = v.workshop_id) then
    raise exception 'Cliente no encontrado.' using errcode = '22023';
  end if;
  if v.customer_id is not distinct from p_customer_id then
    raise exception 'El vehículo ya está a nombre de ese cliente.' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('permiso', 'midgt', 'correccion') then
    raise exception 'Indica cómo lo has comprobado: permiso de circulación, app miDGT o corrección de un error.' using errcode = '22023';
  end if;
  -- Si el comprador ya lo había pedido desde su portal, se confirma esa petición.
  select id into v_id from public.vehicle_transfers
   where vehicle_id = v.id and to_customer_id = p_customer_id and status = 'pendiente';
  if v_id is null then
    insert into public.vehicle_transfers (workshop_id, vehicle_id, from_customer_id, to_customer_id, origin)
    values (v.workshop_id, v.id, v.customer_id, p_customer_id, 'taller')
    returning id into v_id;
  end if;
  perform private.do_vehicle_transfer(v_id, p_method);
  return v_id;
end;
$$;
revoke all on function public.transfer_vehicle(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_vehicle(uuid, uuid, text) to authenticated;

-- El historial de titulares va en la copia del taller.
create or replace function private.export_tables()
returns table (table_name text, drop_columns text[])
language sql immutable set search_path = ''
as $$
  values
    ('customers', '{}'::text[]), ('vehicles', '{}'), ('repair_orders', '{}'), ('repair_order_items', '{}'),
    ('repair_order_events', '{}'), ('repair_order_work_logs', '{}'), ('service_intervals', '{}'), ('order_services', '{}'),
    ('vehicle_services', '{}'), ('quotes', '{token_hash,response_ip_hash}'), ('quote_items', '{}'), ('invoices', '{}'),
    ('invoice_items', '{}'), ('invoice_records', '{}'), ('payments', '{}'), ('invoice_counters', '{}'), ('workshop_counters', '{}'),
    ('reminders', '{}'), ('reminder_settings', '{}'), ('notifications', '{}'), ('customer_contact_preferences', '{}'),
    ('communication_consent_log', '{}'), ('customer_invitations', '{token_hash}'), ('workshop_invitations', '{token_hash}'),
    ('web_requests', '{client_hash,idempotency_key}'), ('vehicle_lookups', '{request_key}'), ('workshop_billing_settings', '{}'),
    ('workshop_notification_settings', '{}'), ('workshop_sites', '{}'), ('workshop_domains', '{}'), ('workshop_data_exports', '{}'),
    ('access_events', '{}'), ('customer_account_links', '{}'), ('workshop_legal_acceptances', '{}'), ('workshop_plans', '{}'),
    ('vehicle_transfers', '{}')
$$;
