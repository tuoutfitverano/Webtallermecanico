-- Datos de DEMOSTRACIÓN para desarrollo local (`supabase db reset`).
-- Nombre y dirección del taller: los que ha dado el propietario. El resto (teléfono,
-- correo, horario, servicios, vehículos) es de ejemplo. Nunca se carga en producción.

insert into public.workshops (id, slug, name, status)
values ('d0000000-0000-0000-0000-000000000001', 'taller-demo', 'AutoValue', 'demo');

-- Web del taller demo: copia de talleres/autovalue.json (una prueba comprueba que coinciden;
-- para regenerarla: npm run taller:sql -- talleres/autovalue.json).
insert into public.workshop_sites (workshop_id, published, is_demo_content, theme, content)
values (
  'd0000000-0000-0000-0000-000000000001', true, true,
  $tema${
  "design": "premium",
  "accent": "#8A9A7B",
  "headingFont": "archivo",
  "logo": null,
  "colors": {
    "background": "#000000",
    "surface": "#121614",
    "text": "#EFE8DA"
  },
  "sections": {
    "presentacion": true,
    "servicios": true,
    "software": true,
    "ventajas": true,
    "proceso": true,
    "comercial": true,
    "solicitudes": true,
    "contacto": true
  },
  "software": {
    "ordenes": true,
    "clientes": true,
    "portal": true,
    "avisos": true,
    "solicitudes": true,
    "equipo": true,
    "matriculas": true
  },
  "scrollFrames": {
    "src": "/demo/autovalue/giro/{n}.webp",
    "count": 73,
    "poster": "/demo/autovalue/portada.webp",
    "focusX": 0.365,
    "focusY": 0.41,
    "backdrop": "/demo/autovalue/garaje.webp",
    "frameTop": 0.359375,
    "srcHd": null,
    "backdropHd": null
  }
}$tema$,
  $contenido${
  "tagline": "Mecánica y electrónica del automóvil",
  "city": "El Casar",
  "intro": "Taller multimarca de demostración. Pide cita o presupuesto desde la web y te contestaremos para confirmarlo.",
  "phone": "+34 600 000 000",
  "whatsapp": "+34 600 000 000",
  "email": "demo@example.com",
  "address": "Calle Castilla 2122, El Casar",
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
  "notice": "Web de demostración: AutoValue es un taller ficticio. El teléfono, el correo, el horario y los servicios son de ejemplo.",
  "hero": {
    "title": "La mecánica evoluciona. Tu taller también.",
    "subtitle": "Precisión en cada reparación. Tecnología en cada proceso."
  },
  "about": {
    "title": "Primero entender. Después reparar.",
    "points": [
      "Revisamos el vehículo y te explicamos qué necesita antes de empezar.",
      "Cada trabajo queda registrado en el sistema del taller, paso a paso.",
      "Te avisamos en tu portal cuando el coche está listo para recoger."
    ]
  }
}$contenido$
);

-- *.localhost apunta siempre a tu propio ordenador: sirve para probar en local.
insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at)
values ('demo.localhost', 'd0000000-0000-0000-0000-000000000001', true, now());

-- Vehículo de ejemplo aportado manualmente. Matrícula de la serie «X…», aún no emitida:
-- no puede coincidir con ningún coche real. El año NO se conoce todavía:
-- se deja vacío en lugar de inventarlo.
insert into public.vehicles (workshop_id, plate, make, model, year, year_kind, fuel, data_source, verification_status, internal_notes)
values (
  'd0000000-0000-0000-0000-000000000001', '1950XBF', 'Volkswagen', 'Golf', null, null, 'gasolina',
  'manual', 'pendiente', 'Registro de demostración. Año pendiente de introducir.'
);
