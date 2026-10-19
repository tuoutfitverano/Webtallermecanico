-- =====================================================================
-- Fase 8 · Endurecimiento tras la auditoría (cambios NO destructivos)
--
--  1. Avisos por email: antes de enviar se comprueba que el destinatario
--     sigue siendo el de la orden y su correo actual. Si la orden cambió de
--     cliente o el cliente cambió de correo, el email se cancela
--     ("destinatario_cambiado") en lugar de llegar a quien no debe.
--  2. Fichas de cliente y vehículos: quién y cuándo se creó un registro no
--     se puede falsear, y los campos antiguos de consentimiento de
--     customers (sustituidos por customer_contact_preferences en la Fase 7)
--     quedan congelados.
--  3. Mantenimiento programado (run_maintenance): borra a tiempo las huellas
--     antispam de más de 2 días aunque no lleguen solicitudes nuevas y cierra
--     consultas de matrícula que se quedaron "pendientes".
--  4. Derechos de las personas (RGPD): exportar los datos de un cliente y
--     anonimizarlo conservando el historial de reparaciones. Solo desde el
--     SQL Editor de Supabase (no se exponen en la API).
--  5. Limpieza de permisos: las funciones de disparador no se pueden
--     ejecutar desde fuera, y el personal no lee la huella antispam ni la
--     clave de idempotencia de las solicitudes web (no las necesita).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Destinatario correcto en el momento de enviar
-- ---------------------------------------------------------------------
create or replace function public.claim_email_notifications(p_limit integer default 20, p_order_id uuid default null)
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
           case when n.order_id is not null and o.customer_id is distinct from n.customer_id then 'destinatario_cambiado'
                when c.email is null or lower(btrim(c.email)) is distinct from n.recipient then 'destinatario_cambiado'
                when not (select p.operational_email from private.contact_preferences(n.customer_id) p) and n.purpose = 'operativa' then 'preferencia'
                when n.purpose = 'comercial' and not (select p.marketing_email from private.contact_preferences(n.customer_id) p) then 'sin_consentimiento'
                when not coalesce(s.email_enabled, false) then 'desactivado'
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
  select c.id, c.workshop_id, w.name, s.reply_to, c.order_id, c.event, c.template, c.title, c.body, c.recipient, c.attempts
    from claimed c
    join public.workshops w on w.id = c.workshop_id
    left join public.workshop_notification_settings s on s.workshop_id = c.workshop_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Datos de auditoría y campos antiguos de consentimiento
-- ---------------------------------------------------------------------
comment on column public.customers.marketing_consent is 'OBSOLETO: el consentimiento comercial vive en customer_contact_preferences (Fase 7). No se usa ni se puede cambiar.';
comment on column public.customers.privacy_consent_at is 'OBSOLETO: no se usa. Se conserva para no borrar datos.';

create or replace function private.customers_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Enlazar una ficha de cliente con una cuenta de usuario le da acceso a sus
  -- datos: solo mediante invitación (accept_customer_invitation).
  if (tg_op = 'INSERT' and new.user_id is not null
      or tg_op = 'UPDATE' and new.user_id is distinct from old.user_id)
     and not private.is_privileged() then
    raise exception 'La cuenta del cliente solo se enlaza mediante invitación.' using errcode = '42501';
  end if;
  if not private.is_privileged() then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_at := now();
      new.marketing_consent := false;
      new.privacy_consent_at := null;
    else
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.marketing_consent := old.marketing_consent;
      new.privacy_consent_at := old.privacy_consent_at;
    end if;
  end if;
  return new;
end;
$$;

create function private.vehicles_audit_fields()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not private.is_privileged() then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.created_at := now();
    else
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.vehicles_audit_fields() from public, anon, authenticated;
create trigger vehicles_audit_fields before insert or update on public.vehicles
  for each row execute function private.vehicles_audit_fields();

-- ---------------------------------------------------------------------
-- 3. Mantenimiento programado (lo llama /api/notificaciones/procesar)
-- ---------------------------------------------------------------------
create function public.run_maintenance()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hashes  integer;
  v_lookups integer;
