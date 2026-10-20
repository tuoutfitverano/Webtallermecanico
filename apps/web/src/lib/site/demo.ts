/**
 * Web de demostración para desarrollo local SIN base de datos.
 *
 * Solo se usa con `npm run dev` cuando Supabase no está configurado, para
 * poder ver la web. Como no tiene taller real (workshopId = null), sus
 * formularios responden "no disponible": nunca simulan un envío correcto.
 * El nombre y la dirección son los que ha dado el propietario; el resto de
 * datos son de ejemplo y la web lo indica.
 */
import type { PublicSite } from './content.ts';

export const DEMO_SITE: PublicSite = {
  workshopId: null,
  slug: 'taller-demo',
  name: 'AutoValue',
  isDemoContent: true,
  accent: '#8A9A7B',
  videos: { hero: null, services: null },
  // Coche girando dentro de un garaje: fotogramas recortados del vídeo aportado por el
  // propietario y garaje dibujado (scripts/demo-autovalue). El zoom final apunta a la
  // ventanilla trasera tintada.
  scrollFrames: {
    src: '/demo/autovalue/giro/{n}.webp',
    count: 73,
    poster: '/demo/autovalue/portada.webp',
    focusX: 0.365,
    focusY: 0.41,
    backdrop: '/demo/autovalue/garaje.webp',
    frameTop: 0.359375,
    srcHd: null,
    backdropHd: null,
  },
  content: {
    tagline: 'Mecánica y electrónica del automóvil',
    city: 'El Casar',
    intro:
      'Taller multimarca de demostración. Pide cita o presupuesto desde la web y te contestaremos para confirmarlo.',
    phone: '+34 600 000 000',
    whatsapp: '+34 600 000 000',
    email: 'demo@example.com',
    address: 'Calle Castilla 2122, El Casar',
    hours: ['Lunes a viernes: 8:30–14:00 y 15:30–19:00', 'Sábados y domingos: cerrado'],
    brands: 'Todas las marcas',
    services: [
      { id: 'mantenimiento', name: 'Mantenimiento y revisiones', description: 'Aceite, filtros y revisiones según el plan del fabricante.' },
      { id: 'diagnosis', name: 'Diagnosis electrónica', description: 'Lectura de averías de la centralita y explicación clara.' },
      { id: 'frenos', name: 'Frenos', description: 'Pastillas, discos y líquido de frenos.' },
      { id: 'neumaticos', name: 'Neumáticos', description: 'Montaje, equilibrado y alineado.' },
      { id: 'distribucion', name: 'Distribución', description: 'Cambio de correa o cadena y bomba de agua.' },
      { id: 'embrague', name: 'Embrague', description: 'Diagnóstico y sustitución del kit de embrague.' },
      { id: 'averias', name: 'Averías', description: 'Ruidos, testigos encendidos y fallos de arranque.' },
    ],
    notice: 'Web de demostración: el teléfono, el correo, el horario y los servicios son de ejemplo.',
  },
};
