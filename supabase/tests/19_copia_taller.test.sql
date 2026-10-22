-- Copia de datos de cada taller: solo su gerencia, solo su taller, sin secretos y completa.
begin;
\ir _harness/fixtures.sql

-- a1: propietaria de A · a2: mecánico de A · a3: administradora de A · b1: personal de B · c1: cliente
update public.web_requests set client_hash = 'huella-secreta', idempotency_key = 'ccccdddd-0000-4000-8000-00000000abcd' where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.copia', public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000')::text, true);
reset role;
select tests.eq(current_setting('tests.copia')::jsonb ->> 'formato', 'copia-taller-v1', 'la propietaria descarga la copia de su taller');
select tests.eq((select count(*) from jsonb_array_elements(current_setting('tests.copia')::jsonb -> 'tablas' -> 'customers')), 2::bigint,
  'con sus clientes');
select tests.eq((select count(*) from jsonb_array_elements(current_setting('tests.copia')::jsonb -> 'tablas' -> 'vehicles')), 2::bigint,
  'y sus vehículos (las notas internas también: son del taller)');
select tests.eq(position('bbbbbbbb' in current_setting('tests.copia')), 0, 'nada de otro taller');
select tests.eq(position('Toyota' in current_setting('tests.copia')), 0, '(ni siquiera el vehículo del mismo cliente en otro taller)');
select tests.eq(position('huella-secreta' in current_setting('tests.copia')) + position('ccccdddd-0000-4000-8000-00000000abcd' in current_setting('tests.copia'))
                + position('token_hash' in current_setting('tests.copia')), 0, 'sin huellas, claves ni tokens');
select tests.eq((select count(*) from jsonb_array_elements(current_setting('tests.copia')::jsonb -> 'equipo')), 3::bigint, 'con el equipo');
select tests.eq((select count(*) from public.workshop_data_exports where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'
                   and exported_by = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'la descarga queda anotada');

-- Completa: toda tabla con workshop_id va en la copia (o es el equipo, que va aparte).
select tests.eq((select string_agg(c.table_name, ',' order by c.table_name) from information_schema.columns c
                  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
                 where c.table_schema = 'public' and c.column_name = 'workshop_id' and c.table_name <> 'workshop_members'
                   and not (current_setting('tests.copia')::jsonb -> 'tablas') ? c.table_name), null,
  'ninguna tabla del taller se queda fuera de la copia');

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq((public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000', 'csv') ->> 'formato'), 'copia-taller-v1', 'la administradora también');
select tests.eq((select count(*) from public.workshop_data_exports), 2::bigint, 'y ve quién ha descargado copias');
select tests.throws($$select public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000', 'pdf')$$, 'formato no válido', '%Formato%');
select tests.throws($$insert into public.workshop_data_exports (workshop_id, format) values ('aaaaaaaa-0000-0000-0000-000000000000', 'json')$$,
  'nadie escribe el registro a mano', '%permission denied%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000')$$, 'el mecánico no descarga la copia', '%propietario o un administrador%');
select tests.eq((select count(*) from public.workshop_data_exports), 0::bigint, 'ni ve el registro');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000')$$, 'otro taller tampoco', '%propietario o un administrador%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.throws($$select public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000')$$, 'ni un cliente', '%propietario o un administrador%');
reset role;

select tests.logout();
set local role anon;
select tests.throws($$select public.export_workshop_data('aaaaaaaa-0000-0000-0000-000000000000')$$, 'ni sin sesión', '%permission denied%');
reset role;

rollback;
