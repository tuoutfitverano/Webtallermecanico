-- Fase 5: portal de clientes y vinculación cuenta ↔ ficha.
begin;
\ir _harness/fixtures.sql

-- c1 → fichas "Cliente Uno" en A (c1…a) y en B (c1…b) · c2 → ficha "Cliente Dos" en A (c2…a)
-- ff → cuenta sin ninguna ficha vinculada · a1 propietaria A · a3 administradora A · a2 mecánico A · b1 propietario B
-- Vehículos: 7e000001…a (1950BXF, de c1 en A), 7e000002…a (1234KLM, de c2 en A), 7e000001…b (5678BCD, de c1 en B)

-- ===================== Datos: órdenes en los dos talleres =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, assigned_to, problem_description,
                                    diagnosis, work_done, internal_notes, customer_notes)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-0000000000a2', 'Ruido al frenar', 'Pastillas gastadas', 'Cambio de pastillas',
          'SECRETO-INTERNO: cliente moroso', 'Ya tenemos tu coche en el taller')
  returning id)
select set_config('tests.oa1', (select id::text from x), true);
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Revisión')
  returning id)
select set_config('tests.oa2', (select id::text from x), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('bbbbbbbb-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'Neumáticos')
  returning id)
select set_config('tests.ob1', (select id::text from x), true);
reset role;

-- ===================== Cliente 2: solo lo suyo =====================
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select plate from public.portal_vehicles()), '1234KLM', 'el cliente ve su vehículo');
select tests.eq((select count(*) from public.portal_vehicles()), 1::bigint, 'y solo el suyo');
select tests.eq((select count(*) from public.portal_orders()), 1::bigint, 'el cliente ve solo sus reparaciones');
select tests.eq((select count(*) from public.portal_order(current_setting('tests.oa1')::uuid)), 0::bigint,
  'no ve la reparación de otro cliente aunque conozca su id');
select tests.eq((select count(*) from public.portal_order_timeline(current_setting('tests.oa1')::uuid)), 0::bigint,
  'ni su historial');
select tests.eq((select count(*) from public.portal_orders('todas', '7e000001-0000-0000-0000-00000000000a')), 0::bigint,
  'ni filtrando por el vehículo de otro cliente');
select tests.eq((select count(*) from public.repair_orders) + (select count(*) from public.repair_order_events)
  + (select count(*) from public.customers) + (select count(*) from public.vehicles), 0::bigint,
  'un cliente no lee ninguna tabla directamente');
select tests.eq(tests.affected($$update public.repair_orders set status = 'entregado'$$), 0::bigint, 'un cliente no cambia el estado de una reparación');
select tests.eq(tests.affected($$update public.vehicles set customer_id = 'c2000000-0000-0000-0000-00000000000a'$$), 0::bigint,
  'un cliente no cambia el propietario de un vehículo');
select tests.eq(tests.affected($$update public.customers set user_id = '00000000-0000-0000-0000-0000000000c2' where id = 'c1000000-0000-0000-0000-00000000000a'$$), 0::bigint,
  'un cliente no se apropia de otra ficha cambiando el identificador');
select tests.throws($$insert into public.customers (workshop_id, full_name, user_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Yo', '00000000-0000-0000-0000-0000000000c2')$$,
  'un cliente no crea fichas para sí mismo (lo frena el disparador; detrás está RLS)', '%mediante invitación%');
select tests.throws($$insert into public.workshop_members (workshop_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c2', 'mecanico')$$,
  'un cliente no se da permisos de empleado', '%row-level security%');
select tests.throws($$select * from public.create_customer_invitation('c1000000-0000-0000-0000-00000000000a', 'cliente2@correo.test')$$,
  'un cliente no se invita a fichas ajenas', '%No tienes permiso%');
select tests.throws($$select public.unlink_customer_account('c2000000-0000-0000-0000-00000000000a')$$,
  'un cliente no gestiona vinculaciones', '%No tienes permiso%');
select tests.eq((select count(*) from public.my_workshops()), 0::bigint, 'un cliente no es miembro de ningún taller');
reset role;

-- ===================== Cliente 1: dos talleres, información autorizada =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_orders()), 2::bigint, 'el cliente ve sus reparaciones de los dos talleres');
select tests.eq((select count(*) from public.portal_profile()), 2::bigint, 'y sus dos fichas');
select tests.eq((select customer_notes from public.portal_order(current_setting('tests.oa1')::uuid)), 'Ya tenemos tu coche en el taller',
  've el mensaje que el taller escribió para él');
select tests.ok((select diagnosis is null and work_done is null from public.portal_order(current_setting('tests.oa1')::uuid)),
  'NO ve la diagnosis ni el trabajo si el taller no lo ha autorizado');
