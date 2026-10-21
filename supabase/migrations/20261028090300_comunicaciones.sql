-- =====================================================================
-- Capa común de avisos al cliente (presupuestos y recordatorios).
--
--  · private.enqueue_notice: UN sitio decide por qué canales sale un aviso
--    (portal si tiene cuenta; email y WhatsApp si el taller los tiene
--    activados y el cliente no los ha desactivado/pedido). Mismas reglas que
--    los avisos de estado (notifications_guard las vuelve a comprobar).
--  · dedupe_key: el mismo aviso no se crea dos veces por canal.
--  · link_path: a qué página del portal lleva (solo rutas /portal/…).
--  · Recordatorios de mantenimiento: solo si el propio cliente los pide
--    (preferencia service_reminders, desactivada de entrada).
--
-- No borra ni modifica datos existentes.
-- =====================================================================

alter table public.notifications
  add column link_path text check (link_path is null or link_path ~ '^/portal/[a-z0-9/_-]{1,120}$'),
  add column dedupe_key text check (dedupe_key is null or dedupe_key ~ '^[a-z0-9:_-]{1,120}$');
create unique index notifications_dedupe_idx on public.notifications (dedupe_key, channel) where dedupe_key is not null;

alter table public.customer_contact_preferences add column service_reminders boolean not null default false;
comment on column public.customer_contact_preferences.service_reminders is 'Recordatorios de revisión y mantenimiento. Solo los activa el propio cliente.';
alter table public.communication_consent_log add column topic text check (topic is null or topic in ('recordatorios'));

