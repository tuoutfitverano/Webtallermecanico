-- Web pública y solicitudes de cita/contacto.
begin;
\ir _harness/fixtures.sql

select tests.logout();
set local role anon;
select tests.eq((select public.get_public_site('alcarria.test') -> 'workshop' ->> 'slug'), 'taller-alcarria', 'un visitante obtiene la web publicada por dominio');
select tests.eq((select public.get_public_site('ALCARRIA.test ') -> 'site' ->> 'is_demo_content'), 'true', 'se indica si el contenido es de demostración');
select tests.eq(public.get_public_site('chamberi.test'), null::jsonb, 'una web no publicada no se muestra');
select tests.eq(public.get_public_site('sin-verificar.test'), null::jsonb, 'un dominio sin verificar no se usa');
select tests.eq(public.get_public_site('no-existe.test'), null::jsonb, 'un dominio desconocido no devuelve nada');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"cita","name":"Spam","phone":"600000000","service":"frenos","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'el navegador no puede registrar solicitudes saltándose el servidor', '%permission denied%');
reset role;

-- El servidor (clave secreta) registra la solicitud tras el antispam
set local role service_role;
select tests.ok((select (public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000',
  jsonb_build_object('kind','cita','name',' Ana ','phone','600 000 000','preferredContact','whatsapp','plate','1950 bxf','make','VW','model','Golf',
                     'service','frenos','preferredDate', (current_date + 1)::text,'preferredTime','manana','message','Ruido al frenar','privacyAccepted',true,'sourcePath','/'),
  gen_random_uuid(), 'hash-ana')) ->> 'id' is not null), 'el servidor registra una solicitud de cita');
select tests.eq((select status::text from public.web_requests where name = 'Ana'), 'nueva', 'una cita solicitada queda como "nueva", no confirmada');
select tests.eq((select plate from public.web_requests where name = 'Ana'), '1950BXF', 'la matrícula de la solicitud se normaliza');
select tests.eq((select vehicle_make || ' ' || vehicle_model from public.web_requests where name = 'Ana'), 'VW Golf', 'marca y modelo se guardan tal cual, sin completar nada');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Ana","phone":"600","topic":"otro","privacyAccepted":false}', gen_random_uuid(), null)$$,
  'sin aceptar la privacidad no se registra', '%privacidad%');
select tests.throws($$select public.submit_web_request('bbbbbbbb-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Ana","phone":"600","topic":"otro","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'no se aceptan solicitudes para webs no publicadas', '%no disponible%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"contacto","name":"Ana","topic":"otro","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'hace falta teléfono o email', '%teléfono o un correo%');
select tests.throws(format($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"cita","name":"Ana","phone":"600","service":"frenos","preferredDate":"%s","privacyAccepted":true}', gen_random_uuid(), null)$$, current_date - 1),
  'no se pide cita para una fecha pasada', '%Fecha%');
reset role;

rollback;
