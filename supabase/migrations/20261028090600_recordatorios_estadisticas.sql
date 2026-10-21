-- =====================================================================
-- Recordatorios automáticos y estadísticas.
--
-- Recordatorios (los genera la base de datos en el mantenimiento programado,
-- /api/notificaciones/procesar, aunque nadie tenga el panel abierto):
--  · revisión: fecha de próxima revisión cercana, o kilómetros cerca del
--    límite (solo si el cliente pidió recordatorios de mantenimiento);
--  · presupuesto pendiente de respuesta tras N días;
--  · vehículo listo y sin recoger tras N días;
--  · trabajo retrasado (fecha prevista pasada): aviso INTERNO para el taller,
--    nunca al cliente.
-- Cada recordatorio tiene una clave única (no se repite) y su resultado.
-- Los mensajes salen por la cola de avisos (enqueue_notice): sin proveedor
-- configurado se quedan pendientes; nunca se dan por enviados.
--
-- Estadísticas: workshop_stats calcula todo a partir de los datos reales
-- (SECURITY INVOKER: cada persona ve solo lo que ya podía ver).
--
-- No borra ni modifica datos existentes.
-- =====================================================================

create type public.reminder_kind as enum ('revision', 'presupuesto_pendiente', 'recogida_pendiente', 'trabajo_retrasado');
create type public.reminder_status as enum ('pendiente', 'enviado', 'sin_canal', 'descartado');

create table public.reminder_settings (
  workshop_id          uuid primary key references public.workshops (id) on delete cascade,
  revision_enabled     boolean not null default false,
  revision_days_before integer not null default 14 check (revision_days_before between 1 and 90),
  revision_km_margin   integer not null default 1000 check (revision_km_margin between 100 and 20000),
  quote_enabled        boolean not null default false,
  quote_after_days     integer not null default 3 check (quote_after_days between 1 and 60),
  pickup_enabled       boolean not null default false,
  pickup_after_days    integer not null default 2 check (pickup_after_days between 1 and 60),
  delay_enabled        boolean not null default true,
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid()
);
comment on table public.reminder_settings is 'Reglas de recordatorios de cada taller. Los avisos al cliente nacen desactivados.';
insert into public.reminder_settings (workshop_id) select id from public.workshops on conflict do nothing;
create function private.workshops_reminder_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.reminder_settings (workshop_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.workshops_reminder_defaults() from public, anon, authenticated;
create trigger workshops_reminder_defaults after insert on public.workshops
  for each row execute function private.workshops_reminder_defaults();
create trigger reminder_settings_updated_at before update on public.reminder_settings
  for each row execute function private.set_updated_at();

create table public.reminders (
  id                  uuid primary key default gen_random_uuid(),
  workshop_id         uuid not null references public.workshops (id) on delete cascade,
  kind                public.reminder_kind not null,
  customer_id         uuid,
  vehicle_id          uuid,
  order_id            uuid,
  quote_id            uuid references public.quotes (id) on delete cascade,
  due_on              date not null,
  title               text not null check (length(title) between 1 and 200),
  status              public.reminder_status not null default 'pendiente',
  notifications_count integer not null default 0,
  dedupe_key          text not null unique check (dedupe_key ~ '^[a-z0-9:_-]{1,160}$'),
  created_at          timestamptz not null default now(),
  dismissed_at        timestamptz,
  dismissed_by        uuid references auth.users (id) on delete set null,
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade,
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id) on delete cascade,
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id) on delete cascade
);
comment on table public.reminders is 'Recordatorios generados (uno por clave). Los escribe solo la base de datos.';
create index reminders_ws_idx on public.reminders (workshop_id, created_at desc);
create index reminders_open_idx on public.reminders (workshop_id, kind) where status = 'pendiente';

revoke all on public.reminder_settings, public.reminders from anon, authenticated;
grant all on public.reminder_settings, public.reminders to service_role;
grant select on public.reminder_settings, public.reminders to authenticated;
grant update (revision_enabled, revision_days_before, revision_km_margin, quote_enabled, quote_after_days,
              pickup_enabled, pickup_after_days, delay_enabled) on public.reminder_settings to authenticated;
alter table public.reminder_settings enable row level security;
alter table public.reminders enable row level security;
create policy "reminder settings: lectura personal" on public.reminder_settings for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "reminder settings: edición gestores" on public.reminder_settings for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "reminders: lectura oficina" on public.reminders for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));

