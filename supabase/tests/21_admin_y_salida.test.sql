-- Pantalla de administración (admin_status) y el cliente que deja un taller desde su portal.
begin;
\ir _harness/fixtures.sql

-- ===================== admin_status =====================
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.admin_status()), 0::bigint, 'a quien no es de la plataforma no le devuelve nada');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal1');
set local role authenticated;
select tests.eq((select mfa::text || '|' || coalesce(support_until::text, '-') from public.admin_status()), 'false|-',
  'administración sin 2FA: lo sabe la pantalla (y no tiene sesión de soporte)');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select public.admin_open_support_session('Revisar una vinculación (prueba)', 'aaaaaaaa-0000-0000-0000-000000000000', 20);
select tests.eq((select mfa::text || '|' || support_reason || '|' || support_workshop_id from public.admin_status()),
  'true|Revisar una vinculación (prueba)|aaaaaaaa-0000-0000-0000-000000000000', 'con 2FA y sesión de soporte abierta');
select public.admin_close_support_session();
select tests.eq((select support_until from public.admin_status()), null::timestamptz, 'al cerrarla ya no aparece');
reset role;

-- ===================== Dejar un taller =====================
-- c1 es cliente de A y de B con la misma cuenta.
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.throws($$select public.portal_leave_workshop('cccccccc-0000-0000-0000-000000000000')$$, 'no se deja un taller al que no se pertenece', '%No estás vinculado%');
select public.portal_leave_workshop('bbbbbbbb-0000-0000-0000-000000000000');
select tests.eq((select string_agg(name, ',') from public.portal_workshops()), 'Taller Alcarria (prueba)', 'el cliente deja de ver el taller B');
select tests.eq((select count(*) from public.portal_vehicles() where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, 'ni sus vehículos de B');
select tests.eq((select count(*) from public.portal_vehicles() where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, 'y sigue viendo lo de A');
select tests.throws($$select public.portal_leave_workshop('bbbbbbbb-0000-0000-0000-000000000000')$$, 'no se puede dejar dos veces', '%No estás vinculado%');
reset role;
select tests.eq((select count(*) from public.customers where id = 'c1000000-0000-0000-0000-00000000000b'), 1::bigint, 'el taller B conserva la ficha');
select tests.eq((select count(*) from public.vehicles where id = '7e000001-0000-0000-0000-00000000000b'), 1::bigint, 'y el vehículo');
select tests.eq((select status || '|' || (revoked_by = user_id) from public.customer_account_links where customer_id = 'c1000000-0000-0000-0000-00000000000b'),
  'revocada|true', 'el historial dice que lo retiró el propio cliente');
select tests.eq((select actor from public.access_events where kind = 'cliente_desvinculado' and customer_id = 'c1000000-0000-0000-0000-00000000000b'),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'y el registro de accesos también');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select status from public.customer_link_overview('bbbbbbbb-0000-0000-0000-000000000000') where customer_id = 'c1000000-0000-0000-0000-00000000000b'),
  'revocada', 'el panel de B lo ve como acceso retirado');
reset role;

-- Un cliente no puede «dejar» la ficha de otra persona.
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.portal_leave_workshop('aaaaaaaa-0000-0000-0000-000000000000');
reset role;
select tests.eq((select user_id from public.customers where id = 'c1000000-0000-0000-0000-00000000000a'), '00000000-0000-0000-0000-0000000000c1'::uuid,
  'dejar un taller solo afecta a la ficha propia');
select tests.eq((select user_id from public.customers where id = 'c2000000-0000-0000-0000-00000000000a'), null::uuid, '(c2 solo ha dejado la suya)');

select tests.logout();
set local role anon;
select tests.throws($$select public.portal_leave_workshop('aaaaaaaa-0000-0000-0000-000000000000')$$, 'sin sesión, nada', '%permission denied%');
reset role;

rollback;
