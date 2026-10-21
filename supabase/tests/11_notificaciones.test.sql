-- Fase 7: notificaciones (generación por cambios reales, aislamiento, envío, reintentos, preferencias).
begin;
\ir _harness/fixtures.sql

-- a1 propietaria de A · a3 administradora de A · a2 mecánico de A · b1 propietario de B
-- c1 = cuenta del "Cliente Uno" (ficha c1…a en A y c1…b en B) · c2 = cuenta del "Cliente Dos" (c2…a en A)
update public.customers set email = 'cliente1@correo.test' where id = 'c1000000-0000-0000-0000-00000000000a';
update public.customers set email = 'Cliente2@Correo.test' where id = 'c2000000-0000-0000-0000-00000000000a';
update public.workshop_notification_settings set email_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';

select tests.eq((select count(*) from public.workshop_notification_settings), 2::bigint, 'cada taller tiene sus ajustes de avisos');
select tests.eq((select email_enabled from public.workshop_notification_settings where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), false,
  'el email empieza desactivado');

-- ===================== Generación de avisos =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, internal_notes)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          'Ruido al frenar', 'NOTA-INTERNA-SECRETA')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
reset role;

select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app'), 1::bigint,
  'crear la orden genera el aviso "vehículo recibido" en el portal');
select tests.eq((select status::text || '|' || recipient from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'email'),
  'pendiente|cliente1@correo.test', 'y un email pendiente (no "enviado": todavía no se ha mandado)');
select tests.eq((select title from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app'), 'Hemos recibido tu vehículo', 'título claro');
select tests.ok((select body not like '%NOTA-INTERNA%' and body like '%OR-%' from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app'),
  'el aviso no incluye notas internas');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set diagnosis = 'Pastillas', internal_notes = 'otra nota' where id = current_setting('tests.o1')::uuid;
update public.repair_orders set status = 'recibido' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid), 2::bigint,
  'guardar sin cambiar el estado (o con el mismo estado) no genera avisos');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'diagnosis' where id = current_setting('tests.o1')::uuid;
update public.repair_orders set status = 'diagnosis', diagnosis = 'Pastillas y discos' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app'), 2::bigint,
  'un cambio real de estado genera un aviso; repetirlo no lo duplica');
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'email'), 1::bigint,
  '"diagnosis" no va por email con la configuración inicial');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'listo', customer_notes = 'Puedes venir a partir de las 17:00.' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select string_agg(status::text || ':' || coalesce(error_code, '-'), ',' order by source_event_id) from public.notifications
                 where order_id = current_setting('tests.o1')::uuid and channel = 'email'),
  'cancelado:sustituida,pendiente:-', 'el email anterior aún sin enviar se sustituye por el del último estado');
select tests.ok((select body like '%Mensaje del taller: Puedes venir a partir de las 17:00.%' from public.notifications
                 where order_id = current_setting('tests.o1')::uuid and channel = 'app' and event = 'listo'),
  'el aviso incluye el mensaje para el cliente');

-- Vuelta atrás (corrección): se avisa como actualización y no se borra nada.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select title from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app' order by source_event_id desc limit 1),
  'Actualización del estado de tu reparación', 'volver atrás desde "listo" se explica como actualización');
select tests.eq((select error_code from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'email' and event = 'listo'),
  'estado_corregido', 'el email de "listo" que no se había enviado se cancela');
select tests.eq((select count(*) from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'estado'), 3::bigint,
  'el historial conserva todos los cambios de estado');
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app'), 4::bigint,
  'los avisos anteriores se conservan');

-- Cliente sin cuenta en el portal: no hay aviso interno (nadie lo leería), pero sí email.
insert into public.customers (id, workshop_id, full_name, email) values
  ('c3000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente sin portal', 'tres@correo.test'),
  ('c4000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente sin correo', null);
insert into public.vehicles (id, workshop_id, customer_id, plate, make, model, year, year_kind) values
  ('7e000003-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c3000000-0000-0000-0000-00000000000a', '3333CCC', 'Kia', 'Ceed', 2015, 'fabricacion'),
  ('7e000004-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-00000000000a', '4444CCC', 'Kia', 'Rio', 2015, 'fabricacion');
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '7e000003-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000a', 'Revisión'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '7e000004-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000a', 'Revisión');
reset role;
select tests.eq((select string_agg(channel::text, ',') from public.notifications where customer_id = 'c3000000-0000-0000-0000-00000000000a'), 'email',
  'sin cuenta vinculada: solo email');