select tests.ok((select not (to_jsonb(o) ? 'internal_notes') and to_jsonb(o)::text not like '%SECRETO%' from public.portal_order(current_setting('tests.oa1')::uuid) o),
  'las notas internas no salen nunca hacia el portal');
select tests.ok((select bool_and(to_jsonb(o)::text not like '%SECRETO%') from public.portal_orders() o), 'ni en el listado');
select tests.eq((select active_status::text from public.portal_vehicles() where plate = '1950BXF'), 'recibido', 'el vehículo muestra su reparación activa');
reset role;

-- El taller avanza la orden, autoriza los detalles y escribe al cliente.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'diagnosis', customer_notes = 'Estamos revisando los frenos'
 where id = current_setting('tests.oa1')::uuid;
update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a3', internal_notes = 'Otra nota interna'
 where id = current_setting('tests.oa1')::uuid;
update public.repair_orders set show_details_to_customer = true, status = 'listo', customer_notes = 'Ya puedes recogerlo'
 where id = current_setting('tests.oa1')::uuid;
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select diagnosis from public.portal_order(current_setting('tests.oa1')::uuid)), 'Pastillas gastadas',
  'con la autorización del taller ve la diagnosis');
select tests.eq((select string_agg(coalesce(status::text, '-') || ':' || coalesce(message, ''), ' | ' order by happened_at)
                 from public.portal_order_timeline(current_setting('tests.oa1')::uuid)),
  'recibido:Ya tenemos tu coche en el taller | diagnosis:Estamos revisando los frenos | listo:Ya puedes recogerlo',
  'la línea temporal muestra estados y mensajes, sin asignaciones ni cambios internos');
select tests.eq((select count(*) from public.portal_orders('listas')), 1::bigint, 'filtro "listas para recoger"');
select tests.eq((select count(*) from public.portal_orders('en_curso')), 1::bigint, 'filtro "en curso" (la del taller B)');
select tests.eq((select count(*) from public.portal_orders('finalizadas')), 0::bigint, 'filtro "finalizadas"');
reset role;

-- Un mecánico no decide qué ve el cliente.
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a2' where id = current_setting('tests.oa1')::uuid;
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$update public.repair_orders set customer_notes = 'Hola' where id = current_setting('tests.oa1')::uuid$$,
  'el mecánico no escribe mensajes al cliente', '%decide qué ve el cliente%');
select tests.throws($$update public.repair_orders set show_details_to_customer = false where id = current_setting('tests.oa1')::uuid$$,
  'ni cambia lo que el cliente puede ver', '%decide qué ve el cliente%');
reset role;

-- Taller suspendido: desaparece del portal.
update public.workshops set status = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_orders()), 1::bigint, 'las reparaciones de un taller suspendido no aparecen');
reset role;
update public.workshops set status = 'activo' where id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- ===================== Sin vincular y sin sesión =====================
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq((select count(*) from public.portal_profile()) + (select count(*) from public.portal_vehicles())
  + (select count(*) from public.portal_orders()), 0::bigint, 'una cuenta sin vincular no ve nada');
select tests.eq((select count(*) from public.portal_order(current_setting('tests.oa2')::uuid)), 0::bigint, 'ni pidiendo una reparación por su id');
reset role;
select tests.logout();
set local role anon;
select tests.throws($$select * from public.portal_orders()$$, 'anónimo: no usa el portal', '%permission denied%');
select tests.throws($$select * from public.accept_customer_invitation('x')$$, 'anónimo: no acepta invitaciones', '%permission denied%');
select tests.throws($$select id from public.customer_invitations$$, 'anónimo: no lee invitaciones', '%permission denied%');
reset role;

-- ===================== Invitaciones y vinculación =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.customers (workshop_id, full_name, email) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Persona Nueva', 'Ajeno@Correo.test')
  returning id)
