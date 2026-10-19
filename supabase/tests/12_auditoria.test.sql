-- Fase 8: auditoría. Reglas generales del esquema (para que una migración futura
-- no abra un hueco sin darse cuenta) y correcciones de la auditoría.
begin;
\ir _harness/fixtures.sql

-- ===================== Reglas generales del esquema =====================
select tests.eq((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity), 0::bigint,
  'todas las tablas de public tienen RLS activado');
select tests.eq((select count(*) from information_schema.role_table_grants where grantee in ('anon', 'PUBLIC') and table_schema = 'public'), 0::bigint,
  'un visitante sin sesión (anon) no tiene permisos sobre ninguna tabla');
select tests.eq((select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 'get_public_site',
  'la única función pública para visitantes es get_public_site (web pública)');
select tests.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('public', p.oid, 'execute')), 0::bigint,
  'ninguna función nuestra se puede ejecutar por PUBLIC');
select tests.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.prosecdef
                   and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=""%', false)), 0::bigint,
  'todas las funciones security definer fijan search_path vacío');
select tests.eq((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.prosecdef and p.prosrc like '%is_privileged%'), 0::bigint,
  'ninguna función security definer usa is_privileged (daría permisos a todos)');
select tests.eq((select string_agg(table_name || ':' || privilege_type, ',' order by table_name) from information_schema.role_table_grants
                 where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
                   and table_name in ('notifications', 'repair_order_events', 'vehicle_lookups', 'communication_consent_log',
                                      'customer_contact_preferences', 'customer_invitations', 'workshop_invitations', 'platform_admins')), null,
  'nadie escribe directamente avisos, historial, consultas, consentimientos, invitaciones ni administradores');
select tests.eq((select count(*) from information_schema.columns col
                 where col.table_schema = 'public' and col.column_name = 'workshop_id'
                   and col.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
                   and not exists (
                     select 1 from pg_constraint k
                      where k.conrelid = format('public.%I', col.table_name)::regclass and k.contype in ('f', 'p')
                        and (select attname from pg_attribute where attrelid = k.conrelid and attnum = k.conkey[1]) = 'workshop_id'
                        and (k.contype = 'p' or k.confrelid = 'public.workshops'::regclass))), 0::bigint,
  'toda tabla con workshop_id apunta al taller (clave foránea o primaria)');
select tests.eq((select count(*) from pg_policies where schemaname = 'public' and 'anon' = any (roles)), 0::bigint,
  'ninguna política RLS da acceso a anon');

select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select client_hash from public.web_requests$$, 'el personal no lee la huella antispam de las solicitudes', '%permission denied%');
select tests.eq((select count(*) from public.web_requests where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1::bigint, 'pero sí las solicitudes de su taller');
reset role;

-- ===================== Destinatario correcto (avisos «listo para recoger») =====================
update public.customers set email = 'cliente1@correo.test' where id = 'c1000000-0000-0000-0000-00000000000a';
update public.customers set email = 'cliente2@correo.test' where id = 'c2000000-0000-0000-0000-00000000000a';
update public.workshop_notification_settings set email_enabled = true where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Frenos', 'listo')
  returning id)
select set_config('tests.o1', (select id::text from x), true);
-- Se asignó por error al cliente 1: se corrige al cliente 2 antes de que salga el email.
update public.repair_orders set customer_id = 'c2000000-0000-0000-0000-00000000000a', vehicle_id = '7e000002-0000-0000-0000-00000000000a'
 where id = current_setting('tests.o1')::uuid;
-- Y otro cliente cambia su correo con un email en cola.
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, status)
  values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Aceite', 'listo')
  returning id)
select set_config('tests.o2', (select id::text from x), true);
update public.customers set email = 'nuevo2@correo.test' where id = 'c2000000-0000-0000-0000-00000000000a';
reset role;
set local role service_role;
select tests.eq((select count(*) from public.claim_email_notifications(50)), 0::bigint, 'no se reclama ningún email con destinatario desactualizado');
reset role;
select tests.eq((select status::text || ':' || error_code || ':' || recipient from public.notifications
                 where order_id = current_setting('tests.o1')::uuid and channel = 'email'),
  'cancelado:destinatario_cambiado:cliente1@correo.test', 'si la orden cambia de cliente, el email al cliente anterior se cancela');
select tests.eq((select status::text || ':' || error_code from public.notifications where order_id = current_setting('tests.o2')::uuid and channel = 'email'),
  'cancelado:destinatario_cambiado', 'si el cliente cambia de correo, no se envía a la dirección antigua');

