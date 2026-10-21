-- Facturación y cobros, recordatorios automáticos y estadísticas.
begin;
\ir _harness/fixtures.sql

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recepcion@alcarria.test', now(), '{"full_name":"Rita Recepción"}');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'recepcionista');

-- Orden con líneas (como recepción).
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, estimated_minutes, assigned_to)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Cambio de aceite', 60,
          '00000000-0000-0000-0000-0000000000a2')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate) values
  ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 1, 'pieza', 'Aceite 5W30', 4, 1250, 21),
  ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.o1')::uuid, 2, 'mano_obra', 'Cambio de aceite', 0.5, 4000, 21);
select set_config('tests.f1', public.create_invoice_draft(current_setting('tests.o1')::uuid)::text, true);
select tests.eq((select count(*) from public.invoice_items where invoice_id = current_setting('tests.f1')::uuid), 2::bigint, 'el borrador copia las líneas de la orden');
select tests.throws($$select public.issue_invoice(current_setting('tests.f1')::uuid)$$, 'sin NIF del taller no se emite', '%NIF del taller%');
reset role;
update public.workshops set legal_name = 'Taller Alcarria S.L.', tax_id = 'B12345678' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.customers set tax_id = '12345678Z', address_line = 'Calle Mayor 1', postal_code = '19001', city = 'Guadalajara' where id = 'c1000000-0000-0000-0000-00000000000a';

select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.throws($$update public.invoices set total_cents = 1 where id = current_setting('tests.f1')::uuid$$, 'los importes no se escriben a mano', '%permission denied%');
select tests.eq(public.issue_invoice(current_setting('tests.f1')::uuid), 'F' || extract(year from current_date) || '-0001', 'primera factura de la serie: F<año>-0001');
select tests.eq((select total_cents::text || '|' || tax_cents || '|' || (recipient ->> 'tax_id') || '|' || (issuer ->> 'tax_id') from public.invoices where id = current_setting('tests.f1')::uuid),
  '8470|1470|12345678Z|B12345678', 'importes calculados (5000 + 2000 + 21 %) y datos fijados al emitir');
select tests.throws($$update public.invoices set notes = 'x' where id = current_setting('tests.f1')::uuid$$, 'una factura emitida no se modifica', '%rectificativa%');
select tests.throws($$delete from public.invoice_items where invoice_id = current_setting('tests.f1')::uuid$$, 'ni sus líneas', '%rectificativa%');
select tests.eq(tests.affected($$delete from public.invoices where id = current_setting('tests.f1')::uuid$$), 0::bigint, 'ni se borra');
-- Cambiar la ficha después no cambia la factura.
update public.customers set full_name = 'Nombre Cambiado' where id = 'c1000000-0000-0000-0000-00000000000a';
select tests.eq((select recipient ->> 'name' from public.invoices where id = current_setting('tests.f1')::uuid), 'Cliente Uno (A)', 'el destinatario quedó fijado');
-- Segunda factura: correlativa.
select set_config('tests.f2', public.create_invoice_draft(null, null, 'c2000000-0000-0000-0000-00000000000a')::text, true);
insert into public.invoice_items (workshop_id, invoice_id, kind, description, quantity, unit_price_cents, tax_rate)
values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f2')::uuid, 'otro', 'Diagnosis', 1, 3000, 21);
select tests.throws($$insert into public.invoice_items (workshop_id, invoice_id, kind, description, quantity, unit_price_cents, tax_rate) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f2')::uuid, 'otro', 'Abono', -1, 100, 21)$$,
  'una factura ordinaria no lleva cantidades negativas', '%rectificativa%');
select tests.eq(public.issue_invoice(current_setting('tests.f2')::uuid), 'F' || extract(year from current_date) || '-0002', 'numeración correlativa sin huecos');

-- Cobros.
insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f1')::uuid, 5000, 'tarjeta');
select tests.eq((select payment_status || '|' || pending_cents from public.invoice_balances('aaaaaaaa-0000-0000-0000-000000000000') where invoice_id = current_setting('tests.f1')::uuid),
  'parcial|3470', 'cobro parcial: queda pendiente el resto');
select tests.throws($$insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f1')::uuid, 5000, 'efectivo')$$,
  'no se cobra más de lo pendiente', '%supera%');
