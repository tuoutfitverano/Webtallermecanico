-- El cliente añade y quita vehículos desde su portal: papelera de 30 días; el taller lo conserva todo.
begin;
\ir _harness/fixtures.sql

-- c1: cliente de A (y de B) · c2: otro cliente de A · a1: propietaria de A · a2: mecánico de A
-- ===================== Añadir =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select set_config('tests.v', public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', ' 4821-xkl ', 'Seat', 'Ibiza', 2017, 'fabricacion', 'gasolina')::text, true);
select tests.eq((select plate from public.portal_vehicles() where id = current_setting('tests.v')::uuid), '4821XKL',
  'el cliente añade un vehículo a su ficha (matrícula normalizada)');
select tests.throws($$select public.portal_add_vehicle('c2000000-0000-0000-0000-00000000000a', '1111BBB', 'Seat', 'Ibiza', 2017, 'fabricacion')$$,
  'nunca a la ficha de otro cliente', '%no encontrada%');
select tests.throws($$select public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '1234KLM', 'Seat', 'León', 2015, 'fabricacion')$$,
  'una matrícula de otro cliente del taller no se le asocia', '%Pídele al taller%');
select tests.throws($$select public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '4821XKL', 'Seat', 'Ibiza', 2017, 'fabricacion')$$,
  'ni se duplica la suya', '%ya está en tu portal%');
select tests.throws($$select public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '2222CCC', 'Seat', 'Ibiza', null, null)$$,
  'matrícula, marca, modelo y año son obligatorios', '%año%');
select tests.throws($$select public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '!', 'Seat', 'Ibiza', 2017, 'fabricacion')$$,
  'matrícula no válida', '%Matrícula no válida%');
with u as (update public.vehicles set portal_hidden_at = now() returning 1)
select tests.eq((select count(*) from u), 0::bigint, 'el cliente no escribe en la tabla (RLS: no ve ninguna fila)');
reset role;
select tests.eq((select data_source::text || '|' || verification_status::text || '|' || added_by_customer from public.vehicles where id = current_setting('tests.v')::uuid),
  'cliente|pendiente|true', 'queda como dato del cliente, pendiente de verificar');

-- El taller lo ve como cualquier otro vehículo.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles where id = current_setting('tests.v')::uuid), 1::bigint, 'el taller ve el vehículo añadido');
select tests.throws($$update public.vehicles set portal_hidden_at = now() where id = current_setting('tests.v')::uuid$$,
  'el taller no puede mandarlo a la papelera del cliente', '%solo los cambia el cliente%');
select tests.throws($$update public.vehicles set added_by_customer = false where id = current_setting('tests.v')::uuid$$,
  'ni cambiar quién lo añadió', '%solo los cambia el cliente%');
with x as (insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
           values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.v')::uuid, 'c1000000-0000-0000-0000-00000000000a', 'Revisión') returning id)
select set_config('tests.o', (select id::text from x), true);
reset role;

-- ===================== Quitar =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.throws($$select public.portal_remove_vehicle(current_setting('tests.v')::uuid)$$,
  'no se quita con una reparación en curso', '%reparación en curso%');
select tests.throws($$select public.portal_remove_vehicle('7e000002-0000-0000-0000-00000000000a')$$,
  'ni el vehículo de otro cliente', '%no encontrado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'listo' where id = current_setting('tests.o')::uuid;
update public.repair_orders set status = 'entregado' where id = current_setting('tests.o')::uuid;
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.portal_remove_vehicle(current_setting('tests.v')::uuid);
select tests.eq((select count(*) from public.portal_vehicles() where id = current_setting('tests.v')::uuid), 0::bigint, 'quitado: desaparece de su portal');
select tests.eq((select count(*) from public.portal_orders() where vehicle_id = current_setting('tests.v')::uuid), 0::bigint, 'y sus reparaciones de las listas');
select tests.eq((select plate from public.portal_vehicle_trash()), '4821XKL', 'está en su papelera');
reset role;
select tests.eq((select count(*) from public.vehicles where id = current_setting('tests.v')::uuid), 1::bigint, 'el vehículo NO se borra');
select tests.eq((select count(*) from public.repair_orders where vehicle_id = current_setting('tests.v')::uuid), 1::bigint, 'ni su historial');

-- El taller lo sigue viendo todo (propietaria y mecánico asignado).
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles where id = current_setting('tests.v')::uuid and portal_hidden_at is not null), 1::bigint,
  'el taller conserva el vehículo y sabe que el cliente lo quitó');
select tests.eq((select count(*) from public.repair_order_events e join public.repair_orders o on o.id = e.order_id where o.vehicle_id = current_setting('tests.v')::uuid) > 0, true,
  'y todo su historial');
reset role;

-- ===================== Recuperar =====================
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.throws($$select public.portal_restore_vehicle(current_setting('tests.v')::uuid)$$, 'otro cliente no lo recupera', '%papelera%');
select tests.eq((select count(*) from public.portal_vehicle_trash()), 0::bigint, 'ni ve la papelera ajena');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.portal_restore_vehicle(current_setting('tests.v')::uuid);
select tests.eq((select count(*) from public.portal_vehicles() where id = current_setting('tests.v')::uuid), 1::bigint, 'recuperado: vuelve a su portal');
select tests.eq((select count(*) from public.portal_orders() where vehicle_id = current_setting('tests.v')::uuid), 1::bigint, 'con sus reparaciones');
select public.portal_remove_vehicle(current_setting('tests.v')::uuid);
reset role;

-- Pasados 30 días ya no está en la papelera ni se puede recuperar, pero el taller lo conserva.
update public.vehicles set portal_hidden_at = now() - interval '31 days' where id = current_setting('tests.v')::uuid;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_vehicle_trash()), 0::bigint, 'a los 30 días sale de la papelera');
select tests.throws($$select public.portal_restore_vehicle(current_setting('tests.v')::uuid)$$, 'y no se puede recuperar', '%papelera%');
-- Si vuelve a darlo de alta, recupera el mismo vehículo con su historial.
select tests.eq(public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '4821XKL', 'Seat', 'Ibiza', 2017, 'fabricacion')::text,
  current_setting('tests.v'), 'si lo vuelve a añadir, es el mismo vehículo con su historial');
select public.portal_remove_vehicle(current_setting('tests.v')::uuid);
reset role;

-- Una orden nueva del taller lo devuelve al portal.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.v')::uuid, 'c1000000-0000-0000-0000-00000000000a', 'Nueva visita');
reset role;
select tests.eq((select portal_hidden_at from public.vehicles where id = current_setting('tests.v')::uuid), null::timestamptz,
  'una orden nueva devuelve el vehículo al portal');

-- Sin sesión, nada.
set local role anon;
select tests.throws($$select public.portal_vehicle_trash()$$, 'sin sesión no hay papelera', '%permission denied%');
select tests.throws($$select public.portal_add_vehicle('c1000000-0000-0000-0000-00000000000a', '3333DDD', 'Seat', 'Ibiza', 2017, 'fabricacion')$$,
  'ni altas', '%permission denied%');
reset role;

rollback;
