-- Información legal: datos del titular en la web pública, aceptación de condiciones
-- y contrato de encargo (solo la propietaria) y borrado de solicitudes a los 12 meses.
begin;
\ir _harness/fixtures.sql

-- ===================== Datos legales en la web pública =====================
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshops set legal_name = 'Talleres Alcarria SL', tax_id = 'B19000009', address_line = 'Calle Mayor 1',
  postal_code = '19001', city = 'Guadalajara', province = 'Guadalajara', registry_info = 'Registro Mercantil de Guadalajara, tomo 1, folio 1',
  legal_email = 'legal@alcarria.test' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 1::bigint, 'la gerencia guarda los datos legales del taller');
select tests.throws($$update public.workshops set legal_email = 'no-es-correo' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'el correo legal se valida', '%check%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshops set legal_name = 'Otro nombre' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 0::bigint,
  'un mecánico no cambia los datos legales');
reset role;

set local role anon;
select tests.eq((select public.get_public_site('alcarria.test') -> 'legal' ->> 'legal_name'), 'Talleres Alcarria SL', 'la web pública muestra la razón social');
select tests.eq((select public.get_public_site('alcarria.test') -> 'legal' ->> 'email'), 'legal@alcarria.test', 'y el correo legal');
select tests.eq((select (public.get_public_site('alcarria.test') -> 'legal') ? 'internal_notes'), false, 'y nada interno');
select tests.eq((select public.get_public_site('chamberi.test')), null::jsonb, 'una web sin publicar no muestra nada');
select tests.throws($$select * from public.workshop_legal_acceptances$$, 'anónimo no lee las aceptaciones', '%permission denied%');
reset role;

-- ===================== Aceptación de condiciones y encargo =====================
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.accept_platform_terms('aaaaaaaa-0000-0000-0000-000000000000', '1.0')$$,
  'la administradora no acepta en nombre del taller', '%propietaria%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select public.accept_platform_terms('aaaaaaaa-0000-0000-0000-000000000000', '1.0')$$,
  'ni el propietario de otro taller', '%propietaria%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.accept_platform_terms('aaaaaaaa-0000-0000-0000-000000000000', 'x')$$, 'versión no válida', '%Versión%');
select public.accept_platform_terms('aaaaaaaa-0000-0000-0000-000000000000', '1.0');
select public.accept_platform_terms('aaaaaaaa-0000-0000-0000-000000000000', '1.0');
select tests.eq((select string_agg(document || ':' || version, ',' order by document) from public.workshop_legal_acceptances
  where accepted_by = '00000000-0000-0000-0000-0000000000a1'), 'condiciones:1.0,encargo:1.0', 'la propietaria acepta las dos, una sola vez');
select tests.throws($$insert into public.workshop_legal_acceptances (workshop_id, document, version) values ('aaaaaaaa-0000-0000-0000-000000000000', 'encargo', '9.9')$$,
  'nadie escribe aceptaciones a mano', '%permission denied%');
select tests.throws($$delete from public.workshop_legal_acceptances$$, 'ni las borra', '%permission denied%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.workshop_legal_acceptances), 0::bigint, 'el mecánico no las ve');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.workshop_legal_acceptances), 0::bigint, 'ni otro taller');
reset role;

-- ===================== Solicitudes de la web: 12 meses =====================
insert into public.web_requests (id, workshop_id, kind, name, phone, privacy_accepted_at, created_at) values
  ('ee000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Vieja', '611111112', now(), now() - interval '13 months');
select tests.eq((select (public.run_maintenance() ->> 'solicitudes_borradas')::int >= 1), true, 'el mantenimiento borra las de hace más de 12 meses');
select tests.eq((select count(*) from public.web_requests where id = 'ee000000-0000-0000-0000-0000000000a1'), 0::bigint, '(la vieja ya no está)');
select tests.eq((select count(*) from public.web_requests where id = 'ee000000-0000-0000-0000-00000000000a'), 1::bigint, 'y conserva las recientes');

rollback;
