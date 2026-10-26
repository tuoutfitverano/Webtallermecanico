-- Aislamiento entre talleres, COMPLETO (auditoría del 24/10/2026).
--
-- El taller B se llena con datos en TODAS las tablas que llevan workshop_id
-- (la prueba falla si alguna queda vacía: así no se da por buena una tabla
-- sin haberla probado). Después, con cada cuenta del taller A (propietaria,
-- administradora, recepción, mecánico), con una clienta solo de A y con una
-- persona sin taller, se intenta, tabla por tabla:
--   · leer las filas de B;
--   · cambiarlas y borrarlas;
--   · crear una copia de una fila de B dentro de B;
--   · mover filas propias a B;
-- y se llama a CADA función de la API con los identificadores de B.
-- Al final, los datos de B (comparados por huella, como superusuario) tienen
-- que estar exactamente igual y ninguna respuesta puede contener datos de B.
begin;
\ir _harness/fixtures.sql

-- Huella de los datos de B (como superusuario: sin RLS). Solo para la prueba.
create function tests.b_rows(p_table text) returns bigint language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where workshop_id = %L', p_table, 'bbbbbbbb-0000-0000-0000-000000000000') into n;
  return n;
end $$;
create function tests.b_hash() returns text language plpgsql security definer set search_path = '' as $$
declare t text; h text := ''; x text;
begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
            where c.table_schema = 'public' and c.column_name = 'workshop_id' and tb.table_type = 'BASE TABLE' order by 1 loop
    execute format('select coalesce(md5(string_agg(r::text, %L order by r::text)), %L) from public.%I r where workshop_id = %L', '|', '-', t, 'bbbbbbbb-0000-0000-0000-000000000000') into x;
    h := h || t || '=' || x || ';';
  end loop;
  select h || 'workshops=' || md5(w::text) into h from public.workshops w where w.id = 'bbbbbbbb-0000-0000-0000-000000000000';
  return md5(h);
end $$;
grant execute on function tests.b_rows(text), tests.b_hash() to authenticated, anon;

-- Recepción del taller A (el cuarto rol).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recepcion@alcarria.test', now(), '{"full_name":"Rita Recepción"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'mecanico@chamberi.test', now(), '{"full_name":"Benito Mecánico B"}');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'recepcionista'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b2', 'mecanico');

-- ===================== Datos del taller B (como su propietario) =====================
update public.workshops set legal_name = 'Talleres Chamberí SL', tax_id = 'B12345674', address_line = 'Calle Secreta B 1',
  postal_code = '28010', city = 'Madrid' where id = 'bbbbbbbb-0000-0000-0000-000000000000';
insert into public.workshop_domains (hostname, workshop_id) values ('chamberi-secreto.test', 'bbbbbbbb-0000-0000-0000-000000000000');
insert into public.customers (id, workshop_id, full_name, phone, email, tax_id, internal_notes) values
  ('c3000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'Secreto Cliente B', '611222333', 'secreto-b@correo.test', '12345678Z', 'NOTA-SECRETA-B');
insert into public.web_requests (workshop_id, kind, name, phone, privacy_accepted_at) values
  ('bbbbbbbb-0000-0000-0000-000000000000', 'contacto', 'Secreto Solicitud B', '622333444', now());

select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
with x as (
  insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description, assigned_to)
  values ('bbbbbbbb-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'SECRETO-AVERIA-B', '00000000-0000-0000-0000-0000000000b2')
  returning id)
select set_config('tests.ob', (select id::text from x), true);
insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate) values
  ('bbbbbbbb-0000-0000-0000-000000000000', current_setting('tests.ob')::uuid, 1, 'mano_obra', 'Trabajo B', 1, 10000, 21);
