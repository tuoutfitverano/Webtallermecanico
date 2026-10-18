-- Fase 2: duplicados, antispam, validación y privacidad de las solicitudes web.
begin;
\ir _harness/fixtures.sql

set local role service_role;

-- Envío duplicado (doble clic / reintento): una sola fila y el mismo id.
create temp table ids as
select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000',
  '{"kind":"contacto","name":"Doble Clic","email":"doble@correo.test","topic":"informacion","message":"Hola, ¿abrís el sábado?","privacyAccepted":true}',
  '11111111-1111-4111-8111-111111111111', 'hash-doble') as r
union all
select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000',
  '{"kind":"contacto","name":"Doble Clic","email":"doble@correo.test","topic":"informacion","message":"Hola, ¿abrís el sábado?","privacyAccepted":true}',
  '11111111-1111-4111-8111-111111111111', 'hash-doble');
select tests.eq((select count(*) from public.web_requests where name = 'Doble Clic'), 1::bigint, 'un envío repetido se guarda una sola vez');
select tests.eq((select count(distinct r ->> 'id') from ids), 1::bigint, 'el reintento devuelve el mismo id');
select tests.eq((select (r ->> 'duplicate') from ids offset 1), 'true', 'y avisa de que era un duplicado');
select tests.eq((select email from public.web_requests where name = 'Doble Clic'), 'doble@correo.test', 'el correo se guarda en minúsculas');

-- Un contacto no guarda datos de vehículo aunque se manden.
select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000',
  '{"kind":"contacto","name":"Solo Contacto","phone":"611111111","topic":"otro","message":"Consulta general sobre horarios.","plate":"1234KLM","service":"frenos","privacyAccepted":true}',
  gen_random_uuid(), null);
select tests.eq((select coalesce(plate, '-') || coalesce(service, '-') from public.web_requests where name = 'Solo Contacto'), '--', 'un contacto no guarda matrícula ni servicio');

-- Antispam: 5 envíos por visitante cada 10 minutos.
do $$ begin
  for i in 1..5 loop
    perform public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000',
      jsonb_build_object('kind','contacto','name','Spammer','phone','622222222','topic','otro','message','Mensaje repetido número ' || i,'privacyAccepted',true),
      gen_random_uuid(), 'hash-spam');
  end loop;
end $$;
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Spammer","phone":"622222222","topic":"otro","message":"Sexto intento de envío.","privacyAccepted":true}', gen_random_uuid(), 'hash-spam')$$,
  'el sexto envío seguido del mismo visitante se bloquea', '%rate_limited%');
select tests.ok((select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Otra Persona","phone":"633333333","topic":"otro","message":"Consulta de otra persona.","privacyAccepted":true}', gen_random_uuid(), 'hash-otro')) is not null,
  'otro visitante puede seguir enviando');

-- El error de límite usa el código que PostgREST convierte en HTTP 429.
do $$ begin
  perform public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Spammer","phone":"622222222","topic":"otro","message":"Otro intento más.","privacyAccepted":true}', gen_random_uuid(), 'hash-spam');
  raise exception 'no bloqueó';
exception when others then
  if sqlstate <> 'PT429' then raise exception 'FALLO: código % en vez de PT429', sqlstate; end if;
  raise notice 'ok - el bloqueo devuelve el código PT429 (HTTP 429)';
end $$;

-- Validación de la última barrera.
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"spam","name":"X Y","phone":"600000000","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'tipo de solicitud desconocido', '%Tipo de solicitud%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"cita","name":"Sin Servicio","phone":"600000000","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'una cita sin servicio no se guarda', '%servicio%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"presupuesto","name":"Fecha","phone":"600000000","service":"frenos","preferredDate":"2030-01-01","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'la fecha solo vale en citas y dentro del próximo año', '%Fecha%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', ($j${"kind":"contacto","name":"Largo","phone":"600000000","topic":"otro","privacyAccepted":true,"message":"$j$ || repeat('x', 2100) || $j$"}$j$)::jsonb, gen_random_uuid(), null)$$,
  'un mensaje demasiado largo se rechaza', '%no válidos%');
reset role;

-- La propietaria ve las solicitudes de su taller, pero no la huella antispam.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.ok((select count(*) from public.web_requests where name = 'Doble Clic') = 1, 'la propietaria ve la solicitud en su taller');
select tests.throws('select client_hash from public.web_requests', 'nadie del taller puede leer la huella antispam', '%permission denied%');
select tests.throws('select idempotency_key from public.web_requests', 'ni la clave de idempotencia', '%permission denied%');
select tests.eq(tests.affected($$update public.web_requests set status = 'aceptada' where name = 'Doble Clic'$$), 1::bigint, 'la propietaria puede cambiar el estado');
reset role;

-- El propietario de OTRO taller no las ve.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.web_requests where name = 'Doble Clic'), 0::bigint, 'otro taller no ve estas solicitudes');
reset role;

-- Las huellas antiguas se borran (minimización de datos).
update public.web_requests set created_at = now() - interval '3 days' where name = 'Spammer';
set local role service_role;
select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Disparador","phone":"644444444","topic":"otro","message":"Envío que dispara la limpieza.","privacyAccepted":true}', gen_random_uuid(), 'hash-nuevo');
reset role;
select tests.eq((select count(*) from public.web_requests where name = 'Spammer' and client_hash is not null), 0::bigint, 'las huellas de más de 2 días se borran');

rollback;
