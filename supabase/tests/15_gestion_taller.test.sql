-- Gestión del taller: rol de recepción, planificación, líneas y tiempos de la orden, presupuestos.
begin;
\ir _harness/fixtures.sql

-- a1 propietaria de A · a2 mecánico de A · a3 administradora de A · b1 propietario de B · c1/c2 clientes con portal
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recepcion@alcarria.test', now(), '{"full_name":"Rita Recepción"}');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'recepcionista');

-- ===================== Recepción =====================
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.eq((select count(*) from public.customers where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000') > 0, true, 'recepción ve los clientes de su taller');
select tests.eq((select count(*) from public.customers where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000'), 0::bigint, 'y ninguno de otro taller');
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, assigned_to, priority, scheduled_on, mileage_in)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a',
          'Ruido al frenar', '00000000-0000-0000-0000-0000000000a2', 'alta', current_date, 120500)
  returning id)
select set_config('tests.o1', (select id::text from x), true);
select tests.ok(current_setting('tests.o1') <> '', 'recepción crea órdenes, asigna mecánico y planifica');
select tests.throws($$select * from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'nuevo@correo.test', 'mecanico')$$,
  'recepción no invita al equipo', '%permiso%');
select tests.throws($$select public.set_member_active('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', false)$$,
  'recepción no desactiva a nadie (antes bastaba con no ser mecánico)', '%permiso%');
select tests.eq(tests.affected($$update public.workshop_notification_settings set email_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 0::bigint,
  'recepción no cambia los ajustes de avisos');
select tests.eq(tests.affected($$update public.workshop_billing_settings set default_tax_rate = 10 where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 0::bigint,
  'ni los ajustes económicos');
reset role;
select tests.eq((select mileage from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'), 120500, 'los km de la orden pasan al vehículo');

-- La administradora puede invitar recepcionistas; la propietaria también.
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.ok((select count(*) from public.create_workshop_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'recep2@correo.test', 'recepcionista')) = 1,
  'la administradora invita a una recepcionista');
reset role;

-- ===================== Planificación =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$update public.repair_orders set priority = 'urgente' where id = current_setting('tests.o1')::uuid$$,
  'el mecánico no cambia la prioridad', '%planifica%');
select tests.throws($$update public.repair_orders set due_at = now() + interval '1 day' where id = current_setting('tests.o1')::uuid$$,
  'ni la fecha prevista', '%planifica%');
update public.repair_orders set mileage_in = 120600 where id = current_setting('tests.o1')::uuid;
-- Líneas de trabajo: el mecánico asignado las añade.
insert into public.repair_order_items (workshop_id, order_id, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 'pieza', 'Pastillas delanteras', 1, 4500, 21);
select tests.eq((select count(*) from public.repair_order_items where order_id = current_setting('tests.o1')::uuid), 1::bigint, 'el mecánico asignado añade piezas');
-- Tiempo real.
select public.start_work(current_setting('tests.o1')::uuid);
select tests.eq((select count(*) from public.repair_order_work_logs where order_id = current_setting('tests.o1')::uuid and ended_at is null), 1::bigint,
  'empezar abre un tramo con la hora del servidor');
select public.stop_work(current_setting('tests.o1')::uuid);
select tests.eq((select count(*) from public.repair_order_work_logs where order_id = current_setting('tests.o1')::uuid and ended_at is not null), 1::bigint,
  'parar lo cierra');
select tests.throws($$select public.stop_work(current_setting('tests.o1')::uuid)$$, 'no se para lo que no está en marcha', '%en marcha%');
select tests.throws($$insert into public.repair_order_work_logs (workshop_id, order_id, user_id, started_at) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, '00000000-0000-0000-0000-0000000000a2', now() - interval '8 hours')$$,
  'nadie se inventa horas escribiendo en la tabla', '%permission denied%');
reset role;
select tests.eq((select mileage from public.vehicles where id = '7e000001-0000-0000-0000-00000000000a'), 120600, 'km actualizados');

-- Otro taller no ve ni toca líneas ni tiempos de A.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.repair_order_items), 0::bigint, 'B no ve líneas de A');
select tests.eq((select count(*) from public.repair_order_work_logs), 0::bigint, 'B no ve tiempos de A');
select tests.throws($$insert into public.repair_order_items (workshop_id, order_id, kind, description, quantity, unit_price_cents, tax_rate) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 'otro', 'x', 1, 1, 21)$$,
  'B no añade líneas a una orden de A', '%row-level security%');
select tests.throws($$select public.start_work(current_setting('tests.o1')::uuid)$$, 'B no registra tiempo en A', '%No puedes%');
reset role;

