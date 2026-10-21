-- Fase 6: consultas de matrícula a un proveedor externo (permisos, límites, procedencia de los datos).
begin;
\ir _harness/fixtures.sql

-- a1 propietaria de A · a2 mecánico de A · b1 propietario de B · c1 cliente (no es personal) · ff sin taller

-- ===================== Quién puede empezar una consulta =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('tests.l1', (select lookup_id::text from public.start_vehicle_lookup(
  'aaaaaaaa-0000-0000-0000-000000000000', ' 5776-cns ', 'openapi', '11111111-0000-0000-0000-000000000001')), true);
select tests.eq((select plate from public.vehicle_lookups where id = current_setting('tests.l1')::uuid), '5776CNS', 'el personal (también un mecánico) puede consultar; la matrícula se normaliza');
select tests.eq((select status::text from public.vehicle_lookups where id = current_setting('tests.l1')::uuid), 'pendiente', 'la consulta nace pendiente');
select tests.eq((select state from public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '5776CNS', 'openapi', '11111111-0000-0000-0000-000000000001')),
  'en_curso', 'un doble clic (misma clave) no genera otra consulta');
select tests.eq((select state from public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '5776CNS', 'openapi', '11111111-0000-0000-0000-000000000002')),
  'en_curso', 'la misma matrícula consultándose ahora mismo tampoco');
select tests.eq((select count(*) from public.vehicle_lookups where plate = '5776CNS'), 1::bigint, 'sigue habiendo una sola consulta');

-- Nadie fabrica resultados "del proveedor" con su token.
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado', '{"make":"FALSO"}')$$,
  'el personal no puede escribir el resultado de una consulta', '%permission denied%');
select tests.throws($$insert into public.vehicle_lookups (workshop_id, plate, provider, status, result, request_key)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '1950BXF', 'openapi', 'encontrado', '{"make":"FALSO"}', gen_random_uuid())$$,
  'ni insertar consultas directamente', '%permission denied%');
select tests.throws($$update public.vehicle_lookups set status = 'encontrado', result = '{"make":"FALSO"}'$$,
  'ni modificarlas', '%permission denied%');
select tests.throws($$select public.start_vehicle_lookup('bbbbbbbb-0000-0000-0000-000000000000', '5776CNS', 'openapi', gen_random_uuid())$$,
  'no consulta en nombre de otro taller', '%No tienes permiso%');
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '!!', 'openapi', gen_random_uuid())$$,
  'una matrícula vacía o inválida se rechaza', '%no es válida%');
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '5776CNS', 'Proveedor Raro!', gen_random_uuid())$$,
  'un nombre de proveedor extraño se rechaza', '%no válida%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '9999ZZZ', 'openapi', gen_random_uuid())$$,
  'un cliente (portal) no puede consultar matrículas', '%No tienes permiso%');
select tests.eq((select count(*) from public.vehicle_lookups), 0::bigint, 'un cliente no ve ninguna consulta');
reset role;

select tests.logout();
set local role anon;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '9999ZZZ', 'openapi', gen_random_uuid())$$,
  'sin sesión no se puede consultar', '%permission denied%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '9999ZZZ', 'openapi', gen_random_uuid())$$,
  'una cuenta sin taller no puede consultar', '%No tienes permiso%');
reset role;

-- Un empleado desactivado tampoco.
update public.workshop_members set active = false where user_id = '00000000-0000-0000-0000-0000000000a3';
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '9999ZZZ', 'openapi', gen_random_uuid())$$,
  'un empleado desactivado no puede consultar', '%No tienes permiso%');
reset role;
update public.workshop_members set active = true where user_id = '00000000-0000-0000-0000-0000000000a3';

