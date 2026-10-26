-- Planes (Profesional / Premium) y consumo de los extras de pago: avisos por
-- WhatsApp y consultas de matrícula, que van a cargo del taller.
--
--  · El plan de cada taller lo pone la plataforma (SQL Editor), nunca el taller.
--  · Tarifas en extras_tariff (céntimos, IVA incluido): el Premium tiene precio
--    rebajado hasta un límite al mes; a partir de ahí, el normal. Se cambian
--    en el SQL Editor sin tocar el programa.
--  · Consumo de un mes (hora de Madrid): WhatsApp aceptados por Meta y
--    consultas de matrícula contestadas por el proveedor (las reutilizadas en
--    24 h no cuentan: no cuestan nada).
--  · El taller (propietario y administración) ve su consumo; la plataforma, el
--    de todos para cobrarlo. Sin datos personales.

create table public.workshop_plans (
  workshop_id  uuid primary key references public.workshops (id) on delete cascade,
  plan         text not null default 'profesional' check (plan in ('profesional', 'premium')),
  updated_at   timestamptz not null default now()
);
comment on table public.workshop_plans is 'Plan contratado por cada taller. Sin fila = Profesional. Solo lo cambia la plataforma (SQL Editor).';
alter table public.workshop_plans enable row level security;
revoke all on public.workshop_plans from anon, authenticated;

create table public.extras_tariff (
  plan              text not null check (plan in ('profesional', 'premium')),
  kind              text not null check (kind in ('whatsapp', 'matricula')),
  -- Precio normal y precio rebajado hasta discounted_limit unidades al mes (céntimos, IVA incluido).
  unit_cents        integer not null check (unit_cents between 0 and 10000),
  discounted_cents  integer not null check (discounted_cents between 0 and 10000),
  discounted_limit  integer not null default 0 check (discounted_limit >= 0),
  primary key (plan, kind)
);
comment on table public.extras_tariff is 'Precios de los extras a cargo del taller (céntimos, IVA incluido). Ver el guion comercial: cada unidad deja margen.';
alter table public.extras_tariff enable row level security;
revoke all on public.extras_tariff from anon, authenticated;
insert into public.extras_tariff (plan, kind, unit_cents, discounted_cents, discounted_limit) values
  ('profesional', 'whatsapp', 6, 6, 0),
  ('profesional', 'matricula', 75, 75, 0),
  ('premium', 'whatsapp', 6, 4, 300),
  ('premium', 'matricula', 75, 60, 60);

-- Importe (céntimos, IVA incluido) de n unidades en un mes según el plan.
create function private.extras_amount(p_plan text, p_kind text, p_units integer)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(least(p_units, t.discounted_limit) * t.discounted_cents
                  + greatest(p_units - t.discounted_limit, 0) * t.unit_cents, 0)::integer
    from public.extras_tariff t where t.plan = p_plan and t.kind = p_kind;
$$;
revoke all on function private.extras_amount(text, text, integer) from public, anon, authenticated;

-- Consumo del mes de p_month (hora de Madrid) de los talleres indicados.
create function private.usage_rows(p_month date, p_workshops uuid[])
returns table (workshop_id uuid, plan text, whatsapp integer, matriculas integer, whatsapp_cents integer, matriculas_cents integer)
language sql stable security definer set search_path = '' set timezone to 'Europe/Madrid'
as $$
  with bounds as (
    select date_trunc('month', p_month::timestamp)::timestamptz as start_at,
           (date_trunc('month', p_month::timestamp) + interval '1 month')::timestamptz as end_at
  ), counts as (
    select w.id,
           coalesce(p.plan, 'profesional') as plan,
           (select count(*)::integer from public.notifications n, bounds b
             where n.workshop_id = w.id and n.channel = 'whatsapp' and n.sent_at >= b.start_at and n.sent_at < b.end_at) as whatsapp,
           (select count(*)::integer from public.vehicle_lookups l, bounds b
             where l.workshop_id = w.id and l.status in ('encontrado', 'no_encontrado')
               and l.created_at >= b.start_at and l.created_at < b.end_at) as matriculas
      from public.workshops w
      left join public.workshop_plans p on p.workshop_id = w.id
     where w.id = any (p_workshops)
  )
  select c.id, c.plan, c.whatsapp, c.matriculas,
         private.extras_amount(c.plan, 'whatsapp', c.whatsapp),
         private.extras_amount(c.plan, 'matricula', c.matriculas)
    from counts c;
