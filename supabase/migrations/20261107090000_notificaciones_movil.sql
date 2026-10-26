-- Notificaciones en el móvil (Web Push) desde el portal del cliente.
--
-- Gratis: el navegador del cliente (Chrome, Safari, Firefox…) recibe un aviso
-- de su propio servicio de notificaciones, sin proveedor de pago. La persona lo
-- activa en su portal (el navegador le pide permiso) y vale solo para ESE
-- dispositivo. En iPhone hay que añadir antes el portal a la pantalla de inicio.
--
-- El aviso que llega al móvil NO lleva datos: es solo un «toque». Al recibirlo,
-- el móvil pide a la web el último aviso de la persona (con su sesión) y lo
-- enseña. Así ningún dato del cliente pasa por Google, Apple o Mozilla.
--
-- Solo avisos operativos (cambios de estado, presupuestos…), nunca comerciales.
-- Se envían desde el servidor con la clave secreta (claim_push_deliveries →
-- servicio del navegador → record_push_result).

create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  -- Dirección del servicio de notificaciones del navegador (https; http solo en local para pruebas).
  endpoint         text not null unique check (length(endpoint) <= 1000 and
                     (endpoint ~ '^https://[^\s]+$' or endpoint ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/[^\s]*$')),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failures         smallint not null default 0
);
comment on table public.push_subscriptions is 'Dispositivos donde la persona ha activado las notificaciones del portal. Sin datos personales: solo la dirección del servicio del navegador.';
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table public.push_outbox (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  created_at       timestamptz not null default now(),
  attempts         smallint not null default 0,
  next_attempt_at  timestamptz not null default now(),
  sent_at          timestamptz,
  unique (notification_id, user_id)
);
comment on table public.push_outbox is 'Notificaciones al móvil pendientes de enviar (una por aviso y persona). Solo la escriben la base de datos y el servidor.';
create index push_outbox_pending_idx on public.push_outbox (next_attempt_at) where sent_at is null;
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

-- ---------------------------------------------------------------------
-- La persona activa o quita las notificaciones en su dispositivo
-- ---------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  -- El mismo dispositivo con otra cuenta: pasa a la cuenta que lo activa ahora.
  insert into public.push_subscriptions (user_id, endpoint) values (v_uid, btrim(p_endpoint))
  on conflict (endpoint) do update set user_id = excluded.user_id, failures = 0;
  -- Como mucho 10 dispositivos por persona: se quitan los más antiguos.
  delete from public.push_subscriptions
   where id in (select s.id from public.push_subscriptions s where s.user_id = v_uid order by s.created_at desc offset 10);
end;
$$;
revoke all on function public.save_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text) to authenticated;

create function public.delete_push_subscription(p_endpoint text)
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from public.push_subscriptions where user_id = (select auth.uid()) and endpoint = btrim(p_endpoint);
$$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ¿Este dispositivo (endpoint) las tiene activadas? ¿Y cuántos tiene la persona?
create function public.my_push_status(p_endpoint text default null)
returns table (devices integer, this_device boolean)
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer, coalesce(bool_or(s.endpoint = btrim(p_endpoint)), false)
    from public.push_subscriptions s where s.user_id = (select auth.uid());
$$;
revoke all on function public.my_push_status(text) from public, anon;
grant execute on function public.my_push_status(text) to authenticated;

-- Lo que enseña el móvil al recibir el «toque»: el último aviso de la persona (24 h).
create function public.portal_push_preview()
returns table (title text, body text, link_path text, workshop_name text)
language sql stable security definer set search_path = ''
as $$
  select n.title, left(n.body, 300), coalesce(n.link_path, case when n.order_id is not null then '/portal/reparaciones/' || n.order_id else '/portal/avisos' end), w.name
    from public.notifications n
    join public.customers c on c.id = n.customer_id and c.workshop_id = n.workshop_id
    join public.workshops w on w.id = n.workshop_id
   where c.user_id = (select auth.uid()) and n.channel = 'app' and n.purpose = 'operativa'
     and n.created_at > now() - interval '24 hours' and w.status <> 'suspendido'
   order by n.created_at desc limit 1;
$$;
revoke all on function public.portal_push_preview() from public, anon;
grant execute on function public.portal_push_preview() to authenticated;

-- ---------------------------------------------------------------------
-- Cola: cada aviso del portal (operativo) para un cliente con cuenta y algún dispositivo
-- ---------------------------------------------------------------------
create function private.enqueue_push()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.channel = 'app' and new.purpose = 'operativa' then
    insert into public.push_outbox (user_id, notification_id)
    select c.user_id, new.id from public.customers c
     where c.id = new.customer_id and c.workshop_id = new.workshop_id and c.user_id is not null
       and exists (select 1 from public.push_subscriptions s where s.user_id = c.user_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_push() from public, anon, authenticated;
create trigger notifications_enqueue_push after insert on public.notifications
  for each row execute function private.enqueue_push();

-- ---------------------------------------------------------------------
-- Envío (servidor, clave secreta)
-- ---------------------------------------------------------------------
-- Reserva un lote: una fila por aviso y dispositivo. Como mucho 3 intentos por aviso.
create function public.claim_push_deliveries(p_limit integer default 50)
returns table (outbox_id bigint, subscription_id uuid, endpoint text)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  return query
  with picked as (
    select o.id from public.push_outbox o
     where o.sent_at is null and o.attempts < 3 and o.next_attempt_at <= now() and o.created_at > now() - interval '1 day'
     order by o.next_attempt_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  ), touched as (
    update public.push_outbox o set attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
      from picked where o.id = picked.id
    returning o.id, o.user_id
  )
  select t.id, s.id, s.endpoint from touched t join public.push_subscriptions s on s.user_id = t.user_id;
end;
$$;
revoke all on function public.claim_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

-- Resultado del servicio del navegador: 2xx = enviado; 404/410 = el dispositivo ya no existe (se quita).
create function public.record_push_result(p_outbox_id bigint, p_subscription_id uuid, p_status integer)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_status between 200 and 299 then
    update public.push_outbox set sent_at = coalesce(sent_at, now()) where id = p_outbox_id;
    update public.push_subscriptions set last_success_at = now(), failures = 0 where id = p_subscription_id;
  elsif p_status in (404, 410) then
    delete from public.push_subscriptions where id = p_subscription_id;
  else
    update public.push_subscriptions set failures = least(failures + 1, 1000) where id = p_subscription_id;
    -- Tras 20 fallos seguidos, el dispositivo se da por perdido.
    delete from public.push_subscriptions where id = p_subscription_id and failures >= 20;
  end if;
end;
$$;
revoke all on function public.record_push_result(bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.record_push_result(bigint, uuid, integer) to service_role;