begin
  -- Huellas antispam: nunca más de 2 días (también sin solicitudes nuevas).
  update public.web_requests set client_hash = null
   where client_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_hashes = row_count;
  -- Consultas de matrícula que se quedaron a medias (el servidor se cayó).
  update public.vehicle_lookups set status = 'error', completed_at = now()
   where status = 'pendiente' and created_at < now() - interval '10 minutes';
  get diagnostics v_lookups = row_count;
  return jsonb_build_object('huellas_borradas', v_hashes, 'consultas_cerradas', v_lookups);
end;
$$;
revoke all on function public.run_maintenance() from public, anon, authenticated;
grant execute on function public.run_maintenance() to service_role;

-- ---------------------------------------------------------------------
-- 4. Derechos de las personas (solo SQL Editor: no se conceden a la API)
-- ---------------------------------------------------------------------

-- Derecho de acceso / portabilidad: todo lo que el taller guarda de un cliente.
create function private.export_customer_data(p_customer_id uuid)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ficha', (select to_jsonb(c) - 'user_id' from public.customers c where c.id = p_customer_id),
    'vehiculos', coalesce((select jsonb_agg(to_jsonb(v) - 'lookup_fields') from public.vehicles v where v.customer_id = p_customer_id), '[]'),
    'reparaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'numero', o.number, 'estado', o.status, 'recibido', o.received_at, 'entregado', o.delivered_at,
        'motivo', o.problem_description, 'diagnosis', o.diagnosis, 'trabajo', o.work_done, 'mensaje', o.customer_notes))
      from public.repair_orders o where o.customer_id = p_customer_id), '[]'),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('fecha', n.created_at, 'canal', n.channel, 'titulo', n.title, 'estado', n.status))
      from public.notifications n where n.customer_id = p_customer_id), '[]'),
    'preferencias', (select to_jsonb(p) from public.customer_contact_preferences p where p.customer_id = p_customer_id),
    'consentimientos', coalesce((select jsonb_agg(to_jsonb(l) - 'actor') from public.communication_consent_log l where l.customer_id = p_customer_id), '[]')
  );
$$;

-- Derecho de supresión cuando hay que conservar el historial de reparaciones
-- (obligaciones legales del taller): se borran o sustituyen los datos que
-- identifican a la persona y se mantiene lo demás. Si la ficha no tiene
-- órdenes, también se puede borrar entera desde el panel.
create function private.anonymize_customer(p_customer_id uuid)
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
     set recipient = 'suprimido@invalid.invalid',
         status = case when status in ('pendiente', 'procesando') then 'cancelado' else status end,
         cancelled_at = case when status in ('pendiente', 'procesando') then now() else cancelled_at end,
         error_code = case when status in ('pendiente', 'procesando') then 'suprimido' else error_code end
   where customer_id = p_customer_id and channel = 'email';
  delete from public.customer_contact_preferences where customer_id = p_customer_id;
  update public.customers
     set full_name = 'Cliente suprimido', phone = null, email = null, internal_notes = null, user_id = null,
         marketing_consent = false, privacy_consent_at = null
   where id = p_customer_id;
  update public.repair_orders set customer_notes = null where customer_id = p_customer_id;
end;
$$;
revoke all on function private.export_customer_data(uuid) from public, anon, authenticated, service_role;
revoke all on function private.anonymize_customer(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Funciones de disparador: nadie las llama desde fuera
-- ---------------------------------------------------------------------
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.keep_workshop_id() from public, anon, authenticated;
revoke all on function private.workshops_guard() from public, anon, authenticated;
revoke all on function private.customers_guard() from public, anon, authenticated;
revoke all on function private.vehicles_guard() from public, anon, authenticated;
revoke all on function private.web_requests_guard() from public, anon, authenticated;

revoke select on public.web_requests from authenticated;
grant select (id, workshop_id, kind, status, name, phone, email, preferred_contact, plate, vehicle_make, vehicle_model, service, topic,
              preferred_date, preferred_time, message, privacy_accepted_at, source_path, created_at, handled_by, handled_at)
  on public.web_requests to authenticated;