select tests.eq((select count(*) from public.notifications where customer_id = 'c4000000-0000-0000-0000-00000000000a'), 0::bigint,
  'sin dirección de correo no se crea ningún email (ni se inventa una)');

-- Taller con el email desactivado: solo avisos internos.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
values ('bbbbbbbb-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'Revisión B');
reset role;
select tests.eq((select string_agg(channel::text, ',') from public.notifications where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 'app',
  'con el email desactivado en el taller no se prepara ningún email');

-- ===================== Lectura y aislamiento =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.notifications), 0::bigint, 'un cliente no lee la tabla de avisos directamente');
select tests.eq((select count(*) from public.portal_notifications()), 5::bigint, 'el cliente ve sus avisos de todos sus talleres (4 de A + 1 de B)');
select tests.ok((select bool_and(body not like '%NOTA-INTERNA%') from public.portal_notifications()), 'ningún aviso del portal lleva notas internas');
select tests.eq(public.portal_unread_notifications(), 5, 'todos sin leer');
select set_config('tests.n1', (select id::text from public.portal_notifications() limit 1), true);
select tests.eq(public.portal_mark_notifications_read(current_setting('tests.n1')::uuid), 1, 'marca uno como leído');
select tests.eq(public.portal_mark_notifications_read(current_setting('tests.n1')::uuid), 0, 'marcarlo otra vez no cambia nada');
select tests.eq(public.portal_unread_notifications(), 4, 'quedan 4 sin leer');
select tests.throws($$update public.notifications set read_at = now()$$, 'no puede tocar la tabla', '%permission denied%');
reset role;

-- Un aviso de otra persona (cliente 2) no se puede leer ni marcar.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Otra persona')
  returning id)
select set_config('tests.o2', (select id::text from x), true);
reset role;
select set_config('tests.n2', (select id::text from public.notifications where order_id = current_setting('tests.o2')::uuid and channel = 'app'), true);
select tests.eq((select recipient from public.notifications where order_id = current_setting('tests.o2')::uuid and channel = 'email'), 'cliente2@correo.test',
  'la dirección se normaliza (minúsculas)');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq(public.portal_mark_notifications_read(current_setting('tests.n2')::uuid), 0, 'no puede marcar como leído un aviso ajeno');
select tests.ok((select count(*) = 0 from public.portal_notifications() where id = current_setting('tests.n2')::uuid), 'ni verlo');
select tests.eq(public.portal_mark_notifications_read(), 4, '"marcar todo como leído" solo afecta a los suyos');
reset role;
select tests.eq((select read_at is null from public.notifications where id = current_setting('tests.n2')::uuid), true, 'el aviso ajeno sigue sin leer');

