-- Fase 3: perfiles, membresías, invitaciones y alta de talleres.
-- Cada bloque comprueba que nadie puede ver o hacer más de lo que le toca,
-- aunque llame directamente a la API saltándose la web.
begin;
\ir _harness/fixtures.sql

-- Usuarios de las pruebas (ver _harness/fixtures.sql):
--   a1 propietaria de A · a3 administradora de A · a2 mecánico de A
--   b1 propietario de B · ff sin taller · ee sin correo confirmado · ad admin de plataforma

-- ===================== Visitante sin sesión =====================
select tests.logout();
set local role anon;
select tests.throws($$select * from public.profiles$$, 'anónimo: no lee perfiles', '%permission denied%');
select tests.throws($$select * from public.workshop_members$$, 'anónimo: no lee membresías', '%permission denied%');
select tests.throws($$select id from public.workshop_invitations$$, 'anónimo: no lee invitaciones', '%permission denied%');
select tests.throws($$select id from public.web_requests$$, 'anónimo: no lee solicitudes', '%permission denied%');
select tests.throws($$select * from public.my_workshops()$$, 'anónimo: no llama a las funciones de cuenta', '%permission denied%');
select tests.throws($$select * from public.accept_workshop_invitation('x')$$, 'anónimo: no acepta invitaciones', '%permission denied%');
reset role;

-- ===================== Perfiles =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.profiles), 1::bigint, 'cada persona ve solo su propio perfil');
select tests.eq((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint,
  'no se lee el perfil de otra persona, aunque se pida por su id');
select tests.eq(tests.affected($$update public.profiles set full_name = 'Ana P.', phone = '600 111 222' where id = '00000000-0000-0000-0000-0000000000a1'$$), 1::bigint,
  'se edita el propio nombre y teléfono');
select tests.eq(tests.affected($$update public.profiles set full_name = 'Hackeado' where id = '00000000-0000-0000-0000-0000000000b1'$$), 0::bigint,
  'no se edita el perfil de otra persona');
select tests.throws($$update public.profiles set id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'no se cambia el id del perfil', '%permission denied%');
select tests.throws($$update public.profiles set created_at = now()$$, 'no se cambian campos de sistema del perfil', '%permission denied%');
select tests.throws($$insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000000ff')$$, 'no se crean perfiles a mano', '%permission denied%');
select tests.throws($$delete from public.profiles$$, 'no se borran perfiles', '%permission denied%');
-- Los privilegios globales no están en el perfil ni en datos que el usuario controle.
select tests.throws($$update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'no se toca auth.users desde la API', '%permission denied%');
select tests.throws($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1')$$,
  'la propietaria no se nombra administradora de la plataforma', '%permission denied%');
reset role;

-- ===================== Talleres: datos de la cuenta =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshops set contact_email = 'hola@alcarria.test', contact_phone = '949 000 000', logo_url = 'https://cdn.alcarria.test/logo.png' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$),
  1::bigint, 'la propietaria edita el contacto y el logotipo de su taller');
select tests.throws($$update public.workshops set logo_url = 'http://inseguro.test/logo.png' where id = 'aaaaaaaa-0000-0000-0000-000000000000'$$,
  'el logotipo solo admite https', '%check constraint%');
select tests.eq(tests.affected($$update public.workshops set contact_email = 'robo@x.test' where id = 'bbbbbbbb-0000-0000-0000-000000000000'$$), 0::bigint,
  'no edita la cuenta de otro taller');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshops set contact_email = 'mio@x.test'$$), 0::bigint, 'el mecánico no edita la cuenta del taller');
reset role;

-- ===================== Membresías y equipo =====================
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$insert into public.workshop_members (workshop_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000ff', 'mecanico')$$,
  'nadie se añade a un taller ajeno insertando su membresía', '%row-level security%');
select tests.eq((select count(*) from public.my_workshops()), 0::bigint, 'una persona sin taller no tiene talleres');
-- Quien no es miembro (rol NULL) no pasa ninguna comprobación de permisos.
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'colado@correo.test', 'mecanico')$$,
  'una persona ajena no invita en un taller', '%No tienes permiso para invitar%');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'administrador')$$,
  'una persona ajena no cambia roles', '%propietario puede cambiar roles%');
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', false)$$,
  'una persona ajena no desactiva a nadie', '%No tienes permiso%');