select tests.throws($$insert into public.payments (workshop_id, invoice_id, amount_cents, method, paid_on) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f1')::uuid, 100, 'efectivo', current_date + 3)$$,
  'ni con fecha futura', '%futura%');
insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f1')::uuid, 3470, 'efectivo');
select tests.eq((select payment_status from public.invoice_balances('aaaaaaaa-0000-0000-0000-000000000000') where invoice_id = current_setting('tests.f1')::uuid),
  'cobrada', 'cobrada del todo');
select tests.throws($$delete from public.payments where invoice_id = current_setting('tests.f1')::uuid$$, 'un cobro no se borra', '%permission denied%');
select tests.throws($$select public.void_payment((select id from public.payments where amount_cents = 3470), 'Error de caja')$$,
  'recepción no anula cobros', '%propietario o un administrador%');
select tests.throws($$select public.create_rectifying_invoice(current_setting('tests.f1')::uuid, 'Precio equivocado')$$,
  'ni hace rectificativas', '%propietario o un administrador%');
reset role;

-- Rectificativa y anulación de cobro (propietaria).
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.void_payment((select id from public.payments where amount_cents = 3470), 'Se registró dos veces');
select tests.eq((select payment_status from public.invoice_balances('aaaaaaaa-0000-0000-0000-000000000000') where invoice_id = current_setting('tests.f1')::uuid),
  'parcial', 'el cobro anulado deja de contar (y queda registrado)');
select set_config('tests.r1', public.create_rectifying_invoice(current_setting('tests.f1')::uuid, 'Se facturó aceite de más')::text, true);
select tests.eq(public.issue_invoice(current_setting('tests.r1')::uuid), 'R' || extract(year from current_date) || '-0001', 'la rectificativa lleva su propia serie');
select tests.eq((select total_cents from public.invoices where id = current_setting('tests.r1')::uuid), -8470::bigint, 'y anula en negativo lo facturado');
reset role;

-- Registro encadenado e inmutable.
select tests.eq((select count(*) from public.invoice_records where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 3::bigint, 'cada emisión deja su registro');
select tests.ok((select bool_and(r.hash = encode(sha256(convert_to(coalesce(r.prev_hash, '') || r.payload::text, 'UTF8')), 'hex'))
                   and count(*) filter (where prev_hash is null) = 1
                   from public.invoice_records r where r.workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'cada huella encadena con la anterior');
select tests.throws($$update public.invoice_records set hash = repeat('0', 64)$$, 'el registro no se modifica (ni con permisos de sistema)', '%no se modifica%');
select tests.throws($$delete from public.invoices where id = current_setting('tests.f1')::uuid$$, 'una factura emitida no se borra ni con permisos de sistema', '%no se borra%');

-- Aislamiento: otro taller, el mecánico y el portal.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.invoices), 0::bigint, 'otro taller no ve facturas de A');
select tests.eq((select count(*) from public.payments), 0::bigint, 'ni sus cobros');
select tests.throws($$select public.issue_invoice(current_setting('tests.f2')::uuid)$$, 'ni las emite', '%no encontrada%');
select tests.throws($$insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('aaaaaaaa-0000-0000-0000-000000000000', current_setting('tests.f2')::uuid, 100, 'efectivo')$$,
  'ni registra cobros', '%row-level security%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.invoices), 0::bigint, 'el mecánico no ve facturas');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select string_agg(full_number, ',' order by full_number) from public.portal_invoices()),
  'F' || extract(year from current_date) || '-0001,R' || extract(year from current_date) || '-0001', 'el cliente ve sus facturas emitidas');
select tests.eq((public.portal_invoice(current_setting('tests.f1')::uuid) ->> 'paid_cents'), '5000', 'y lo que ha pagado');
select tests.eq(public.portal_invoice(current_setting('tests.f2')::uuid), null::jsonb, 'nunca la factura de otro cliente');
reset role;

-- ===================== Recordatorios =====================
update public.reminder_settings set revision_enabled = true, pickup_enabled = true, quote_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.workshop_notification_settings set email_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
update public.customers set email = 'cliente1@correo.test' where id = 'c1000000-0000-0000-0000-00000000000a';
update public.vehicles set next_service_date = current_date + 7 where id = '7e000001-0000-0000-0000-00000000000a';
select private.generate_reminders();
select tests.eq((select status::text from public.reminders where kind = 'revision' and vehicle_id = '7e000001-0000-0000-0000-00000000000a'), 'sin_canal',
  'sin el permiso del cliente, el recordatorio de revisión no sale por ningún canal');
