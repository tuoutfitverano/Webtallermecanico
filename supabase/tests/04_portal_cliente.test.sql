-- Los clientes solo ven lo suyo y nunca las notas internas.
begin;
\ir _harness/fixtures.sql

select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 0::bigint, 'un cliente no lee la tabla de vehículos directamente');
select tests.eq((select count(*) from public.customers), 0::bigint, 'un cliente no lee la tabla de clientes');
select tests.eq((select count(*) from public.portal_my_vehicles()), 1::bigint, 'el cliente 2 ve solo su vehículo');
select tests.eq((select plate from public.portal_my_vehicles()), '1234KLM', 'y es el suyo');
reset role;

-- Cliente 1: es cliente de los dos talleres y ve sus vehículos en ambos
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_my_vehicles()), 2::bigint, 'el cliente 1 ve sus vehículos de los dos talleres');
select tests.eq((select count(*) from public.portal_my_workshops()), 2::bigint, 'y los dos talleres donde es cliente');
select tests.ok((select bool_and(not (to_jsonb(v) ? 'internal_notes')) from public.portal_my_vehicles() v), 'el portal no devuelve notas internas');
reset role;

-- Si el taller queda suspendido, su información desaparece del portal
update public.workshops set status = 'suspendido' where slug = 'taller-chamberi';
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_my_vehicles()), 1::bigint, 'los talleres suspendidos no aparecen en el portal');
reset role;

select tests.logout();
set local role anon;
select tests.throws('select * from public.portal_my_vehicles()', 'sin sesión no se puede usar el portal', '%permission denied%');
reset role;

rollback;