select tests.throws($$select public.revoke_workshop_invitation(gen_random_uuid())$$,
  'una persona ajena no anula invitaciones', '%no encontrada%');
select tests.throws($$select * from public.workshop_team('aaaaaaaa-0000-0000-0000-000000000000')$$,
  'una persona ajena no ve el equipo de un taller', '%No tienes acceso%');
reset role;

-- Mecánico
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.workshop_team('aaaaaaaa-0000-0000-0000-000000000000')), 3::bigint, 'el mecánico ve a sus compañeros');
select tests.eq((select count(*) from public.workshop_team('aaaaaaaa-0000-0000-0000-000000000000') where email is not null), 0::bigint,
  'el mecánico no ve los correos de sus compañeros');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'propietario')$$,
  'el mecánico no se convierte en propietario con la función', '%propietario puede cambiar roles%');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'administrador')$$,
  'el mecánico no se sube a administrador', '%propietario puede cambiar roles%');
select tests.eq(tests.affected($$update public.workshop_members set role = 'propietario', active = true where user_id = '00000000-0000-0000-0000-0000000000a2'$$), 0::bigint,
  'el mecánico no cambia su rol editando la tabla');
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', false)$$,
  'el mecánico no desactiva a nadie', '%No tienes permiso%');
select tests.eq((select role::text from public.my_workshops()), 'mecanico', 'el mecánico sigue siendo mecánico');
reset role;

-- Administradora (manager)
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'administrador')$$,
  'la administradora no cambia roles', '%propietario puede cambiar roles%');
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', false)$$,
  'la administradora no desactiva a la propietaria', '%No tienes permiso para gestionar a esta persona%');
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', false)$$,
  'nadie se desactiva a sí mismo', '%ti mismo%');
select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', false);
select tests.ok(true, 'la administradora desactiva a un mecánico');
reset role;

-- Un mecánico desactivado pierde el acceso al instante (RLS consulta la tabla, no el token).
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.vehicles), 0::bigint, 'el mecánico desactivado ya no ve vehículos');
select tests.eq((select count(*) from public.workshop_members where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint,
  'pero sí ve su propia membresía (desactivada)');
select tests.eq((select count(*) from public.my_workshops()), 0::bigint, 'y ya no le aparece el taller');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', true);
select tests.ok(true, 'la administradora reactiva al mecánico');
reset role;

-- Propietaria
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.workshop_team('aaaaaaaa-0000-0000-0000-000000000000') where email is not null), 3::bigint,
  'la propietaria ve los correos de su equipo');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'propietario')$$,
  'ni la propietaria nombra propietarios (solo la plataforma)', '%Solo la plataforma%');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'mecanico')$$,
  'la propietaria no cambia su propio rol', '%propio rol%');
select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'administrador');
select tests.ok(true, 'la propietaria asciende al mecánico a administrador');
select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'mecanico');
select tests.ok(true, 'y lo devuelve a mecánico');
select tests.throws($$select public.set_member_role('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', 'mecanico')$$,
  'la propietaria de A no toca roles del taller B', '%propietario puede cambiar roles%');
select tests.throws($$select * from public.workshop_team('bbbbbbbb-0000-0000-0000-000000000000')$$,
  'la propietaria de A no ve el equipo de B', '%No tienes acceso%');
select tests.eq(tests.affected($$update public.workshop_members set user_id = '00000000-0000-0000-0000-0000000000ff' where user_id = '00000000-0000-0000-0000-0000000000a2'$$), 0::bigint,
  'una membresía no se pasa a otra persona editando la tabla');
reset role;
-- Ni siquiera la plataforma puede "mudar" una membresía (se crea otra).
select tests.throws($$update public.workshop_members set user_id = '00000000-0000-0000-0000-0000000000ff' where user_id = '00000000-0000-0000-0000-0000000000a2'$$,
  'el disparador impide cambiar la persona de una membresía', '%cambiar de persona%');

-- Un segundo propietario no lo puede tocar la propietaria.
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'propietario');
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', false)$$,
  'un propietario no desactiva a otro propietario', '%No tienes permiso para gestionar a esta persona%');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'mecanico')$$,
  'un propietario no degrada a otro propietario', '%solo lo cambia la plataforma%');
reset role;
delete from public.workshop_members where user_id = '00000000-0000-0000-0000-0000000000c2';