-- ===================== Resultado (solo el servidor, con la clave secreta) =====================
set local role service_role;
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado', '{"make":"AUDI","precio":"9000"}')$$,
  'no se guardan campos que no existen en el modelo', '%formato no válido%');
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado', '{"make":"AUDI","year":2003}')$$,
  'un año sin decir de qué es se rechaza', '%formato no válido%');
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado', '{"make":"AUDI","fuel":"queroseno"}')$$,
  'un combustible desconocido se rechaza', '%formato no válido%');
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado', '{"version":"1.6"}')$$,
  'sin marca ni modelo no es un resultado útil', '%formato no válido%');
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'no_encontrado', '{"make":"AUDI"}')$$,
  'una consulta fallida no lleva datos', '%resultado%');
select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'encontrado',
  '{"make":"AUDI","model":"A3","version":"1.6 ATTRACTION","year":2003,"year_kind":"primera_matriculacion","fuel":"gasolina","power_cv":102,"engine_cc":1595}');
select tests.throws($$select public.complete_vehicle_lookup(current_setting('tests.l1')::uuid, 'error')$$,
  'una consulta completada no se reescribe', '%ya está completada%');
reset role;

-- ===================== Reutilización (sin coste) y aislamiento =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select state || '|' || (result ->> 'model') from public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '5776 CNS', 'openapi', gen_random_uuid())),
  'reutilizada|A3', 'otra persona del mismo taller reutiliza la respuesta reciente (no se vuelve a pagar)');
select tests.eq((select count(*) from public.vehicle_lookups where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, 'el taller ve sus consultas');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.vehicle_lookups), 0::bigint, 'otro taller no ve las consultas de A');
select tests.eq((select state from public.start_vehicle_lookup('bbbbbbbb-0000-0000-0000-000000000000', '5776CNS', 'openapi', gen_random_uuid())),
  'nueva', 'otro taller NO reutiliza la respuesta de A (no se comparten datos entre talleres)');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, lookup_id)
  values ('bbbbbbbb-0000-0000-0000-000000000000', '5776CNS', 'AUDI', 'A3', 2003, 'primera_matriculacion', current_setting('tests.l1')::uuid)$$,
  'otro taller no puede usar la consulta de A para su vehículo (lo frena el disparador; detrás está la clave foránea)', '%no corresponde%');
reset role;

-- ===================== Guardar el vehículo con los datos revisados =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, lookup_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '1111BBB', 'AUDI', 'A3', 2003, 'primera_matriculacion', current_setting('tests.l1')::uuid)$$,
  'la consulta tiene que ser de la misma matrícula', '%no corresponde%');
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, data_source)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '2222BBB', 'AUDI', 'A3', 2003, 'primera_matriculacion', 'proveedor_externo')$$,
  'nadie se inventa el origen "proveedor externo" sin consulta', '%solo lo asigna el sistema%');
with x as (
  insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, fuel, lookup_id, lookup_fields)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '5776cns', 'Audi', 'A3 Sportback', 2003, 'primera_matriculacion', null,
          current_setting('tests.l1')::uuid, '{"make":{"state":"confirmado"},"falso":true}')
  returning id)
select set_config('tests.v1', (select id::text from x), true);
select tests.eq((select data_source::text from public.vehicles where id = current_setting('tests.v1')::uuid), 'proveedor_externo',
  'con una consulta válida, el origen lo pone la base de datos');
select tests.eq((select verification_status::text from public.vehicles where id = current_setting('tests.v1')::uuid), 'pendiente',
  'los datos del proveedor NO cuentan como verificados por el taller');
select tests.eq((select (lookup_fields -> 'make' ->> 'state') || '|' || (lookup_fields -> 'model' ->> 'state') || '|' ||
                (lookup_fields -> 'year' ->> 'state') || '|' || (lookup_fields -> 'fuel' ->> 'state')
                from public.vehicles where id = current_setting('tests.v1')::uuid),
  'confirmado|modificado|confirmado|no_usado', 'se anota campo a campo qué se confirmó, qué se cambió a mano y qué no se usó');
select tests.eq((select lookup_fields ? 'falso' from public.vehicles where id = current_setting('tests.v1')::uuid), false,
  'lookup_fields no se puede falsear desde fuera');
