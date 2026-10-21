-- Avisos por WhatsApp: número, opt-in del propio cliente, generación, envío, entrega, retirada y aislamiento.
begin;
\ir _harness/fixtures.sql

-- a1 propietaria de A · a2 mecánico de A · a3 administradora de A · b1 propietario de B
-- c1 = cuenta del "Cliente Uno" (fichas c1…a en A y c1…b en B, móvil 600000001) · c2 = "Cliente Dos" (c2…a en A)

-- ===================== Número de WhatsApp =====================
select tests.eq(private.whatsapp_number('600 00 00 01'), '34600000001', 'móvil español sin prefijo');
select tests.eq(private.whatsapp_number('+34 700-123-456'), '34700123456', 'móvil español con +34');
select tests.eq(private.whatsapp_number('0034600000001'), '34600000001', 'móvil español con 0034');
select tests.eq(private.whatsapp_number('+44 7700 900123'), '447700900123', 'móvil de otro país escrito con +');
select tests.eq(private.whatsapp_number('912345678'), null::text, 'un fijo no vale para WhatsApp');
select tests.eq(private.whatsapp_number('+34 912345678'), null::text, 'un fijo con prefijo tampoco');
select tests.eq(private.whatsapp_number('12'), null::text, 'un número incompleto no vale');
select tests.eq(private.whatsapp_number(null), null::text, 'sin teléfono, sin WhatsApp');

-- ===================== Valores por defecto =====================
select tests.eq((select whatsapp_enabled from public.workshop_notification_settings where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), false,
  'WhatsApp empieza desactivado en el taller');
select tests.eq(private.whatsapp_preference('c1000000-0000-0000-0000-00000000000a'), false, 'y en cada cliente (lo tiene que pedir él)');

-- Un mecánico no puede activarlo en el taller.
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshop_notification_settings set whatsapp_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 0::bigint,
  'un mecánico no activa WhatsApp en el taller');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.workshop_notification_settings set whatsapp_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;
select tests.eq((select whatsapp_enabled from public.workshop_notification_settings where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), true,
  'la propietaria sí lo activa');

-- Sin opt-in del cliente, no se crea ningún WhatsApp.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Revisión')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp'), 0::bigint,
  'sin que el cliente lo pida, no hay WhatsApp');

-- ===================== Opt-in: solo el propio cliente =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false, true)$$,
  'el taller no puede activar el WhatsApp de un cliente', '%solo los puede pedir el propio cliente%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false, true);
select tests.eq((select has_whatsapp_number::text || '|' || whatsapp_hint || '|' || operational_whatsapp || '|' || workshop_whatsapp
                   from public.portal_contact_preferences() where customer_id = 'c1000000-0000-0000-0000-00000000000a'),
  'true|001|true|true', 'el cliente ve su elección y solo las 3 últimas cifras de su móvil');
select tests.eq((select count(*) from public.portal_contact_preferences()), 2::bigint, 've sus dos fichas (dos talleres), nada más');
select tests.throws($$select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', true, false, true)$$,
  'no puede cambiar las preferencias de otro cliente', '%permiso%');
reset role;
select tests.eq((select count(*) from public.communication_consent_log
                  where customer_id = 'c1000000-0000-0000-0000-00000000000a' and channel = 'whatsapp' and granted and source = 'portal'), 1::bigint,
  'queda registrado que lo pidió el propio cliente');
select tests.eq(private.whatsapp_preference('c1000000-0000-0000-0000-00000000000b'), false, 'su ficha en el otro taller no cambia');

-- Sin móvil válido no se puede activar.
update public.customers set phone = '912345678' where id = 'c2000000-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.throws($$select public.set_contact_preferences('c2000000-0000-0000-0000-00000000000a', true, false, true)$$,
  'con un fijo en la ficha no se puede pedir WhatsApp', '%hace falta un móvil%');
select tests.eq((select has_whatsapp_number from public.portal_contact_preferences()), false, 'y el portal se lo dice');
reset role;

-- ===================== Generación =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'esperando_recambios', customer_notes = 'Llega la pieza el lunes' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select status::text || '|' || recipient || '|' || purpose from public.notifications
                  where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp'),
  'pendiente|34600000001|operativa', 'un cambio de estado crea el WhatsApp pendiente al móvil de la ficha');
select tests.ok((select body like '%Llega la pieza el lunes%' and body not like '%Revisión%' from public.notifications
                  where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp'),
  'lleva el estado y el mensaje para el cliente (nada interno)');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp'), 1::bigint,
  '«En reparación» no se avisa por WhatsApp por defecto');

-- Nada comercial por WhatsApp, ni con la clave secreta.
set local role service_role;
select tests.throws($$insert into public.notifications (workshop_id, customer_id, channel, purpose, template, title, body, recipient)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'whatsapp', 'comercial', 'promo', 'Oferta', 'Texto', '34600000001')$$,
  'no se puede crear un WhatsApp comercial', '%comerciales por WhatsApp%');
