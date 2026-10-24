/**
 * Web exportada: la copia que se lleva un taller que ha pagado su web y deja
 * el servicio (contrato de web, cláusula 4). Funciona en cualquier alojamiento,
 * sin la plataforma: archivos HTML, CSS, JavaScript e imágenes.
 *
 * Solo existe al generarla con `npm run web:exportar` (scripts/exportar-web/):
 * `WEB_EXPORT` y los datos del taller se fijan AL COMPILAR (vite.define en
 * astro.config.mjs). En producción `WEB_EXPORT` es siempre false y este código
 * no hace nada.
 *
 * Lo que depende de la plataforma no va en la copia: los formularios pasan a
 * ser botones de llamar, WhatsApp y correo; sin área de clientes, sin la parte
 * del software, sin aviso de cookies (la copia no usa ninguna).
 */
import { parsePublicSite, type PublicSite } from './content.ts';
import { siteFromConfig, workshopConfigSchema } from './workshop-config.ts';

export const WEB_EXPORT: boolean = import.meta.env.WEB_EXPORT === '1';

/**
 * Datos del taller a partir de la respuesta de `get_public_site` (lo que se ve
 * hoy en su web) o de su archivo `talleres/<taller>.json`.
 */
export function exportedSiteFrom(raw: unknown): PublicSite | null {
  let site: PublicSite | null = null;
  if (raw && typeof raw === 'object' && 'workshop' in raw && 'site' in raw) {
    site = parsePublicSite(raw);
  } else {
    const cfg = workshopConfigSchema.safeParse(raw);
    if (cfg.success) site = siteFromConfig(cfg.data);
  }
  if (!site) return null;
  // Lo que es de la plataforma no se lleva: ni la parte del software ni la comercial.
  const software = Object.fromEntries(Object.keys(site.software).map(k => [k, false])) as PublicSite['software'];
  return {
    ...site,
    workshopId: null,
    salesEnabled: false,
    software,
    sections: { ...site.sections, software: false, ventajas: false, comercial: false },
  };
}

let cached: PublicSite | null | undefined;
/** El taller de la copia (solo con WEB_EXPORT). */
export function exportedSite(): PublicSite | null {
  if (cached === undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(import.meta.env.WEB_EXPORT_SITE || 'null');
    } catch {
      raw = null;
    }
    cached = WEB_EXPORT ? exportedSiteFrom(raw) : null;
    // Mejor que falle la compilación que entregar una copia con la página «web no encontrada».
    if (WEB_EXPORT && !cached) throw new Error('Los datos del taller para la copia de la web no son válidos.');
  }
  return cached;
}
