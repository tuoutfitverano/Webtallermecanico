-- =====================================================================
-- Avisos por WhatsApp · 2/2 (cambios NO destructivos)
--
-- El cliente elige por dónde le llegan los avisos de su reparación: siempre
-- en su portal y, además, por email, por WhatsApp o por los dos.
--
--  · WhatsApp está APAGADO por defecto en cada cliente: solo lo activa el
--    propio cliente desde su portal (opt-in, como exige WhatsApp Business).
--    El taller solo puede retirarlo. Cada cambio queda en el registro de
--    consentimientos.
--  · Se envía al móvil de la ficha (España 6xx/7xx, o internacional con +).
--    Sin móvil válido no se puede activar ni se crea el aviso.
--  · Solo avisos operativos (estado de la reparación). Nunca comerciales por
--    WhatsApp: la base de datos lo impide.
--  · Mismo patrón "outbox" que el email: el aviso nace "pendiente" en la misma
--    transacción que el cambio de estado; el servidor lo reclama
--    (claim_whatsapp_notifications), lo envía con el proveedor y anota el
--    resultado (record_whatsapp_result). "enviado" = aceptado por el
--    proveedor; "entregado" = confirmado por webhook (record_whatsapp_delivery).
--  · Cada taller lo activa en Panel → Avisos (apagado por defecto, y sin
--    proveedor configurado en la plataforma no se puede activar).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ajustes del taller
-- ---------------------------------------------------------------------
alter table public.workshop_notification_settings
  add column whatsapp_enabled boolean not null default false,
  -- Como el email: solo los momentos importantes para no saturar al cliente.
  add column whatsapp_events public.notification_event[] not null default '{vehiculo_recibido,esperando_recambios,listo,entregado}';
grant update (whatsapp_enabled, whatsapp_events) on public.workshop_notification_settings to authenticated;
comment on column public.workshop_notification_settings.whatsapp_enabled is 'El taller envía avisos por WhatsApp (además de los clientes que lo hayan pedido).';

-- ---------------------------------------------------------------------
-- 2. Preferencia del cliente y número de WhatsApp
-- ---------------------------------------------------------------------
-- Sin fila = NO (WhatsApp exige que el propio cliente lo pida).
alter table public.customer_contact_preferences add column operational_whatsapp boolean not null default false;

create function private.whatsapp_preference(p_customer_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.operational_whatsapp from public.customer_contact_preferences p where p.customer_id = p_customer_id), false);
$$;