-- ---------------------------------------------------------------------
-- 1. Encolar un aviso para un cliente (todos los canales que procedan)
-- ---------------------------------------------------------------------
create function private.enqueue_notice(
  p_customer_id uuid, p_event public.notification_event, p_title text, p_body text,
  p_link_path text default null, p_order_id uuid default null, p_dedupe_key text default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_c        public.customers;
  v_s        public.workshop_notification_settings;
  v_wstatus  public.workshop_status;
  v_prefs    record;
  v_wa       text;
  v_count    integer := 0;
  v_n        integer;
begin
  select * into v_c from public.customers c where c.id = p_customer_id;
  if v_c.id is null then return 0; end if;
  select w.status into v_wstatus from public.workshops w where w.id = v_c.workshop_id;
  if v_wstatus = 'suspendido' then return 0; end if;
  select * into v_s from public.workshop_notification_settings s where s.workshop_id = v_c.workshop_id;
  select * into v_prefs from public.customer_contact_preferences p where p.customer_id = p_customer_id;
  -- Recordatorios de mantenimiento: solo con la preferencia del propio cliente.
  if p_event::text = 'recordatorio_revision' and not coalesce(v_prefs.service_reminders, false) then
    return 0;
  end if;

  if v_c.user_id is not null then
    insert into public.notifications (workshop_id, customer_id, order_id, channel, event, template, title, body, status, sent_at, delivered_at, link_path, dedupe_key)
    values (v_c.workshop_id, v_c.id, p_order_id, 'app', p_event, 'aviso_v1', p_title, p_body, 'entregado', now(), now(), p_link_path, p_dedupe_key)
    on conflict (dedupe_key, channel) where dedupe_key is not null do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;
  if coalesce(v_s.email_enabled, false) and v_c.email is not null and coalesce(v_prefs.operational_email, true) then
    insert into public.notifications (workshop_id, customer_id, order_id, channel, event, template, title, body, recipient, link_path, dedupe_key)
    values (v_c.workshop_id, v_c.id, p_order_id, 'email', p_event, 'aviso_v1', p_title, p_body, lower(btrim(v_c.email)), p_link_path, p_dedupe_key)
    on conflict (dedupe_key, channel) where dedupe_key is not null do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;
  v_wa := private.whatsapp_number(v_c.phone);
  if coalesce(v_s.whatsapp_enabled, false) and v_wa is not null and coalesce(v_prefs.operational_whatsapp, false) then
    insert into public.notifications (workshop_id, customer_id, order_id, channel, event, template, title, body, recipient, link_path, dedupe_key)
    values (v_c.workshop_id, v_c.id, p_order_id, 'whatsapp', p_event, 'aviso_v1', p_title, p_body, v_wa, p_link_path, p_dedupe_key)
    on conflict (dedupe_key, channel) where dedupe_key is not null do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;
  return v_count;
end;
$$;
revoke all on function private.enqueue_notice(uuid, public.notification_event, text, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Recordatorios de mantenimiento: preferencia del cliente
-- ---------------------------------------------------------------------
-- Activar: solo el propio cliente (portal). Desactivar: el cliente o la oficina del taller.
create function public.set_service_reminders(p_customer_id uuid, p_enabled boolean)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_c      public.customers;
  v_source text;
begin
  perform private.require_user();
  select * into v_c from public.customers c where c.id = p_customer_id;
  if v_c.id is null then
    raise exception 'No tienes permiso para cambiar estas preferencias.' using errcode = '42501';
  end if;
  if p_customer_id in (select private.portal_customer_ids()) then
    v_source := 'portal';
  elsif v_c.workshop_id in (select private.office_workshop_ids()) and p_enabled is not true then
    v_source := 'panel';
  elsif v_c.workshop_id in (select private.office_workshop_ids()) then
    raise exception 'Los recordatorios de mantenimiento solo los puede pedir el propio cliente desde su portal.' using errcode = '42501';
  else
    raise exception 'No tienes permiso para cambiar estas preferencias.' using errcode = '42501';
  end if;
  insert into public.customer_contact_preferences (customer_id, workshop_id, service_reminders)
  values (p_customer_id, v_c.workshop_id, coalesce(p_enabled, false))
  on conflict (customer_id) do update set service_reminders = excluded.service_reminders, updated_at = now(), updated_by = auth.uid();
  insert into public.communication_consent_log (workshop_id, customer_id, purpose, channel, granted, source, topic)
  values (v_c.workshop_id, p_customer_id, 'operativa', 'app', coalesce(p_enabled, false), v_source, 'recordatorios');
  if not coalesce(p_enabled, false) then
    update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'preferencia'
     where n.customer_id = p_customer_id and n.event::text = 'recordatorio_revision'
       and n.channel <> 'app' and n.status = 'pendiente';
  end if;
end;
$$;
revoke all on function public.set_service_reminders(uuid, boolean) from public, anon;
grant execute on function public.set_service_reminders(uuid, boolean) to authenticated;

create function public.portal_service_reminders()
returns table (customer_id uuid, enabled boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, coalesce(p.service_reminders, false)
    from public.customers c
    left join public.customer_contact_preferences p on p.customer_id = c.id
   where c.id in (select private.portal_customer_ids());
$$;
revoke all on function public.portal_service_reminders() from public, anon;
grant execute on function public.portal_service_reminders() to authenticated;

-- ---------------------------------------------------------------------
-- 3. La cola de envío devuelve también el enlace del portal
-- ---------------------------------------------------------------------
drop function public.claim_email_notifications(integer, uuid);
create function public.claim_email_notifications(p_limit integer default 20, p_order_id uuid default null)
returns table (id uuid, workshop_id uuid, workshop_name text, reply_to text, order_id uuid, event public.notification_event,
               template text, title text, body text, recipient text, attempts smallint, link_path text)
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'caducada'
   where n.channel = 'email' and n.status = 'pendiente' and n.created_at < now() - interval '2 days';
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
    select n.id,
           case when n.order_id is not null and o.customer_id is distinct from n.customer_id then 'destinatario_cambiado'
                when c.email is null or lower(btrim(c.email)) is distinct from n.recipient then 'destinatario_cambiado'
                when not (select p.operational_email from private.contact_preferences(n.customer_id) p) and n.purpose = 'operativa' then 'preferencia'
                when n.purpose = 'comercial' and not (select p.marketing_email from private.contact_preferences(n.customer_id) p) then 'sin_consentimiento'
                when n.event::text = 'recordatorio_revision' and not coalesce(cp.service_reminders, false) then 'preferencia'
                when not coalesce(s.email_enabled, false) then 'desactivado'
                when w.status = 'suspendido' then 'taller_suspendido'
           end as reason
      from public.notifications n
      join picked using (id)
      join public.workshops w on w.id = n.workshop_id
      join public.customers c on c.id = n.customer_id
      left join public.customer_contact_preferences cp on cp.customer_id = n.customer_id
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
  select c.id, c.workshop_id, w.name, s.reply_to, c.order_id, c.event, c.template, c.title, c.body, c.recipient, c.attempts, c.link_path
    from claimed c
    join public.workshops w on w.id = c.workshop_id
    left join public.workshop_notification_settings s on s.workshop_id = c.workshop_id;
end;
$$;
revoke all on function public.claim_email_notifications(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(integer, uuid) to service_role;

drop function public.claim_whatsapp_notifications(integer, uuid);
create function public.claim_whatsapp_notifications(p_limit integer default 20, p_order_id uuid default null)
returns table (id uuid, workshop_id uuid, workshop_name text, order_id uuid, event public.notification_event,
               template text, title text, body text, recipient text, attempts smallint, link_path text)
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications n set status = 'cancelado', cancelled_at = now(), error_code = 'caducada'
   where n.channel = 'whatsapp' and n.status = 'pendiente' and n.created_at < now() - interval '2 days';
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
    select n.id,
           case when n.order_id is not null and o.customer_id is distinct from n.customer_id then 'destinatario_cambiado'
                when private.whatsapp_number(c.phone) is distinct from n.recipient then 'destinatario_cambiado'
                when not private.whatsapp_preference(n.customer_id) then 'preferencia'
                when n.purpose = 'comercial' then 'sin_consentimiento'
                when n.event::text = 'recordatorio_revision' and not coalesce(cp.service_reminders, false) then 'preferencia'
                when not coalesce(s.whatsapp_enabled, false) then 'desactivado'
                when w.status = 'suspendido' then 'taller_suspendido'
           end as reason
      from public.notifications n
      join picked using (id)
      join public.workshops w on w.id = n.workshop_id
      join public.customers c on c.id = n.customer_id
      left join public.customer_contact_preferences cp on cp.customer_id = n.customer_id
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
  select c.id, c.workshop_id, w.name, c.order_id, c.event, c.template, c.title, c.body, c.recipient, c.attempts, c.link_path
    from claimed c
    join public.workshops w on w.id = c.workshop_id;
end;
$$;
revoke all on function public.claim_whatsapp_notifications(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_notifications(integer, uuid) to service_role;
