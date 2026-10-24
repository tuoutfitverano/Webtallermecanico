-- Auditoría H03: NIF/NIE/CIF con letra o dígito de control, también en la base de datos.
-- La lista de casos es la misma que la de packages/core/src/documents.test.ts (paridad).
begin;
\ir _harness/fixtures.sql

-- ===================== Paridad con checkTaxId() =====================
select tests.eq((select string_agg(v || '=' || coalesce(private.tax_id_kind(v, false), '-'), ',' order by v)
  from unnest(array['12345678Z', '00000000T', 'K1234567L', 'X1234567L', 'Y1234567X', 'Z1234567R', 'B12345674', 'Q2826000H', 'A28015865', 'B00000000']) v),
  '00000000T=nif,12345678Z=nif,A28015865=cif,B00000000=cif,B12345674=cif,K1234567L=nif,Q2826000H=cif,X1234567L=nie,Y1234567X=nie,Z1234567R=nie',
  'los identificadores españoles correctos se aceptan');
select tests.eq((select count(*) from unnest(array['12345678A', '00000000A', 'K1234567A', 'X1234567A', 'Z1234567X', 'B12345678', 'B1234567D', 'Q2826000A', 'Q28260008', 'A2801586E']) v
  where private.tax_id_kind(v, true) is not null), 0::bigint, 'forma correcta con el control mal: se rechazan');
select tests.eq((select count(*) from unnest(array['', '1234', 'ABCDEFGHI', '123456789', 'I1234567A', 'AA1234567', 'ES123']) v
  where private.tax_id_kind(v, true) is not null), 0::bigint, 'formatos imposibles: se rechazan');
select tests.eq(private.tax_id_kind(' es-b12.345.674 ', false), 'cif', 'con prefijo ES, puntos y guiones');
select tests.eq(private.tax_id_kind('FR12345678901', true), 'extranjero', 'extranjero con prefijo de país (clientes)');
select tests.eq(private.tax_id_kind('FR12345678901', false), null::text, 'pero no como NIF del taller');

-- ===================== Clientes (oficina del taller) =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$insert into public.customers (workshop_id, full_name, tax_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'NIF mal', '12345678A')$$,
  'un cliente con la letra del NIF equivocada no se guarda', '%customers_tax_id_valid%');
select tests.throws($$update public.customers set tax_id = 'B12345678' where id = 'c1000000-0000-0000-0000-00000000000a'$$,
  'ni se puede cambiar a un CIF con el dígito mal', '%customers_tax_id_valid%');
select tests.eq(tests.affected($$insert into public.customers (workshop_id, full_name, tax_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'NIF bien', '12345678Z')$$),
  1::bigint, 'con el NIF correcto, sí');
select tests.eq(tests.affected($$insert into public.customers (workshop_id, full_name, tax_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Client SARL', 'FR12345678901')$$),
  1::bigint, 'y un NIF-IVA extranjero de 13 caracteres (antes no cabía)');

-- ===================== Taller (emisor de facturas) =====================
select tests.throws($$update public.workshops set tax_id = 'B12345678' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'el NIF del taller se comprueba', '%workshops_tax_id_valid%');
select tests.throws($$update public.workshops set tax_id = 'FR12345678901' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'y tiene que ser español', '%workshops_tax_id_valid%');
select tests.eq(tests.affected($$update public.workshops set tax_id = 'B12345674' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$),
  1::bigint, 'un CIF correcto se guarda');
reset role;

rollback;
