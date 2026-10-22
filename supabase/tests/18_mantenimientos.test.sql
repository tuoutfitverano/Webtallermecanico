-- Mantenimientos periódicos: lista por taller, marcados en la orden, próximo al entregar, portal y recordatorios.
begin;
\ir _harness/fixtures.sql

-- a1: propietaria de A · a2: mecánico de A · a3: administradora de A · b1: personal de B · c1/c2: clientes de A
select set_config('tests.aceite', (select id::text from public.service_intervals
  where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = 'Cambio de aceite y filtro'), true);
select set_config('tests.itv', (select id::text from public.service_intervals
  where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = 'Pre-ITV'), true);
select set_config('tests.aceite_b', (select id::text from public.service_intervals
  where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' and name = 'Cambio de aceite y filtro'), true);

-- ===================== Lista de cada taller =====================
select tests.eq((select count(*) from public.service_intervals where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 6::bigint,
  'cada taller nace con la lista de partida (aceite, revisión, pre-ITV, filtros, frenos, correa)');
insert into public.workshops (id, slug, name, status) values ('cccccccc-0000-0000-0000-000000000000', 'taller-nuevo', 'Taller nuevo', 'activo');
select tests.eq((select count(*) from public.service_intervals where workshop_id = 'cccccccc-0000-0000-0000-000000000000'), 6::bigint,
  'también un taller dado de alta después');

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.service_intervals), 6::bigint, 'el mecánico ve la lista de su taller (y solo la suya)');
select tests.eq(tests.affected($$update public.service_intervals set every_months = 6 where id = current_setting('tests.aceite')::uuid$$), 0::bigint,
  'pero no la cambia');
select tests.throws($$insert into public.service_intervals (workshop_id, name, every_months) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Embrague', 24)$$,
  'ni añade mantenimientos', '%row-level security%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq(tests.affected($$update public.service_intervals set every_months = 18, every_km = 20000 where id = current_setting('tests.aceite')::uuid$$), 1::bigint,
  'la administradora cambia la periodicidad');
insert into public.service_intervals (workshop_id, name, every_months, every_km) values ('aaaaaaaa-0000-0000-0000-000000000000', '  Kit   de embrague ', null, 120000);
select tests.eq((select name from public.service_intervals where name like 'Kit%'), 'Kit de embrague', 'y añade los suyos (nombre limpio)');
select tests.throws($$insert into public.service_intervals (workshop_id, name, every_months) values ('aaaaaaaa-0000-0000-0000-000000000000', 'kit de embrague', 12)$$,
  'sin nombres repetidos', '%service_intervals_name_idx%');
select tests.throws($$insert into public.service_intervals (workshop_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Sin plazo')$$,
  'con meses o kilómetros', '%check%');
select tests.throws($$insert into public.service_intervals (workshop_id, name, every_months) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Ajeno', 12)$$,
  'nunca en otro taller', '%row-level security%');
select tests.eq(tests.affected($$update public.service_intervals set every_months = 1 where id = current_setting('tests.aceite_b')::uuid$$), 0::bigint,
  'ni cambia la lista de otro taller');
select tests.throws($$delete from public.service_intervals where id = current_setting('tests.itv')::uuid$$,
  'no se borran (se desactivan, para no perder el historial)', '%permission denied%');
update public.service_intervals set every_months = 12, every_km = 15000 where id = current_setting('tests.aceite')::uuid;
reset role;

-- ===================== Marcados en la orden =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description, mileage_in)
           values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
                   '00000000-0000-0000-0000-0000000000a2', 'Cambio de aceite', 80000) returning id)