$$;
revoke all on function private.usage_rows(date, uuid[]) from public, anon, authenticated;

-- El taller ve su consumo (propietario y administración) y las tarifas de su plan.
create function public.workshop_usage(p_workshop_id uuid, p_month date default null)
returns table (plan text, whatsapp integer, matriculas integer, whatsapp_cents integer, matriculas_cents integer,
               whatsapp_unit_cents integer, whatsapp_discounted_cents integer, whatsapp_limit integer,
               matricula_unit_cents integer, matricula_discounted_cents integer, matricula_limit integer)
language plpgsql stable security definer set search_path = '' set timezone to 'Europe/Madrid'
as $$
begin
  if p_workshop_id is null or p_workshop_id not in (select private.manager_workshop_ids()) then
    raise exception 'Solo la propiedad y la administración del taller ven su consumo.' using errcode = '42501';
  end if;
  return query
    select u.plan, u.whatsapp, u.matriculas, u.whatsapp_cents, u.matriculas_cents,
           tw.unit_cents, tw.discounted_cents, tw.discounted_limit, tm.unit_cents, tm.discounted_cents, tm.discounted_limit
      from private.usage_rows(coalesce(p_month, current_date), array[p_workshop_id]) u
      join public.extras_tariff tw on tw.plan = u.plan and tw.kind = 'whatsapp'
      join public.extras_tariff tm on tm.plan = u.plan and tm.kind = 'matricula';
end;
$$;
revoke all on function public.workshop_usage(uuid, date) from public, anon;
grant execute on function public.workshop_usage(uuid, date) to authenticated;

-- La plataforma: el consumo de todos los talleres en un mes, para cobrarlo (sin datos personales).
create function public.admin_usage(p_month date default null)
returns table (workshop_id uuid, name text, plan text, whatsapp integer, matriculas integer, whatsapp_cents integer, matriculas_cents integer)
language plpgsql stable security definer set search_path = '' set timezone to 'Europe/Madrid'
as $$
begin
  if not private.is_platform_operator() then
    raise exception 'Solo la administración de la plataforma, con verificación en dos pasos.' using errcode = '42501';
  end if;
  return query
    select u.workshop_id, w.name, u.plan, u.whatsapp, u.matriculas, u.whatsapp_cents, u.matriculas_cents
      from private.usage_rows(coalesce(p_month, current_date), array(select id from public.workshops)) u
      join public.workshops w on w.id = u.workshop_id
     order by w.name;
end;
$$;
revoke all on function public.admin_usage(date) from public, anon;
grant execute on function public.admin_usage(date) to authenticated;

-- Cambiar el plan de un taller (SQL Editor): select private.set_workshop_plan('<slug>', 'premium');
create function private.set_workshop_plan(p_slug text, p_plan text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.workshops where slug = btrim(p_slug);
  if v_id is null then raise exception 'No hay ningún taller con ese identificador.' using errcode = 'P0002'; end if;
  insert into public.workshop_plans (workshop_id, plan) values (v_id, p_plan)
  on conflict (workshop_id) do update set plan = excluded.plan, updated_at = now();
end;
$$;
revoke all on function private.set_workshop_plan(text, text) from public, anon, authenticated, service_role;

-- El plan va en la copia del taller (es suyo; las tarifas son de la plataforma).
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
    ('access_events', '{}'), ('customer_account_links', '{}'), ('workshop_legal_acceptances', '{}'), ('workshop_plans', '{}')
$$;
