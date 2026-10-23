-- =====================================================================
-- Información legal.
--
--  · Datos del titular de cada web de taller (LSSI art. 10): razón social,
--    NIF, domicilio, inscripción registral y correo de contacto legal. Son
--    públicos por ley, así que get_public_site los devuelve para pintar el
--    aviso legal y la privacidad. Si faltan, la web lo dice: nunca se inventan.
--  · Aceptación de las condiciones del servicio y del contrato de encargado
--    del tratamiento (RGPD art. 28) por la PROPIETARIA del taller, con versión,
--    persona y fecha. No se cambia ni se borra.
--  · Minimización: las solicitudes de la web se borran a los 12 meses de
--    recibirse (run_maintenance).
--
-- No borra ni modifica datos existentes (salvo el borrado periódico anunciado).
-- =====================================================================

alter table public.workshops
  add column registry_info text check (registry_info is null or length(btrim(registry_info)) between 1 and 300),
  add column legal_email text check (legal_email is null or legal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
comment on column public.workshops.registry_info is 'Inscripción registral (p. ej. Registro Mercantil, tomo, folio, hoja). Opcional: solo si el titular está inscrito.';
comment on column public.workshops.legal_email is 'Correo para avisos legales y para ejercer los derechos de protección de datos. Sale en el aviso legal y en la privacidad.';

-- Web pública: además, los datos legales del titular (obligatorios en el aviso legal).
create or replace function public.get_public_site(p_hostname text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'workshop', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'site', jsonb_build_object('is_demo_content', s.is_demo_content, 'theme', s.theme, 'content', s.content),
    'legal', jsonb_build_object(
      'legal_name', w.legal_name, 'tax_id', w.tax_id, 'address_line', w.address_line, 'postal_code', w.postal_code,
      'city', w.city, 'province', w.province, 'registry_info', w.registry_info, 'email', w.legal_email)
  )
  from public.workshop_domains d
  join public.workshops w on w.id = d.workshop_id
  join public.workshop_sites s on s.workshop_id = w.id
  where d.hostname = lower(btrim(p_hostname))
    and d.verified_at is not null
    and s.published
    and w.status <> 'suspendido';
$$;

-- ---------------------------------------------------------------------
-- Aceptación de condiciones y contrato de encargo
-- ---------------------------------------------------------------------
create table public.workshop_legal_acceptances (
  id           bigint generated always as identity primary key,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  document     text not null check (document in ('condiciones', 'encargo')),
  version      text not null check (version ~ '^[0-9]+\.[0-9]+$'),
  accepted_by  uuid references auth.users (id) on delete set null,
  accepted_at  timestamptz not null default now(),
  unique (workshop_id, document, version)
);
comment on table public.workshop_legal_acceptances is 'Qué versión de las condiciones y del contrato de encargado aceptó cada taller, quién y cuándo. Solo la escribe accept_platform_terms; no se cambia ni se borra.';

revoke all on public.workshop_legal_acceptances from anon, authenticated;
grant select on public.workshop_legal_acceptances to authenticated;
grant all on public.workshop_legal_acceptances to service_role;
alter table public.workshop_legal_acceptances enable row level security;
create policy "legal acceptances: lectura gerencia" on public.workshop_legal_acceptances for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

create function public.accept_platform_terms(p_workshop_id uuid, p_version text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if p_workshop_id is null or p_workshop_id not in (select private.workshops_with_role('{propietario}')) then
    raise exception 'Solo la persona propietaria del taller acepta las condiciones y el contrato de encargo.' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]+\.[0-9]+$' then
    raise exception 'Versión no válida.' using errcode = '22023';
  end if;
  insert into public.workshop_legal_acceptances (workshop_id, document, version, accepted_by)
  values (p_workshop_id, 'condiciones', p_version, v_uid), (p_workshop_id, 'encargo', p_version, v_uid)
  on conflict (workshop_id, document, version) do nothing;
end;
$$;
revoke all on function public.accept_platform_terms(uuid, text) from public, anon;
grant execute on function public.accept_platform_terms(uuid, text) to authenticated;

-- La copia del taller incluye sus aceptaciones.
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
    ('access_events', '{}'), ('customer_account_links', '{}'), ('workshop_legal_acceptances', '{}')
$$;

-- ---------------------------------------------------------------------
-- Mantenimiento: además, borra las solicitudes de la web de hace más de 12 meses.
-- ---------------------------------------------------------------------
create or replace function public.run_maintenance()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hashes    integer;
  v_lookups   integer;
  v_quotes    integer;
  v_reminders integer;
  v_services  integer;
  v_requests  integer;
begin
  update public.web_requests set client_hash = null
   where client_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_hashes = row_count;
  delete from public.web_requests where created_at < now() - interval '12 months';
  get diagnostics v_requests = row_count;
  update public.vehicle_lookups set status = 'error', completed_at = now()
   where status = 'pendiente' and created_at < now() - interval '10 minutes';
  get diagnostics v_lookups = row_count;
  v_quotes := private.expire_quotes();
  v_reminders := private.generate_reminders();
  v_services := private.generate_service_reminders();
  return jsonb_build_object('huellas_borradas', v_hashes, 'solicitudes_borradas', v_requests, 'consultas_cerradas', v_lookups,
                            'presupuestos_caducados', v_quotes, 'recordatorios_nuevos', v_reminders,
                            'mantenimientos_nuevos', v_services);
end;
$$;
