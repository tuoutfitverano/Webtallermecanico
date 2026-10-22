-- Cuentas de cliente multitaller: una cuenta global, varios talleres, cambio de taller,
-- invitaciones, historial de vinculaciones, registro de accesos y soporte de la plataforma.
begin;
\ir _harness/fixtures.sql

-- a1: propietaria de A · a2: mecánico de A · b1: propietario de B · c1: cliente de A y B · c2: cliente de A
-- ff: «Persona Ajena», con cuenta pero sin ningún taller · ad: administración de la plataforma
update public.workshop_sites set published = true, content = '{"phone":"949000000","city":"Guadalajara"}' where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.workshop_sites set published = true, content = '{"phone":"910000000"}' where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000';

-- ===================== 13. Los datos antiguos siguen accesibles =====================
select tests.eq((select count(*) from public.customer_account_links where status = 'activa'), 3::bigint,
  'las fichas ya vinculadas aparecen en el historial de vinculaciones');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_vehicles()), 2::bigint, 'c1 sigue viendo sus vehículos de A y B tras la migración');
reset role;

-- ===================== 1 y 9. Una cuenta global, dos talleres, sin cuentas duplicadas =====================
insert into public.customers (id, workshop_id, full_name, email) values
  ('ff000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Persona Ajena', 'ajeno@correo.test'),
  ('ff000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'P. Ajena', 'ajeno@correo.test');
insert into public.vehicles (id, workshop_id, customer_id, plate, make, model, year, year_kind) values
  ('7eff0000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'ff000000-0000-0000-0000-00000000000a', '1111FFA', 'Seat', 'Ibiza', 2018, 'fabricacion'),
  ('7eff0000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'ff000000-0000-0000-0000-00000000000b', '2222FFB', 'Kia', 'Ceed', 2020, 'fabricacion');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.inv_a', (select token from public.create_customer_invitation('ff000000-0000-0000-0000-00000000000a')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('tests.inv_b', (select token from public.create_customer_invitation('ff000000-0000-0000-0000-00000000000b')), true);
reset role;

select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select linked::text || '|' || pending_invitation from public.workshop_entry('taller-alcarria')), 'false|true',
  'desde la web de A: todavía sin vínculo, pero con una invitación pendiente');
select tests.eq((select count(*) from public.portal_workshops()), 0::bigint, 'sin vincular no tiene talleres');
select tests.eq((select count(*) from public.vehicles) + (select count(*) from public.customers), 0::bigint,
  '3. un cliente no vinculado no ve nada privado (ni en las tablas)');
select public.accept_customer_invitation(current_setting('tests.inv_a'));
select public.accept_customer_invitation(current_setting('tests.inv_b'));
select tests.eq((select string_agg(name, ' / ' order by name) from public.portal_workshops()), 'Taller Alcarria (prueba) / Taller Chamberí (prueba)',
  '1. una sola cuenta vinculada a dos talleres');
select tests.eq((select linked from public.workshop_entry('taller-alcarria')), true, 'al entrar desde la web de A, ya está vinculada');
select tests.eq((select vehicles from public.portal_workshops() where name like 'Taller Alcarria%'), 1, 'con el resumen real de cada taller');
reset role;
select tests.eq((select count(*) from auth.users where lower(email) = 'ajeno@correo.test'), 1::bigint, '9. sigue habiendo una única cuenta global');
select tests.eq((select string_agg(origin || ':' || status, ',') from public.customer_account_links where user_id = '00000000-0000-0000-0000-0000000000ff'),
  'invitacion:activa,invitacion:activa', 'cada vinculación queda en el historial con su origen');
select tests.eq((select count(*) from public.access_events where kind = 'cliente_vinculado' and subject_user = '00000000-0000-0000-0000-0000000000ff'), 2::bigint,
  'y en el registro de accesos (sin tokens ni correos)');
select tests.eq((select count(*) from public.access_events where detail::text like '%@%' or detail::text ~ '[0-9a-f]{64}'), 0::bigint,
  'el registro no guarda correos ni códigos');

-- ===================== 2. Cambiar de taller (el servidor elige; solo estrecha) =====================
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select set_config('request.headers', '{"x-portal-taller":"aaaaaaaa-0000-0000-0000-000000000000"}', true);
select tests.eq((select string_agg(plate, ',') from public.portal_vehicles()), '1111FFA', '2. con el taller A elegido, solo lo de A');
select set_config('request.headers', '{"x-portal-taller":"bbbbbbbb-0000-0000-0000-000000000000"}', true);
select tests.eq((select string_agg(plate, ',') from public.portal_vehicles()), '2222FFB', '…y al cambiar a B, solo lo de B');
select tests.eq((select count(*) from public.portal_workshops()), 2::bigint, '«Mis talleres» sigue mostrando los dos');
select set_config('request.headers', '{"x-portal-taller":"cccccccc-0000-0000-0000-000000000000"}', true);
select tests.eq((select count(*) from public.portal_vehicles()), 0::bigint, '11. elegir un taller ajeno no da acceso a nada');
select set_config('request.headers', '{"x-portal-taller":"no-es-un-id"}', true);
select tests.eq((select count(*) from public.portal_vehicles()), 2::bigint, 'un valor no válido se ignora (solo lo suyo, nunca más)');
select set_config('request.headers', '', true);
reset role;

-- ===================== 4 y 11. Facturas de otro cliente =====================
update public.workshops set legal_name = 'Taller Alcarria S.L.', tax_id = 'B12345678' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.customers set tax_id = '12345678Z', address_line = 'Calle Mayor 1', postal_code = '19001', city = 'Guadalajara' where id = 'c1000000-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
           values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Frenos') returning id)
select set_config('tests.o1', (select id::text from x), true);
insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 1, 'pieza', 'Pastillas', 1, 5000, 21);
select set_config('tests.f1', public.create_invoice_draft(current_setting('tests.o1')::uuid)::text, true);
select public.issue_invoice(current_setting('tests.f1')::uuid);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_invoices()), 1::bigint, 'c1 ve su factura');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select count(*) from public.portal_invoices()), 0::bigint, '4. otro cliente del mismo taller no ve esa factura');
select tests.eq(public.portal_invoice(current_setting('tests.f1')::uuid), null::jsonb, '11. ni pidiéndola por su identificador');
select tests.eq((select count(*) from public.invoices), 0::bigint, 'ni leyendo la tabla');
reset role;

