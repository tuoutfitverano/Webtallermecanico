-- Un taller nunca ve ni toca los datos de otro.
begin;
\ir _harness/fixtures.sql

-- Propietaria del taller A
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 2::bigint, 'A ve solo sus 2 vehículos');
select tests.eq((select count(*) from public.customers), 2::bigint, 'A ve solo sus 2 clientes');
select tests.eq((select count(*) from public.workshops), 1::bigint, 'A ve solo su taller');
select tests.eq((select count(*) from public.web_requests), 1::bigint, 'A ve solo sus solicitudes');
select tests.eq((select count(*) from public.vehicles where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, 'A no ve vehículos de B ni filtrando por su id');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model) values ('bbbbbbbb-0000-0000-0000-000000000000', '9999BBB', 'Ford', 'Focus')$$,
  'A no puede crear vehículos en B', '%row-level security%');
select tests.eq(tests.affected($$update public.vehicles set model = 'Hackeado' where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$), 0::bigint, 'A no puede modificar vehículos de B');
select tests.eq(tests.affected($$delete from public.customers where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$), 0::bigint, 'A no puede borrar clientes de B');
select tests.throws($$update public.vehicles set workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' where plate = '1950BXF'$$,
  'A no puede mover un vehículo a otro taller');
select tests.throws($$insert into public.vehicles (workshop_id, customer_id, plate, make, model) values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000b', '4444CCC', 'Kia', 'Ceed')$$,
  'A no puede asignar a su vehículo un cliente de B', '%foreign key%');
reset role;

-- Mecánico de A: ve su taller, no el otro
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 2::bigint, 'el mecánico de A ve los vehículos de A');
select tests.eq((select count(*) from public.vehicles where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, 'el mecánico de A no ve B');
reset role;

-- Usuario registrado sin relación con ningún taller
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles) + (select count(*) from public.customers) + (select count(*) from public.workshops)
  + (select count(*) from public.web_requests) + (select count(*) from public.workshop_members), 0::bigint, 'un usuario ajeno no ve nada');
reset role;

-- Visitante sin sesión (anon): ni siquiera tiene permiso sobre las tablas
select tests.logout();
set local role anon;
select tests.throws('select * from public.vehicles', 'anon no puede leer vehículos', '%permission denied%');
select tests.throws('select * from public.customers', 'anon no puede leer clientes', '%permission denied%');
select tests.throws('select * from public.web_requests', 'anon no puede leer solicitudes', '%permission denied%');
select tests.throws($$insert into public.web_requests (workshop_id, kind, name, phone, privacy_accepted_at) values ('aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Spam', '600', now())$$,
  'anon no puede escribir solicitudes directamente', '%permission denied%');
reset role;

rollback;
