/**
 * Contenido de la web pública de un taller.
 *
 * Vive en la base de datos (workshop_sites.content / theme) y se valida aquí
 * antes de pintarlo: si falta algo, la web usa valores neutros en vez de
 * romperse. Nada de este contenido es secreto: solo se sirve si el taller
 * tiene la web publicada.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const serviceSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  name: text(60).min(2),
  description: text(240).default(''),
});

export const siteContentSchema = z.object({
  tagline: text(120).default(''),
  city: text(60).default(''),
  intro: text(400).default(''),
  phone: text(30).default(''),
  whatsapp: text(30).default(''),
  email: z.string().trim().max(254).default(''),
  address: text(200).default(''),
  hours: z.array(text(120)).max(8).default([]),
  brands: text(200).default(''),
  services: z.array(serviceSchema).max(20).default([]),
  notice: text(300).default(''),
});

/** Vídeo de fondo opcional: solo https y alojado donde el taller tenga derecho a usarlo. */
const videoUrl = z.url({ protocol: /^https$/ }).max(500).nullable().default(null).catch(null);

export const siteThemeSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e4572e').catch('#e4572e'),
  heroVideo: videoUrl,
  servicesVideo: videoUrl,
});

export type SiteService = z.output<typeof serviceSchema>;
export type SiteContent = z.output<typeof siteContentSchema>;

export interface PublicSite {
  /** null = web de demostración local sin base de datos: no puede recibir solicitudes. */
  workshopId: string | null;
  slug: string;
  name: string;
  isDemoContent: boolean;
  accent: string;
  /** Vídeos de fondo; sin vídeo, la web usa un fondo animado. */
  videos: { hero: string | null; services: string | null };
  content: SiteContent;
}

const rpcResultSchema = z.object({
  // guid: cualquier identificador con forma de UUID (los de demostración no siguen el estándar RFC).
  workshop: z.object({ id: z.guid(), slug: z.string(), name: z.string() }),
  site: z.object({
    is_demo_content: z.boolean(),
    theme: z.unknown(),
    content: z.unknown(),
  }),
});

/** Convierte la respuesta de get_public_site en un PublicSite seguro de usar. */
export function parsePublicSite(raw: unknown): PublicSite | null {
  const parsed = rpcResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { workshop, site } = parsed.data;
  const content = siteContentSchema.safeParse(site.content ?? {});
  const theme = siteThemeSchema.parse(typeof site.theme === 'object' && site.theme ? site.theme : {});
  return {
    workshopId: workshop.id,
    slug: workshop.slug,
    name: workshop.name,
    isDemoContent: site.is_demo_content,
    accent: theme.accent,
    videos: { hero: theme.heroVideo, services: theme.servicesVideo },
    content: content.success ? content.data : siteContentSchema.parse({}),
  };
}

/** Enlace tel: a partir de un teléfono escrito con espacios. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/** Enlace de WhatsApp (wa.me) a partir de un número con prefijo internacional. */
export function whatsappHref(phone: string, text = ''): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
