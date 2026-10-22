-- Fase 4: órdenes de reparación, historial, búsquedas y resumen del panel.
begin;
\ir _harness/fixtures.sql

-- a1 propietaria de A · a3 administradora de A · a2 mecánico de A · b1 propietario de B · ff sin taller
-- A: clientes c1…a (Cliente Uno), c2…a; vehículos 7e000001…a (1950BXF), 7e000002…a (1234KLM)
-- B: cliente c1…b; vehículo 7e000001…b (5678BCD)

-- ===================== Crear órdenes (propietaria de A) =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;

with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-0000000000a2', '  Ruido al frenar  ')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
select tests.eq((select number from public.repair_orders where id = current_setting('tests.o1')::uuid), 1, 'la primera orden del taller es la número 1');
select tests.eq((select status::text from public.repair_orders where id = current_setting('tests.o1')::uuid), 'recibido', 'nace como "vehículo recibido"');
select tests.eq((select problem_description from public.repair_orders where id = current_setting('tests.o1')::uuid), 'Ruido al frenar', 'se quitan espacios sobrantes');
select tests.eq((select created_by from public.repair_orders where id = current_setting('tests.o1')::uuid), '00000000-0000-0000-0000-0000000000a1'::uuid, 'queda registrado quién la creó');
select tests.eq((select kind::text || '|' || to_status::text || '|' || actor::text from public.repair_order_events where order_id = current_setting('tests.o1')::uuid),
  'creada|recibido|00000000-0000-0000-0000-0000000000a1', 'el historial registra la creación, el estado y el responsable');

with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Revisión de los 60.000 km')
  returning id)
select set_config('tests.o2', (select id::text from x), true);
select tests.eq((select number from public.repair_orders where id = current_setting('tests.o2')::uuid), 2, 'la numeración es correlativa');

-- Integridad: nada de otro taller.
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000a', 'Coche ajeno')$$,
  'no se crea una orden con un vehículo de otro taller', '%foreign key%');
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000b', 'Cliente ajeno')$$,
  'no se crea una orden con un cliente de otro taller', '%foreign key%');
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'Mecánico ajeno')$$,
  'no se asigna a alguien de otro taller (lo frena el disparador; detrás está la clave foránea)', '%equipo activo%');
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('bbbbbbbb-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'En el taller B')$$,
  'no se crean órdenes en otro taller cambiando el workshop_id', '%row-level security%');
select tests.throws($$update public.repair_orders set number = 99$$, 'el número de orden no se cambia', '%permission denied%');
select tests.throws($$update public.repair_orders set workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 'una orden no cambia de taller', '%permission denied%');
select tests.throws($$delete from public.repair_orders$$, 'las órdenes no se borran desde la API', '%permission denied%');
select tests.throws($$insert into public.repair_order_events (order_id, workshop_id, kind) values (current_setting('tests.o1')::uuid, 'aaaaaaaa-0000-0000-0000-000000000000', 'estado')$$,
  'nadie escribe el historial a mano', '%permission denied%');
select tests.throws($$update public.repair_order_events set actor = null$$, 'nadie modifica el historial', '%permission denied%');
select tests.throws($$delete from public.repair_order_events$$, 'nadie borra el historial', '%permission denied%');

-- Ciclo de vida
select tests.eq(tests.affected($$update public.repair_orders set status = 'diagnosis' where id = current_setting('tests.o1')::uuid$$), 1::bigint, 'pasa a "en diagnosis"');
select tests.eq((select from_status::text || '>' || to_status::text from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'estado'),
  'recibido>diagnosis', 'el historial guarda el cambio de estado');
reset role;

-- El historial no se reescribe ni con privilegios de sistema.
select tests.throws($$update public.repair_order_events set actor = null$$, 'ni el superusuario reescribe el historial', '%no se puede modificar%');

-- ===================== Mecánico (a2) =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders), 1::bigint, 'el mecánico solo ve las órdenes asignadas a él');
select tests.eq(tests.affected($$update public.repair_orders set diagnosis = 'Pastillas gastadas', internal_notes = 'Pedir a proveedor X' where id = current_setting('tests.o1')::uuid$$),
  1::bigint, 'el mecánico escribe la diagnosis y notas internas de su orden');
