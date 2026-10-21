-- Reglas de datos de los vehículos.
begin;
\ir _harness/fixtures.sql

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;

select tests.eq((select plate from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'), '1950BXF', 'la matrícula se guarda normalizada');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind) values ('aaaaaaaa-0000-0000-0000-000000000000', '1950-bxf', 'Otro', 'Coche', 2015, 'fabricacion')$$,
  'no se puede duplicar una matrícula escrita de otra forma', '%duplicate key%');

insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, fuel)
values ('aaaaaaaa-0000-0000-0000-000000000000', ' 5678 bcd ', ' Toyota ', 'Corolla ', 2015, 'fabricacion', 'hibrido');
select tests.ok(true, 'la misma matrícula puede existir en otro taller distinto');
select tests.eq((select make || '|' || model from public.vehicles where plate = '5678BCD' and workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'Toyota|Corolla', 'se quitan espacios sobrantes');

select tests.eq((select data_source::text || '|' || verification_status::text from public.vehicles where plate = '5678BCD' and workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'manual|pendiente', 'por defecto: introducido manualmente y pendiente de verificar');
select tests.eq((select created_by from public.vehicles where plate = '5678BCD' and workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'queda registrado quién lo creó');

select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year) values ('aaaaaaaa-0000-0000-0000-000000000000', '7777DDD', 'VW', 'Polo', 2010)$$,
  'si hay año hay que decir qué tipo de año es', '%check constraint%');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind) values ('aaaaaaaa-0000-0000-0000-000000000000', '-', 'VW', 'Polo', 2015, 'fabricacion')$$,
  'una matrícula vacía tras normalizar se rechaza', '%check constraint%');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind) values ('aaaaaaaa-0000-0000-0000-000000000000', '7777DDD', '  ', 'Polo', 2015, 'fabricacion')$$,
  'la marca es obligatoria', '%check constraint%');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, fuel) values ('aaaaaaaa-0000-0000-0000-000000000000', '7777DDD', 'VW', 'Polo', 2015, 'fabricacion', 'nuclear')$$,
  'solo combustibles de la lista', '%invalid input value%');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, data_source) values ('aaaaaaaa-0000-0000-0000-000000000000', '7777DDD', 'VW', 'Polo', 2015, 'fabricacion', 'proveedor_externo')$$,
  'no se crea un vehículo diciendo que viene de un proveedor', '%sistema%');
-- Matrícula, marca, modelo y año obligatorios.
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model) values ('aaaaaaaa-0000-0000-0000-000000000000', '7777DDD', 'VW', 'Polo')$$,
  'el año es obligatorio al crear un vehículo', '%año del vehículo%');
select tests.throws($$update public.vehicles set year = null, year_kind = null where id = '7e000001-0000-0000-0000-00000000000a'$$,
  'no se puede quitar el año a un vehículo', '%año del vehículo%');
reset role;

rollback;
