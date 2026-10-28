-- =====================================================================
-- Coherencia de textos: el programa no emite facturas (son «resúmenes de
-- servicios»). El aviso al titular anterior de un vehículo vendido decía
-- «Tus reparaciones y facturas anteriores se conservan».
-- Misma función que en 20261109090100_cambio_titular.sql, solo cambia ese texto.
-- =====================================================================

create or replace function private.do_vehicle_transfer(p_id uuid, p_method text)
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
      left(format('%s %s (%s) ha pasado a otra persona y ya no aparece en tu portal. Tus reparaciones y resúmenes de servicios anteriores se conservan.',
                  v.make, v.model, v.plate), 600),
      '/portal/reparaciones', null, 'titular:' || t.id || ':anterior');
  end if;
  perform private.enqueue_notice(t.to_customer_id, 'cambio_titular', 'Ya tienes tu vehículo en tu portal',
    left(format('%s %s (%s) está ya a tu nombre en %s.', v.make, v.model, v.plate, w), 600),
    '/portal/vehiculos/' || v.id, null, 'titular:' || t.id || ':nuevo');
end;
$$;
revoke all on function private.do_vehicle_transfer(uuid, text) from public, anon, authenticated;