with x as (insert into public.service_intervals (workshop_id, name, every_months) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Aceite B', 12) returning id)
select set_config('tests.ib', (select id::text from x), true);
insert into public.order_services (order_id, workshop_id, interval_id) values (current_setting('tests.ob')::uuid, 'bbbbbbbb-0000-0000-0000-000000000000', current_setting('tests.ib')::uuid);
select public.set_vehicle_service('7e000001-0000-0000-0000-00000000000b', current_setting('tests.ib')::uuid, current_date - 30, 50000);
select public.start_work(current_setting('tests.ob')::uuid);
select public.stop_work(current_setting('tests.ob')::uuid);
with x as (
  insert into public.quotes (workshop_id, customer_id, vehicle_id, order_id, title)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000b', '7e000001-0000-0000-0000-00000000000b', current_setting('tests.ob')::uuid, 'Presupuesto B')
  returning id)
select set_config('tests.qb', (select id::text from x), true);
insert into public.quote_items (workshop_id, quote_id, position, kind, description, quantity, unit_price_cents, tax_rate) values
  ('bbbbbbbb-0000-0000-0000-000000000000', current_setting('tests.qb')::uuid, 1, 'pieza', 'Pieza B', 1, 5000, 21);
select public.send_quote(current_setting('tests.qb')::uuid, 30);
select set_config('tests.fb', public.create_invoice_draft(current_setting('tests.ob')::uuid)::text, true);
reset role;
update public.customers set tax_id = '00000000T', address_line = 'Calle B 2', postal_code = '28010', city = 'Madrid' where id = 'c1000000-0000-0000-0000-00000000000b';
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.issue_invoice(current_setting('tests.fb')::uuid);
insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('bbbbbbbb-0000-0000-0000-000000000000', current_setting('tests.fb')::uuid, 1000, 'efectivo');
-- Cambio de estado que avisa a la clienta vinculada (c1 también es clienta de B).
update public.repair_orders set status = 'diagnosis' where id = current_setting('tests.ob')::uuid;
select public.export_workshop_data('bbbbbbbb-0000-0000-0000-000000000000');
select public.accept_platform_terms('bbbbbbbb-0000-0000-0000-000000000000', '1.0');
select public.create_workshop_invitation('bbbbbbbb-0000-0000-0000-000000000000', 'futuro-b@correo.test', 'mecanico');
select public.create_customer_invitation('c3000000-0000-0000-0000-00000000000b', 'secreto-b@correo.test');
select public.start_vehicle_lookup('bbbbbbbb-0000-0000-0000-000000000000', '5678BCD', 'openapi', gen_random_uuid());
reset role;
-- La clienta c1 (vinculada a B) elige cómo recibir avisos de B.
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.set_contact_preferences('c1000000-0000-0000-0000-00000000000b', true, true, false);
reset role;
insert into public.reminders (workshop_id, kind, due_on, title, dedupe_key) values ('bbbbbbbb-0000-0000-0000-000000000000', 'revision', current_date, 'Secreto recordatorio B', 'prueba-b');
insert into public.reminder_settings (workshop_id) values ('bbbbbbbb-0000-0000-0000-000000000000') on conflict do nothing;
insert into public.workshop_billing_settings (workshop_id) values ('bbbbbbbb-0000-0000-0000-000000000000') on conflict do nothing;
insert into public.workshop_notification_settings (workshop_id) values ('bbbbbbbb-0000-0000-0000-000000000000') on conflict do nothing;
insert into public.workshop_counters (workshop_id) values ('bbbbbbbb-0000-0000-0000-000000000000') on conflict do nothing;
insert into public.workshop_plans (workshop_id, plan) values ('bbbbbbbb-0000-0000-0000-000000000000', 'premium');
insert into public.vehicle_transfers (workshop_id, vehicle_id, from_customer_id, to_customer_id, origin) values
  ('bbbbbbbb-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-00000000000b', 'portal');

-- Ninguna tabla con workshop_id puede quedar sin datos de B.
create temp table tablas_taller on commit drop as
  select c.table_name::text as t
    from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
   where c.table_schema = 'public' and c.column_name = 'workshop_id' and tb.table_type = 'BASE TABLE';
grant select on tablas_taller to authenticated, anon;
select tests.eq((select coalesce(string_agg(t, ', ' order by t), '') from tablas_taller where tests.b_rows(t) = 0),
  '', 'el taller B tiene datos en todas las tablas (si no, la prueba no prueba nada)');

-- Identificadores de B para las llamadas a la API.
select set_config('tests.pb', (select id::text from public.payments where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.nb', (select id::text from public.notifications where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.rb', (select id::text from public.reminders where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.wib', (select id::text from public.workshop_invitations where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.cib', (select id::text from public.customer_invitations where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.tb', (select id::text from public.vehicle_transfers where workshop_id = 'bbbbbbbb-0000-0000-0000-000000000000' limit 1), true);
select set_config('tests.b_before', tests.b_hash(), true);

-- Una fila de B (como superusuario) para intentar copiarla dentro de B.
create function tests.b_sample(p_table text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
  execute format('select to_jsonb(r) from public.%I r where workshop_id = %L limit 1', p_table, 'bbbbbbbb-0000-0000-0000-000000000000') into j;
  return j;
end $$;
grant execute on function tests.b_sample(text) to authenticated, anon;

-- Intentos tabla por tabla con la cuenta actual. Devuelve las fugas (vacío = ninguna).
create function tests.probe_tables() returns text language plpgsql as $$
declare
  t text; n bigint; leaks text := ''; j jsonb; cols text; col text;
  b constant uuid := 'bbbbbbbb-0000-0000-0000-000000000000';
  a constant uuid := 'aaaaaaaa-0000-0000-0000-000000000000';
begin
  for t in select x.t from tablas_taller x order by 1 loop
    -- Leer
    begin
      -- (Su propia membresía, aunque esté desactivada, sí la ve: es suya.)
      execute format('select count(*) from public.%I where workshop_id = %L', t, b)
        || case when t = 'workshop_members' then ' and user_id is distinct from auth.uid()' else '' end into n;
      if n > 0 then leaks := leaks || t || ':lee ' || n || ' filas; '; end if;
    exception when insufficient_privilege then null;
    end;
    -- Cambiar (con la primera columna que la cuenta pueda cambiar)
    col := null;
    select a2.attname into col from pg_attribute a2
     where a2.attrelid = format('public.%I', t)::regclass and a2.attnum > 0 and not a2.attisdropped
       and has_column_privilege(format('public.%I', t), a2.attname, 'UPDATE') order by a2.attnum limit 1;
    if col is not null then
      begin
        execute format('update public.%I set %I = %I where workshop_id = %L', t, col, col, b);
        get diagnostics n = row_count;
        if n > 0 then leaks := leaks || t || ':cambia ' || n || ' filas; '; end if;
      exception when others then null;
      end;
    end if;
    -- Borrar
    begin
      execute format('delete from public.%I where workshop_id = %L', t, b);
      get diagnostics n = row_count;
      if n > 0 then leaks := leaks || t || ':borra ' || n || ' filas; '; end if;
    exception when others then null;
    end;
    -- Crear una copia de una fila de B dentro de B (columnas que se pueden escribir, id nuevo)
    j := tests.b_sample(t);
    if j ? 'id' and jsonb_typeof(j -> 'id') = 'string' then j := jsonb_set(j, '{id}', to_jsonb(gen_random_uuid())); end if;
    select string_agg(quote_ident(a2.attname), ', ' order by a2.attnum) into cols from pg_attribute a2
     where a2.attrelid = format('public.%I', t)::regclass and a2.attnum > 0 and not a2.attisdropped
       and a2.attidentity = '' and a2.attgenerated = '' and j ? a2.attname;
    begin
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', t, cols, cols, t) using j;
      leaks := leaks || t || ':crea en B; ';
    exception when others then null;
    end;
    -- Mover filas propias a B
    if has_column_privilege(format('public.%I', t), 'workshop_id', 'UPDATE') then
      begin
        execute format('update public.%I set workshop_id = %L where workshop_id = %L', t, b, a);
        get diagnostics n = row_count;
        if n > 0 then leaks := leaks || t || ':mueve ' || n || ' filas a B; '; end if;
        raise exception using errcode = 'P0099';
      exception when others then null;
      end;
    end if;
  end loop;
  -- Talleres y perfiles (sin workshop_id)
  begin
    execute format('select count(*) from public.workshops where id = %L', b) into n;
    if n > 0 then leaks := leaks || 'workshops:lee; '; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute $q$select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b2' and id is distinct from auth.uid()$q$ into n;
    if n > 0 then leaks := leaks || 'profiles:lee el perfil de un empleado de B; '; end if;
  exception when insufficient_privilege then null;
  end;
  if tests.b_hash() <> current_setting('tests.b_before') then leaks := leaks || 'LOS DATOS DE B HAN CAMBIADO; '; end if;
  return leaks;
end $$;

-- Cada función de la API (las que puede ejecutar la cuenta) con los identificadores de B.
create function tests.probe_api() returns text language plpgsql as $$
declare
  f record; i int; args text[]; arg text; q text; res text; leaks text := ''; tries text[]; try_val text; v text;
  markers constant text[] := array['SECRETO', 'Secreto', 'NOTA-SECRETA', '5678BCD', '611222333', '622333444',
    current_setting('tests.ob'), current_setting('tests.qb'), current_setting('tests.fb'), 'c1000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-00000000000b'];
  m text;
begin
  for f in
    select p.oid, p.proname, p.proretset, p.proargnames, p.proargtypes::oid[] as types, p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege(p.oid, 'execute') and p.prokind = 'f'
     order by p.proname, p.oid
  loop
    -- Los parámetros uuid sin nombre conocido se prueban con varios identificadores de B.
    tries := array['-'];
    for i in 1..f.pronargs loop
      if f.types[i - 1] = 'uuid'::regtype and coalesce(f.proargnames[i], '') in ('p_id', 'p_invitation_id') then
        tries := array[current_setting('tests.nb'), current_setting('tests.rb'), current_setting('tests.wib'), current_setting('tests.cib')];
      end if;
    end loop;
    foreach try_val in array tries loop
      args := '{}';
      for i in 1..f.pronargs loop
        if f.types[i - 1] = 'uuid'::regtype then
          v := case coalesce(f.proargnames[i], '')
              when 'p_workshop_id' then 'bbbbbbbb-0000-0000-0000-000000000000'
              when 'p_order_id' then current_setting('tests.ob')
              when 'p_quote_id' then current_setting('tests.qb')
              when 'p_invoice_id' then current_setting('tests.fb')
              when 'p_customer_id' then 'c1000000-0000-0000-0000-00000000000b'
              when 'p_vehicle_id' then '7e000001-0000-0000-0000-00000000000b'
              when 'p_interval_id' then current_setting('tests.ib')
              when 'p_payment_id' then current_setting('tests.pb')
              when 'p_transfer_id' then current_setting('tests.tb')
              when 'p_user_id' then '00000000-0000-0000-0000-0000000000b2'
              when 'p_assigned_to' then '00000000-0000-0000-0000-0000000000b2'
              when 'p_request_key' then gen_random_uuid()::text
              when 'p_exclude' then null
              else nullif(try_val, '-') end;
          arg := coalesce(quote_literal(v), 'null') || '::uuid';
        elsif f.types[i - 1] = 'text'::regtype then
          arg := quote_literal(case coalesce(f.proargnames[i], '')
              when 'p_email' then 'secreto-b@correo.test'
              when 'p_slug' then 'taller-chamberi'
              when 'p_hostname' then 'chamberi-secreto.test'
              when 'p_format' then 'json'
              when 'p_query' then ''
              when 'p_plate' then '5678BCD'
              when 'p_provider' then 'openapi'
              when 'p_version' then '1.0'
              when 'p_filter' then 'todas'
              when 'p_token' then 'x'
              else 'prueba' end);
        elsif f.types[i - 1] in ('integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'numeric'::regtype) then
          arg := '50';
        elsif f.types[i - 1] = 'boolean'::regtype then
          arg := 'true';
        elsif f.types[i - 1] = 'date'::regtype then
          arg := 'current_date';
        elsif f.types[i - 1] in ('jsonb'::regtype, 'json'::regtype) then
          arg := '''{}''';
        elsif (select t2.typtype from pg_type t2 where t2.oid = f.types[i - 1]) = 'e' then
          arg := quote_literal((select e.enumlabel from pg_enum e where e.enumtypid = f.types[i - 1] order by e.enumsortorder limit 1)) || '::' || f.types[i - 1]::regtype::text;
        else
          arg := 'null';
        end if;
        args := args || arg;
      end loop;
      q := format('public.%I(%s)', f.proname, array_to_string(args, ', '));
      q := case when f.proretset then format('select string_agg(x::text, %L) from %s x', ',', q) else format('select (%s)::text', q) end;
      res := null;
      begin
        execute q into res;
        if tests.b_hash() <> current_setting('tests.b_before') then
          leaks := leaks || f.proname || ': CAMBIA DATOS DE B; ';
        end if;
        raise exception using errcode = 'P0099';  -- deshace lo que la llamada haya hecho
      exception when others then null;
      end;
      foreach m in array markers loop
        if coalesce(res, '') like '%' || m || '%' then
          leaks := leaks || f.proname || ': devuelve datos de B (' || m || '); ';
          exit;
        end if;
      end loop;
    end loop;
  end loop;
  return leaks;
end $$;
grant execute on function tests.probe_tables(), tests.probe_api() to authenticated;

-- ===================== Cada cuenta del taller A, una clienta solo de A y una persona sin taller =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'propietaria de A: no lee, cambia, borra, crea ni mueve nada de B');
select tests.eq(tests.probe_api(), '', 'propietaria de A: ninguna función de la API da o cambia datos de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'administradora de A: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'administradora de A: API sin datos de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'recepción de A: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'recepción de A: API sin datos de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'mecánico de A: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'mecánico de A: API sin datos de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'clienta solo de A: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'clienta solo de A: API sin datos de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'persona sin taller: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'persona sin taller: API sin datos de B');
reset role;
select tests.eq(tests.b_hash(), current_setting('tests.b_before'), 'después de todo lo anterior, los datos de B siguen exactamente igual');
-- ===================== Después de irse =====================
-- Un empleado de B desactivado y una clienta que deja B pierden todo el acceso a B al momento.
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_member_active('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b2', false);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.portal_leave_workshop('bbbbbbbb-0000-0000-0000-000000000000');
reset role;
select set_config('tests.b_before', tests.b_hash(), true);
select tests.login('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'mecánico de B desactivado: ya no lee ni toca nada de B');
select tests.eq(tests.probe_api(), '', 'mecánico de B desactivado: la API ya no le da nada de B');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select tests.eq(tests.probe_tables(), '', 'clienta que dejó B: tablas de B intactas');
select tests.eq(tests.probe_api(), '', 'clienta que dejó B: el portal ya no le da nada de B');
reset role;
-- Control: la propia prueba detecta un acceso legítimo (si no, no probaría nada).
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.ok(tests.probe_tables() like '%customers:lee%', 'control: el propietario de B SÍ lee sus clientes (la prueba detecta accesos)');
select tests.ok(tests.probe_api() like '%devuelve datos de B%', 'control: y la API le devuelve sus datos');
reset role;

rollback;