-- ===================== Importes (misma regla que packages/core) =====================
select tests.eq(private.lines_totals('[{"quantity":1,"unit_price_cents":1001,"discount_pct":0,"tax_rate":21},{"quantity":1,"unit_price_cents":1001,"discount_pct":0,"tax_rate":21},{"quantity":2,"unit_price_cents":1550,"discount_pct":0,"tax_rate":10},{"quantity":1,"unit_price_cents":500,"discount_pct":0,"tax_rate":0}]') ->> 'total_cents',
  '6332', 'mismo total que money.test.ts (IVA por tipo, redondeo al céntimo)');
select tests.eq(private.line_base_cents(3, 333, 10), 899::bigint, 'base de línea con descuento');
select tests.eq(private.line_base_cents(1, 1, 50), 1::bigint, 'la mitad del céntimo redondea hacia arriba');

-- ===================== Presupuestos =====================
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
with x as (
  insert into public.quotes (workshop_id, customer_id, vehicle_id, order_id, title)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', '7e000001-0000-0000-0000-00000000000a',
          current_setting('tests.o1')::uuid, 'Frenos delanteros')
  returning id)
select set_config('tests.q1', (select id::text from x), true);
select tests.eq((select number from public.quotes where id = current_setting('tests.q1')::uuid), 1, 'numeración P-1 de la base de datos');
select tests.throws($$insert into public.quotes (workshop_id, customer_id, number) values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 999)$$,
  'el número no se elige', '%permission denied%');
select tests.throws($$insert into public.quotes (workshop_id, customer_id, vehicle_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a', '7e000001-0000-0000-0000-00000000000a')$$,
  'el vehículo tiene que ser del cliente', '%no es de este cliente%');
insert into public.quote_items (workshop_id, quote_id, position, kind, description, quantity, unit_price_cents, discount_pct, tax_rate) values
  ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.q1')::uuid, 1, 'pieza', 'Discos', 2, 5000, 10, 21),
  ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.q1')::uuid, 2, 'mano_obra', 'Montaje', 1.5, 4000, 0, 21);
select tests.eq((public.quote_totals(current_setting('tests.q1')::uuid) ->> 'total_cents'), '18150', 'importes: (9000 + 6000) + 21 % = 181,50 €');
select tests.throws($$update public.quotes set status = 'aceptado' where id = current_setting('tests.q1')::uuid$$,
  'el estado no se cambia escribiendo en la tabla', '%permission denied%');
select set_config('tests.tok', (select token from public.send_quote(current_setting('tests.q1')::uuid)), true);
select tests.eq((select status::text || '|' || total_cents from public.quotes where id = current_setting('tests.q1')::uuid), 'enviado|18150',
  'al enviar quedan fijados estado e importes');
select tests.ok(length(current_setting('tests.tok')) = 64, 'el enlace es un código aleatorio largo');
select tests.throws($$update public.quotes set title = 'Cambiado' where id = current_setting('tests.q1')::uuid$$,
  'un presupuesto enviado no se modifica', '%versión nueva%');
select tests.throws($$insert into public.quote_items (workshop_id, quote_id, kind, description, quantity, unit_price_cents, tax_rate) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.q1')::uuid, 'otro', 'Extra', 1, 100, 21)$$,
  'ni se le añaden líneas', '%versión nueva%');
select tests.throws($$select token_hash from public.quotes$$, 'la huella del enlace no se puede leer', '%permission denied%');
reset role;
select tests.eq((select token_hash from public.quotes where id = current_setting('tests.q1')::uuid),
  encode(sha256(convert_to(current_setting('tests.tok'), 'UTF8')), 'hex'), 'solo se guarda la huella del código');
select tests.eq((select count(*) from public.notifications where customer_id = 'c1000000-0000-0000-0000-00000000000a' and event::text = 'presupuesto_enviado' and channel = 'app'), 1::bigint,
  'el cliente recibe el aviso en su portal');

-- El mecánico y otro taller no ven presupuestos.
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.quotes), 0::bigint, 'el mecánico no ve presupuestos');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.quotes), 0::bigint, 'otro taller no ve presupuestos de A');
select tests.throws($$select public.revise_quote(current_setting('tests.q1')::uuid)$$, 'ni crea versiones', '%no encontrado%');
reset role;

-- Enlace público: lo usa solo el servidor.
set local role anon;
select tests.throws($$select public.quote_by_token(current_setting('tests.tok'))$$, 'el navegador no llama al enlace directamente', '%permission denied%');
reset role;
set local role service_role;
select tests.eq((public.quote_by_token(current_setting('tests.tok')) ->> 'total_cents'), '18150', 'el enlace muestra el presupuesto');
select tests.ok((public.quote_by_token(current_setting('tests.tok')) ->> 'plate_hint') = right('1950BXF', 3)
  and public.quote_by_token(current_setting('tests.tok')) ? 'customer' = false, 'sin datos del cliente y solo 3 cifras de la matrícula');
