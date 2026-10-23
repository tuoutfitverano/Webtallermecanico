-- El mecánico se queda órdenes libres y las da por terminadas; solo el propietario
-- o un administrador las confirma («Listo para recoger») o las devuelve.
begin;
\ir _harness/fixtures.sql

-- a1 propietaria · a2 mecánico · a3 administradora · a4 recepción · a5 otro mecánico (todos de A) · b1 propietario de B
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recepcion@alcarria.test', now(), '{"full_name":"Rita Recepción"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'mecanico2@alcarria.test', now(), '{"full_name":"Lola Mecánica"}');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'recepcionista'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a5', 'mecanico');

-- Recepción crea dos órdenes sin asignar y una asignada a a5.
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, priority)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Ruido al frenar', 'urgente')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Cambio de aceite')
  returning id)
select set_config('tests.o2', (select id::text from x), true);
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, assigned_to)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Luces', '00000000-0000-0000-0000-0000000000a5')
  returning id)
select set_config('tests.o3', (select id::text from x), true);
select tests.throws($$insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Atajo', 'listo')$$,
  'recepción no crea una orden ya «Listo para recoger»', '%propietario o un administrador%');
select tests.throws($$update public.repair_orders set review_requested_at = now() where id = current_setting('tests.o1')::uuid$$,
  'nadie marca «pendiente de revisión» escribiendo la columna', '%permission denied%');
reset role;

-- ===================== Mecánico: órdenes libres =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.repair_orders where id = current_setting('tests.o1')::uuid), 0::bigint,
  'antes de quedársela, el mecánico no lee la orden completa');
select tests.eq((select string_agg(problem_description, ',') from public.unassigned_repair_orders('aaaaaaaa-0000-0000-0000-000000000000')),
  'Ruido al frenar,Cambio de aceite', 've las órdenes libres (lo urgente primero), no la de su compañera');
select tests.eq((select count(*) from public.unassigned_repair_orders('bbbbbbbb-0000-0000-0000-000000000000')), 0::bigint,
  'ni las de otro taller');
select tests.throws($$select public.claim_repair_order(current_setting('tests.o3')::uuid)$$,
  'no se queda la orden de una compañera', '%Otra persona ya se ha quedado%');