-- ===================== 5 y 6. Aislamiento entre talleres y roles =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.customers where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  '5. el taller B no ve las fichas de A');
select tests.eq((select count(*) from public.customer_account_links where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'ni su historial de vinculaciones');
select tests.eq((select count(*) from public.access_events where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'ni su registro de accesos');
select tests.throws($$select * from public.customer_link_overview('aaaaaaaa-0000-0000-0000-000000000000')$$, 'ni el estado de sus clientes', '%No tienes acceso%');
select tests.throws($$select * from public.create_customer_invitation('ff000000-0000-0000-0000-00000000000a')$$, 'ni invita a un cliente de A', '%No tienes permiso%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select * from public.create_customer_invitation('c2000000-0000-0000-0000-00000000000a')$$, '6. el mecánico no invita clientes', '%No tienes permiso%');
select tests.throws($$select public.unlink_customer_account('ff000000-0000-0000-0000-00000000000a')$$, 'ni desvincula cuentas', '%No tienes permiso%');
select tests.throws($$select public.set_member_role('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'administrador')$$,
  'ni se cambia el rol', null);
select tests.eq((select count(*) from public.access_events), 0::bigint, 'ni lee el registro de accesos');
select tests.eq((select status from public.customer_link_overview('aaaaaaaa-0000-0000-0000-000000000000') where customer_id = 'ff000000-0000-0000-0000-00000000000a'),
  'activa', 'pero sí ve si el cliente ha activado su cuenta');
reset role;

-- ===================== 7 y 8. Invitaciones: taller correcto, sin reutilizar =====================
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select public.accept_customer_invitation(current_setting('tests.inv_a'))$$, '8. una invitación usada no se acepta otra vez', '%ya se ha usado%');
reset role;
-- Invitación caducada.
insert into public.customers (id, workshop_id, full_name, email) values
  ('dd000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente Nuevo', 'sin-confirmar@correo.test');
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.inv_old', (select token from public.create_customer_invitation('dd000000-0000-0000-0000-00000000000a')), true);
reset role;
update public.customer_invitations set expires_at = now() - interval '1 minute' where customer_id = 'dd000000-0000-0000-0000-00000000000a';
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000ee';
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select tests.throws($$select public.accept_customer_invitation(current_setting('tests.inv_old'))$$, '8. una invitación caducada no se acepta', '%caducado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select status from public.customer_link_overview('aaaaaaaa-0000-0000-0000-000000000000') where customer_id = 'dd000000-0000-0000-0000-00000000000a'),
  'caducada', 'el panel la muestra como caducada');
select set_config('tests.inv_new', (select token from public.create_customer_invitation('dd000000-0000-0000-0000-00000000000a')), true);
select public.revoke_customer_invitation((select id from public.customer_invitations where customer_id = 'dd000000-0000-0000-0000-00000000000a' and status = 'pendiente'));
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select tests.throws($$select public.accept_customer_invitation(current_setting('tests.inv_new'))$$, '8. una invitación revocada no se acepta', '%anulado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.inv_ok', (select token from public.create_customer_invitation('dd000000-0000-0000-0000-00000000000a')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select (public.accept_customer_invitation(current_setting('tests.inv_ok'))).workshop_id;
select tests.eq((select string_agg(workshop_id::text || '/' || customer_id, ',') from public.portal_workshops()),
  'aaaaaaaa-0000-0000-0000-000000000000/dd000000-0000-0000-0000-00000000000a', '7. la invitación vincula el taller y la ficha correctos (los decide el código)');
reset role;

-- ===================== 10. Fichas parecidas no se fusionan =====================
-- Otra ficha de A con el MISMO correo y nombre: no se vincula sola; y una cuenta no puede tener dos fichas en un taller.
insert into public.customers (id, workshop_id, full_name, email) values
  ('ff000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'Persona Ajena', 'ajeno@correo.test');
select tests.eq((select user_id from public.customers where id = 'ff000000-0000-0000-0000-0000000000a2'), null::uuid,
  '10. una ficha que coincide en nombre y correo no se vincula sola');
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.inv_dup', (select token from public.create_customer_invitation('ff000000-0000-0000-0000-0000000000a2')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select public.accept_customer_invitation(current_setting('tests.inv_dup'))$$,
  '10. ni con una invitación: una cuenta, una sola ficha por taller (la duplicada la revisa el taller)', '%otra ficha de este taller%');
select tests.eq((select count(*) from public.portal_vehicles()), 2::bigint, 'y la cuenta sigue viendo solo sus fichas');
reset role;
select tests.throws($$update public.customers set user_id = '00000000-0000-0000-0000-0000000000ff' where id = 'ff000000-0000-0000-0000-0000000000a2'$$,
  'ni a mano', null);

-- ===================== 12. Revocar quita el acceso y conserva el historial =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.unlink_customer_account('ff000000-0000-0000-0000-00000000000b');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select string_agg(name, ',') from public.portal_workshops()), 'Taller Alcarria (prueba)', '12. tras desvincular, el taller B desaparece de «Mis talleres»');
select tests.eq((select string_agg(plate, ',') from public.portal_vehicles()), '1111FFA', 'y sus datos de B dejan de verse');
select tests.eq((select linked from public.workshop_entry('taller-chamberi')), false, 'al entrar desde la web de B: sin relación activa');
reset role;
select tests.eq((select count(*) from public.vehicles where id = '7eff0000-0000-0000-0000-00000000000b'), 1::bigint, 'el taller conserva la ficha y el vehículo');
select tests.eq((select status || '|' || (revoked_by = '00000000-0000-0000-0000-0000000000b1') from public.customer_account_links where customer_id = 'ff000000-0000-0000-0000-00000000000b'),
  'revocada|true', 'el historial guarda la revocación (quién y cuándo)');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select status from public.customer_link_overview('bbbbbbbb-0000-0000-0000-000000000000') where customer_id = 'ff000000-0000-0000-0000-00000000000b'),
  'revocada', 'el panel la muestra como revocada');
select tests.eq((select count(*) from public.access_events where kind = 'cliente_desvinculado'), 1::bigint, 'y el taller la ve en su registro');
reset role;

-- ===================== Registro de cambios del equipo =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', false);
select tests.eq((select count(*) from public.access_events where kind = 'miembro_inactivo' and subject_user = '00000000-0000-0000-0000-0000000000a2'), 1::bigint,
  'desactivar a un empleado queda registrado');
select tests.throws($$insert into public.access_events (workshop_id, kind) values ('aaaaaaaa-0000-0000-0000-000000000000', 'miembro_alta')$$,
  'nadie escribe el registro a mano', '%permission denied%');
select tests.throws($$delete from public.customer_account_links$$, 'ni borra el historial', '%permission denied%');
reset role;

-- ===================== Administración de la plataforma =====================
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.admin_workshops_overview()), 2::bigint, 'el resumen de talleres (sin datos personales) no necesita sesión');
select tests.eq((select customers_linked from public.admin_workshops_overview() where slug = 'taller-alcarria'), 4, 'con el número de clientes vinculados');
select tests.eq((select count(*) from public.customers), 0::bigint, 'sin sesión de soporte no ve fichas de clientes');
select tests.throws($$select * from public.admin_link_diagnosis('ajeno@correo.test')$$, 'ni diagnostica vinculaciones', '%sesión de soporte%');
select tests.throws($$select public.admin_open_support_session('corto')$$, 'la sesión exige un motivo', '%motivo%');
select public.admin_open_support_session('Cliente no ve su taller en el portal (incidencia de prueba)', 'aaaaaaaa-0000-0000-0000-000000000000', 30);
select tests.eq((select string_agg(coalesce(workshop_name, '-') || ':' || link_status, ',' order by workshop_name) from public.admin_link_diagnosis('ajeno@correo.test')),
  'Taller Alcarria (prueba):activa,Taller Alcarria (prueba):invitacion_pendiente', 'con sesión: diagnóstico de vinculación');