select tests.eq((select changed_fields from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'datos'),
  array['diagnosis', 'internal_notes'], 'el historial guarda qué campos cambiaron');
select tests.eq(tests.affected($$update public.repair_orders set status = 'esperando_recambios' where id = current_setting('tests.o1')::uuid$$),
  1::bigint, 'el mecánico cambia el estado de su orden');
select tests.throws($$update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid$$,
  'el mecánico no marca como entregado', '%entregada%');
select tests.throws($$update public.repair_orders set assigned_to = null where id = current_setting('tests.o1')::uuid$$,
  'el mecánico no se quita ni cambia la asignación', '%Solo el propietario o un administrador%');
select tests.throws($$update public.repair_orders set vehicle_id = '7e000002-0000-0000-0000-00000000000a' where id = current_setting('tests.o1')::uuid$$,
  'el mecánico no cambia el vehículo', '%Solo el propietario o un administrador%');
select tests.eq(tests.affected($$update public.repair_orders set diagnosis = 'x' where id = current_setting('tests.o2')::uuid$$), 0::bigint,
  'el mecánico no toca órdenes que no son suyas');
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Nueva')$$,
  'el mecánico no crea órdenes', '%row-level security%');
select tests.eq((select count(distinct order_id) from public.repair_order_events), 1::bigint, 'el mecánico solo ve el historial de sus órdenes');
select tests.eq((select active from public.workshop_dashboard('aaaaaaaa-0000-0000-0000-000000000000')), 1::bigint, 'el resumen del mecánico cuenta sus trabajos');
select tests.eq((select count(*) from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000')), 1::bigint, 'la búsqueda respeta los permisos');
reset role;

-- ===================== Administradora (a3) =====================
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders), 2::bigint, 'la administradora ve todas las órdenes del taller');
select tests.eq(tests.affected($$update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a2' where id = current_setting('tests.o2')::uuid$$),
  1::bigint, 'la administradora asigna un mecánico');
select tests.eq((select to_assignee from public.repair_order_events where order_id = current_setting('tests.o2')::uuid and kind = 'asignacion'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'el historial guarda la asignación');
select tests.eq(tests.affected($$update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid$$), 1::bigint, 'listo para recoger');
select tests.eq(tests.affected($$update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid$$), 1::bigint, 'la administradora marca como entregado');
select tests.ok((select delivered_at is not null from public.repair_orders where id = current_setting('tests.o1')::uuid), 'queda registrada la fecha de entrega');
select tests.eq((select active || '|' || delivered_30d from public.workshop_dashboard('aaaaaaaa-0000-0000-0000-000000000000')), '1|1', 'el resumen cuenta activas y entregadas');
select tests.eq((select count(*) from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'estado'), 4::bigint,
  'el historial guarda todos los cambios de estado');
select tests.throws($$delete from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'$$,
  'un vehículo con órdenes no se puede borrar (se conserva el historial)', '%foreign key%');
select tests.throws($$delete from public.customers where id = 'c1000000-0000-0000-0000-00000000000a'$$,
  'un cliente con órdenes no se puede borrar', '%foreign key%');
reset role;

-- ===================== Otro taller, sin taller y anónimo =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders), 0::bigint, 'el propietario de B no ve órdenes de A');
select tests.eq((select count(*) from public.repair_orders where id = current_setting('tests.o2')::uuid), 0::bigint,
  'ni pidiéndola por su id');
select tests.eq(tests.affected($$update public.repair_orders set status = 'listo' where id = current_setting('tests.o2')::uuid$$), 0::bigint,
  'ni la modifica conociendo su id');
select tests.eq((select count(*) from public.repair_order_events), 0::bigint, 'ni ve su historial');
select tests.eq((select count(*) from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000')), 0::bigint,
  'la búsqueda con el id de otro taller no devuelve nada');
select tests.eq((select count(*) from public.search_customers('aaaaaaaa-0000-0000-0000-000000000000')), 0::bigint, 'ni clientes de A');
select tests.eq((select count(*) from public.search_vehicles('aaaaaaaa-0000-0000-0000-000000000000')), 0::bigint, 'ni vehículos de A');
select tests.eq((select active + customers + vehicles from public.workshop_dashboard('aaaaaaaa-0000-0000-0000-000000000000')), 0::bigint,
  'el resumen de otro taller sale a cero');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders) + (select count(*) from public.customers) + (select count(*) from public.vehicles), 0::bigint,
  'una persona sin taller no ve nada');