select tests.eq(tests.affected($$update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a2' where id = current_setting('tests.o2')::uuid$$),
  0::bigint, 'ni se asigna una libre escribiendo directamente');
select public.claim_repair_order(current_setting('tests.o1')::uuid);
select tests.eq((select assigned_to from public.repair_orders where id = current_setting('tests.o1')::uuid), '00000000-0000-0000-0000-0000000000a2'::uuid,
  '«Me la quedo»: ahora es suya');
select public.claim_repair_order(current_setting('tests.o1')::uuid);
select tests.ok(true, 'quedársela dos veces no da error');
select tests.eq((select to_assignee from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'asignacion'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'el historial guarda quién se la quedó');
select tests.eq((select actor from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'asignacion'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, '(y que lo hizo él mismo)');

-- ===================== Mecánico: dar por terminada =====================
select tests.throws($$update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid$$,
  'el mecánico ya no pone «Listo para recoger»', '%propietario o un administrador%');
select tests.eq(tests.affected($$update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o1')::uuid$$), 1::bigint,
  'sí cambia los demás estados');
select public.start_work(current_setting('tests.o1')::uuid);
select public.mark_order_done(current_setting('tests.o1')::uuid);
select tests.ok((select review_requested_at is not null and review_requested_by = '00000000-0000-0000-0000-0000000000a2'
  from public.repair_orders where id = current_setting('tests.o1')::uuid), 'queda pendiente de revisión, con quién y cuándo');
select tests.eq((select status::text from public.repair_orders where id = current_setting('tests.o1')::uuid), 'en_reparacion',
  'el estado no cambia (el cliente no ve nada todavía)');
select tests.eq((select count(*) from public.repair_order_work_logs where order_id = current_setting('tests.o1')::uuid and ended_at is null), 0::bigint,
  'su tiempo en marcha se para');
select tests.throws($$select public.mark_order_done(current_setting('tests.o1')::uuid)$$, 'no se da por terminada dos veces', '%pendiente de revisión%');
select tests.throws($$select public.review_repair_order(current_setting('tests.o1')::uuid, true)$$,
  'el mecánico no se confirma a sí mismo', '%propietario o un administrador%');
reset role;
select tests.eq((select count(*) from public.notifications where order_id = current_setting('tests.o1')::uuid and event::text = 'listo'), 0::bigint,
  'darla por terminada no avisa al cliente');

-- Otra mecánica no da por terminada una orden que no es suya.
select tests.login('00000000-0000-0000-0000-0000000000a5');
set local role authenticated;
select tests.throws($$select public.mark_order_done(current_setting('tests.o1')::uuid)$$, 'nadie más la da por terminada', '%Solo quien tiene asignada%');
reset role;

-- ===================== Recepción: no confirma, entrega solo lo confirmado =====================
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.throws($$select public.review_repair_order(current_setting('tests.o1')::uuid, true)$$,
  'recepción no confirma trabajos', '%propietario o un administrador%');
select tests.throws($$update public.repair_orders set status = 'listo' where id = current_setting('tests.o1')::uuid$$,
  'ni pone «Listo para recoger» directamente', '%propietario o un administrador%');
select tests.throws($$update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid$$,
  'ni entrega lo que no está confirmado', '%confirmar antes%');
reset role;

-- ===================== Administradora: devolver y confirmar =====================
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.throws($$select public.review_repair_order(current_setting('tests.o1')::uuid, false, '  ')$$,
  'devolver exige un motivo', '%motivo%');
select public.review_repair_order(current_setting('tests.o1')::uuid, false, 'Falta apretar las pinzas');
select tests.eq((select coalesce(review_requested_at::text, '-') || '|' || review_note from public.repair_orders where id = current_setting('tests.o1')::uuid),
  '-|Falta apretar las pinzas', 'devuelta: vuelve al mecánico con el motivo');
select tests.eq((select note from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind::text = 'devuelta'),
  'Falta apretar las pinzas', 'el historial guarda el motivo');
select tests.throws($$select public.review_repair_order(current_setting('tests.o1')::uuid, true)$$,
  'lo devuelto no se confirma sin que el mecánico lo vuelva a terminar', '%no está pendiente%');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select review_note from public.repair_orders where id = current_setting('tests.o1')::uuid), 'Falta apretar las pinzas',
  'el mecánico ve el motivo');
select public.mark_order_done(current_setting('tests.o1')::uuid);
select tests.eq((select count(*) from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind::text = 'terminada'), 2::bigint,
  'el historial guarda las dos veces que la dio por terminada');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select public.review_repair_order(current_setting('tests.o1')::uuid, true);
select tests.eq((select status::text || '|' || coalesce(review_requested_at::text, '-') || '|' || coalesce(review_note, '-')
  from public.repair_orders where id = current_setting('tests.o1')::uuid), 'listo|-|-', 'confirmada: «Listo para recoger» y nada pendiente');
select tests.eq((select actor from public.repair_order_events where order_id = current_setting('tests.o1')::uuid and kind = 'estado' and to_status = 'listo'),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'el historial dice quién la confirmó');
reset role;
select tests.ok((select count(*) > 0 from public.notifications where order_id = current_setting('tests.o1')::uuid and event::text = 'listo'),
  'al confirmar, el cliente recibe el aviso de siempre');

select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.eq(tests.affected($$update public.repair_orders set status = 'entregado' where id = current_setting('tests.o1')::uuid$$), 1::bigint,
  'recepción entrega lo que ya está confirmado');
reset role;

-- ===================== El cliente no ve la revisión =====================
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select string_agg(kind::text, ',') from public.portal_order_timeline(current_setting('tests.o1')::uuid)), 'creada,estado,estado,estado',
  'en el portal no aparecen «terminada» ni «devuelta»');
reset role;

-- ===================== La propietaria pone «Listo» sin revisión; reasignar quita lo pendiente =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq(tests.affected($$update public.repair_orders set status = 'listo' where id = current_setting('tests.o3')::uuid$$), 1::bigint,
  'la propietaria puede poner «Listo para recoger» directamente');
select tests.eq(tests.affected($$update public.repair_orders set status = 'en_reparacion' where id = current_setting('tests.o3')::uuid$$), 1::bigint,
  '(y volver atrás)');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a5');
set local role authenticated;
select public.mark_order_done(current_setting('tests.o3')::uuid);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
update public.repair_orders set assigned_to = '00000000-0000-0000-0000-0000000000a2' where id = current_setting('tests.o3')::uuid;
reset role;
select tests.eq((select review_requested_at from public.repair_orders where id = current_setting('tests.o3')::uuid), null::timestamptz,
  'si la oficina cambia la orden de persona, deja de estar pendiente de revisión');

-- ===================== Otro taller y sin sesión =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select public.claim_repair_order(current_setting('tests.o2')::uuid)$$, 'otro taller no se queda órdenes de A', '%Orden no encontrada%');
select tests.throws($$select public.review_repair_order(current_setting('tests.o3')::uuid, true)$$, 'ni las revisa', '%propietario o un administrador%');
reset role;
select tests.logout();
set local role anon;
select tests.throws($$select * from public.unassigned_repair_orders('aaaaaaaa-0000-0000-0000-000000000000')$$, 'sin sesión, nada', '%permission denied%');
reset role;

rollback;
