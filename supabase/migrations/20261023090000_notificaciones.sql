-- =====================================================================
-- Fase 7 · Notificaciones (centro de avisos, email y preferencias)
--
-- Cambios NO destructivos: tipos y tablas nuevos, una restricción única
-- nueva en repair_orders y funciones nuevas.
--
-- Cómo funciona (patrón "outbox"):
--   1. Cada cambio real de estado ya queda en repair_order_events (lo
--      escriben los disparadores de la Fase 4; guardar sin cambiar el estado
--      no crea evento).
--   2. Un disparador sobre repair_order_events crea, EN LA MISMA
--      TRANSACCIÓN, el aviso interno del portal y, si procede, un email
--      "pendiente". Si el cambio de estado se deshace, el aviso también.
--   3. El servidor reclama los emails pendientes (claim_email_notifications),
--      los envía con el proveedor y anota el resultado (record_email_result).
--      Reintentos limitados con esperas crecientes; estado final "fallido".
--   4. El proveedor confirma la entrega por webhook (record_email_delivery).
--
-- Un email "enviado" significa "aceptado por el proveedor"; "entregado",
-- solo si el proveedor confirma la entrega.
-- =====================================================================

create type public.notification_channel as enum ('app', 'email');
create type public.notification_status as enum ('pendiente', 'procesando', 'enviado', 'entregado', 'fallido', 'cancelado');
create type public.notification_event as enum ('vehiculo_recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado');
create type public.notification_purpose as enum ('operativa', 'comercial');

alter table public.repair_orders add constraint repair_orders_id_workshop_key unique (id, workshop_id);

