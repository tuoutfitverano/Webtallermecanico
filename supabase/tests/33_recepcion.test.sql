-- Recepción del vehículo: combustible, daños previos y comprobaciones; solo la oficina la anota.
begin;
\ir _harness/fixtures.sql

insert into public.repair_orders (id, workshop_id, vehicle_id, customer_id, problem_description, assigned_to) values
  ('0d000009-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a',
   'c1000000-0000-0000-0000-00000000000a', 'Ruido al frenar', '00000000-0000-0000-0000-0000000000a2');

-- La administración anota la recepción.
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
update public.repair_orders set fuel_level = '1/4', existing_damage = '  Rayón en la puerta trasera izquierda  ',
  reception_checks = array['objetos_valor', 'documentacion', 'documentacion']
 where id = '0d000009-0000-0000-0000-00000000000a';
select tests.eq((select fuel_level || '|' || existing_damage || '|' || array_to_string(reception_checks, ',') from public.repair_orders where id = '0d000009-0000-0000-0000-00000000000a'),
  '1/4|Rayón en la puerta trasera izquierda|documentacion,objetos_valor', 'la oficina anota combustible, daños y comprobaciones (sin repetidos)');
select tests.throws($$update public.repair_orders set fuel_level = 'medio' where id = '0d000009-0000-0000-0000-00000000000a'$$,
  'solo niveles de combustible conocidos', '%check%');
select tests.throws($$update public.repair_orders set reception_checks = array['inventado'] where id = '0d000009-0000-0000-0000-00000000000a'$$,
  'solo comprobaciones de la lista', '%check%');
reset role;

-- El mecánico la ve, pero no la cambia (ni al crear, ni al editar).
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select fuel_level from public.repair_orders where id = '0d000009-0000-0000-0000-00000000000a'), '1/4', 'el mecánico ve la recepción');
select tests.throws($$update public.repair_orders set existing_damage = 'Nada' where id = '0d000009-0000-0000-0000-00000000000a'$$,
  'el mecánico no cambia los daños anotados', '%oficina%');
select tests.throws($$update public.repair_orders set reception_checks = '{}' where id = '0d000009-0000-0000-0000-00000000000a'$$,
  'ni las comprobaciones', '%oficina%');
-- Lo demás de su trabajo sigue igual.
update public.repair_orders set diagnosis = 'Pastillas gastadas' where id = '0d000009-0000-0000-0000-00000000000a';
select tests.eq((select diagnosis from public.repair_orders where id = '0d000009-0000-0000-0000-00000000000a'), 'Pastillas gastadas',
  'el mecánico sigue anotando su diagnóstico');
reset role;

-- Otro taller no ve nada.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.repair_orders set fuel_level = 'lleno' where id = '0d000009-0000-0000-0000-00000000000a';
reset role;
select tests.eq((select fuel_level from public.repair_orders where id = '0d000009-0000-0000-0000-00000000000a'), '1/4', 'otro taller no la cambia');

rollback;