-- ===================== Invitaciones: quién puede invitar =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'nuevo@correo.test', 'mecanico')$$,
  'el mecánico no invita', '%No tienes permiso para invitar%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'nuevo@correo.test', 'administrador')$$,
  'la administradora no invita administradores', '%No tienes permiso para invitar%');
select tests.eq((select length(token) from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', ' Nuevo@Correo.test ', 'mecanico')), 64,
  'la administradora invita mecánicos (código de 64 caracteres)');
select tests.eq((select email from public.workshop_invitations where email like 'nuevo%'), 'nuevo@correo.test', 'el correo se guarda normalizado');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'colado@correo.test', 'mecanico')$$,
  'el propietario de B no invita en A cambiando el id del taller', '%No tienes permiso para invitar%');
select tests.eq((select count(*) from public.workshop_invitations where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'el propietario de B no ve las invitaciones de A');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'jefe@correo.test', 'propietario')$$,
  'nadie invita como propietario', '%Solo la plataforma%');
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'no-es-un-correo', 'mecanico')$$,
  'el correo se valida', '%no es válido%');
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'MECANICO@alcarria.test', 'mecanico')$$,
  'no se invita a quien ya está en el equipo', '%ya forma parte%');
select tests.throws($$select token_hash from public.workshop_invitations$$, 'nadie lee la huella de los códigos', '%permission denied%');
select tests.throws($$insert into public.workshop_invitations (workshop_id, email, role, token_hash) values ('aaaaaaaa-0000-0000-0000-000000000000', 'x@x.test', 'mecanico', repeat('a', 64))$$,
  'no se crean invitaciones escribiendo en la tabla', '%permission denied%');
select tests.throws($$update public.workshop_invitations set role = 'administrador'$$, 'no se modifican invitaciones en la tabla', '%permission denied%');

-- Invitación para "ajeno@correo.test" (ff) como mecánico; guardamos el código.
select set_config('tests.token', (select token from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'ajeno@correo.test', 'mecanico')), true);
select tests.eq((select count(*) from public.workshop_invitations where email = 'ajeno@correo.test' and status = 'pendiente'), 1::bigint,
  'la propietaria ve la invitación pendiente');
-- Repetir la invitación anula la anterior (solo vale el último código).
select set_config('tests.token_viejo', current_setting('tests.token'), true);
select set_config('tests.token', (select token from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'ajeno@correo.test', 'mecanico')), true);
select tests.eq((select count(*) from public.workshop_invitations where email = 'ajeno@correo.test' and status = 'pendiente'), 1::bigint,
  'sigue habiendo una sola invitación pendiente por persona');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.workshop_invitations), 0::bigint, 'el mecánico no ve las invitaciones');
reset role;

-- ===================== Invitaciones: aceptar =====================
-- Otra persona con sesión (b1) que consigue el código no puede usarlo.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select email_matches from public.get_workshop_invitation(current_setting('tests.token'))), false,
  'la pantalla avisa de que la invitación es para otro correo');
select tests.eq((select email_hint from public.get_workshop_invitation(current_setting('tests.token'))), 'a***@correo.test',
  'y no muestra el correo completo');