select tests.ok((select count(*) from public.admin_access_events(50)) > 0, 'y consulta el registro de accesos');
select public.admin_close_support_session();
select tests.eq((select count(*) from public.customers), 0::bigint, 'al cerrar la sesión, vuelve a no ver nada');
reset role;
select tests.eq((select string_agg(kind, ',' order by id) from public.access_events where kind like 'soporte%'),
  'soporte_abierto,soporte_consulta,soporte_cerrado', 'apertura, consulta y cierre quedan registrados');
select tests.eq((select detail ->> 'correo' from public.access_events where kind = 'soporte_consulta'), 'a***@correo.test', 'la consulta guarda el correo enmascarado');
update public.platform_support_sessions set expires_at = opened_at + interval '1 minute', closed_at = null;
update public.platform_support_sessions set opened_at = now() - interval '10 minutes', expires_at = now() - interval '9 minutes';
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.customers), 0::bigint, 'una sesión caducada no da acceso');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal1');
set local role authenticated;
select tests.throws($$select public.admin_open_support_session('Sin segundo factor no se abre nada')$$, 'sin 2FA no se abre una sesión de soporte', '%dos pasos%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1', 'aal2');
set local role authenticated;
select tests.throws($$select * from public.admin_workshops_overview()$$, 'una propietaria no es administración de la plataforma', '%dos pasos%');
reset role;

rollback;
