-- Datos de PRUEBA para test-restore.sh (nunca en producción): los talleres y
-- cuentas de supabase/tests/_harness/fixtures.sql más una orden con historial,
-- un presupuesto aceptado y una factura emitida y cobrada, creados con las
-- funciones reales (así hay historial, avisos y registro encadenado de facturas).
-- Una sola transacción: la sesión simulada (tests.login) solo vale dentro de ella.
begin;
\ir ../../supabase/tests/_harness/fixtures.sql
update public.workshops set legal_name = 'Taller de Prueba S.L.', tax_id = 'B00000000' where id = 'aaaaaaaa-0000-0000-0000-000000000000';

select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
with o as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Ruido al frenar')
  returning id)
select set_config('copia.orden', (select id::text from o), true);
update public.repair_orders set status = 'diagnosis' where id = current_setting('copia.orden')::uuid;
update public.repair_orders set status = 'en_reparacion' where id = current_setting('copia.orden')::uuid;
insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('copia.orden')::uuid, 1, 'pieza', 'Pastillas delanteras', 1, 4200, 21),
       ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('copia.orden')::uuid, 2, 'mano_obra', 'Sustitución', 1.5, 4500, 21);
update public.repair_orders set status = 'listo' where id = current_setting('copia.orden')::uuid;
update public.repair_orders set status = 'entregado' where id = current_setting('copia.orden')::uuid;
select set_config('copia.factura', public.create_invoice_draft(current_setting('copia.orden')::uuid)::text, true);
select public.issue_invoice(current_setting('copia.factura')::uuid);
insert into public.payments (workshop_id, invoice_id, amount_cents, method, paid_on)
select workshop_id, id, total_cents, 'tarjeta', current_date from public.invoices where id = current_setting('copia.factura')::uuid;
reset role;
commit;