select tests.logout();
set local role anon;
select tests.throws($$select public.portal_notifications()$$, 'sin sesión no hay avisos', '%permission denied%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.notifications where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'otro taller no ve los avisos de A');
select tests.throws($$select public.retry_notification((select id from public.notifications limit 1))$$, 'ni puede reintentarlos (no los ve)', '%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.notifications), 0::bigint, 'un mecánico no ve el registro de avisos');
select tests.eq(tests.affected($$update public.workshop_notification_settings set email_enabled = false$$), 0::bigint, 'ni cambia los ajustes');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.ok((select count(*) > 0 from public.notifications), 'la propietaria ve los avisos de su taller');
select tests.eq((select count(*) from public.notifications where workshop_id <> 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'y solo los de su taller');
select tests.throws($$insert into public.notifications (workshop_id, customer_id, channel, template, title, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'app', 'x', 'Falso', 'Falso')$$,
  'nadie crea avisos a mano desde la API', '%permission denied%');
select tests.throws($$select * from public.claim_email_notifications()$$, 'ni reclama envíos', '%permission denied%');
select tests.throws($$select public.record_email_result(current_setting('tests.n2')::uuid, 'aceptado', 'x')$$, 'ni anota resultados', '%permission denied%');
select tests.eq(tests.affected($$update public.workshop_notification_settings set email_events = '{listo}' where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$), 0::bigint,
  'ni cambia los ajustes de otro taller');
select tests.throws($$update public.workshop_notification_settings set reply_to = 'no-es-correo'$$, 'la dirección de respuesta se valida', '%check%');
reset role;

-- ===================== Envío, reintentos y entrega =====================
set local role service_role;
select tests.eq((select count(*) from public.claim_email_notifications(50)), 2::bigint, 'el servidor reclama los emails pendientes');
select tests.eq((select count(*) from public.claim_email_notifications(50)), 0::bigint, 'un email reclamado no se vuelve a reclamar (sin envíos dobles)');
select set_config('tests.e2', (select id::text from public.notifications where order_id = current_setting('tests.o2')::uuid and channel = 'email'), true);
select tests.eq(public.record_email_result(current_setting('tests.e2')::uuid, 'temporal', 'resend', null, 'no_disponible')::text, 'pendiente',
  'un fallo temporal se reintentará');
select tests.ok((select next_attempt_at > now() + interval '50 seconds' and attempts = 1 and error_code = 'no_disponible' from public.notifications where id = current_setting('tests.e2')::uuid),
  'con espera y con el error registrado');
select tests.eq((select count(*) from public.claim_email_notifications(50)), 0::bigint, 'antes de la espera no se reintenta');
do $$
begin
  for i in 2..5 loop
    update public.notifications set next_attempt_at = now() where id = current_setting('tests.e2')::uuid;
    perform public.claim_email_notifications(50);
    perform public.record_email_result(current_setting('tests.e2')::uuid, 'temporal', 'resend', null, 'no_disponible');
  end loop;
end $$;
select tests.eq((select status::text || '|' || attempts || '|' || error_code from public.notifications where id = current_setting('tests.e2')::uuid),
  'fallido|5|no_disponible', 'los reintentos automáticos están limitados (5) y terminan en "fallido"');
update public.notifications set next_attempt_at = now() - interval '1 day' where id = current_setting('tests.e2')::uuid;
select tests.eq((select count(*) from public.claim_email_notifications(50)), 0::bigint, 'un fallido no se vuelve a enviar solo');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select public.retry_notification(current_setting('tests.e2')::uuid)$$, 'un mecánico no puede reintentar', '%permiso%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.retry_notification(current_setting('tests.e2')::uuid);
reset role;
select tests.eq((select status::text || '|' || manual_retries || '|' || max_attempts from public.notifications where id = current_setting('tests.e2')::uuid),
  'pendiente|1|6', 'una administradora reintenta: un único intento más');
set local role service_role;
select tests.eq((select count(*) from public.claim_email_notifications(50, current_setting('tests.o2')::uuid)), 1::bigint, 'se puede despachar solo una orden');
select tests.eq(public.record_email_result(current_setting('tests.e2')::uuid, 'aceptado', 'resend', 'msg-123')::text, 'enviado', 'aceptado por el proveedor = "enviado"');
select tests.eq((select delivered_at is null from public.notifications where id = current_setting('tests.e2')::uuid), true, 'pero NO "entregado"');
select tests.eq(public.record_email_delivery('resend', 'msg-123', 'entregado')::text, 'entregado', 'el proveedor confirma la entrega');
select tests.eq(public.record_email_delivery('resend', 'msg-123', 'entregado')::text, 'entregado', 'la confirmación repetida no cambia nada');
select tests.eq(public.record_email_delivery('resend', 'no-existe', 'entregado'), null::public.notification_status, 'un id desconocido se ignora');
select tests.throws($$select public.record_email_result(current_setting('tests.e2')::uuid, 'aceptado', 'resend', 'msg-456')$$,
  'un aviso ya enviado no se vuelve a anotar', '%no se está enviando%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.retry_notification(current_setting('tests.e2')::uuid)$$, 'un email ya entregado no se reintenta (no se duplica)', '%nunca uno ya enviado%');
reset role;

-- Límite de reintentos manuales y fallos permanentes.
set local role service_role;
select set_config('tests.e3', (select id::text from public.notifications where customer_id = 'c3000000-0000-0000-0000-00000000000a'), true);
select tests.eq(public.record_email_result(current_setting('tests.e3')::uuid, 'permanente', 'resend', null, 'rechazado')::text, 'fallido',
  'un rechazo permanente falla sin reintentos automáticos');
reset role;
do $$
begin
  for i in 1..3 loop
    perform tests.login('00000000-0000-0000-0000-0000000000a1');
    set local role authenticated;
    perform public.retry_notification(current_setting('tests.e3')::uuid);
    reset role;
    set local role service_role;
    perform public.claim_email_notifications(50);
    perform public.record_email_result(current_setting('tests.e3')::uuid, 'permanente', 'resend', null, 'rechazado');
    reset role;
  end loop;
end $$;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.retry_notification(current_setting('tests.e3')::uuid)$$, 'como máximo 3 reintentos manuales', '%3 veces%');
reset role;

-- Queja confirmada por el proveedor.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid;
reset role;
set local role service_role;
select set_config('tests.e1', (select id::text from public.claim_email_notifications(50, current_setting('tests.o1')::uuid) limit 1), true);
select public.record_email_result(current_setting('tests.e1')::uuid, 'aceptado', 'resend', 'msg-789');
select tests.eq(public.record_email_delivery('resend', 'msg-789', 'queja')::text, 'enviado', 'una queja (spam) se registra');
select tests.eq((select operational_email from public.customer_contact_preferences where customer_id = 'c1000000-0000-0000-0000-00000000000a'), false,
  'y desactiva los emails a ese cliente');
reset role;

-- ===================== Preferencias y consentimiento =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'email' and event = 'entregado'), 0::bigint,
  'si el cliente no quiere emails, no se prepara ninguno');
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'app' and event = 'entregado'), 1::bigint,
  'el aviso del portal sí');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select string_agg(workshop_name || ':' || operational_email || ':' || marketing_email, ',' order by workshop_name) from public.portal_contact_preferences()),
  'Taller Alcarria (prueba):false:false,Taller Chamberí (prueba):true:false', 'el cliente ve sus preferencias; nadie está suscrito a publicidad por defecto');
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, true);
select tests.throws($$select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', false, true)$$,
  'no puede cambiar las preferencias de otra persona', '%permiso%');
