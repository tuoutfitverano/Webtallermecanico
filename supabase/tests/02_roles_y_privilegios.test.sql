-- Cada rol hace solo lo que le corresponde y nadie puede subirse de nivel.
begin;
\ir _harness/fixtures.sql

-- Mecánico
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.affected($$update public.vehicles set model = 'Golf GTI' where plate = '1950BXF'$$), 1::bigint, 'el mecánico puede editar vehículos');
select tests.eq(tests.affected($$delete from public.vehicles where plate = '1950BXF'$$), 0::bigint, 'el mecánico no puede borrar vehículos');
select tests.throws($$update public.vehicles set verification_status = 'verificado' where plate = '1950BXF'$$,
  'el mecánico no puede marcar datos como verificados', '%propietario o un administrador%');
select tests.throws($$insert into public.workshop_members (workshop_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ff', 'propietario')$$,
  'el mecánico no puede añadir miembros', '%row-level security%');
select tests.eq(tests.affected($$update public.workshop_members set role = 'propietario' where user_id = '00000000-0000-0000-0000-0000000000a2'$$), 0::bigint,
  'el mecánico no puede subirse a propietario');
select tests.eq(tests.affected($$update public.workshops set name = 'Mío' $$), 0::bigint, 'el mecánico no puede editar el taller');
select tests.eq((select count(*) from public.web_requests), 0::bigint, 'el mecánico no ve las solicitudes web (datos personales)');
reset role;

-- Propietaria
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshop_members set role = 'mecanico' where user_id = '00000000-0000-0000-0000-0000000000a1'$$), 0::bigint,
  'la propietaria no cambia roles directamente (irá por invitaciones)');
select tests.throws($$update public.workshops set status = 'demo' where slug = 'taller-alcarria'$$, 'la propietaria no cambia el estado comercial del taller', '%plataforma%');
select tests.throws($$update public.workshops set slug = 'otro-nombre'$$, 'la propietaria no cambia el identificador', '%plataforma%');
select tests.eq(tests.affected($$update public.workshops set name = 'Taller Alcarria' $$), 1::bigint, 'la propietaria sí cambia el nombre comercial');
select tests.eq(tests.affected($$update public.vehicles set verification_status = 'verificado' where plate = '1950BXF'$$), 1::bigint, 'la propietaria puede verificar datos');
select tests.eq((select verified_by from public.vehicles where plate = '1950BXF'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'queda registrado quién verificó');
select tests.ok((select verified_at is not null from public.vehicles where plate = '1950BXF'), 'queda registrado cuándo se verificó');
select tests.throws($$update public.vehicles set data_source = 'proveedor_externo' where plate = '1950BXF'$$,
  'nadie del taller puede fingir que los datos vienen de un proveedor', '%sistema%');
select tests.throws($$update public.customers set user_id = '00000000-0000-0000-0000-0000000000ff' where full_name = 'Cliente Dos (A)'$$,
  'no se enlaza una cuenta de cliente a mano', '%invitación%');
select tests.throws($$update public.web_requests set name = 'Otro' where id = 'ee000000-0000-0000-0000-00000000000a'$$,
  'en una solicitud solo se puede cambiar el estado', '%permission denied%');
select tests.eq(tests.affected($$update public.web_requests set status = 'en_gestion' where id = 'ee000000-0000-0000-0000-00000000000a'$$), 1::bigint, 'la propietaria gestiona la solicitud');
select tests.eq((select handled_by from public.web_requests where id = 'ee000000-0000-0000-0000-00000000000a'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'queda registrado quién la gestionó');
select tests.throws($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1')$$, 'nadie se nombra administrador de plataforma', '%permission denied%');
reset role;

-- Administrador de plataforma: sin 2FA no tiene privilegios; con 2FA, sí.
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 0::bigint, 'el admin sin 2FA no ve datos de talleres');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 0::bigint, 'el admin con 2FA pero sin sesión de soporte tampoco ve datos de talleres');
select public.admin_open_support_session('Incidencia de prueba: revisar vehículos', null, 30);
select tests.eq((select count(*) from public.vehicles), 3::bigint, 'con 2FA y una sesión de soporte abierta (con motivo), sí');
select tests.eq(tests.affected($$update public.workshops set status = 'suspendido' where slug = 'taller-chamberi'$$), 1::bigint, 'el admin con 2FA puede suspender un taller');
reset role;

rollback;
