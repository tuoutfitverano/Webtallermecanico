-- Datos de DEMOSTRACIÓN para desarrollo local (`supabase db reset`).
-- Nada de esto es un taller ni un cliente real. Nunca se carga en producción.

insert into public.workshops (id, slug, name, status)
values ('d0000000-0000-0000-0000-000000000001', 'taller-demo', 'Taller Demo (datos de demostración)', 'demo');

insert into public.workshop_sites (workshop_id, published, is_demo_content, theme, content)
values (
  'd0000000-0000-0000-0000-000000000001', true, true,
  '{"accent": "#e4572e"}',
  '{"city": "Guadalajara", "notice": "Web de demostración: los datos de contacto y los servicios son ficticios."}'
);

-- *.localhost apunta siempre a tu propio ordenador: sirve para probar en local.
insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at)
values ('demo.localhost', 'd0000000-0000-0000-0000-000000000001', true, now());

-- Vehículo de ejemplo aportado manualmente. El año NO se conoce todavía:
-- se deja vacío en lugar de inventarlo.
insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, fuel, data_source, verification_status, internal_notes)
values (
  'd0000000-0000-0000-0000-000000000001', '1950BXF', 'Volkswagen', 'Golf', null, null, 'gasolina',
  'manual', 'pendiente', 'Registro de demostración. Año pendiente de introducir.'
);