reset role;
select tests.eq((select string_agg(purpose || ':' || granted || ':' || source, ',' order by id) from public.communication_consent_log
                 where customer_id = 'c1000000-0000-0000-0000-00000000000a'),
  'operativa:false:queja_proveedor,operativa:true:portal,comercial:true:portal', 'cada cambio queda registrado con su origen');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', true, true)$$,
  'el taller no puede dar el consentimiento comercial por el cliente', '%solo lo puede dar el propio cliente%');
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false);
select tests.eq((select marketing_email from public.customer_contact_preferences where customer_id = 'c1000000-0000-0000-0000-00000000000a'), false,
  'pero sí retirarlo a petición del cliente');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', false, false)$$, 'un mecánico no cambia preferencias', '%permiso%');
reset role;

-- Comunicaciones comerciales: imposibles sin consentimiento.
set local role service_role;
select tests.throws($$insert into public.notifications (workshop_id, customer_id, channel, purpose, template, title, body, recipient)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a', 'email', 'comercial', 'promo', 'Oferta', 'Oferta', 'cliente2@correo.test')$$,
  'sin consentimiento no se crea un email comercial (ni con la clave secreta)', '%consentimiento%');
select tests.throws($$insert into public.notifications (workshop_id, customer_id, channel, purpose, template, title, body)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'app', 'comercial', 'promo', 'Oferta', 'Oferta')$$,
  'ni un aviso comercial en el portal', '%consentimiento%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', true, true);
reset role;
set local role service_role;
insert into public.notifications (workshop_id, customer_id, channel, purpose, template, title, body, recipient)
values ('aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a', 'email', 'comercial', 'promo', 'Oferta', 'Oferta', 'cliente2@correo.test');
select tests.ok(true, 'con consentimiento del propio cliente, sí');
reset role;
-- Si lo retira, lo que estuviera en cola no sale.
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', true, false);
reset role;
set local role service_role;
select count(*) from public.claim_email_notifications(50);
reset role;
select tests.eq((select status::text || ':' || error_code from public.notifications where purpose = 'comercial'), 'cancelado:sin_consentimiento',
  'si retira el consentimiento, el email comercial en cola no sale');

-- Taller suspendido: no se generan avisos.
update public.workshops set status = 'suspendido' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
update public.repair_orders set status = 'diagnosis' where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000';
select tests.eq((select count(*) from public.notifications where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 1::bigint,
  'un taller suspendido no genera avisos');

-- Las funciones nuevas no se exponen de más.
select tests.eq((select has_function_privilege('authenticated', 'public.claim_email_notifications(integer, uuid)', 'execute')), false, 'authenticated no reclama envíos');
select tests.eq((select has_function_privilege('authenticated', 'public.record_email_delivery(text, text, text)', 'execute')), false, 'ni anota entregas');
select tests.eq((select has_function_privilege('anon', 'public.retry_notification(uuid)', 'execute')), false, 'anon no reintenta');
select tests.eq((select has_function_privilege('anon', 'public.set_contact_preferences(uuid, boolean, boolean)', 'execute')), false, 'anon no cambia preferencias');

rollback;