select tests.throws($$select * from public.accept_workshop_invitation(current_setting('tests.token'))$$,
  'un código robado no sirve con otra cuenta', '%otra dirección de correo%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select * from public.accept_workshop_invitation('codigo-inventado')$$, 'un código inventado no sirve', '%no es válida%');
select tests.throws($$select * from public.accept_workshop_invitation(current_setting('tests.token_viejo'))$$,
  'el código anterior quedó anulado', '%ya se ha usado o se ha anulado%');
select tests.eq((select state from public.get_workshop_invitation(current_setting('tests.token'))), 'pendiente', 'la invitación está pendiente');
select tests.eq((select role::text from public.accept_workshop_invitation(current_setting('tests.token'))), 'mecanico',
  'la persona invitada acepta y entra con el rol de la invitación');
select tests.eq((select role::text from public.my_workshops() where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'mecanico',
  'ya pertenece al taller A como mecánico');
select tests.eq((select count(*) from public.vehicles), 2::bigint, 'y ve los vehículos de A (y solo de A)');
select tests.eq((select count(*) from public.web_requests), 0::bigint, 'pero como mecánico no ve las solicitudes web');
select tests.throws($$select * from public.accept_workshop_invitation(current_setting('tests.token'))$$,
  'un código solo se usa una vez', '%ya se ha usado%');
reset role;

-- Correo sin confirmar
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.token_ee', (select token from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'sin-confirmar@correo.test', 'mecanico')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select tests.throws($$select * from public.accept_workshop_invitation(current_setting('tests.token_ee'))$$,
  'sin confirmar el correo no se acepta', '%Confirma tu correo%');
reset role;

-- Caducada
update public.workshop_invitations set expires_at = now() - interval '1 minute' where email = 'sin-confirmar@correo.test';
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000ee';
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select tests.eq((select state from public.get_workshop_invitation(current_setting('tests.token_ee'))), 'caducada', 'la pantalla indica que ha caducado');
select tests.throws($$select * from public.accept_workshop_invitation(current_setting('tests.token_ee'))$$,
  'una invitación caducada no se acepta', '%caducado%');
reset role;

-- Revocar
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.inv_admin', (select invitation_id::text from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'futura@correo.test', 'administrador')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.revoke_workshop_invitation(current_setting('tests.inv_admin')::uuid)$$,
  'la administradora no anula invitaciones de administrador', '%no encontrada%');
select public.revoke_workshop_invitation((select id from public.workshop_invitations where email = 'nuevo@correo.test'));
select tests.ok(true, 'la administradora anula una invitación de mecánico');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select public.revoke_workshop_invitation(current_setting('tests.inv_admin')::uuid)$$,
  'el propietario de B no anula invitaciones de A', '%no encontrada%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.revoke_workshop_invitation(current_setting('tests.inv_admin')::uuid);
select tests.eq((select status::text from public.workshop_invitations where id = current_setting('tests.inv_admin')::uuid), 'revocada',
  'la propietaria anula la invitación');
reset role;

-- Administración de plataforma: sin 2FA no gestiona equipos ajenos.
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal1');
set local role authenticated;
select tests.throws($$select * from public.create_workshop_invitation('bbbbbbbb-0000-0000-0000-000000000000', 'x@correo.test', 'mecanico')$$,
  'el admin de plataforma sin 2FA no invita', '%No tienes permiso%');
reset role;

-- ===================== Alta controlada de talleres =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select private.create_workshop('taller-robado', 'Robado', 'propietaria@alcarria.test')$$,
  'un usuario no crea talleres', '%permission denied%');
select tests.throws($$select private.add_workshop_owner('bbbbbbbb-0000-0000-0000-000000000000', 'propietaria@alcarria.test')$$,
  'un usuario no se hace propietario de otro taller', '%permission denied%');
select tests.throws($$insert into public.workshops (slug, name) values ('taller-pirata', 'Pirata')$$,
  'un usuario no inserta talleres directamente', '%row-level security%');
reset role;
set local role service_role;
select tests.throws($$select private.create_workshop('taller-servicio', 'Servicio', 'ajeno@correo.test')$$,
  'ni siquiera la clave secreta de la API crea talleres con esta función', '%permission denied%');
reset role;

-- Como superusuario (SQL Editor de Supabase):
select tests.throws($$select private.create_workshop('taller-x', 'Taller X', 'nadie@correo.test')$$,
  'no se crea un taller para una cuenta que no existe', '%No hay ninguna cuenta%');
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-0000000000ee';
select tests.throws($$select private.create_workshop('taller-x', 'Taller X', 'sin-confirmar@correo.test')$$,
  'ni para una cuenta sin confirmar', '%No hay ninguna cuenta%');
select set_config('tests.nuevo', private.create_workshop('taller-nuevo', 'Taller Nuevo', 'Ajeno@Correo.test')::text, true);
select tests.eq((select role::text from public.workshop_members where workshop_id = current_setting('tests.nuevo')::uuid), 'propietario',
  'el taller nuevo nace con su propietario');
select tests.eq((select published from public.workshop_sites where workshop_id = current_setting('tests.nuevo')::uuid), false,
  'y con la web sin publicar');
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select count(*) from public.my_workshops()), 2::bigint, 'la persona ve su taller nuevo y el taller donde es mecánico');
select tests.eq((select count(*) from public.vehicles where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint,
  'y sigue sin ver nada del taller B');
reset role;

rollback;
