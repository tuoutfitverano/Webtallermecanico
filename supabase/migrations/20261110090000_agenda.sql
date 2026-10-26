-- =====================================================================
-- Agenda de cada persona del taller (mecánicos, recepción, administración
-- y propiedad): tareas, citas, reuniones y ausencias con hora.
--
--  · Cada persona ve y organiza SU agenda.
--  · Propietario y administración ven y organizan la de todo el equipo.
--  · Recepción y mecánicos no ven la de los demás.
--  · «Lo que ha hecho» sale de los apuntes marcados como hechos y del tiempo
--    fichado en las órdenes (repair_order_work_logs, ya existente).
--  · Un apunte puede ir unido a una orden del mismo taller en la que esa
--    persona pueda trabajar.
-- =====================================================================

create table public.staff_agenda (
  id          uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  user_id     uuid not null,
  kind        text not null default 'tarea' check (kind in ('tarea', 'cita', 'reunion', 'ausencia', 'otro')),
  title       text not null check (length(btrim(title)) between 1 and 120),
  notes       text check (notes is null or length(notes) <= 1000),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  order_id    uuid,
  done_at     timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '31 days'),
  foreign key (workshop_id, user_id) references public.workshop_members (workshop_id, user_id) on delete cascade,
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id) on delete set null (order_id)
);
comment on table public.staff_agenda is 'Agenda de cada persona del taller. Cada uno la suya; propiedad y administración, la de todos.';
create index staff_agenda_user_idx on public.staff_agenda (workshop_id, user_id, starts_at);
create index staff_agenda_ws_idx on public.staff_agenda (workshop_id, starts_at);

alter table public.staff_agenda enable row level security;
revoke all on public.staff_agenda from anon, authenticated;
grant select, delete on public.staff_agenda to authenticated;
grant insert (workshop_id, user_id, kind, title, notes, starts_at, ends_at, order_id) on public.staff_agenda to authenticated;
grant update (user_id, kind, title, notes, starts_at, ends_at, order_id, done_at) on public.staff_agenda to authenticated;
grant all on public.staff_agenda to service_role;

-- La suya (si sigue en el equipo) o, para propiedad y administración, la de cualquiera del taller.
create policy staff_agenda_read on public.staff_agenda for select to authenticated
  using ((user_id = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
         or workshop_id in (select private.manager_workshop_ids()));
create policy staff_agenda_insert on public.staff_agenda for insert to authenticated
  with check ((user_id = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
              or workshop_id in (select private.manager_workshop_ids()));
create policy staff_agenda_update on public.staff_agenda for update to authenticated
  using ((user_id = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
         or workshop_id in (select private.manager_workshop_ids()))
  with check ((user_id = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
              or workshop_id in (select private.manager_workshop_ids()));
create policy staff_agenda_delete on public.staff_agenda for delete to authenticated
  using ((user_id = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
         or workshop_id in (select private.manager_workshop_ids()));

-- Autor y fecha de cambio los pone la base de datos; la orden tiene que ser una en la que esa persona pueda trabajar.
create function private.staff_agenda_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.title := btrim(new.title);
  if current_user in ('authenticated', 'anon') and new.order_id is not null
     and new.order_id is distinct from (case when tg_op = 'UPDATE' then old.order_id end)
     and not private.can_work_on_order(new.order_id) then
    raise exception 'Esa orden no está a tu alcance.' using errcode = '42501';
  end if;
  -- Solo quien se ocupa de ella (o la gerencia) la da por hecha; la fecha la pone el servidor.
  if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
    new.done_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.staff_agenda_guard() from public, anon, authenticated;
create trigger staff_agenda_guard before insert or update on public.staff_agenda
  for each row execute function private.staff_agenda_guard();

-- La agenda va en la copia del taller.
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
    ('vehicle_transfers', '{}'), ('staff_agenda', '{}')
$$;
