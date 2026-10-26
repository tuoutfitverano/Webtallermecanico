-- Cambio de titular de un vehículo vendido: se pide, se comprueba (vendedor u oficina) y queda registrado.
begin;
\ir _harness/fixtures.sql

-- Una reparación ya entregada del titular actual (Cliente Uno) y un recordatorio suyo pendiente.
insert into public.repair_orders (id, workshop_id, vehicle_id, customer_id, problem_description, status)
values ('0d000001-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a',
        'c1000000-0000-0000-0000-00000000000a', 'Cambio de aceite de Cliente Uno', 'entregado');
insert into public.reminders (workshop_id, kind, customer_id, vehicle_id, due_on, title, dedupe_key)
values ('aaaaaaaa-0000-0000-0000-000000000000', 'revision', 'c1000000-0000-0000-0000-00000000000a',
        '7e000001-0000-0000-0000-00000000000a', current_date, 'Revisión del Golf', 'prueba-titular');
insert into public.vehicles (id, workshop_id, customer_id, plate, make, model, year, year_kind, fuel) values
  ('7e000003-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', '1111AAA', 'Renault', 'Clio', 2012, 'fabricacion', 'gasolina'),
  ('7e000004-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', '2222BBB', 'Opel', 'Corsa', 2013, 'fabricacion', 'gasolina');

-- ===================== El comprador lo pide desde su portal =====================
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.throws($$select public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '9999ZZZ')$$,
  'una matrícula que no está en el taller no se puede pedir', '%no está registrada%');
select tests.throws($$select public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '1234-KLM')$$,
  'ni uno que ya es suyo', '%ya está a tu nombre%');
select tests.throws($$select public.portal_request_vehicle_transfer('c1000000-0000-0000-0000-00000000000a', '1950BXF')$$,
  'ni en nombre de otra ficha', '%Ficha no encontrada%');
select set_config('tests.t1', public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '1950 bxf')::text, true);
select tests.eq(public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '1950BXF')::text,
  current_setting('tests.t1'), 'pedirlo dos veces no crea otra solicitud');
select tests.eq((select count(*) from public.portal_vehicles() where id = '7e000001-0000-0000-0000-00000000000a'), 0::bigint,
  'pedirlo no da el vehículo: saber la matrícula no basta');
select tests.eq((select role || ':' || status from public.portal_vehicle_transfers() where id = current_setting('tests.t1')::uuid),
  'comprador:pendiente', 'el comprador ve su petición pendiente');
reset role;

-- El titular actual recibe la pregunta, sin el nombre de quien lo pide.
select tests.eq((select count(*) from public.notifications where customer_id = 'c1000000-0000-0000-0000-00000000000a'
                   and event = 'cambio_titular' and title = '¿Has vendido tu vehículo?' and body not like '%Cliente Dos%'), 1::bigint,
  'al titular se le pregunta si lo ha vendido (sin decirle quién lo pide)');

-- ===================== Quién NO puede =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.vehicle_transfers), 0::bigint, 'un mecánico no ve los cambios de titular');
select tests.throws(format('select public.confirm_vehicle_transfer(%L, %L)', current_setting('tests.t1'), 'permiso'),
  'ni los confirma', '%no encontrada%');
select tests.throws($$select public.transfer_vehicle('7e000001-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'permiso')$$,
  'ni cambia el titular en el mostrador', '%no encontrado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws(format('select public.confirm_vehicle_transfer(%L, %L)', current_setting('tests.t1'), 'permiso'),
  'otro taller tampoco', '%no encontrada%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$update public.vehicles set customer_id = 'c2000000-0000-0000-0000-00000000000a' where id = '7e000001-0000-0000-0000-00000000000a'$$,
  'ni la propietaria cambia el titular escribiendo en la tabla', '%Cambiar de titular%');
reset role;

-- ===================== El titular dice que NO lo ha vendido =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select role || ':' || plate from public.portal_vehicle_transfers() where id = current_setting('tests.t1')::uuid),
  'vendedor:1950BXF', 'el titular ve la pregunta en su portal');
select tests.eq(public.portal_answer_vehicle_transfer(current_setting('tests.t1')::uuid, false), 'no_vendido', 'contesta que no');
select tests.eq((select count(*) from public.portal_vehicles() where id = '7e000001-0000-0000-0000-00000000000a'), 1::bigint,
  'y sigue siendo suyo: decide la oficina');
reset role;

-- ===================== La oficina comprueba el documento =====================
-- Con una reparación en curso no se cambia.
insert into public.repair_orders (id, workshop_id, vehicle_id, customer_id, problem_description)
values ('0d000002-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a',
        'c1000000-0000-0000-0000-00000000000a', 'En curso');
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq((select seller_answer from public.vehicle_transfers where id = current_setting('tests.t1')::uuid), 'no_vendido',
  'la oficina ve que el titular dijo que no lo ha vendido');
select tests.throws(format('select public.confirm_vehicle_transfer(%L, %L)', current_setting('tests.t1'), 'contrato'),
  'solo valen el permiso de circulación o miDGT', '%permiso de circulación%');
select tests.throws(format('select public.confirm_vehicle_transfer(%L, %L)', current_setting('tests.t1'), 'permiso'),
  'con una reparación en curso no se cambia', '%reparación en curso%');