-- Número para WhatsApp (solo cifras, con prefijo de país) a partir del teléfono de la ficha.
-- España: móviles 6xx/7xx, con o sin +34. Otro país: solo si se escribió con + o 00.
-- Fijos o números raros: null (no se envía nada).
create function private.whatsapp_number(p_phone text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when x.d ~ '^[67][0-9]{8}$' then '34' || x.d
    when x.d ~ '^34[67][0-9]{8}$' then x.d
    when x.intl and x.d !~ '^34' and x.d ~ '^[1-9][0-9]{7,14}$' then x.d
  end
  from (select regexp_replace(regexp_replace(coalesce(btrim(p_phone), ''), '^00', ''), '[^0-9]', '', 'g') as d,
               coalesce(btrim(p_phone), '') ~ '^(\+|00)' as intl) x;
$$;

-- ---------------------------------------------------------------------
-- 3. Avisos: destinatario según el canal
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_check;
alter table public.notifications drop constraint if exists notifications_recipient_check;
alter table public.notifications
  add constraint notifications_recipient_by_channel check ((channel = 'app') = (recipient is null)),
  add constraint notifications_recipient_format check (
    recipient is null
    or (channel = 'email' and length(recipient) <= 254 and recipient ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    or (channel = 'whatsapp' and recipient ~ '^[0-9]{8,15}$'));
comment on table public.notifications is 'Avisos al cliente (portal, email y WhatsApp) con su estado de envío. Solo los escribe la base de datos y el servidor.';
create index notifications_whatsapp_outbox_idx on public.notifications (next_attempt_at) where channel = 'whatsapp' and status in ('pendiente', 'procesando');

-- Nada comercial por WhatsApp; los operativos, solo si el cliente los pidió.
create or replace function private.notifications_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.purpose = 'comercial' then
    -- Todavía no hay forma de consentir avisos comerciales dentro del portal: ese canal queda cerrado.
    if new.channel = 'app' then
      raise exception 'No hay consentimiento para comunicaciones comerciales en el portal.' using errcode = '42501';
    end if;
    if new.channel = 'whatsapp' then
      raise exception 'No se envían comunicaciones comerciales por WhatsApp.' using errcode = '42501';
    end if;
    if not (select p.marketing_email from private.contact_preferences(new.customer_id) p) then
      raise exception 'El cliente no ha dado su consentimiento para comunicaciones comerciales por email.' using errcode = '42501';
    end if;
  elsif new.channel = 'email' and not (select p.operational_email from private.contact_preferences(new.customer_id) p) then
    raise exception 'El cliente ha desactivado los avisos por email.' using errcode = '42501';
  elsif new.channel = 'whatsapp' and not private.whatsapp_preference(new.customer_id) then
    raise exception 'El cliente no ha pedido avisos por WhatsApp.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Cada cambio real de estado genera también su WhatsApp (si procede)
-- ---------------------------------------------------------------------
create or replace function private.notify_order_event()
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
  v_whatsapp  text;
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

  -- Tras una vuelta atrás, un email o WhatsApp aún no enviado ya no es cierto: se cancela siempre.
  if v_back then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'estado_corregido'
     where n.order_id = v_order.id and n.channel in ('email', 'whatsapp') and n.status = 'pendiente';
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

  -- WhatsApp: el taller lo tiene activado, el cliente lo ha pedido y la ficha tiene un móvil válido.
  v_whatsapp := private.whatsapp_number(v_customer.phone);
  if coalesce(v_settings.whatsapp_enabled, false) and v_event = any (v_settings.whatsapp_events)
     and v_whatsapp is not null and private.whatsapp_preference(v_customer.id) then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'sustituida'
     where n.order_id = v_order.id and n.channel = 'whatsapp' and n.status = 'pendiente';
    insert into public.notifications (workshop_id, customer_id, order_id, source_event_id, channel, event, template, title, body, recipient)
    values (new.workshop_id, v_customer.id, v_order.id, new.id, 'whatsapp', v_event, 'reparacion_estado_v1', v_title, v_body, v_whatsapp)
    on conflict (source_event_id, channel) do nothing;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Envío por WhatsApp (solo el servidor, con la clave secreta)
-- ---------------------------------------------------------------------
create function public.claim_whatsapp_notifications(p_limit integer default 20, p_order_id uuid default null)
returns table (id uuid, workshop_id uuid, workshop_name text, order_id uuid, event public.notification_event,
               template text, title text, body text, recipient text, attempts smallint)
language plpgsql security definer set search_path = ''
as $$
begin
  -- Un aviso de hace más de 2 días ya no tiene sentido: se cancela.
  update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'caducada'
   where n.channel = 'whatsapp' and n.status = 'pendiente' and n.created_at < now() - interval '2 days';
  -- Un envío que se quedó a medias vuelve a la cola a los 10 minutos.
  update public.notifications n set status = 'pendiente'
   where n.channel = 'whatsapp' and n.status = 'procesando' and n.last_attempt_at < now() - interval '10 minutes';

  return query
  with picked as (
    select n.id from public.notifications n
     where n.channel = 'whatsapp' and n.status = 'pendiente' and n.next_attempt_at <= now()
       and (p_order_id is null or n.order_id = p_order_id)
     order by n.next_attempt_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update skip locked
  ), checked as (
    -- Se vuelve a comprobar en el momento de enviar: destinatario actual, preferencia, ajustes y estado del taller.
    select n.id,
           case when n.order_id is not null and o.customer_id is distinct from n.customer_id then 'destinatario_cambiado'
                when private.whatsapp_number(c.phone) is distinct from n.recipient then 'destinatario_cambiado'
                when not private.whatsapp_preference(n.customer_id) then 'preferencia'
                when n.purpose = 'comercial' then 'sin_consentimiento'
                when not coalesce(s.whatsapp_enabled, false) then 'desactivado'
                when w.status = 'suspendido' then 'taller_suspendido'
           end as reason
      from public.notifications n
      join picked using (id)
      join public.workshops w on w.id = n.workshop_id
      join public.customers c on c.id = n.customer_id
      left join public.repair_orders o on o.id = n.order_id
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
  select c.id, c.workshop_id, w.name, c.order_id, c.event, c.template, c.title, c.body, c.recipient, c.attempts
    from claimed c
    join public.workshops w on w.id = c.workshop_id;
end;
$$;

-- Resultado de un envío por WhatsApp: mismas reglas de reintento que el email (record_email_result).
create function public.record_whatsapp_result(p_id uuid, p_result text, p_provider text, p_message_id text default null, p_error_code text default null)
returns public.notification_status
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.notifications n where n.id = p_id and n.channel = 'whatsapp') then
    raise exception 'El aviso no es de WhatsApp.' using errcode = '22023';
  end if;
  return public.record_email_result(p_id, p_result, p_provider, p_message_id, p_error_code);
end;
$$;

-- Confirmaciones del proveedor (webhook firmado): entregado, leído o fallido. Nunca "rebaja" un estado.
create function public.record_whatsapp_delivery(p_provider text, p_message_id text, p_outcome text)
returns public.notification_status
language plpgsql security definer set search_path = ''
as $$
declare
  v public.notifications;
begin
  if p_outcome not in ('entregado', 'leido', 'fallido') then
    raise exception 'Resultado no válido.' using errcode = '22023';
  end if;
  select * into v from public.notifications n
   where n.provider = p_provider and n.provider_message_id = p_message_id and n.channel = 'whatsapp' for update;
  if v.id is null then
    return null;
  end if;
  if p_outcome in ('entregado', 'leido') and v.status = 'enviado' then
    update public.notifications set status = 'entregado', delivered_at = now() where id = v.id returning status into v.status;
  elsif p_outcome = 'fallido' and v.status in ('enviado', 'entregado') then
    update public.notifications set status = 'fallido', error_code = 'fallido' where id = v.id returning status into v.status;
  end if;
  return v.status;
end;
$$;

-- Reintento manual (propietario o administrador): email o WhatsApp fallidos. Nunca reenvía lo ya enviado.
create or replace function public.retry_notification(p_id uuid)
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
  if v.channel not in ('email', 'whatsapp') or v.status <> 'fallido' then
    raise exception 'Solo se pueden reintentar los emails o WhatsApp fallidos (nunca uno ya enviado).' using errcode = '22023';
  end if;
  if v.manual_retries >= 3 then
    raise exception 'Este aviso ya se ha reintentado 3 veces. Revisa los datos de contacto del cliente.' using errcode = 'PT429';
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
-- 6. Preferencias: email y WhatsApp (cliente desde el portal; taller solo para retirar)
-- ---------------------------------------------------------------------
create function public.set_contact_preferences(p_customer_id uuid, p_operational_email boolean, p_marketing_email boolean, p_operational_whatsapp boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_user();
  v_customer public.customers;
  v_prev     record;
  v_prev_wa  boolean;
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
  v_prev_wa := private.whatsapp_preference(p_customer_id);
  -- El consentimiento comercial solo lo da el propio cliente. El taller puede retirarlo (a petición del cliente).
  if v_source = 'panel' and p_marketing_email and not v_prev.marketing_email then
    raise exception 'El consentimiento para comunicaciones comerciales solo lo puede dar el propio cliente desde su portal.' using errcode = '42501';
  end if;
  -- WhatsApp también lo pide solo el propio cliente (opt-in); el taller solo lo retira.
  if v_source = 'panel' and p_operational_whatsapp and not v_prev_wa then
    raise exception 'Los avisos por WhatsApp solo los puede pedir el propio cliente desde su portal.' using errcode = '42501';
  end if;
  if p_operational_whatsapp and not v_prev_wa and private.whatsapp_number(v_customer.phone) is null then
    raise exception 'Para recibir avisos por WhatsApp hace falta un móvil en tu ficha del taller. Pídele al taller que lo añada.' using errcode = '22023';
  end if;

  insert into public.customer_contact_preferences (customer_id, workshop_id, operational_email, marketing_email, operational_whatsapp)
  values (p_customer_id, v_customer.workshop_id, p_operational_email, p_marketing_email, p_operational_whatsapp)
  on conflict (customer_id) do update set operational_email = excluded.operational_email, marketing_email = excluded.marketing_email,
                                          operational_whatsapp = excluded.operational_whatsapp,
                                          updated_at = now(), updated_by = v_uid;
  if p_operational_email is distinct from v_prev.operational_email then
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source)
    values (v_customer.workshop_id, p_customer_id, 'operativa', 'email', p_operational_email, v_source);
  end if;
  if p_marketing_email is distinct from v_prev.marketing_email then
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source)
    values (v_customer.workshop_id, p_customer_id, 'comercial', 'email', p_marketing_email, v_source);
  end if;
  if p_operational_whatsapp is distinct from v_prev_wa then
    insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source)
    values (v_customer.workshop_id, p_customer_id, 'operativa', 'whatsapp', p_operational_whatsapp, v_source);
  end if;
  -- Lo que deja de aceptar no se envía aunque estuviera en cola.
  if not p_operational_email then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'preferencia'
     where n.customer_id = p_customer_id and n.channel = 'email' and n.status = 'pendiente' and n.purpose = 'operativa';
  end if;
  if not p_operational_whatsapp then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'preferencia'
     where n.customer_id = p_customer_id and n.channel = 'whatsapp' and n.status = 'pendiente';
  end if;