select set_config('tests.nuevo', (select id::text from x), true);
with x as (
  insert into public.customers (workshop_id, full_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Otra Persona')
  returning id)
select set_config('tests.otra', (select id::text from x), true);
select tests.throws($$select * from public.create_customer_invitation('c1000000-0000-0000-0000-00000000000a', 'x@correo.test')$$,
  'no se invita a una ficha ya vinculada', '%ya está vinculada%');
select tests.throws($$select * from public.create_customer_invitation(current_setting('tests.otra')::uuid, null)$$,
  'sin correo no se puede invitar', '%correo electrónico válido%');
select tests.eq(tests.affected($$update public.customers set portal_linked_at = now() where id = current_setting('tests.nuevo')::uuid$$), 1::bigint,
  'el personal puede intentar escribir la fecha de vinculación…');
select tests.ok((select portal_linked_at is null from public.customers where id = current_setting('tests.nuevo')::uuid),
  'la fecha de vinculación no se puede falsear (la calcula la base de datos)');
-- Invitación usando el correo de la ficha.
select set_config('tests.tok', (select token from public.create_customer_invitation(current_setting('tests.nuevo')::uuid)), true);
select tests.eq((select email from public.customer_invitations where customer_id = current_setting('tests.nuevo')::uuid and status = 'pendiente'),
  'ajeno@correo.test', 'la invitación usa el correo de la ficha, normalizado');
select tests.throws($$select token_hash from public.customer_invitations$$, 'nadie lee la huella de los códigos', '%permission denied%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select * from public.create_customer_invitation(current_setting('tests.otra')::uuid, 'm@correo.test')$$,
  'un mecánico no invita clientes', '%No tienes permiso%');
select tests.throws($$select public.unlink_customer_account('c1000000-0000-0000-0000-00000000000a')$$,
  'ni desvincula cuentas', '%No tienes permiso%');
select tests.eq((select count(*) from public.customer_invitations), 0::bigint, 'ni ve las invitaciones');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select * from public.create_customer_invitation(current_setting('tests.otra')::uuid, 'b@correo.test')$$,
  'otro taller no invita a clientes ajenos', '%No tienes permiso%');
reset role;

-- Otra cuenta con el código: no sirve.
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select email_matches from public.get_customer_invitation(current_setting('tests.tok'))), false, 'la pantalla avisa de otro correo');
select tests.throws($$select * from public.accept_customer_invitation(current_setting('tests.tok'))$$,
  'un código robado no sirve con otra cuenta', '%otra dirección de correo%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select * from public.accept_customer_invitation('inventado')$$, 'un código inventado no sirve', '%no es válida%');
select tests.eq((select customer_id::text from public.accept_customer_invitation(current_setting('tests.tok'))), current_setting('tests.nuevo'),
  'la persona invitada vincula su cuenta a SU ficha');
select tests.eq((select full_name from public.portal_profile()), 'Persona Nueva', 'y ya ve su ficha en el portal');
select tests.ok((select linked_at is not null from public.portal_profile()), 'con la fecha de vinculación');
select tests.throws($$select * from public.accept_customer_invitation(current_setting('tests.tok'))$$, 'un código se usa una sola vez', '%ya se ha usado%');
reset role;

-- La misma cuenta no reclama otra ficha del mismo taller.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.tok2', (select token from public.create_customer_invitation(current_setting('tests.otra')::uuid, 'ajeno@correo.test')), true);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select * from public.accept_customer_invitation(current_setting('tests.tok2'))$$,
  'una cuenta no se vincula a dos fichas del mismo taller', '%ya está vinculada a otra ficha%');
reset role;

-- Caducada y anulada.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.revoke_customer_invitation((select id from public.customer_invitations where customer_id = current_setting('tests.otra')::uuid and status = 'pendiente'));
select tests.ok(true, 'la propietaria anula una invitación');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.throws($$select * from public.accept_customer_invitation(current_setting('tests.tok2'))$$, 'una invitación anulada no sirve', '%anulado%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select set_config('tests.tok3', (select token from public.create_customer_invitation(current_setting('tests.otra')::uuid, 'sin-confirmar@correo.test')), true);
select tests.ok(true, 'la administradora también invita clientes');
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000ee';
update public.customer_invitations set expires_at = now() - interval '1 minute' where customer_id = current_setting('tests.otra')::uuid and status = 'pendiente';
select tests.login('00000000-0000-0000-0000-0000000000ee');
set local role authenticated;
select tests.throws($$select * from public.accept_customer_invitation(current_setting('tests.tok3'))$$, 'una invitación caducada no sirve', '%caducado%');
reset role;

-- Revocar la vinculación: la ficha y el historial se conservan; el acceso desaparece al instante.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.unlink_customer_account('c1000000-0000-0000-0000-00000000000a');
select tests.ok((select user_id is null and portal_linked_at is null from public.customers where id = 'c1000000-0000-0000-0000-00000000000a'),
  'la propietaria desvincula la cuenta');
select tests.eq((select count(*) from public.repair_orders where customer_id = 'c1000000-0000-0000-0000-00000000000a'), 1::bigint,
  'la ficha y sus reparaciones se conservan');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_order(current_setting('tests.oa1')::uuid)), 0::bigint,
  'tras desvincular, el cliente ya no ve esa reparación');
select tests.eq((select count(*) from public.portal_orders()), 1::bigint, 'pero sí lo de su otro taller');
reset role;

rollback;