select tests.eq((select lookup_fields -> 'model' ->> 'value' from public.vehicles where id = current_setting('tests.v1')::uuid), 'A3',
  'se conserva el valor que dio el proveedor');

-- Cambios posteriores a mano: quedan reflejados.
update public.vehicles set make = 'Seat' where id = current_setting('tests.v1')::uuid;
select tests.eq((select (lookup_fields -> 'make' ->> 'state') || '|' || data_source::text from public.vehicles where id = current_setting('tests.v1')::uuid),
  'modificado|proveedor_externo', 'editar un dato a mano lo marca como modificado');
update public.vehicles set year = 2004 where id = current_setting('tests.v1')::uuid;
select tests.eq((select data_source::text from public.vehicles where id = current_setting('tests.v1')::uuid), 'manual',
  'si ya no queda ningún dato confirmado del proveedor, el origen pasa a "manual"');
update public.vehicles set plate = '9876BCD' where id = current_setting('tests.v1')::uuid;
select tests.eq((select coalesce(lookup_id::text, 'sin consulta') || '|' || data_source::text from public.vehicles where id = current_setting('tests.v1')::uuid),
  'sin consulta|manual', 'cambiar la matrícula desvincula la consulta');
select tests.throws($$update public.vehicles set lookup_id = current_setting('tests.l1')::uuid where id = current_setting('tests.v1')::uuid$$,
  'no se vuelve a enlazar una consulta de otra matrícula', '%no corresponde%');
reset role;

-- Los vehículos con datos manuales existentes no cambian.
select tests.eq((select data_source::text || '|' || coalesce(lookup_id::text, '-') || '|' || make from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'),
  'manual|-|Volkswagen', 'los vehículos manuales que ya existían siguen igual');

-- Consultas caducadas: no se pueden usar para guardar.
update public.vehicle_lookups set completed_at = now() - interval '2 days' where id = current_setting('tests.l1')::uuid;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, lookup_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '5776CNS', 'AUDI', 'A3', 2003, 'primera_matriculacion', current_setting('tests.l1')::uuid)$$,
  'una consulta de hace más de 24 h no se usa', '%caducado%');
select tests.eq((select state from public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '5776CNS', 'openapi', gen_random_uuid())),
  'nueva', 'pasadas 24 h se vuelve a consultar');
reset role;

-- ===================== Límites de uso =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
do $$
begin
  for i in 1..9 loop
    perform public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', 'M' || (100000 + i)::text, 'openapi', gen_random_uuid());
  end loop;
end $$;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', 'M999999', 'openapi', gen_random_uuid())$$,
  'una persona no puede lanzar consultas sin límite (10 cada 10 minutos)', '%muchas consultas seguidas%');
reset role;

-- Límite diario del taller (se simulan consultas anteriores de otras personas).
insert into public.vehicle_lookups (workshop_id, plate, provider, status, request_key, requested_by, completed_at)
  select 'aaaaaaaa-0000-0000-0000-000000000000', 'GU' || (1000 + g)::text || 'A', 'openapi', 'error', gen_random_uuid(), null, now()
  from generate_series(1, 100) g;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.start_vehicle_lookup('aaaaaaaa-0000-0000-0000-000000000000', '4444BBB', 'openapi', gen_random_uuid())$$,
  'el taller tiene un límite diario de consultas', '%límite diario%');
reset role;

-- Las funciones nuevas no están abiertas a cualquiera.
select tests.eq((select has_function_privilege('anon', 'public.start_vehicle_lookup(uuid, text, text, uuid)', 'execute')), false, 'anon no ejecuta start_vehicle_lookup');
select tests.eq((select has_function_privilege('authenticated', 'public.complete_vehicle_lookup(uuid, public.vehicle_lookup_status, jsonb)', 'execute')), false,
  'authenticated no ejecuta complete_vehicle_lookup');
select tests.eq((select has_function_privilege('authenticated', 'private.lookup_field_states(public.vehicles, jsonb)', 'execute')), false,
  'las funciones internas nuevas no se exponen');

rollback;