-- Inserta un recordatorio (si no existía) y, si va al cliente, encola el aviso.
create function private.add_reminder(
  p_ws uuid, p_kind public.reminder_kind, p_key text, p_due date, p_title text,
  p_customer uuid, p_vehicle uuid, p_order uuid, p_quote uuid,
  p_event public.notification_event, p_body text, p_link text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  insert into public.reminders (workshop_id, kind, customer_id, vehicle_id, order_id, quote_id, due_on, title, dedupe_key)
  values (p_ws, p_kind, p_customer, p_vehicle, p_order, p_quote, p_due, p_title, p_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  if p_event is not null and p_customer is not null then
    v_n := private.enqueue_notice(p_customer, p_event, p_title, p_body, p_link, p_order, p_key);
    update public.reminders set notifications_count = v_n, status = (case when v_n > 0 then 'enviado' else 'sin_canal' end)::public.reminder_status
     where id = v_id;
  end if;
  return true;
end;
$$;
revoke all on function private.add_reminder(uuid, public.reminder_kind, text, date, text, uuid, uuid, uuid, uuid, public.notification_event, text, text) from public, anon, authenticated;

create function private.generate_reminders()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  -- Revisión por fecha.
  for r in
    select v.id, v.workshop_id, v.customer_id, v.make, v.model, v.plate, v.next_service_date, v.next_service_notes
      from public.vehicles v
      join public.reminder_settings s on s.workshop_id = v.workshop_id and s.revision_enabled
      join public.workshops w on w.id = v.workshop_id and w.status <> 'suspendido'
     where v.customer_id is not null and v.next_service_date is not null
       and v.next_service_date between current_date and current_date + s.revision_days_before
  loop
    if private.add_reminder(r.workshop_id, 'revision', 'rev:' || r.id || ':' || r.next_service_date, r.next_service_date,
         format('Próxima revisión de tu %s %s', r.make, r.model), r.customer_id, r.id, null, null, 'recordatorio_revision',
         concat_ws(E'\n', format('Tu %s %s (%s) tiene la revisión prevista el %s.', r.make, r.model, r.plate, to_char(r.next_service_date, 'DD/MM/YYYY')),
                   r.next_service_notes, 'Llámanos o escríbenos para reservar día.'),
         '/portal/vehiculos/' || r.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Revisión por kilómetros.
  for r in
    select v.id, v.workshop_id, v.customer_id, v.make, v.model, v.plate, v.mileage, v.next_service_km, v.next_service_notes
      from public.vehicles v
      join public.reminder_settings s on s.workshop_id = v.workshop_id and s.revision_enabled
      join public.workshops w on w.id = v.workshop_id and w.status <> 'suspendido'
     where v.customer_id is not null and v.next_service_km is not null and v.mileage is not null
       and v.next_service_km - v.mileage <= s.revision_km_margin
  loop
    if private.add_reminder(r.workshop_id, 'revision', 'revkm:' || r.id || ':' || r.next_service_km, current_date,
         format('Revisión de tu %s %s', r.make, r.model), r.customer_id, r.id, null, null, 'recordatorio_revision',
         concat_ws(E'\n', format('Tu %s %s (%s) se acerca a los %s km de su próxima revisión.', r.make, r.model, r.plate, r.next_service_km),
                   r.next_service_notes, 'Llámanos o escríbenos para reservar día.'),
         '/portal/vehiculos/' || r.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Presupuesto pendiente de respuesta.
  for r in
    select q.id, q.workshop_id, q.customer_id, q.vehicle_id, q.order_id, q.number, q.valid_until
      from public.quotes q
      join public.reminder_settings s on s.workshop_id = q.workshop_id and s.quote_enabled
     where q.status = 'enviado' and q.sent_at <= now() - make_interval(days => s.quote_after_days)
  loop
    if private.add_reminder(r.workshop_id, 'presupuesto_pendiente', 'quote:' || r.id || ':reminder', current_date,
         format('Tu presupuesto P-%s sigue pendiente', r.number), r.customer_id, r.vehicle_id, r.order_id, r.id, 'recordatorio_presupuesto',
         format('El presupuesto P-%s está pendiente de tu respuesta. Es válido hasta el %s. Puedes aceptarlo o rechazarlo en tu portal.',
                r.number, to_char(r.valid_until, 'DD/MM/YYYY')),
         '/portal/presupuestos/' || r.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Vehículo listo y sin recoger.
  for r in
    select o.id, o.workshop_id, o.customer_id, o.vehicle_id, o.number, o.status_changed_at, v.make, v.model, v.plate
      from public.repair_orders o
      join public.vehicles v on v.id = o.vehicle_id
      join public.reminder_settings s on s.workshop_id = o.workshop_id and s.pickup_enabled
     where o.status = 'listo' and o.status_changed_at <= now() - make_interval(days => s.pickup_after_days)
  loop
    if private.add_reminder(r.workshop_id, 'recogida_pendiente', 'pickup:' || r.id || ':' || to_char(r.status_changed_at, 'YYYYMMDDHH24MI'), current_date,
         format('Tu %s %s te espera en el taller', r.make, r.model), r.customer_id, r.vehicle_id, r.id, null, 'recordatorio_recogida',
         format('Tu %s %s (%s) está listo para recoger. Si necesitas otra hora, llámanos.', r.make, r.model, r.plate),
         '/portal/reparaciones/' || r.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Trabajo retrasado: solo para el taller.
  for r in
    select o.id, o.workshop_id, o.customer_id, o.vehicle_id, o.number, o.due_at
      from public.repair_orders o
      join public.reminder_settings s on s.workshop_id = o.workshop_id and s.delay_enabled
     where o.status <> 'entregado' and o.due_at is not null and o.due_at < now()
  loop
    if private.add_reminder(r.workshop_id, 'trabajo_retrasado', 'late:' || r.id || ':' || to_char(r.due_at, 'YYYYMMDDHH24MI'), (r.due_at)::date,
         format('OR-%s: fecha prevista superada', r.number), r.customer_id, r.vehicle_id, r.id, null, null, null, null) then
      v_count := v_count + 1;
    end if;
  end loop;
  -- Los avisos internos de retraso se cierran solos cuando la orden se entrega o se replanifica.
  update public.reminders m set status = 'descartado', dismissed_at = now()
    from public.repair_orders o
   where m.kind = 'trabajo_retrasado' and m.status = 'pendiente' and o.id = m.order_id
     and (o.status = 'entregado' or o.due_at is null or o.due_at >= now());
  return v_count;
end;
$$;
revoke all on function private.generate_reminders() from public, anon, authenticated;

create function public.dismiss_reminder(p_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v public.reminders;
begin
  perform private.require_user();
  select * into v from public.reminders r where r.id = p_id;
  if v.id is null or not (v.workshop_id in (select private.office_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'Recordatorio no encontrado.' using errcode = '42501';
  end if;
  update public.reminders set status = 'descartado', dismissed_at = now(), dismissed_by = auth.uid()
   where id = v.id and status = 'pendiente';
end;
$$;
revoke all on function public.dismiss_reminder(uuid) from public, anon;
grant execute on function public.dismiss_reminder(uuid) to authenticated;

-- Mantenimiento programado: ahora también caducan presupuestos y se generan recordatorios.
create or replace function public.run_maintenance()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hashes    integer;
  v_lookups   integer;
  v_quotes    integer;
  v_reminders integer;
begin
  update public.web_requests set client_hash = null
   where client_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_hashes = row_count;
  update public.vehicle_lookups set status = 'error', completed_at = now()
   where status = 'pendiente' and created_at < now() - interval '10 minutes';
  get diagnostics v_lookups = row_count;
  v_quotes := private.expire_quotes();
  v_reminders := private.generate_reminders();
  return jsonb_build_object('huellas_borradas', v_hashes, 'consultas_cerradas', v_lookups,
                            'presupuestos_caducados', v_quotes, 'recordatorios_nuevos', v_reminders);
end;
$$;

-- ---------------------------------------------------------------------
-- Estadísticas (datos reales; cada persona ve lo que ya podía ver)
-- ---------------------------------------------------------------------
create function public.workshop_stats(p_workshop_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with
  o as (select * from public.repair_orders where workshop_id = p_workshop_id),
  inv as (select * from public.invoices where workshop_id = p_workshop_id and status = 'emitida'),
  pay as (select p.* from public.payments p join inv on inv.id = p.invoice_id where p.voided_at is null),
  bal as (select inv.id, inv.total_cents - coalesce((select sum(p.amount_cents) from pay p where p.invoice_id = inv.id), 0) as pending,
                 inv.due_date from inv),
  logs as (select l.*, extract(epoch from (coalesce(l.ended_at, now()) - l.started_at)) / 60 as minutes
             from public.repair_order_work_logs l where l.workshop_id = p_workshop_id),
  q as (select status, sent_at, responded_at, valid_until, total_cents from public.quotes where workshop_id = p_workshop_id and status <> 'sustituido')
  select jsonb_build_object(
    'periodo', jsonb_build_object('desde', p_from, 'hasta', p_to),
    'ordenes', jsonb_build_object(
      'abiertas', (select count(*) from o where status <> 'entregado'),
      'por_estado', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from o where status <> 'entregado' group by status) x), '{}'),
      'recibidas', (select count(*) from o where received_at::date between p_from and p_to),
      'entregadas', (select count(*) from o where delivered_at::date between p_from and p_to),
      'listas_para_recoger', (select count(*) from o where status = 'listo'),
      'retrasadas', (select count(*) from o where status <> 'entregado' and due_at < now())),
    'vehiculos_atendidos', (select count(distinct vehicle_id) from o where received_at::date between p_from and p_to),
    'presupuestos', jsonb_build_object(
      'pendientes', (select count(*) from q where status = 'enviado'),
      'enviados', (select count(*) from q where sent_at::date between p_from and p_to),
      'aceptados', (select count(*) from q where status = 'aceptado' and responded_at::date between p_from and p_to),
      'rechazados', (select count(*) from q where status = 'rechazado' and responded_at::date between p_from and p_to),
      'caducados', (select count(*) from q where status = 'caducado' and valid_until between p_from and p_to),
      'importe_aceptado_cents', coalesce((select sum(total_cents) from q where status = 'aceptado' and responded_at::date between p_from and p_to), 0)),
    'facturacion', jsonb_build_object(
      'emitidas', (select count(*) from inv where issue_date between p_from and p_to),
      'importe_emitido_cents', coalesce((select sum(total_cents) from inv where issue_date between p_from and p_to), 0),
      'base_emitida_cents', coalesce((select sum(subtotal_cents) from inv where issue_date between p_from and p_to), 0),
      'cobrado_cents', coalesce((select sum(amount_cents) from pay where paid_on between p_from and p_to), 0),
      'pendiente_cents', coalesce((select sum(pending) from bal), 0),
      'vencido_cents', coalesce((select sum(pending) from bal where due_date < current_date and pending <> 0), 0),
      'borradores', (select count(*) from public.invoices where workshop_id = p_workshop_id and status = 'borrador')),
    'carga_mecanicos', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nombre', coalesce(pr.full_name, 'Sin nombre'),
               'abiertas', (select count(*) from o where o.assigned_to = m.user_id and o.status <> 'entregado'),
               'minutos_estimados', coalesce((select sum(estimated_minutes) from o where o.assigned_to = m.user_id and o.status <> 'entregado'), 0),
               'minutos_reales', coalesce((select round(sum(minutes)) from logs where logs.user_id = m.user_id and logs.started_at::date between p_from and p_to), 0))
             order by pr.full_name)
        from public.workshop_members m left join public.profiles pr on pr.id = m.user_id
       where m.workshop_id = p_workshop_id and m.active and m.role::text in ('mecanico', 'administrador', 'propietario')
         and (exists (select 1 from o where o.assigned_to = m.user_id) or m.role = 'mecanico')), '[]'),
    'tiempos', (
      select jsonb_build_object('ordenes', count(*), 'estimado_min', coalesce(sum(est), 0), 'real_min', coalesce(round(sum(real)), 0))
        from (select o.estimated_minutes est, (select sum(minutes) from logs where logs.order_id = o.id) real
                from o where o.delivered_at::date between p_from and p_to and o.estimated_minutes is not null
                 and exists (select 1 from logs where logs.order_id = o.id)) t),
    'evolucion', coalesce((
      select jsonb_agg(jsonb_build_object('semana', w, 'ordenes', n_o, 'facturado_cents', f) order by w)
        from (select gs::date w,
                     (select count(*) from o where o.received_at >= gs and o.received_at < gs + interval '7 days') n_o,
                     coalesce((select sum(total_cents) from inv where inv.issue_date >= gs::date and inv.issue_date < (gs + interval '7 days')::date), 0) f
                from generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '7 days') gs) s), '[]'),
    'atencion', jsonb_build_object(
      'presupuestos_sin_respuesta_3d', (select count(*) from q where status = 'enviado' and sent_at < now() - interval '3 days'),
      'facturas_vencidas', (select count(*) from bal where due_date < current_date and pending <> 0),
      'ordenes_sin_asignar', (select count(*) from o where status <> 'entregado' and assigned_to is null),
      'recordatorios_pendientes', (select count(*) from public.reminders r where r.workshop_id = p_workshop_id and r.status = 'pendiente'))
  );
$$;
revoke all on function public.workshop_stats(uuid, date, date) from public, anon;
grant execute on function public.workshop_stats(uuid, date, date) to authenticated;
