-- Notificaciones en el móvil (Web Push): dispositivos de cada persona, cola por
-- aviso operativo, lo que ve el móvil y el envío solo desde el servidor.
begin;
\ir _harness/fixtures.sql

-- ===================== Activar en un dispositivo =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.throws($$select public.save_push_subscription('http://evil.example/push')$$, 'solo direcciones https del navegador', '%check%');
select tests.throws($$select public.save_push_subscription('https://evil.example/push')$$, 'ni https de un sitio ajeno: solo servicios de notificaciones', '%known_service%');
select tests.throws($$select public.save_push_subscription('https://fcm.googleapis.com.evil.example/x')$$, 'ni un dominio que lo imita', '%known_service%');
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc');
select tests.eq((select devices from public.my_push_status('https://fcm.googleapis.com/fcm/send/abc')), 1, 'el cliente ve su dispositivo');
select tests.eq((select this_device from public.my_push_status('https://fcm.googleapis.com/fcm/send/abc')), true, 'y sabe que es este');
select tests.throws($$select * from public.push_subscriptions$$, 'nadie lee la tabla', '%permission denied%');
select tests.throws($$select * from public.push_outbox$$, 'ni la cola', '%permission denied%');
select tests.throws($$select * from public.claim_push_deliveries(10)$$, 'el cliente no reserva envíos', '%permission denied%');
reset role;

-- Otra cuenta en el mismo dispositivo: pasa a la nueva.
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/abc');
select tests.eq((select this_device from public.my_push_status('https://fcm.googleapis.com/fcm/send/abc')), true, 'el mismo móvil con otra cuenta pasa a esa cuenta');
select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/abc');
select tests.eq((select devices from public.my_push_status(null)), 0, 'y la persona lo puede quitar');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/c1-' || n) from generate_series(1, 12) n;
select tests.eq((select devices from public.my_push_status(null)), 10, 'como mucho 10 dispositivos por persona');
reset role;

-- ===================== Cola =====================
select private.enqueue_notice('c1000000-0000-0000-0000-00000000000a', 'listo', 'Tu coche está listo', 'Puedes pasar a recogerlo.', '/portal/reparaciones', null, 'prueba-push-1');
select tests.eq((select count(*) from public.push_outbox where user_id = '00000000-0000-0000-0000-0000000000c1'), 1::bigint,
  'un aviso del portal para un cliente con dispositivo entra en la cola (una vez)');
select private.enqueue_notice('c2000000-0000-0000-0000-00000000000a', 'listo', 'Listo', 'Pasa a recogerlo.', null, null, 'prueba-push-2');
select tests.eq((select count(*) from public.push_outbox where user_id = '00000000-0000-0000-0000-0000000000c2'), 0::bigint,
  'sin dispositivos no entra nada');

-- Lo que ve el móvil: solo el último aviso de la propia persona.
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select title from public.portal_push_preview()), 'Tu coche está listo', 'el móvil enseña el último aviso del cliente');
select tests.eq((select link_path from public.portal_push_preview()), '/portal/reparaciones', 'y a dónde lleva');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select title from public.portal_push_preview()), 'Listo', 'cada persona ve solo lo suyo');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_push_preview()), 0::bigint, 'el taller no ve nada por aquí');
reset role;

-- ===================== Envío (servidor) =====================
set local role service_role;
create temp table lote on commit drop as select * from public.claim_push_deliveries(50);
reset role;
select tests.eq((select count(*) from lote), 10::bigint, 'el servidor reserva un envío por dispositivo');
select tests.eq((select attempts from public.push_outbox where user_id = '00000000-0000-0000-0000-0000000000c1'), 1::smallint, 'y cuenta el intento');
set local role service_role;
select tests.eq((select count(*) from public.claim_push_deliveries(50)), 0::bigint, 'lo reservado no se reserva otra vez enseguida');
select public.record_push_result((select outbox_id from lote limit 1), (select subscription_id from lote limit 1), 201);
select public.record_push_result((select outbox_id from lote limit 1), (select subscription_id from lote offset 1 limit 1), 410);
reset role;
select tests.ok((select sent_at is not null from public.push_outbox where user_id = '00000000-0000-0000-0000-0000000000c1'), 'un 201 lo da por enviado');
select tests.eq((select count(*) from public.push_subscriptions where id = (select subscription_id from lote offset 1 limit 1)), 0::bigint,
  'un 410 (el móvil ya no existe) quita el dispositivo');

-- Avisos comerciales: nunca al móvil (en el portal ni siquiera pueden existir).
select tests.throws($$insert into public.notifications (workshop_id, customer_id, channel, purpose, template, title, body, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'app', 'comercial', 'aviso_v1', 'Oferta', 'Oferta', 'entregado')$$,
  'lo comercial no llega al portal ni, por tanto, al móvil', '%consentimiento%');

rollback;
