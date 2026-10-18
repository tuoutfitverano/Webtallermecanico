-- Datos de DEMOSTRACIÓN para desarrollo local (`supabase db reset`).
-- Nada de esto es un taller ni un cliente real. Nunca se carga en producción.

insert into public.workshops (id, slug, name, status)
values ('d0000000-0000-0000-0000-000000000001', 'taller-demo', 'Taller Demo', 'demo');

-- Mismo contenido que apps/web/src/lib/site/demo.ts (la demo local sin base de datos).
insert into public.workshop_sites (workshop_id, published, is_demo_content, theme, content)
values (
  'd0000000-0000-0000-0000-000000000001', true, true,
  '{"accent": "#e4572e", "heroVideo": "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4", "servicesVideo": "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_093722_ccfc7ebf-182f-419f-8a62-2dc02db7dd9d.mp4"}',
  '{
  "tagline": "Mecánica y electrónica del automóvil",
  "city": "Guadalajara",
  "intro": "Taller multimarca de demostración. Pide cita o presupuesto desde la web y te contestaremos para confirmarlo.",
  "phone": "+34 600 000 000",
  "whatsapp": "+34 600 000 000",
  "email": "demo@example.com",
  "address": "Calle de Ejemplo 1, 19001 Guadalajara",
  "hours": [
    "Lunes a viernes: 8:30–14:00 y 15:30–19:00",
    "Sábados y domingos: cerrado"
  ],
  "brands": "Todas las marcas",
  "services": [
    {
      "id": "mantenimiento",
      "name": "Mantenimiento y revisiones",
      "description": "Aceite, filtros y revisiones según el plan del fabricante."
    },
    {
      "id": "diagnosis",
      "name": "Diagnosis electrónica",
      "description": "Lectura de averías de la centralita y explicación clara."
    },
    {
      "id": "frenos",
      "name": "Frenos",
      "description": "Pastillas, discos y líquido de frenos."
    },
    {
      "id": "neumaticos",
      "name": "Neumáticos",
      "description": "Montaje, equilibrado y alineado."
    },
    {
      "id": "distribucion",
      "name": "Distribución",
      "description": "Cambio de correa o cadena y bomba de agua."
    },
    {
      "id": "embrague",
      "name": "Embrague",
      "description": "Diagnóstico y sustitución del kit de embrague."
    },
    {
      "id": "averias",
      "name": "Averías",
      "description": "Ruidos, testigos encendidos y fallos de arranque."
    }
  ],
  "notice": "Web de demostración: el taller, los teléfonos y la dirección son ficticios."
}'
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
