-- Agenda de cada persona del taller: cada uno la suya; propiedad y administración, la de todos.
begin;
\ir _harness/fixtures.sql

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'recepcion@alcarria.test', now(), '{"full_name":"Rita Recepción"}');
insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'recepcionista');
insert into public.repair_orders (id, workshop_id, vehicle_id, customer_id, problem_description, assigned_to) values
  ('0d000001-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '7e000001-0000-0000-0000-00000000000a',
   'c1000000-0000-0000-0000-00000000000a', 'Asignada al mecánico', '00000000-0000-0000-0000-0000000000a2'),
  ('0d000002-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', '7e000002-0000-0000-0000-00000000000a',
   'c2000000-0000-0000-0000-00000000000a', 'De otro', null);

-- ===================== El mecánico organiza la suya =====================
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
insert into public.staff_agenda (workshop_id, user_id, kind, title, starts_at, ends_at, order_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'tarea',
   '  Cambiar pastillas  ', '2026-11-02 09:00 Europe/Madrid', '2026-11-02 10:30 Europe/Madrid', '0d000001-0000-0000-0000-00000000000a');
select tests.eq((select title || ':' || created_by from public.staff_agenda where title = 'Cambiar pastillas'),
  'Cambiar pastillas:00000000-0000-0000-0000-0000000000a2', 'apunta en su agenda (el autor lo pone la base de datos)');
select tests.throws($$insert into public.staff_agenda (workshop_id, user_id, title, starts_at, ends_at)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'Para la gestora', now(), now() + interval '1 hour')$$,
  'no apunta en la agenda de otra persona', '%row-level security%');
select tests.throws($$insert into public.staff_agenda (workshop_id, user_id, title, starts_at, ends_at, order_id)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'Orden ajena', now(), now() + interval '1 hour', '0d000002-0000-0000-0000-00000000000a')$$,
  'ni la une a una orden que no es suya', '%no está a tu alcance%');
select tests.throws($$insert into public.staff_agenda (workshop_id, user_id, title, starts_at, ends_at)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'Al revés', now(), now() - interval '1 hour')$$,
  'la hora de fin va después de la de inicio', '%check%');
update public.staff_agenda set done_at = '2000-01-01' where title = 'Cambiar pastillas';
select tests.eq((select done_at > now() - interval '1 minute' from public.staff_agenda where title = 'Cambiar pastillas'), true,
  'la marca de hecho la pone el servidor, con su hora');
select tests.throws($$update public.staff_agenda set created_by = null where title = 'Cambiar pastillas'$$,
  'el autor no se cambia', '%permission denied%');
reset role;

-- ===================== La gerencia organiza la de todos =====================
select tests.login('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select tests.eq((select count(*) from public.staff_agenda where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint,
  'la administradora ve la agenda del mecánico');
insert into public.staff_agenda (workshop_id, user_id, kind, title, starts_at, ends_at) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'cita',
   'Recibir al cliente del Golf', '2026-11-02 11:00 Europe/Madrid', '2026-11-02 11:30 Europe/Madrid'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'reunion',
   'Cierre de caja', '2026-11-02 19:00 Europe/Madrid', '2026-11-02 19:30 Europe/Madrid');
select tests.eq((select created_by::text from public.staff_agenda where title = 'Recibir al cliente del Golf'),
  '00000000-0000-0000-0000-0000000000a3', 'y le apunta cosas (queda quién lo hizo)');
reset role;

-- ===================== Recepción solo la suya =====================
select tests.login('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select tests.eq((select string_agg(title, ',') from public.staff_agenda), 'Cierre de caja',
  'recepción solo ve su agenda');
update public.staff_agenda set title = 'Cambiado' where title = 'Recibir al cliente del Golf';
delete from public.staff_agenda where title = 'Cambiar pastillas';
reset role;
select tests.eq((select count(*) from public.staff_agenda where title in ('Cambiado', 'Cambiar pastillas')), 1::bigint,
  'ni cambia ni borra la de otros');

-- El mecánico no ve la de recepción, pero sí lo que le apuntaron a él.
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.staff_agenda), 2::bigint, 'el mecánico ve lo suyo, también lo que le apuntó la gerencia');
-- Puede mover lo suyo, pero no pasárselo a otra persona.
select tests.throws($$update public.staff_agenda set user_id = '00000000-0000-0000-0000-0000000000a4' where title = 'Recibir al cliente del Golf'$$,
  'no pasa sus apuntes a la agenda de otro', '%row-level security%');
reset role;

-- ===================== Otro taller y quien se va =====================
select tests.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select tests.eq((select count(*) from public.staff_agenda), 0::bigint, 'otro taller no ve nada');
select tests.throws($$insert into public.staff_agenda (workshop_id, user_id, title, starts_at, ends_at)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', 'Colado', now(), now() + interval '1 hour')$$,
  'ni se apunta en él', '%violates%');
reset role;
select tests.throws($$insert into public.staff_agenda (workshop_id, user_id, title, starts_at, ends_at)
                      values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c1', 'Cliente', now(), now() + interval '1 hour')$$,
  'solo personas del equipo tienen agenda', '%foreign key%');
update public.workshop_members set active = false where user_id = '00000000-0000-0000-0000-0000000000a2';
select tests.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select tests.eq((select count(*) from public.staff_agenda), 0::bigint, 'quien deja el taller deja de verla');
reset role;
select tests.eq((select count(*) from public.staff_agenda where user_id = '00000000-0000-0000-0000-0000000000a2'), 2::bigint,
  'pero no se borra: el taller la conserva');

rollback;