select set_config('tests.o1', (select id::text from x), true);
with x as (insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
           values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Pre-ITV') returning id)
select set_config('tests.o2', (select id::text from x), true);
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
insert into public.order_services (order_id, workshop_id, interval_id)
values (current_setting('tests.o1')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.aceite')::uuid);
select tests.eq((select count(*) from public.order_services where order_id = current_setting('tests.o1')::uuid), 1::bigint,
  'el mecánico marca lo que ha hecho en su orden');
select tests.throws($$insert into public.order_services (order_id, workshop_id, interval_id)
                      values (current_setting('tests.o2')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.itv')::uuid)$$,
  'no en una orden que no es suya', '%row-level security%');
select tests.throws($$insert into public.order_services (order_id, workshop_id, interval_id)
                      values (current_setting('tests.o1')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.aceite_b')::uuid)$$,
  'ni con un mantenimiento de otro taller', '%foreign key%');
select tests.eq((select count(*) from public.vehicle_services), 0::bigint, 'sin entregar, todavía no cuenta para el vehículo');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.order_services), 0::bigint, 'otro taller no ve los mantenimientos de las órdenes');
select tests.throws($$insert into public.order_services (order_id, workshop_id, interval_id)
                      values (current_setting('tests.o1')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.aceite')::uuid)$$,
  'ni los marca', '%row-level security%');
reset role;

-- ===================== Al entregar: último y próximo =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid;
update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid;
select tests.eq((select format('%s|%s|%s|%s', last_done_on = (now() at time zone 'Europe/Madrid')::date, last_done_km,
                               next_due_on = ((now() at time zone 'Europe/Madrid')::date + interval '12 months')::date, next_due_km)
                   from public.vehicle_services where vehicle_id = '7e000001-0000-0000-0000-00000000000a' and interval_id = current_setting('tests.aceite')::uuid),
  't|80000|t|95000', 'al entregar: hecho hoy a 80.000 km → próximo en 12 meses o a 95.000 km');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.affected($$delete from public.order_services where order_id = current_setting('tests.o1')::uuid$$), 0::bigint,
  'entregada, el mecánico ya no lo desmarca');
reset role;
select tests.eq((select count(*) from public.order_services where order_id = current_setting('tests.o1')::uuid), 1::bigint,
  '(sigue marcado)');

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
update public.service_intervals set every_months = 6, every_km = null where id = current_setting('tests.aceite')::uuid;
select tests.eq((select format('%s|%s', next_due_on = ((now() at time zone 'Europe/Madrid')::date + interval '6 months')::date, next_due_km)
                   from public.vehicle_services where interval_id = current_setting('tests.aceite')::uuid),
  't|', 'si el taller cambia la periodicidad, se recalcula el próximo');
update public.service_intervals set every_months = 12, every_km = 15000 where id = current_setting('tests.aceite')::uuid;
reset role;

-- ===================== Anotado a mano (hecho fuera del taller) =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select public.set_vehicle_service('7e000002-0000-0000-0000-00000000000a', current_setting('tests.itv')::uuid, current_date - 30)$$,
  'el mecánico no anota a mano', '%no encontrado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select public.set_vehicle_service('7e000002-0000-0000-0000-00000000000a', current_setting('tests.itv')::uuid, current_date - 30)$$,
  'ni otro taller', '%no encontrado%');
select tests.eq((select count(*) from public.vehicle_services), 0::bigint, 'que tampoco ve los de este taller');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.set_vehicle_service('7e000002-0000-0000-0000-00000000000a', current_setting('tests.itv')::uuid, current_date + 1)$$,
  'no con fecha futura', '%futura%');
select tests.throws($$select public.set_vehicle_service('7e000002-0000-0000-0000-00000000000a', current_setting('tests.aceite_b')::uuid, current_date)$$,
  'ni con un mantenimiento de otro taller', '%no encontrado%');
select public.set_vehicle_service('7e000002-0000-0000-0000-00000000000a', current_setting('tests.itv')::uuid, current_date - 360, 120000);
select tests.eq((select format('%s|%s|%s', source, next_due_on = current_date + 5, next_due_km)
                   from public.vehicle_services where vehicle_id = '7e000002-0000-0000-0000-00000000000a'),
  'manual|t|', 'la oficina anota uno hecho fuera: próximo calculado (la pre-ITV va solo por meses)');
select tests.throws($$update public.vehicle_services set next_due_on = current_date$$, 'nadie escribe el calendario a mano', '%permission denied%');
reset role;

-- ===================== Portal del cliente =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select string_agg(name || ':' || coalesce(next_due_km::text, '-'), ',') from public.portal_vehicle_services('7e000001-0000-0000-0000-00000000000a')),
  'Cambio de aceite y filtro:95000', 'el cliente ve los mantenimientos de su vehículo');
select tests.eq((select count(*) from public.portal_vehicle_services('7e000002-0000-0000-0000-00000000000a')), 0::bigint,
  'nunca los del vehículo de otro cliente');
select tests.eq((select count(*) from public.vehicle_services) + (select count(*) from public.order_services), 0::bigint,
  'ni lee las tablas (RLS: ninguna fila)');
reset role;
update public.service_intervals set active = false where id = current_setting('tests.aceite')::uuid;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_vehicle_services('7e000001-0000-0000-0000-00000000000a')), 0::bigint,
  'un mantenimiento desactivado deja de mostrarse');
reset role;
update public.service_intervals set active = true where id = current_setting('tests.aceite')::uuid;

-- ===================== Recordatorios =====================
select private.generate_service_reminders();
select tests.eq((select count(*) from public.reminders where dedupe_key like 'mant%'), 0::bigint,
  'sin la regla «revisión» del taller activada, no hay recordatorios');
update public.reminder_settings set revision_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.vehicles set mileage = 94500 where id = '7e000001-0000-0000-0000-00000000000a';
select tests.eq((public.run_maintenance() ->> 'mantenimientos_nuevos')::int, 2, 'el mantenimiento programado los genera (pre-ITV por fecha, aceite por km)');
select tests.eq((select string_agg(title, ' / ' order by title) from public.reminders where dedupe_key like 'mant%'),
  'Cambio de aceite y filtro de tu Volkswagen Golf / Pre-ITV de tu Seat León', 'con el nombre del mantenimiento y el coche');
select tests.eq((select count(*) from public.notifications where event::text = 'recordatorio_revision'), 0::bigint,
  'al cliente solo le llega si él lo pidió');
select tests.eq(private.generate_service_reminders(), 0, 'sin duplicados al repetir el proceso');
update public.workshops set status = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
delete from public.reminders where dedupe_key like 'mant%';
select tests.eq(private.generate_service_reminders(), 0, 'un taller suspendido no genera recordatorios');
update public.workshops set status = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- ===================== Deshacer la entrega =====================
delete from public.order_services where order_id = current_setting('tests.o1')::uuid;
select tests.eq((select count(*) from public.vehicle_services where vehicle_id = '7e000001-0000-0000-0000-00000000000a'), 0::bigint,
  'si se desmarca, el vehículo deja de tenerlo en su calendario');

rollback;