end;
$$;

-- La versión anterior (solo email) sigue funcionando y conserva lo elegido para WhatsApp.
create or replace function public.set_contact_preferences(p_customer_id uuid, p_operational_email boolean, p_marketing_email boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.set_contact_preferences(p_customer_id, p_operational_email, p_marketing_email, private.whatsapp_preference(p_customer_id));
end;
$$;

-- Lo que ve el cliente en «Mis datos»: canales y si su ficha permite cada uno. Del móvil, solo las 3 últimas cifras.
drop function public.portal_contact_preferences();
create function public.portal_contact_preferences()
returns table (customer_id uuid, workshop_name text, has_email boolean, operational_email boolean, marketing_email boolean,
               has_whatsapp_number boolean, whatsapp_hint text, operational_whatsapp boolean, workshop_email boolean, workshop_whatsapp boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, w.name, c.email is not null, p.operational_email, p.marketing_email,
         private.whatsapp_number(c.phone) is not null, right(private.whatsapp_number(c.phone), 3),
         private.whatsapp_preference(c.id), coalesce(s.email_enabled, false), coalesce(s.whatsapp_enabled, false)
    from public.customers c
    join public.workshops w on w.id = c.workshop_id
    left join public.workshop_notification_settings s on s.workshop_id = c.workshop_id
    cross join lateral private.contact_preferences(c.id) p
   where c.id in (select private.portal_customer_ids())
   order by w.name;
$$;

-- ---------------------------------------------------------------------
-- 7. Derecho de supresión: también los WhatsApp
-- ---------------------------------------------------------------------
create or replace function private.anonymize_customer(p_customer_id uuid)
returns void
language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'La ficha no existe.' using errcode = '22023';
  end if;
  update public.customer_invitations set status = 'revocada', revoked_at = now()
   where customer_id = p_customer_id and status = 'pendiente';
  update public.customer_invitations set email = 'suprimido@invalid.invalid' where customer_id = p_customer_id;
  delete from public.notifications where customer_id = p_customer_id and channel = 'app';
  update public.notifications
     set recipient = case when channel = 'whatsapp' then '00000000' else 'suprimido@invalid.invalid' end,
         status = case when status in ('pendiente', 'procesando') then 'cancelado' else status end,
         cancelled_at = case when status in ('pendiente', 'procesando') then now() else cancelled_at end,
         error_code = case when status in ('pendiente', 'procesando') then 'suprimido' else error_code end
   where customer_id = p_customer_id and channel in ('email', 'whatsapp');
  delete from public.customer_contact_preferences where customer_id = p_customer_id;
  update public.customers
     set full_name = 'Cliente suprimido', phone = null, email = null, internal_notes = null, user_id = null,
         marketing_consent = false, privacy_consent_at = null
   where id = p_customer_id;
  update public.repair_orders set customer_notes = null where customer_id = p_customer_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de las funciones
-- ---------------------------------------------------------------------
revoke all on function private.whatsapp_preference(uuid) from public, anon, authenticated;
revoke all on function private.whatsapp_number(text) from public, anon, authenticated;
grant execute on function private.whatsapp_preference(uuid) to service_role;
revoke all on function private.anonymize_customer(uuid) from public, anon, authenticated, service_role;

revoke all on function public.claim_whatsapp_notifications(integer, uuid) from public, anon, authenticated;
revoke all on function public.record_whatsapp_result(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_whatsapp_delivery(text, text, text) from public, anon, authenticated;
revoke all on function public.set_contact_preferences(uuid, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.portal_contact_preferences() from public, anon, authenticated;

grant execute on function public.claim_whatsapp_notifications(integer, uuid) to service_role;
grant execute on function public.record_whatsapp_result(uuid, text, text, text, text) to service_role;
grant execute on function public.record_whatsapp_delivery(text, text, text) to service_role;
grant execute on function public.set_contact_preferences(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.portal_contact_preferences() to authenticated;