reset role;

-- ===================== Envío =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select * from public.claim_whatsapp_notifications()$$, 'el personal no reclama envíos', '%permission denied%');
select tests.throws($$select public.record_whatsapp_result(gen_random_uuid(), 'aceptado', 'meta')$$, 'ni anota resultados', '%permission denied%');
reset role;

set local role service_role;
select set_config('tests.w1', (select id::text from public.claim_whatsapp_notifications(50)), true);
select tests.eq((select status::text || '|' || attempts from public.notifications where id = current_setting('tests.w1')::uuid), 'procesando|1',
  'el servidor lo reclama para enviarlo');
select tests.eq((select count(*) from public.claim_whatsapp_notifications(50)), 0::bigint, 'nadie más lo reclama a la vez');
select tests.throws($$select public.record_whatsapp_result((select id from public.notifications where channel = 'app' limit 1), 'aceptado', 'meta')$$,
  'no se anota como WhatsApp lo que no lo es', '%no es de WhatsApp%');
select tests.eq(public.record_whatsapp_result(current_setting('tests.w1')::uuid, 'aceptado', 'meta', 'wamid.1')::text, 'enviado',
  'aceptado por el proveedor = «enviado»');
select tests.eq(public.record_whatsapp_delivery('meta', 'wamid.1', 'leido')::text, 'entregado', 'leído o entregado = «entregado»');
select tests.eq(public.record_whatsapp_delivery('meta', 'wamid.1', 'entregado')::text, 'entregado', 'la confirmación repetida no cambia nada');
select tests.eq(public.record_whatsapp_delivery('meta', 'desconocido', 'entregado'), null::public.notification_status, 'un id desconocido se ignora');
reset role;

-- El móvil de la ficha cambia antes de enviar: no se manda al número viejo.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid;
update public.customers set phone = '611 22 33 44' where id = 'c1000000-0000-0000-0000-00000000000a';
reset role;
set local role service_role;
select tests.eq((select count(*) from public.claim_whatsapp_notifications(50)), 0::bigint, 'con el móvil cambiado no se reclama');
reset role;
select tests.eq((select error_code from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp' and event = 'listo'),
  'destinatario_cambiado', 'se cancela: «destinatario cambiado»');

-- Fallo y reintento manual (solo gestores, solo lo fallido).
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o1')::uuid;
update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid;
reset role;
set local role service_role;
select set_config('tests.w2', (select id::text from public.claim_whatsapp_notifications(50)), true);
select tests.eq(public.record_whatsapp_result(current_setting('tests.w2')::uuid, 'permanente', 'meta', null, 'rechazado')::text, 'fallido',
  'un rechazo definitivo queda «fallido»');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select public.retry_notification(current_setting('tests.w2')::uuid)$$, 'un mecánico no reintenta', '%permiso%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.retry_notification(current_setting('tests.w2')::uuid);
reset role;
select tests.eq((select status::text || '|' || manual_retries from public.notifications where id = current_setting('tests.w2')::uuid), 'pendiente|1',
  'la administradora lo reintenta');

-- ===================== Retirada y versión anterior de la función =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false, false);
reset role;
select tests.eq((select status::text || '|' || error_code from public.notifications where id = current_setting('tests.w2')::uuid), 'cancelado|preferencia',
  'el taller puede retirarlo (a petición del cliente) y lo pendiente no se envía');
select tests.eq((select source from public.communication_consent_log where customer_id = 'c1000000-0000-0000-0000-00000000000a' and channel = 'whatsapp' and not granted),
  'panel', 'y queda registrado quién lo retiró');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false, true);
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', false, false);
reset role;
select tests.eq((select operational_email::text || '|' || operational_whatsapp from public.customer_contact_preferences where customer_id = 'c1000000-0000-0000-0000-00000000000a'),
  'false|true', 'la versión de solo email conserva lo elegido para WhatsApp');

-- Vuelta atrás: el WhatsApp pendiente que ya no es cierto se cancela.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid;
update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o1')::uuid;
reset role;
select tests.eq((select error_code from public.notifications where order_id = current_setting('tests.o1')::uuid and channel = 'whatsapp' and event = 'entregado'),
  'estado_corregido', 'tras una corrección, el WhatsApp pendiente se cancela');

-- ===================== Aislamiento =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.notifications where channel = 'whatsapp'), 0::bigint, 'otro taller no ve estos WhatsApp');
select tests.throws($$select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000a', true, false, false)$$,
  'ni cambia preferencias de clientes ajenos', '%permiso%');
reset role;

-- ===================== Supresión (RGPD) =====================
select private.anonymize_customer('c1000000-0000-0000-0000-00000000000a');
select tests.eq((select count(*) from public.notifications where customer_id = 'c1000000-0000-0000-0000-00000000000a' and channel = 'whatsapp' and recipient <> '00000000'),
  0::bigint, 'al suprimir al cliente no queda su móvil en los avisos');

rollback;
