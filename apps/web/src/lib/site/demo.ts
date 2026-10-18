/**
 * Web de demostración para desarrollo local SIN base de datos.
 *
 * Solo se usa con `npm run dev` cuando Supabase no está configurado, para
 * poder ver la web. Como no tiene taller real (workshopId = null), sus
 * formularios responden "no disponible": nunca simulan un envío correcto.
 * Todos los datos son ficticios y la web lo indica.
 */
import type { PublicSite } from './content.ts';

export const DEMO_SITE: PublicSite = {
  workshopId: null,
  slug: 'taller-demo',
  name: 'Taller Demo',
  isDemoContent: true,
  accent: '#e4572e',
  // Vídeos de la referencia de diseño, solo para la demostración. Una web real
  // debe usar vídeos propios o con licencia, alojados en su propio almacenamiento.
  videos: {
    hero: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4',
    services: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_093722_ccfc7ebf-182f-419f-8a62-2dc02db7dd9d.mp4',
  },
  content: {
    tagline: 'Mecánica y electrónica del automóvil',
    city: 'Guadalajara',
    intro:
      'Taller multimarca de demostración. Pide cita o presupuesto desde la web y te contestaremos para confirmarlo.',
    phone: '+34 600 000 000',
    whatsapp: '+34 600 000 000',
    email: 'demo@example.com',
    address: 'Calle de Ejemplo 1, 19001 Guadalajara',
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
    notice: 'Web de demostración: el taller, los teléfonos y la dirección son ficticios.',
  },
};
