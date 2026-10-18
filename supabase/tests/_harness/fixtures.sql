-- Datos de prueba: dos talleres que NUNCA deben ver los datos del otro.
-- Se cargan como superusuario dentro de cada prueba (que termina en ROLLBACK).
-- Cuentas de prueba en la tabla REAL auth.users de Supabase Auth.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000ad', 'admin@plataforma.test', now(), '{"full_name":"Admin Plataforma"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'propietaria@alcarria.test', now(), '{"full_name":"Ana Propietaria"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'mecanico@alcarria.test', now(), '{"full_name":"Mario Mecánico"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'gestora@alcarria.test', now(), '{"full_name":"Gema Gestora"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'propietario@chamberi.test', now(), '{"full_name":"Bruno Propietario"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'cliente1@correo.test', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'cliente2@correo.test', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000ff', 'ajeno@correo.test', now(), '{"full_name":"Persona Ajena"}'),
  -- Se registró pero todavía no ha confirmado su correo.
  ('00000000-0000-0000-0000-0000000000ee', 'sin-confirmar@correo.test', null, '{}');

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000ad');

insert into public.workshops (id, slug, name, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'taller-alcarria', 'Taller Alcarria (prueba)', 'activo'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'taller-chamberi', 'Taller Chamberí (prueba)', 'activo');

insert into public.workshop_members (workshop_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'propietario'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'mecanico'),
  ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'administrador'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b1', 'propietario');

insert into public.customers (id, workshop_id, full_name, phone, user_id, internal_notes) values
  ('c1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente Uno (A)', '600000001', '00000000-0000-0000-0000-0000000000c1', 'Paga tarde'),
  ('c2000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'Cliente Dos (A)', '600000002', '00000000-0000-0000-0000-0000000000c2', null),
  ('c1000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'Cliente Uno (B)', '600000001', '00000000-0000-0000-0000-0000000000c1', null);

insert into public.vehicles (id, workshop_id, customer_id, plate, make, model, fuel, internal_notes) values
  ('7e000001-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000a', '1950 bxf', 'Volkswagen', 'Golf', 'gasolina', 'Nota interna secreta'),
  ('7e000002-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'c2000000-0000-0000-0000-00000000000a', '1234-KLM', 'Seat', 'León', 'diesel', null),
  ('7e000001-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-00000000000b', '5678BCD', 'Toyota', 'Corolla', 'hibrido', null);

insert into public.workshop_sites (workshop_id, published, is_demo_content, content) values
  ('aaaaaaaa-0000-0000-0000-000000000000', true, true, '{"tagline":"Demo"}'),
  ('bbbbbbbb-0000-0000-0000-000000000000', false, true, '{}');

insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at) values
  ('alcarria.test', 'aaaaaaaa-0000-0000-0000-000000000000', true, now()),
  ('sin-verificar.test', 'aaaaaaaa-0000-0000-0000-000000000000', false, null),
  ('chamberi.test', 'bbbbbbbb-0000-0000-0000-000000000000', true, now());

insert into public.web_requests (id, workshop_id, kind, name, phone, privacy_accepted_at) values
  ('ee000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000', 'cita', 'Persona A', '611111111', now()),
  ('ee000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000000', 'contacto', 'Persona B', '622222222', now());