reset role;
update public.repair_orders set status = 'entregado' where id = '0d000002-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.confirm_vehicle_transfer(current_setting('tests.t1')::uuid, 'permiso');
select tests.eq((select status || ':' || method || ':' || decided_by from public.vehicle_transfers where id = current_setting('tests.t1')::uuid),
  'confirmado:permiso:00000000-0000-0000-0000-0000000000a3', 'queda registrado cómo se comprobó y quién lo confirmó');
reset role;
select tests.eq((select customer_id from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'),
  'c2000000-0000-0000-0000-00000000000a'::uuid, 'el vehículo pasa al comprador');
select tests.eq((select status::text from public.reminders where dedupe_key = 'prueba-titular'), 'descartado',
  'los recordatorios pendientes del titular anterior se cancelan');
select tests.eq((select count(*) from public.notifications where event = 'cambio_titular' and channel = 'app'
                   and ((customer_id = 'c1000000-0000-0000-0000-00000000000a' and title = 'Tu vehículo ha cambiado de titular')
                     or (customer_id = 'c2000000-0000-0000-0000-00000000000a' and title = 'Ya tienes tu vehículo en tu portal'))), 2::bigint,
  'se avisa a los dos');

select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select count(*) from public.portal_vehicles() where id = '7e000001-0000-0000-0000-00000000000a'), 1::bigint,
  'el comprador lo ve en su portal');
select tests.eq((select count(*) from public.portal_orders() where id = '0d000001-0000-0000-0000-00000000000a'), 0::bigint,
  'pero NO las reparaciones del titular anterior');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_vehicles() where id = '7e000001-0000-0000-0000-00000000000a'), 0::bigint,
  'el titular anterior deja de verlo');
select tests.eq((select count(*) from public.portal_orders() where id = '0d000001-0000-0000-0000-00000000000a'), 1::bigint,
  'y conserva sus reparaciones');
select tests.throws(format('select public.portal_answer_vehicle_transfer(%L, true)', current_setting('tests.t1')),
  'una solicitud cerrada ya no se contesta', '%no encontrada%');

-- ===================== El titular confirma la venta desde su portal =====================
select set_config('tests.t2', public.portal_request_vehicle_transfer('c1000000-0000-0000-0000-00000000000a', '1234KLM')::text, true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq(public.portal_answer_vehicle_transfer(current_setting('tests.t2')::uuid, true), 'confirmado',
  'el vendedor dice «Sí, lo he vendido»');
reset role;
select tests.eq((select customer_id::text || ':' || (select method from public.vehicle_transfers where id = current_setting('tests.t2')::uuid)
                   from public.vehicles where id = '7e000002-0000-0000-0000-00000000000a'),
  'c1000000-0000-0000-0000-00000000000a:vendedor', 'y el cambio se hace al momento');

-- ===================== La oficina lo rechaza =====================
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select set_config('tests.t3', public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '1234KLM')::text, true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.reject_vehicle_transfer(current_setting('tests.t3')::uuid);
select tests.eq((select status from public.vehicle_transfers where id = current_setting('tests.t3')::uuid), 'rechazado', 'rechazada');
reset role;
select tests.eq((select count(*) from public.notifications where customer_id = 'c2000000-0000-0000-0000-00000000000a'
                   and title = 'No se ha hecho el cambio de titular' and channel = 'app'), 1::bigint, 'y el comprador lo sabe');

-- ===================== Límite de peticiones =====================
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '1111AAA');
select tests.throws($$select public.portal_request_vehicle_transfer('c2000000-0000-0000-0000-00000000000a', '2222BBB')$$,
  'como mucho 3 peticiones al día', '%varios cambios hoy%');
reset role;

-- ===================== En el mostrador =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.transfer_vehicle('7e000003-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', null)$$,
  'en el mostrador también hay que decir cómo se comprobó', '%Indica cómo%');
select tests.throws($$select public.transfer_vehicle('7e000003-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'permiso')$$,
  'solo a clientes del mismo taller', '%Cliente no encontrado%');
select public.transfer_vehicle('7e000003-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'midgt');
select tests.eq((select count(*) from public.vehicle_transfers where vehicle_id = '7e000003-0000-0000-0000-00000000000a'), 1::bigint,
  'si el comprador ya lo había pedido, se confirma esa misma petición');
select tests.eq((select status || ':' || method || ':' || origin from public.vehicle_transfers where vehicle_id = '7e000003-0000-0000-0000-00000000000a'),
  'confirmado:midgt:portal', 'con el documento que vio la oficina');
select public.transfer_vehicle('7e000004-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'correccion');
select tests.eq((select origin || ':' || method from public.vehicle_transfers where vehicle_id = '7e000004-0000-0000-0000-00000000000a'),
  'taller:correccion', 'o corrige un vehículo registrado en la ficha equivocada');
select tests.throws($$insert into public.vehicle_transfers (workshop_id, vehicle_id, to_customer_id, origin)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000004-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'taller')$$,
  'nadie escribe en el registro de titulares directamente', '%permission denied%');
reset role;

-- Un vehículo sin titular sí se puede asignar al editarlo.
update public.vehicles set customer_id = null where id = '7e000004-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.vehicles set customer_id = 'c1000000-0000-0000-0000-00000000000a' where id = '7e000004-0000-0000-0000-00000000000a';
select tests.eq((select customer_id from public.vehicles where id = '7e000004-0000-0000-0000-00000000000a'),
  'c1000000-0000-0000-0000-00000000000a'::uuid, 'un vehículo sin titular se asigna al editarlo');
reset role;

rollback;
