-- Plantilla: solicitudes de digitalización (sección comercial de la web de demostración).
begin;
\ir _harness/fixtures.sql
insert into public.workshops (id, slug, name, status) values
  ('dddddddd-0000-0000-0000-000000000000', 'taller-demo-prueba', 'Demo (prueba)', 'demo');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ad', 'propietario');
insert into public.workshop_sites (workshop_id, published, is_demo_content, theme, content) values
  ('dddddddd-0000-0000-0000-000000000000', true, true, '{"sections":{"comercial":true}}', '{}');

set local role service_role;

-- Se guarda con su nombre de taller e interés; los datos de vehículo se descartan.
select public.submit_web_request('dddddddd-0000-0000-0000-000000000000',
  '{"kind":"digitalizacion","name":"Lucía Prueba","businessName":"  Taller Lucía ","phone":"600111222","topic":"web_y_software","message":"Quiero ver la demo.","plate":"1234KLM","service":"frenos","make":"Seat","privacyAccepted":true}',
  gen_random_uuid(), null);
select tests.eq((select business_name || '|' || topic || '|' || status::text from public.web_requests where name = 'Lucía Prueba'),
  'Taller Lucía|web_y_software|nueva', 'se guarda el nombre del taller, el interés y queda pendiente (nueva)');
select tests.eq((select coalesce(plate, '-') || coalesce(service, '-') || coalesce(vehicle_make, '-') from public.web_requests where name = 'Lucía Prueba'),
  '---', 'una solicitud de digitalización no guarda vehículo ni servicio aunque se manden');

-- Reglas de la última barrera.
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Sin Taller","phone":"600111222","topic":"web","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'sin nombre del taller no se guarda', '%nombre del taller%');
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Interés Raro","businessName":"Taller X","phone":"600111222","topic":"frenos","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'un interés que no está en la lista no se guarda', '%Interés%');
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Con Fecha","businessName":"Taller X","phone":"600111222","topic":"web","preferredDate":"2030-01-01","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'la fecha solo vale en citas', '%Fecha%');
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Sin Privacidad","businessName":"Taller X","phone":"600111222","topic":"web"}', gen_random_uuid(), null)$$,
  'sin aceptar la privacidad no se guarda', '%privacidad%');

-- Un taller REAL (activo) nunca recibe este tipo, aunque active la sección en su tema.
update public.workshop_sites set theme = '{"sections":{"comercial":true}}' where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Colado","businessName":"Taller X","phone":"600111222","topic":"web","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'un taller activo (no demo) rechaza las solicitudes de digitalización', '%Tipo de solicitud%');

-- Un taller demo sin la sección comercial tampoco (ni con un valor que no sea true).
update public.workshop_sites set theme = '{"sections":{"comercial":"si"}}' where workshop_id = 'dddddddd-0000-0000-0000-000000000000';
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{"kind":"digitalizacion","name":"Sin Sección","businessName":"Taller X","phone":"600111222","topic":"web","privacyAccepted":true}', gen_random_uuid(), null)$$,
  'sin la sección comercial activada (true) no se acepta', '%Tipo de solicitud%');
update public.workshop_sites set theme = '{"sections":{"comercial":true}}' where workshop_id = 'dddddddd-0000-0000-0000-000000000000';

-- Las solicitudes normales siguen igual en el taller demo.
select tests.ok((select public.submit_web_request('dddddddd-0000-0000-0000-000000000000',
  '{"kind":"cita","name":"Cita Normal","phone":"600333444","service":"frenos","plate":"1234 klm","privacyAccepted":true}', gen_random_uuid(), null)) is not null,
  'una cita normal se sigue aceptando en el taller demo');
select tests.eq((select coalesce(business_name, '-') || '|' || plate from public.web_requests where name = 'Cita Normal'), '-|1234KLM',
  'una cita no lleva nombre de taller y conserva la matrícula');
reset role;

-- La tabla no admite un nombre de taller en otro tipo de solicitud (ni lo contrario).
select tests.throws($$insert into public.web_requests (workshop_id, kind, name, phone, privacy_accepted_at, business_name) values ('dddddddd-0000-0000-0000-000000000000', 'contacto', 'X Y', '600000000', now(), 'Taller')$$,
  'un contacto no puede llevar nombre de taller', '%web_requests_business_name_kind%');

-- La propietaria del taller demo ve el nombre del taller; otro taller no ve nada.
select tests.login('00000000-0000-0000-0000-0000000000ad');
set local role authenticated;
select tests.eq((select business_name from public.web_requests where name = 'Lucía Prueba'), 'Taller Lucía', 'la propietaria del taller demo lee el nombre del taller');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.web_requests where name = 'Lucía Prueba'), 0::bigint, 'la propietaria de otro taller no ve las solicitudes de digitalización');
reset role;

-- Visitantes sin sesión: nada.
set local role anon;
select tests.throws($$select business_name from public.web_requests$$, 'un visitante no lee las solicitudes', '%permission denied%');
select tests.throws($$select public.submit_web_request('dddddddd-0000-0000-0000-000000000000', '{}', gen_random_uuid(), null)$$,
  'ni puede llamar a la función de registro (solo el servidor)', '%permission denied%');
reset role;

rollback;