reset role;

select tests.logout();
set local role anon;
select tests.throws($$select * from public.repair_orders$$, 'anónimo: no lee órdenes', '%permission denied%');
select tests.throws($$select * from public.repair_order_events$$, 'anónimo: no lee el historial', '%permission denied%');
select tests.throws($$select * from public.search_customers('aaaaaaaa-0000-0000-0000-000000000000')$$, 'anónimo: no busca', '%permission denied%');
select tests.throws($$select * from public.workshop_dashboard('aaaaaaaa-0000-0000-0000-000000000000')$$, 'anónimo: no ve el resumen', '%permission denied%');
reset role;

-- ===================== Búsquedas =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select full_name from public.search_customers('aaaaaaaa-0000-0000-0000-000000000000', 'uno')), 'Cliente Uno (A)', 'busca clientes por nombre');
select tests.eq((select full_name from public.search_customers('aaaaaaaa-0000-0000-0000-000000000000', '600 000 001')), 'Cliente Uno (A)', 'busca clientes por teléfono');
select tests.eq((select count(*) from public.search_customers('aaaaaaaa-0000-0000-0000-000000000000', '%')), 0::bigint,
  'los comodines de la búsqueda se tratan como texto');
select tests.eq((select full_name from public.find_customer_duplicates('aaaaaaaa-0000-0000-0000-000000000000', '+34 600-000-001', null)), 'Cliente Uno (A)',
  'avisa de un posible cliente duplicado por teléfono');
select tests.eq((select plate from public.search_vehicles('aaaaaaaa-0000-0000-0000-000000000000', '1950 bxf')), '1950BXF', 'busca vehículos por matrícula escrita de cualquier forma');
select tests.eq((select count(*) from public.search_vehicles('aaaaaaaa-0000-0000-0000-000000000000', 'volkswagen')), 1::bigint, 'busca vehículos por marca');
select tests.eq((select number from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000', 'OR-2')), 2, 'busca órdenes por número');
select tests.eq((select number from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000', '1234 klm')), 2, 'busca órdenes por matrícula');
select tests.eq((select count(*) from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000', '', null, null, true)), 1::bigint, 'filtra las activas');
select tests.eq((select count(*) from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000', '', 'entregado')), 1::bigint, 'filtra por estado');
select tests.eq((select count(*) from public.search_repair_orders('aaaaaaaa-0000-0000-0000-000000000000', '', null, '00000000-0000-0000-0000-0000000000a2')), 2::bigint,
  'filtra por empleado asignado');
reset role;

-- Administración de plataforma con 2FA: solo con una sesión de soporte abierta.
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders), 0::bigint, 'el admin de plataforma con 2FA y sin sesión de soporte no ve las órdenes');
select public.admin_open_support_session('Incidencia de prueba: revisar órdenes', 'aaaaaaaa-0000-0000-0000-000000000000', 15);
select tests.eq((select count(*) from public.repair_orders), 2::bigint, 'con sesión de soporte, sí');
reset role;
rollback;

-- Segundo bloque: desactivar a un empleado (datos limpios).
begin;
\ir _harness/fixtures.sql
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description)
values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-0000000000a2', 'Cambio de aceite');
reset role;
update public.workshop_members set active = false where user_id = '00000000-0000-0000-0000-0000000000a2';

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders), 0::bigint, 'un mecánico desactivado deja de ver sus órdenes');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select assigned_to from public.repair_orders), '00000000-0000-0000-0000-0000000000a2'::uuid,
  'desactivar a un empleado NO borra quién llevaba la orden');
select tests.eq((select count(*) from public.repair_order_events), 1::bigint, 'ni su historial');
select tests.eq(tests.affected($$update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a3'$$), 1::bigint,
  'la orden se reasigna a alguien activo');
select tests.throws($$update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a2'$$,
  'no se asigna a un empleado desactivado', '%equipo activo%');
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'Otra')$$,
  'ni al crear una orden', '%equipo activo%');
reset role;
rollback;