-- ===================== Datos de auditoría y consentimiento antiguo =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
insert into public.customers (id, workshop_id, full_name, created_by, created_at, marketing_consent)
values ('c9000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente Auditoría',
        '00000000-0000-0000-0000-0000000000a1', '2000-01-01', true);
update public.customers set created_by = '00000000-0000-0000-0000-0000000000a1', created_at = '2000-01-01', marketing_consent = true,
       privacy_consent_at = now()
 where id = 'c9000000-0000-0000-0000-00000000000a';
insert into public.vehicles (id, workshop_id, plate, make, model, created_by, created_at)
values ('7e000009-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '9090BCD', 'Kia', 'Rio', '00000000-0000-0000-0000-0000000000a1', '2000-01-01');
reset role;
select tests.eq((select created_by::text || '|' || (created_at > now() - interval '1 minute') || '|' || marketing_consent || '|' || coalesce(privacy_consent_at::text, '-')
                 from public.customers where id = 'c9000000-0000-0000-0000-00000000000a'),
  '00000000-0000-0000-0000-0000000000a2|true|false|-', 'nadie falsea quién creó una ficha ni el consentimiento antiguo');
select tests.eq((select created_by::text || '|' || (created_at > now() - interval '1 minute') from public.vehicles where id = '7e000009-0000-0000-0000-00000000000a'),
  '00000000-0000-0000-0000-0000000000a2|true', 'ni quién creó un vehículo');

-- ===================== Mantenimiento =====================
update public.web_requests set client_hash = 'huella', created_at = now() - interval '3 days' where id = 'ee000000-0000-0000-0000-00000000000a';
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.throws($$select public.run_maintenance()$$, 'el personal no ejecuta el mantenimiento', '%permission denied%');
reset role;
set local role service_role;
select tests.eq((select (public.run_maintenance() ->> 'huellas_borradas')::int >= 1), true, 'el mantenimiento borra las huellas antispam antiguas');
reset role;
select tests.eq((select client_hash from public.web_requests where id = 'ee000000-0000-0000-0000-00000000000a'), null::text, 'la huella ya no está');

-- ===================== Derechos de acceso y supresión =====================
insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, customer_notes)
values ('aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Cambio de ruedas', 'Llámame al 600000001');
select tests.ok((select (private.export_customer_data('c1000000-0000-0000-0000-00000000000a') -> 'ficha' ->> 'full_name') = 'Cliente Uno (A)'),
  'se pueden exportar los datos de un cliente (derecho de acceso)');
select tests.ok((select not ((private.export_customer_data('c1000000-0000-0000-0000-00000000000a') -> 'ficha') ? 'user_id')),
  'la exportación no incluye identificadores internos de la cuenta');
select tests.eq((select has_function_privilege('authenticated', 'private.anonymize_customer(uuid)', 'execute')
                     or has_function_privilege('service_role', 'private.anonymize_customer(uuid)', 'execute')
                     or has_function_privilege('authenticated', 'private.export_customer_data(uuid)', 'execute')), false,
  'exportar y anonimizar solo desde el SQL Editor (no por la API)');
select private.anonymize_customer('c1000000-0000-0000-0000-00000000000a');
select tests.eq((select full_name || '|' || coalesce(email, '-') || '|' || coalesce(phone, '-') || '|' || coalesce(internal_notes, '-') || '|' || coalesce(user_id::text, '-')
                 from public.customers where id = 'c1000000-0000-0000-0000-00000000000a'),
  'Cliente suprimido|-|-|-|-', 'la supresión borra los datos que identifican a la persona y su acceso al portal');
select tests.eq((select count(*) from public.repair_orders where customer_id = 'c1000000-0000-0000-0000-00000000000a'), 1::bigint,
  'el historial de reparaciones se conserva');
select tests.eq((select count(*) from public.repair_orders where customer_id = 'c1000000-0000-0000-0000-00000000000a' and customer_notes is not null), 0::bigint,
  'los mensajes al cliente (pueden contener datos personales) se borran');
select tests.eq((select count(*) from public.notifications where customer_id = 'c1000000-0000-0000-0000-00000000000a' and recipient <> 'suprimido@invalid.invalid'), 0::bigint,
  'no queda ninguna dirección de correo en los avisos');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq((select count(*) from public.portal_profile() where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'la cuenta ya no ve esa ficha en el portal');
select tests.eq((select count(*) from public.portal_profile()), 1::bigint, 'pero sí la de otro taller (no se toca)');
reset role;

rollback;
