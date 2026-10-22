-- =====================================================================
-- Copia de seguridad descargable por cada taller
--
--  · El propietario o un administrador descarga TODOS los datos de SU
--    taller (export_workshop_data): clientes, vehículos, órdenes, historial,
--    presupuestos, facturas, cobros, avisos, ajustes… en un solo archivo.
--  · Nunca datos de otro taller: cada tabla se filtra por workshop_id y la
--    función exige ser gerente de ese taller.
--  · Sin secretos: se quitan las huellas de enlaces e invitaciones, la huella
--    antispam y las claves de idempotencia (no sirven fuera y no deben salir).
--  · Cada descarga queda anotada (quién y cuándo): son datos personales.
--
-- Es una copia del TALLER, no de la plataforma (esa es docs/COPIAS_SEGURIDAD.md).
-- No borra ni modifica datos existentes.
-- =====================================================================

create table public.workshop_data_exports (
  id           bigint generated always as identity primary key,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  exported_by  uuid references auth.users (id) on delete set null,
  format       text not null check (format in ('json', 'csv')),
  created_at   timestamptz not null default now()
);
comment on table public.workshop_data_exports is 'Descargas de la copia de datos del taller (quién y cuándo). Las escribe solo export_workshop_data.';
create index workshop_data_exports_ws_idx on public.workshop_data_exports (workshop_id, created_at desc);

revoke all on public.workshop_data_exports from anon, authenticated;
grant all on public.workshop_data_exports to service_role;
grant select on public.workshop_data_exports to authenticated;
alter table public.workshop_data_exports enable row level security;
create policy "copias del taller: lectura gerencia" on public.workshop_data_exports for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()));

-- Tablas del taller que van en la copia y columnas que nunca salen.
-- Una tabla nueva con workshop_id debe añadirse aquí (lo comprueba 19_copia_taller.test.sql).
create function private.export_tables()
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
    ('workshop_notification_settings', '{}'), ('workshop_sites', '{}'), ('workshop_domains', '{}'), ('workshop_data_exports', '{}')
$$;
revoke all on function private.export_tables() from public, anon, authenticated;

create function public.export_workshop_data(p_workshop_id uuid, p_format text default 'json')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_tables jsonb := '{}'::jsonb;
  v_rows   jsonb;
  t        record;
begin
  if p_workshop_id is null or p_workshop_id not in (select private.manager_workshop_ids()) then
    raise exception 'Solo el propietario o un administrador del taller descargan su copia.' using errcode = '42501';
  end if;
  if p_format is null or p_format not in ('json', 'csv') then
    raise exception 'Formato no válido.' using errcode = '22023';
  end if;
  insert into public.workshop_data_exports (workshop_id, exported_by, format) values (p_workshop_id, v_uid, p_format);
  for t in select * from private.export_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) - $2), ''[]''::jsonb) from public.%I x where x.workshop_id = $1', t.table_name)
      into v_rows using p_workshop_id, t.drop_columns;
    v_tables := v_tables || jsonb_build_object(t.table_name, v_rows);
  end loop;
  return jsonb_build_object(
    'formato', 'copia-taller-v1',
    'generada', now(),
    'aviso', 'Copia de los datos de tu taller. Contiene datos personales de tus clientes: guárdala en un lugar seguro y no la compartas.',
    'taller', (select to_jsonb(w) from public.workshops w where w.id = p_workshop_id),
    'equipo', (select coalesce(jsonb_agg(jsonb_build_object(
                  'user_id', m.user_id, 'nombre', p.full_name, 'email', u.email, 'rol', m.role, 'activo', m.active, 'desde', m.created_at)
                  order by m.created_at), '[]'::jsonb)
                 from public.workshop_members m
                 left join public.profiles p on p.id = m.user_id
                 left join auth.users u on u.id = m.user_id
                where m.workshop_id = p_workshop_id),
    'tablas', v_tables);
end;
$$;
revoke all on function public.export_workshop_data(uuid, text) from public, anon;
grant execute on function public.export_workshop_data(uuid, text) to authenticated;
