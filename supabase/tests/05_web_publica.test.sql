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
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Spam', '600000000', null, null, null, null, null, null, null, null, true, '/')$$,
  'el navegador no puede registrar solicitudes saltándose el servidor', '%permission denied%');
reset role;

-- El servidor (clave secreta) registra la solicitud tras el antispam
set local role service_role;
select tests.ok((select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', 'cita', ' Ana ', '600 000 000', null, 'whatsapp', '1950 bxf', 'VW Golf', 'Frenos', current_date + 1, 'manana', 'Ruido al frenar', true, '/cita')) is not null,
  'el servidor registra una solicitud de cita');
select tests.eq((select status::text from public.web_requests where name = 'Ana'), 'nueva', 'una cita solicitada queda como "nueva", no confirmada');
select tests.eq((select plate from public.web_requests where name = 'Ana'), '1950BXF', 'la matrícula de la solicitud se normaliza');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Ana', '600', null, null, null, null, null, null, null, null, false, '/')$$,
  'sin aceptar la privacidad no se registra', '%privacidad%');
select tests.throws($$select public.submit_web_request('bbbbbbbb-0000-0000-0000-000000000000', 'contacto', 'Ana', '600', null, null, null, null, null, null, null, null, true, '/')$$,
  'no se aceptan solicitudes para webs no publicadas', '%no disponible%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', 'contacto', 'Ana', null, null, null, null, null, null, null, null, null, true, '/')$$,
  'hace falta teléfono o email', '%check constraint%');
select tests.throws($$select public.submit_web_request('aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Ana', '600', null, null, null, null, null, current_date - 1, null, null, true, '/')$$,
  'no se pide cita para una fecha pasada', '%pasado%');
reset role;

rollback;