select tests.eq(public.quote_by_token(repeat('0', 64)), null::jsonb, 'un código inventado no muestra nada');
select tests.throws($$select public.respond_quote_by_token(current_setting('tests.tok'), true, '', null, null)$$, 'hay que escribir un nombre', '%nombre%');
select tests.eq(public.respond_quote_by_token(current_setting('tests.tok'), true, 'Cliente Uno', 'Adelante', 'abcdef0123456789')::text, 'aceptado', 'el cliente acepta por enlace');
select tests.throws($$select public.respond_quote_by_token(current_setting('tests.tok'), false, 'Otra persona', null, null)$$,
  'el enlace sirve una sola vez', '%caducado%');
reset role;
select tests.ok((select response_snapshot ->> 'total_cents' = '18150' and snapshot_hash = encode(sha256(convert_to(response_snapshot::text, 'UTF8')), 'hex')
                   and response_source = 'enlace' from public.quotes where id = current_setting('tests.q1')::uuid),
  'queda la instantánea de lo aceptado y su huella');
select tests.eq((select approved_quote_id::text from public.repair_orders where id = current_setting('tests.o1')::uuid), current_setting('tests.q1'),
  'la orden queda aprobada');
select tests.eq((select count(*) from public.repair_order_items where order_id = current_setting('tests.o1')::uuid and source_quote_id = current_setting('tests.q1')::uuid), 2::bigint,
  'y las líneas aceptadas pasan al trabajo de la orden');

-- Versiones y respuesta desde el portal.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (insert into public.quotes (workshop_id, customer_id, title) values ('aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a', 'Revisión') returning id)
select set_config('tests.q2', (select id::text from x), true);
insert into public.quote_items (workshop_id, quote_id, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.q2')::uuid, 'mano_obra', 'Revisión anual', 1, 9000, 21);
update public.quotes set valid_until = current_date - 1 where id = current_setting('tests.q2')::uuid;
select tests.throws($$select public.send_quote(current_setting('tests.q2')::uuid)$$, 'la validez no puede haber pasado ya', '%anterior a hoy%');
update public.quotes set valid_until = null where id = current_setting('tests.q2')::uuid;
select public.send_quote(current_setting('tests.q2')::uuid);
select set_config('tests.q2b', public.revise_quote(current_setting('tests.q2')::uuid)::text, true);
select tests.eq((select string_agg(version || ':' || status, ',' order by version) from public.quotes where number = (select number from public.quotes where id = current_setting('tests.q2')::uuid) and workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  '1:sustituido,2:borrador', 'la versión nueva sustituye a la enviada');
select public.send_quote(current_setting('tests.q2b')::uuid);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq((select count(*) from public.portal_quotes()), 1::bigint, 'el cliente ve solo la versión vigente (no borradores ni sustituidas)');
select tests.eq((public.portal_quote(current_setting('tests.q2b')::uuid) ->> 'total_cents'), '10890', 'y su detalle');
select tests.eq((select link_path from public.portal_notifications() where event::text = 'presupuesto_enviado' order by created_at desc limit 1),
  '/portal/presupuestos/' || current_setting('tests.q2b'), 'el aviso del portal lleva a ese presupuesto');
select tests.eq(public.portal_quote(current_setting('tests.q1')::uuid), null::jsonb, 'nunca el presupuesto de otro cliente');
select tests.throws($$select public.respond_quote_portal(current_setting('tests.q1')::uuid, false)$$, 'ni responderlo', '%no encontrado%');
select tests.eq(public.respond_quote_portal(current_setting('tests.q2b')::uuid, false, 'Muy caro')::text, 'rechazado', 'rechaza desde su portal');
select tests.throws($$select public.respond_quote_portal(current_setting('tests.q2b')::uuid, true)$$, 'y ya no cambia de opinión por su cuenta', '%ya no admite%');
reset role;

-- Caducidad (simulamos el paso del tiempo como sistema).
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (insert into public.quotes (workshop_id, customer_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a') returning id)
select set_config('tests.q3', (select id::text from x), true);
insert into public.quote_items (workshop_id, quote_id, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.q3')::uuid, 'otro', 'Diagnosis', 1, 3000, 21);
select set_config('tests.tok3', (select token from public.send_quote(current_setting('tests.q3')::uuid)), true);
reset role;
select set_config('app.quote_op', 'on', true);
update public.quotes set valid_until = current_date - 1, token_expires_at = now() + interval '1 hour' where id = current_setting('tests.q3')::uuid;
select set_config('app.quote_op', '', true);
set local role service_role;
select tests.eq(public.quote_by_token(current_setting('tests.tok3')), null::jsonb, 'un presupuesto caducado ya no se abre por enlace');
reset role;
select tests.eq((select status::text from public.quotes where id = current_setting('tests.q3')::uuid), 'caducado', 'y queda caducado');

-- Ajustes económicos: la propietaria sí los cambia.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq(tests.affected($$update public.workshop_billing_settings set default_tax_rate = 10 where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$), 1::bigint,
  'la propietaria cambia el IVA por defecto');
reset role;

rollback;
