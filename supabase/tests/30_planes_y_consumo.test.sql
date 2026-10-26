-- Planes y consumo de extras (WhatsApp y matrículas, a cargo del taller).
begin;
\ir _harness/fixtures.sql

-- Consumo de octubre de 2026 en el taller A: 350 WhatsApp y 70 consultas (2 reutilizadas o fallidas no cuentan).
set local session_replication_role = replica;  -- datos de prueba directos, sin disparadores
insert into public.notifications (workshop_id, customer_id, channel, recipient, template, title, body, status, sent_at)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'whatsapp', '34600000001', 'aviso_v1', 'x', 'x', 'enviado',
       timestamptz '2026-10-15 12:00 Europe/Madrid'
  from generate_series(1, 350);
-- Uno enviado el 1 de noviembre a las 00:30 en Madrid (31 de octubre en UTC): cuenta en noviembre.
insert into public.notifications (workshop_id, customer_id, channel, recipient, template, title, body, status, sent_at)
values ('aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', 'whatsapp', '34600000001', 'aviso_v1', 'x', 'x', 'enviado',
        timestamptz '2026-11-01 00:30 Europe/Madrid');
insert into public.vehicle_lookups (workshop_id, plate, provider, status, result, request_key, created_at)
select 'aaaaaaaa-0000-0000-0000-000000000000', 'ABC' || n, 'openapi', 'encontrado', '{}'::jsonb, gen_random_uuid(), timestamptz '2026-10-10 10:00 Europe/Madrid'
  from generate_series(1, 70) n;
insert into public.vehicle_lookups (workshop_id, plate, provider, status, request_key, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ERR1', 'openapi', 'error', gen_random_uuid(), timestamptz '2026-10-10 10:00 Europe/Madrid'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ERR2', 'openapi', 'no_disponible', gen_random_uuid(), timestamptz '2026-10-10 10:00 Europe/Madrid');
set local session_replication_role = origin;

-- ===================== Profesional (sin fila de plan) =====================
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select plan from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-01')), 'profesional', 'sin plan, es Profesional');
select tests.eq((select whatsapp from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 350, 'cuenta los WhatsApp enviados del mes (hora de Madrid)');
select tests.eq((select matriculas from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 70, 'y las consultas contestadas (no las fallidas)');
select tests.eq((select whatsapp_cents from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 2100, 'Profesional: 350 × 0,06 € = 21 €');
select tests.eq((select matriculas_cents from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 5250, 'Profesional: 70 × 0,75 € = 52,50 €');
select tests.eq((select whatsapp from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-11-05')), 1, 'el de las 00:30 del 1 de noviembre cuenta en noviembre');
select tests.throws($$select * from public.workshop_plans$$, 'el taller no lee la tabla de planes', '%permission denied%');
select tests.throws($$update public.extras_tariff set unit_cents = 0$$, 'ni toca las tarifas', '%permission denied%');
reset role;

-- ===================== Premium =====================
select private.set_workshop_plan('taller-alcarria', 'premium');
select tests.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select tests.eq((select whatsapp_cents from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 1500,
  'Premium: 300 × 0,04 € + 50 × 0,06 € = 15 €');
select tests.eq((select matriculas_cents from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 4350,
  'Premium: 60 × 0,60 € + 10 × 0,75 € = 43,50 €');
select tests.eq((select whatsapp_limit from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000', date '2026-10-20')), 300, 'y ve el límite del precio rebajado');
reset role;

-- ===================== Quién lo ve =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.throws($$select * from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000')$$, 'un mecánico no ve el consumo', '%propiedad%');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.throws($$select * from public.workshop_usage('aaaaaaaa-0000-0000-0000-000000000000')$$, 'otro taller tampoco', '%propiedad%');
select tests.throws($$select * from public.admin_usage()$$, 'ni el resumen de la plataforma', '%administración de la plataforma%');
reset role;
select count(*) as talleres from public.workshops \gset
select tests.login('00000000-0000-0000-0000-0000000000ad', 'aal2');
set local role authenticated;
select tests.eq((select whatsapp_cents from public.admin_usage(date '2026-10-01') where workshop_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 1500,
  'la plataforma ve el consumo de cada taller para cobrarlo');
select tests.eq((select count(*) from public.admin_usage(date '2026-10-01')), :talleres::bigint, 'de todos los talleres');
reset role;
select tests.throws($$select private.set_workshop_plan('taller-alcarria', 'gratis')$$, 'solo planes que existen', '%check%');
select tests.eq((select has_function_privilege('authenticated', 'private.set_workshop_plan(text, text)', 'execute')), false, 'el plan solo se cambia desde el SQL Editor');

rollback;
