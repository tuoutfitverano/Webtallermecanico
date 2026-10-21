-- Avisos del portal con enlace propio (presupuesto, factura, revisión…).
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
