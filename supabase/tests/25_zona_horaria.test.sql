-- La fecha de las facturas, cobros, presupuestos y recordatorios es SIEMPRE la de
-- Madrid, aunque la sesión pida otra zona horaria (la API lo permite con la
-- cabecera «Prefer: timezone=…»). Auditoría del 24/10/2026.
begin;
\ir _harness/fixtures.sql

-- ===================== Ninguna función con fechas sin la hora de Madrid fijada =====================
select tests.eq((
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.prosrc ~* '(current_date|current_time|localtime|::date|to_char\s*\(|date_trunc|extract\s*\(|valid_until|due_date|issue_date|paid_on|next_due_on|next_service_date|preferred_date)'
     and not ('TimeZone=Europe/Madrid' = any (coalesce(p.proconfig, '{}')) or 'timezone=Europe/Madrid' = any (coalesce(p.proconfig, '{}')))),
  '', 'toda función que usa fechas fija la hora de Madrid (create or replace la borra: añade «set timezone»)');

-- ===================== Factura emitida con la sesión en UTC+14 =====================
update public.workshops set legal_name = 'Taller Alcarria S.L.', tax_id = 'B12345674' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Revisión')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate) values
  ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 1, 'mano_obra', 'Revisión', 1, 5000, 21);
select set_config('tests.f1', public.create_invoice_draft(current_setting('tests.o1')::uuid)::text, true);

-- Lo que haría una petición con «Prefer: timezone=Pacific/Kiritimati».
set local timezone to 'Pacific/Kiritimati';
select public.issue_invoice(current_setting('tests.f1')::uuid);
reset timezone;
select tests.eq((select issue_date from public.invoices where id = current_setting('tests.f1')::uuid),
  (now() at time zone 'Europe/Madrid')::date, 'la factura lleva la fecha de Madrid, no la que pide la sesión');
select tests.eq((select full_number like 'F' || extract(year from (now() at time zone 'Europe/Madrid')) || '-%' from public.invoices where id = current_setting('tests.f1')::uuid),
  true, 'y la serie del año de Madrid');

-- Un cobro «de mañana» según la sesión es futuro en Madrid: no se admite.
set local timezone to 'Pacific/Kiritimati';
select tests.throws(format($$insert into public.payments (workshop_id, invoice_id, amount_cents, method, paid_on) values ('aaaaaaaa-0000-0000-0000-000000000000', %L, 100, 'efectivo', %L)$$,
  current_setting('tests.f1'), ((now() at time zone 'Europe/Madrid')::date + 1)::text), 'un cobro con fecha de mañana (en Madrid) se rechaza', '%futur%');
reset timezone;
reset role;

rollback;
