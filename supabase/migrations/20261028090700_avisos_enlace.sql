-- Avisos del portal con enlace propio (presupuesto, factura, revisión…) y
-- próxima revisión del vehículo en el portal.
--
-- portal_notifications devuelve también link_path (ruta del portal a la que
-- lleva el aviso; la tabla solo admite rutas /portal/…). Cambia el tipo de
-- resultado, así que se borra y se crea de nuevo con los mismos permisos.

drop function public.portal_notifications(integer);

create function public.portal_notifications(p_limit integer default 50)
returns table (id uuid, created_at timestamptz, title text, body text, read_at timestamptz, order_id uuid,
               workshop_name text, event public.notification_event, link_path text)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.created_at, n.title, n.body, n.read_at, n.order_id, w.name, n.event, n.link_path
    from public.notifications n
    join public.workshops w on w.id = n.workshop_id
   where n.channel = 'app' and n.customer_id in (select private.portal_customer_ids())
   order by n.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.portal_notifications(integer) from public, anon, authenticated;
grant execute on function public.portal_notifications(integer) to authenticated;

-- El portal enseña también la versión, los últimos kilómetros conocidos y la
-- próxima revisión recomendada (fecha, km y recomendación). Nunca notas
-- internas ni el bastidor.
drop function public.portal_vehicles();

create function public.portal_vehicles()
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
  order by v.plate;
$$;

revoke all on function public.portal_vehicles() from public, anon, authenticated;
grant execute on function public.portal_vehicles() to authenticated, service_role;