-- ---------------------------------------------------------------------
-- 1. Ajustes por taller (reglas automáticas)
-- ---------------------------------------------------------------------
create table public.workshop_notification_settings (
  workshop_id    uuid primary key references public.workshops (id) on delete cascade,
  -- El email está apagado hasta que el taller lo active (y la plataforma tenga proveedor).
  email_enabled  boolean not null default false,
  app_events     public.notification_event[] not null
                 default '{vehiculo_recibido,diagnosis,esperando_recambios,en_reparacion,listo,entregado}',
  -- Por email, solo los momentos importantes para no saturar al cliente.
  email_events   public.notification_event[] not null
                 default '{vehiculo_recibido,esperando_recambios,listo,entregado}',
  -- Dirección a la que responde el cliente (opcional).
  reply_to       text check (reply_to is null or (length(reply_to) <= 254 and reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);
comment on table public.workshop_notification_settings is 'Qué avisos genera cada taller y por qué canal. Lo editan propietario y administradores.';

insert into public.workshop_notification_settings (workshop_id) select id from public.workshops on conflict do nothing;

create function private.workshops_notification_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.workshop_notification_settings (workshop_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.workshops_notification_defaults() from public, anon, authenticated;
create trigger workshops_notification_defaults after insert on public.workshops
  for each row execute function private.workshops_notification_defaults();

create trigger workshop_notification_settings_updated_at before update on public.workshop_notification_settings
  for each row execute function private.set_updated_at();
create trigger workshop_notification_settings_keep_workshop before update on public.workshop_notification_settings
  for each row execute function private.keep_workshop_id();

revoke all on public.workshop_notification_settings from anon, authenticated;
grant all on public.workshop_notification_settings to service_role;
grant select on public.workshop_notification_settings to authenticated;
grant update (email_enabled, app_events, email_events, reply_to) on public.workshop_notification_settings to authenticated;
alter table public.workshop_notification_settings enable row level security;
create policy "notification settings: lectura personal" on public.workshop_notification_settings for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "notification settings: edición gestores" on public.workshop_notification_settings for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- 2. Preferencias de comunicación del cliente y registro de consentimientos
-- ---------------------------------------------------------------------
-- Sin fila = valores por defecto: avisos operativos por email SÍ (son parte
-- del servicio contratado, y se pueden desactivar), comunicaciones
-- comerciales NO (exigen consentimiento expreso del propio cliente).
create table public.customer_contact_preferences (
  customer_id        uuid primary key,
  workshop_id        uuid not null references public.workshops (id) on delete cascade,
  operational_email  boolean not null default true,
  marketing_email    boolean not null default false,
  updated_at         timestamptz not null default now(),
  updated_by         uuid default auth.uid(),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade
);
comment on table public.customer_contact_preferences is 'Canales que acepta cada cliente. Solo se cambia con set_contact_preferences.';

-- Prueba de cada cambio (RGPD: hay que poder demostrar el consentimiento). No se modifica ni se borra.
create table public.communication_consent_log (
  id           bigint generated always as identity primary key,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  customer_id  uuid not null,
  purpose      public.notification_purpose not null,
  channel      public.notification_channel not null,
  granted      boolean not null,
  -- 'portal' (el propio cliente), 'panel' (el taller, a petición del cliente), 'queja_proveedor'
  source       text not null check (source in ('portal', 'panel', 'queja_proveedor')),
  actor        uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade
);
create index communication_consent_log_customer_idx on public.communication_consent_log (customer_id, created_at desc);

revoke all on public.customer_contact_preferences, public.communication_consent_log from anon, authenticated;
grant all on public.customer_contact_preferences, public.communication_consent_log to service_role;
grant select on public.customer_contact_preferences, public.communication_consent_log to authenticated;
alter table public.customer_contact_preferences enable row level security;
alter table public.communication_consent_log enable row level security;
create policy "contact preferences: lectura personal" on public.customer_contact_preferences for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "consent log: lectura gestores" on public.communication_consent_log for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

create function private.contact_preferences(p_customer_id uuid)
returns table (operational_email boolean, marketing_email boolean)
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.operational_email, true), coalesce(p.marketing_email, false)
  from (select 1) x left join public.customer_contact_preferences p on p.customer_id = p_customer_id;
$$;

-- ---------------------------------------------------------------------
-- 3. Notificaciones
-- ---------------------------------------------------------------------
create table public.notifications (
  id                   uuid primary key default gen_random_uuid(),
  workshop_id          uuid not null references public.workshops (id) on delete cascade,
  customer_id          uuid not null,
  order_id             uuid,
  -- Cambio de estado que la originó: un aviso por evento y canal (idempotencia).
  source_event_id      bigint references public.repair_order_events (id) on delete cascade,
  channel              public.notification_channel not null,
  event                public.notification_event,
  purpose              public.notification_purpose not null default 'operativa',
  template             text not null check (template ~ '^[a-z0-9_]{1,40}$'),
  title                text not null check (length(title) between 1 and 200),
  body                 text not null check (length(body) <= 4000),
  -- Solo email: dirección a la que se envía (la de la ficha en ese momento).
  recipient            text,
  status               public.notification_status not null default 'pendiente',
  attempts             smallint not null default 0,
  max_attempts         smallint not null default 5 check (max_attempts between 1 and 10),
  manual_retries       smallint not null default 0,
  next_attempt_at      timestamptz not null default now(),
  last_attempt_at      timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  cancelled_at         timestamptz,
  provider             text check (provider is null or provider ~ '^[a-z0-9_-]{1,40}$'),
  provider_message_id  text check (length(provider_message_id) <= 200),
  -- Código general, sin datos personales ni detalles técnicos del proveedor.
  error_code           text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  created_at           timestamptz not null default now(),
  unique (source_event_id, channel),
  check ((channel = 'email') = (recipient is not null)),
  check (recipient is null or (length(recipient) <= 254 and recipient ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade,
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id)
);
comment on table public.notifications is 'Avisos al cliente (portal y email) con su estado de envío. Solo los escribe la base de datos y el servidor.';
create index notifications_workshop_idx on public.notifications (workshop_id, created_at desc);
create index notifications_inbox_idx on public.notifications (customer_id, created_at desc) where channel = 'app';
create index notifications_outbox_idx on public.notifications (next_attempt_at) where channel = 'email' and status in ('pendiente', 'procesando');
create index notifications_order_idx on public.notifications (order_id) where order_id is not null;
create unique index notifications_provider_message_idx on public.notifications (provider, provider_message_id) where provider_message_id is not null;

revoke all on public.notifications from anon, authenticated;
grant all on public.notifications to service_role;
grant select on public.notifications to authenticated;
alter table public.notifications enable row level security;
-- Solo propietario y administradores (y la plataforma). Los clientes, por las funciones portal_*.
create policy "notifications: lectura gestores" on public.notifications for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- Comunicaciones comerciales: imposibles sin consentimiento del cliente para ese canal.
create function private.notifications_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.purpose = 'comercial' then
    -- Todavía no hay forma de consentir avisos comerciales dentro del portal: ese canal queda cerrado.
    if new.channel = 'app' then
      raise exception 'No hay consentimiento para comunicaciones comerciales en el portal.' using errcode = '42501';
    end if;
    if not (select p.marketing_email from private.contact_preferences(new.customer_id) p) then
      raise exception 'El cliente no ha dado su consentimiento para comunicaciones comerciales por email.' using errcode = '42501';
    end if;
  elsif new.channel = 'email' and not (select p.operational_email from private.contact_preferences(new.customer_id) p) then
    raise exception 'El cliente ha desactivado los avisos por email.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.notifications_guard() from public, anon, authenticated;
create trigger notifications_guard before insert on public.notifications
  for each row execute function private.notifications_guard();

-- Textos para el cliente (sincronizados con REPAIR_STATUS_CUSTOMER_TEXT de packages/core;
-- lo comprueba apps/web/src/lib/notifications/notifications.test.ts).
create function private.status_customer_text(p_status public.repair_status)
returns text language sql immutable set search_path = ''
as $$
  select case p_status
    when 'recibido' then 'El taller ha recibido tu vehículo. El siguiente paso es revisarlo.'
    when 'diagnosis' then 'El taller está revisando tu vehículo para saber qué necesita.'
    when 'esperando_recambios' then 'El taller está esperando las piezas necesarias para continuar.'
    when 'en_reparacion' then 'El taller está trabajando en tu vehículo.'
    when 'listo' then 'Tu vehículo está listo. Puedes pasar a recogerlo en el horario del taller.'
    when 'entregado' then 'Vehículo entregado. La reparación ha terminado.'
  end;
$$;

create function private.status_rank(p_status public.repair_status)
returns int language sql immutable set search_path = ''
as $$ select array_position(enum_range(null::public.repair_status), p_status); $$;

-- Cada cambio real de estado (y la creación de la orden) genera sus avisos.
create function private.notify_order_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_order     public.repair_orders;
  v_customer  public.customers;
  v_vehicle   public.vehicles;
  v_settings  public.workshop_notification_settings;
  v_wstatus   public.workshop_status;
  v_event     public.notification_event;
  v_back      boolean;
  v_title     text;
  v_body      text;
begin
  if new.kind::text not in ('creada', 'estado') or new.to_status is null then
    return null;
  end if;
  select * into v_order from public.repair_orders o where o.id = new.order_id;
  select * into v_customer from public.customers c where c.id = v_order.customer_id;
  select * into v_vehicle from public.vehicles v where v.id = v_order.vehicle_id;
  select * into v_settings from public.workshop_notification_settings s where s.workshop_id = new.workshop_id;
  select w.status into v_wstatus from public.workshops w where w.id = new.workshop_id;
  if v_customer.id is null or v_wstatus = 'suspendido' then
    return null;
  end if;

  v_event := case new.to_status
    when 'recibido' then 'vehiculo_recibido' else new.to_status::text
  end::public.notification_event;
  -- Vuelta atrás desde "listo" o "entregado" (corrección o la reparación sigue): se explica como actualización.
  v_back := new.kind::text = 'estado' and new.from_status in ('listo', 'entregado')
            and private.status_rank(new.to_status) < private.status_rank(new.from_status);

  v_title := case when v_back then 'Actualización del estado de tu reparación'
    else case v_event
      when 'vehiculo_recibido' then 'Hemos recibido tu vehículo'
      when 'diagnosis' then 'Tu vehículo está en diagnosis'
      when 'esperando_recambios' then 'Estamos esperando recambios'
      when 'en_reparacion' then 'Tu vehículo está en reparación'
      when 'listo' then 'Tu vehículo está listo para recoger'
      when 'entregado' then 'Vehículo entregado'
    end end;
  -- Solo información que el cliente ya puede ver en su portal: vehículo, número, estado y mensaje del taller.
  v_body := coalesce(v_vehicle.make || ' ' || v_vehicle.model || ' · ', '') || 'OR-' || v_order.number || E'\n'
         || private.status_customer_text(new.to_status)
         || coalesce(E'\n\nMensaje del taller: ' || nullif(btrim(new.customer_message), ''), '');

  -- Tras una vuelta atrás, un email aún no enviado ya no es cierto: se cancela siempre.
  if v_back then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'estado_corregido'
     where n.order_id = v_order.id and n.channel = 'email' and n.status = 'pendiente';
  end if;

  -- Portal: solo si el cliente tiene cuenta vinculada (si no, nadie lo leería).
  if v_customer.user_id is not null and v_event = any (coalesce(v_settings.app_events, '{}')) then
    insert into public.notifications (workshop_id, customer_id, order_id, source_event_id, channel, event, template, title, body,
                                      status, sent_at, delivered_at)
    values (new.workshop_id, v_customer.id, v_order.id, new.id, 'app', v_event, 'reparacion_estado_v1', v_title, v_body,
            'entregado', now(), now())
    on conflict (source_event_id, channel) do nothing;
  end if;

  if coalesce(v_settings.email_enabled, false) and v_event = any (v_settings.email_events)
     and v_customer.email is not null and v_customer.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(v_customer.email) <= 254
     and (select p.operational_email from private.contact_preferences(v_customer.id) p) then
    -- El cliente solo necesita el último estado: un email aún no enviado de esta orden queda sustituido.
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'sustituida'
     where n.order_id = v_order.id and n.channel = 'email' and n.status = 'pendiente';
    insert into public.notifications (workshop_id, customer_id, order_id, source_event_id, channel, event, template, title, body, recipient)
    values (new.workshop_id, v_customer.id, v_order.id, new.id, 'email', v_event, 'reparacion_estado_v1', v_title, v_body, lower(btrim(v_customer.email)))
    on conflict (source_event_id, channel) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.notify_order_event() from public, anon, authenticated;
create trigger repair_order_events_notify after insert on public.repair_order_events
  for each row execute function private.notify_order_event();

-- ---------------------------------------------------------------------
-- 4. Envío por email (solo el servidor, con la clave secreta)
-- ---------------------------------------------------------------------

-- Espera antes del siguiente intento automático: 1 min, 5 min, 30 min, 2 h.
create function private.notification_backoff(p_attempts int)
returns interval language sql immutable set search_path = ''
as $$ select (array['1 minute', '5 minutes', '30 minutes', '2 hours']::interval[])[least(greatest(p_attempts, 1), 4)]; $$;

create function public.claim_email_notifications(p_limit integer default 20, p_order_id uuid default null)
returns table (id uuid, workshop_id uuid, workshop_name text, reply_to text, order_id uuid, event public.notification_event,
               template text, title text, body text, recipient text, attempts smallint)
language plpgsql security definer set search_path = ''
as $$
begin
  -- Un aviso operativo de hace más de 2 días ya no tiene sentido: se cancela.
  update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'caducada'
   where n.channel = 'email' and n.status = 'pendiente' and n.created_at < now() - interval '2 days';
  -- Un envío que se quedó a medias (el servidor se cayó) vuelve a la cola; el proveedor
  -- descarta el duplicado gracias a la clave de idempotencia (el id del aviso).
  update public.notifications n set status = 'pendiente'
   where n.channel = 'email' and n.status = 'procesando' and n.last_attempt_at < now() - interval '10 minutes';

  return query
  with picked as (
    select n.id from public.notifications n
     where n.channel = 'email' and n.status = 'pendiente' and n.next_attempt_at <= now()
       and (p_order_id is null or n.order_id = p_order_id)
     order by n.next_attempt_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update skip locked
  ), checked as (
    -- Se vuelve a comprobar en el momento de enviar: preferencias, ajustes del taller y estado del taller.
    select n.id,
           case when not (select p.operational_email from private.contact_preferences(n.customer_id) p) and n.purpose = 'operativa' then 'preferencia'
                when n.purpose = 'comercial' and not (select p.marketing_email from private.contact_preferences(n.customer_id) p) then 'sin_consentimiento'
                when not coalesce(s.email_enabled, false) then 'desactivado'
                when w.status = 'suspendido' then 'taller_suspendido'
           end as reason
      from public.notifications n
      join picked using (id)
      join public.workshops w on w.id = n.workshop_id
      left join public.workshop_notification_settings s on s.workshop_id = n.workshop_id
  ), cancelled as (
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = c.reason
      from checked c where c.id = n.id and c.reason is not null
    returning n.id
  ), claimed as (
    update public.notifications n set status = 'procesando', attempts = n.attempts + 1, last_attempt_at = now()
      from checked c where c.id = n.id and c.reason is null
    returning n.*
  )
  select c.id, c.workshop_id, w.name, s.reply_to, c.order_id, c.event, c.template, c.title, c.body, c.recipient, c.attempts
    from claimed c
    join public.workshops w on w.id = c.workshop_id
    left join public.workshop_notification_settings s on s.workshop_id = c.workshop_id;
end;
$$;

-- p_result: 'aceptado' (el proveedor lo ha aceptado), 'temporal' (se reintentará) o 'permanente'.
create function public.record_email_result(p_id uuid, p_result text, p_provider text, p_message_id text default null, p_error_code text default null)
returns public.notification_status
language plpgsql security definer set search_path = ''
as $$
declare
  v public.notifications;
begin
  if p_result not in ('aceptado', 'temporal', 'permanente') then
    raise exception 'Resultado no válido.' using errcode = '22023';
  end if;
  select * into v from public.notifications n where n.id = p_id for update;
  if v.id is null or v.status <> 'procesando' then
    raise exception 'El aviso no se está enviando.' using errcode = '22023';
  end if;
  if p_result = 'aceptado' then
    update public.notifications set status = 'enviado', sent_at = now(), provider = p_provider,
           provider_message_id = left(p_message_id, 200), error_code = null
     where id = p_id returning status into v.status;
  elsif p_result = 'temporal' and v.attempts < v.max_attempts then
    update public.notifications set status = 'pendiente', provider = p_provider, error_code = p_error_code,
           next_attempt_at = now() + private.notification_backoff(v.attempts)
     where id = p_id returning status into v.status;
  else
    update public.notifications set status = 'fallido', provider = p_provider,
           error_code = coalesce(p_error_code, case when p_result = 'temporal' then 'reintentos_agotados' else 'rechazado' end)
     where id = p_id returning status into v.status;
  end if;
  return v.status;
end;
$$;

-- Confirmaciones del proveedor (webhook firmado). Nunca "rebaja" un estado: no se pasa de entregado a enviado.
create function public.record_email_delivery(p_provider text, p_message_id text, p_outcome text)
returns public.notification_status
language plpgsql security definer set search_path = ''
as $$
declare
  v public.notifications;
begin
  if p_outcome not in ('entregado', 'rebotado', 'queja', 'fallido', 'retrasado') then
    raise exception 'Resultado no válido.' using errcode = '22023';
  end if;
  select * into v from public.notifications n where n.provider = p_provider and n.provider_message_id = p_message_id for update;
  if v.id is null then
    return null;
  end if;
  if p_outcome = 'entregado' and v.status = 'enviado' then
    update public.notifications set status = 'entregado', delivered_at = now() where id = v.id returning status into v.status;
  elsif p_outcome in ('rebotado', 'fallido') and v.status in ('enviado', 'entregado') then
    update public.notifications set status = 'fallido', error_code = p_outcome where id = v.id returning status into v.status;
  elsif p_outcome = 'queja' then
    -- Lo ha marcado como spam: no se le vuelven a enviar emails hasta que él lo reactive.
    update public.notifications set error_code = 'queja' where id = v.id;
    insert into public.customer_contact_preferences (customer_id, workshop_id, operational_email, marketing_email, updated_by)
    values (v.customer_id, v.workshop_id, false, false, null)
    on conflict (customer_id) do update set operational_email = false, marketing_email = false, updated_at = now(), updated_by = null;
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source, actor)
    values (v.workshop_id, v.customer_id, 'operativa', 'email', false, 'queja_proveedor', null);
  end if;
  return v.status;
end;
$$;

-- Reintento manual (propietario o administrador). Nunca reenvía un aviso ya enviado o entregado.
create function public.retry_notification(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.notifications;
begin
  perform private.require_user();
  select * into v from public.notifications n where n.id = p_id for update;
  if v.id is null or not coalesce(private.my_role_in(v.workshop_id) in ('propietario', 'administrador'), false) then
    raise exception 'No tienes permiso para reintentar este aviso.' using errcode = '42501';
  end if;
  if v.channel <> 'email' or v.status <> 'fallido' then
    raise exception 'Solo se pueden reintentar los emails fallidos (nunca uno ya enviado).' using errcode = '22023';
  end if;
  if v.manual_retries >= 3 then
    raise exception 'Este aviso ya se ha reintentado 3 veces. Revisa la dirección del cliente.' using errcode = 'PT429';
  end if;
  if v.error_code in ('rebotado', 'queja') then
    raise exception 'La dirección rechazó el email: corrígela en la ficha del cliente antes de volver a intentarlo.' using errcode = '22023';
  end if;
  update public.notifications
     set status = 'pendiente', next_attempt_at = now(), max_attempts = least(v.attempts + 1, 10), manual_retries = v.manual_retries + 1, error_code = null
   where id = v.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Preferencias (cliente desde el portal; taller solo para retirar)
-- ---------------------------------------------------------------------
create function public.set_contact_preferences(p_customer_id uuid, p_operational_email boolean, p_marketing_email boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_user();
  v_customer public.customers;
  v_prev     record;
  v_source   text;
begin
  select * into v_customer from public.customers c where c.id = p_customer_id;
  if v_customer.id is null then
    raise exception 'No tienes permiso para cambiar estas preferencias.' using errcode = '42501';
  end if;
  if v_customer.user_id is not distinct from v_uid
     and exists (select 1 from public.workshops w where w.id = v_customer.workshop_id and w.status <> 'suspendido') then
    v_source := 'portal';
  elsif coalesce(private.my_role_in(v_customer.workshop_id) in ('propietario', 'administrador'), false) then
    v_source := 'panel';
  else
    raise exception 'No tienes permiso para cambiar estas preferencias.' using errcode = '42501';
  end if;

  select * into v_prev from private.contact_preferences(p_customer_id);
  -- El consentimiento comercial solo lo da el propio cliente. El taller puede retirarlo (a petición del cliente).
  if v_source = 'panel' and p_marketing_email and not v_prev.marketing_email then
    raise exception 'El consentimiento para comunicaciones comerciales solo lo puede dar el propio cliente desde su portal.' using errcode = '42501';
  end if;

  insert into public.customer_contact_preferences (customer_id, workshop_id, operational_email, marketing_email)
  values (p_customer_id, v_customer.workshop_id, p_operational_email, p_marketing_email)
  on conflict (customer_id) do update set operational_email = excluded.operational_email, marketing_email = excluded.marketing_email,
                                          updated_at = now(), updated_by = v_uid;
  if p_operational_email is distinct from v_prev.operational_email then
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source)
    values (v_customer.workshop_id, p_customer_id, 'operativa', 'email', p_operational_email, v_source);
  end if;
  if p_marketing_email is distinct from v_prev.marketing_email then
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source)
    values (v_customer.workshop_id, p_customer_id, 'comercial', 'email', p_marketing_email, v_source);
  end if;
  -- Si deja de aceptar avisos por email, no se envía lo que estuviera en cola.
  if not p_operational_email then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'preferencia'
     where n.customer_id = p_customer_id and n.channel = 'email' and n.status = 'pendiente' and n.purpose = 'operativa';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Portal del cliente (solo sus avisos)
-- ---------------------------------------------------------------------
create function public.portal_notifications(p_limit integer default 50)
returns table (id uuid, created_at timestamptz, title text, body text, read_at timestamptz, order_id uuid,
               workshop_name text, event public.notification_event)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.created_at, n.title, n.body, n.read_at, n.order_id, w.name, n.event
    from public.notifications n
    join public.workshops w on w.id = n.workshop_id
   where n.channel = 'app' and n.customer_id in (select private.portal_customer_ids())
   order by n.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create function public.portal_unread_notifications()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.notifications n
   where n.channel = 'app' and n.read_at is null and n.customer_id in (select private.portal_customer_ids());
$$;

-- Marca como leído un aviso propio (o todos, con null). Devuelve cuántos ha marcado.
create function public.portal_mark_notifications_read(p_id uuid default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_user();
  update public.notifications n set read_at = now()
   where n.channel = 'app' and n.read_at is null and n.customer_id in (select private.portal_customer_ids())
     and (p_id is null or n.id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.portal_contact_preferences()
returns table (customer_id uuid, workshop_name text, has_email boolean, operational_email boolean, marketing_email boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, w.name, c.email is not null, p.operational_email, p.marketing_email
    from public.customers c
    join public.workshops w on w.id = c.workshop_id
    cross join lateral private.contact_preferences(c.id) p
   where c.id in (select private.portal_customer_ids())
   order by w.name;
$$;

-- ---------------------------------------------------------------------
-- Permisos de las funciones
-- ---------------------------------------------------------------------
revoke all on function private.contact_preferences(uuid) from public, anon, authenticated;
grant execute on function private.contact_preferences(uuid) to service_role;
revoke all on function private.status_customer_text(public.repair_status) from public, anon, authenticated;
revoke all on function private.status_rank(public.repair_status) from public, anon, authenticated;
revoke all on function private.notification_backoff(int) from public, anon, authenticated;

revoke all on function public.claim_email_notifications(integer, uuid) from public, anon, authenticated;
revoke all on function public.record_email_result(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_email_delivery(text, text, text) from public, anon, authenticated;
revoke all on function public.retry_notification(uuid) from public, anon, authenticated;
revoke all on function public.set_contact_preferences(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.portal_notifications(integer) from public, anon, authenticated;
revoke all on function public.portal_unread_notifications() from public, anon, authenticated;
revoke all on function public.portal_mark_notifications_read(uuid) from public, anon, authenticated;
revoke all on function public.portal_contact_preferences() from public, anon, authenticated;

grant execute on function public.claim_email_notifications(integer, uuid) to service_role;
grant execute on function public.record_email_result(uuid, text, text, text, text) to service_role;
grant execute on function public.record_email_delivery(text, text, text) to service_role;
grant execute on function public.retry_notification(uuid) to authenticated, service_role;
grant execute on function public.set_contact_preferences(uuid, boolean, boolean) to authenticated;
grant execute on function public.portal_notifications(integer) to authenticated;
grant execute on function public.portal_unread_notifications() to authenticated;
grant execute on function public.portal_mark_notifications_read(uuid) to authenticated;
grant execute on function public.portal_contact_preferences() to authenticated;