-- El propio cliente lo pide; el taller no puede pedirlo por él.
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.set_service_reminders('c1000000-0000-0000-0000-00000000000a', true)$$, 'el taller no activa recordatorios por el cliente', '%propio cliente%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.set_service_reminders('c1000000-0000-0000-0000-00000000000a', true);
select tests.eq((select enabled from public.portal_service_reminders() where customer_id = 'c1000000-0000-0000-0000-00000000000a'), true, 'el cliente los activa desde su portal');
reset role;
update public.vehicles set next_service_date = current_date + 8 where id = '7e000001-0000-0000-0000-00000000000a';
select private.generate_reminders();
select tests.eq((select string_agg(channel::text, ',' order by channel) from public.notifications where event::text = 'recordatorio_revision' and customer_id = 'c1000000-0000-0000-0000-00000000000a'),
  'app,email', 'con permiso: aviso en el portal y por email (pendiente hasta que haya proveedor)');
select private.generate_reminders();
select tests.eq((select count(*) from public.notifications where event::text = 'recordatorio_revision' and customer_id = 'c1000000-0000-0000-0000-00000000000a'), 2::bigint,
  'sin duplicados al repetir el proceso');
-- Recogida pendiente y trabajo retrasado.
update public.repair_orders set status = 'listo', due_at = now() - interval '1 day' where id = current_setting('tests.o1')::uuid;
-- Simulamos que lleva 5 días listo (sin disparadores: es solo el paso del tiempo).
set local session_replication_role = replica;
update public.repair_orders set status_changed_at = now() - interval '5 days' where id = current_setting('tests.o1')::uuid;
set local session_replication_role = origin;
select private.generate_reminders();
select tests.eq((select count(*) from public.reminders where kind = 'recogida_pendiente' and order_id = current_setting('tests.o1')::uuid), 1::bigint, 'recordatorio de recogida');
select tests.eq((select count(*) from public.notifications where event::text = 'recordatorio_recogida'), 2::bigint, 'que avisa al cliente por sus canales');
select tests.eq((select status::text from public.reminders where kind = 'trabajo_retrasado' and order_id = current_setting('tests.o1')::uuid), 'pendiente',
  'el retraso queda como aviso interno');
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and title like '%fecha prevista%'), 0::bigint,
  'y nunca se avisa al cliente del retraso interno');
update public.repair_orders set due_at = now() + interval '2 days' where id = current_setting('tests.o1')::uuid;
select private.generate_reminders();
select tests.eq((select status::text from public.reminders where kind = 'trabajo_retrasado' and order_id = current_setting('tests.o1')::uuid), 'descartado',
  'al replanificar, el aviso de retraso se cierra solo');
select tests.ok((public.run_maintenance() ? 'recordatorios_nuevos'), 'el mantenimiento programado genera recordatorios');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.reminders), 0::bigint, 'otro taller no ve recordatorios de A');
reset role;

-- ===================== Estadísticas =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('tests.st', public.workshop_stats('aaaaaaaa-0000-0000-0000-000000000000', current_date - 30, current_date)::text, true);
reset role;
select tests.eq((current_setting('tests.st')::jsonb #>> '{facturacion,emitidas}'), '3', 'facturas emitidas en el periodo');
select tests.eq((current_setting('tests.st')::jsonb #>> '{facturacion,importe_emitido_cents}'), '3630', '8470 + 3630 − 8470');
select tests.eq((current_setting('tests.st')::jsonb #>> '{facturacion,cobrado_cents}'), '5000', 'cobrado: solo cobros no anulados');
select tests.eq((current_setting('tests.st')::jsonb #>> '{ordenes,listas_para_recoger}'), '1', 'vehículos pendientes de recogida');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((public.workshop_stats('aaaaaaaa-0000-0000-0000-000000000000', current_date - 30, current_date) #>> '{facturacion,emitidas}'), '0',
  'otro taller obtiene ceros: no ve los datos de A');
reset role;

rollback;
