/**
 * Contenido de la web pública de un taller.
 *
 * Vive en la base de datos (workshop_sites.content / theme) y se valida aquí
 * antes de pintarlo: si falta algo, la web usa valores neutros en vez de
 * romperse. Nada de este contenido es secreto: solo se sirve si el taller
 * tiene la web publicada.
 *
 * Plantilla: cada taller se describe en un archivo de talleres/ (ver
 * talleres/README.md) con estos mismos dos bloques, «content» (textos y datos)
 * y «theme» (aspecto, secciones y funciones que se enseñan).
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
  /** Portada del diseño premium. Vacío = nombre del taller y su lema. */
  hero: z
    .object({ title: text(90).default(''), subtitle: text(200).default('') })
    .default({ title: '', subtitle: '' })
    .catch({ title: '', subtitle: '' }),
  /** Presentación del taller (diseño premium). Sin puntos, la sección no aparece. */
  about: z
    .object({ title: text(90).default(''), points: z.array(text(240)).max(4).default([]) })
    .default({ title: '', points: [] })
    .catch({ title: '', points: [] }),
});

/** Vídeo de fondo opcional: solo https y alojado donde el taller tenga derecho a usarlo. */
const videoUrl = z.url({ protocol: /^https$/ }).max(500).nullable().default(null).catch(null);

/** Imagen o fotograma: https o una ruta de la propia web ("/demo/…"), nunca otro esquema. */
const assetUrl = z.string().max(500).refine(v => /^https:\/\/\S+$/.test(v) || /^\/(?!\/)\S*$/.test(v));

/**
 * Coche que gira con el scroll (portada → servicios) y zoom final hasta un punto
 * de la imagen (focusX/focusY, de 0 a 1) como transición a la siguiente sección.
 * `src` lleva {n}: el número de fotograma con tres cifras (000, 001…).
 */
export const scrollFramesSchema = z.object({
  src: assetUrl.refine(v => v.includes('{n}')),
  count: z.number().int().min(2).max(240),
  poster: assetUrl,
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  /**
   * Fondo opcional (p. ej. un garaje) del mismo ancho que los fotogramas y más alto:
   * los fotogramas (con transparencia) se dibujan encima a partir de frameTop (0–1 del alto).
   */
  backdrop: assetUrl.nullable().default(null),
  frameTop: z.number().min(0).max(1).default(0),
  /** Versiones 4K opcionales (mismos encuadres) para pantallas de más de 2000 px reales. */
  srcHd: assetUrl.refine(v => v.includes('{n}')).nullable().default(null),
  /** Versión ligera para móviles (hasta 1100 px reales de ancho); mismos fotogramas a menor tamaño. */
  srcSm: assetUrl.refine(v => v.includes('{n}')).nullable().default(null),
  backdropHd: assetUrl.nullable().default(null),
  /**
   * Ritmo: parte de la secuencia que se reproduce (1 = vuelta completa, 0.5 = media
   * vuelta; el zoom va al punto focusX/focusY de ese último fotograma) y espacio
   * propio de cada transición, en alturas de pantalla (cuanto menor, más se funde
   * con las secciones que pasan por encima).
   */
  turn: z.number().min(0.1).max(1).default(1),
  /**
   * Dónde acaba el giro: número del último fotograma (si está, manda sobre `turn`)
   * y sentido. Hacia atrás: 000 → último → … → endFrame (el último fotograma de la
   * secuencia debe ser casi igual al primero, como en una vuelta completa).
   */
  endFrame: z.number().int().min(1).max(239).nullable().default(null),
  reverse: z.boolean().default(false),
  /**
   * Segunda animación opcional (p. ej. abrir el maletero): desde este fotograma la
   * secuencia ya no se reproduce en el giro sino al empezar la última transición,
   * antes del zoom. Sin ella, todo es giro.
   */
  openFrom: z.number().int().min(1).max(239).nullable().default(null),
  turnGap: z.number().min(0).max(2).default(1.3),
  zoomGap: z.number().min(0.6).max(2.5).default(1.7),
});
export type ScrollFrames = z.output<typeof scrollFramesSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Diseños de la web pública. «clasico» = cristal líquido; «premium» = editorial. */
export const SITE_DESIGNS = ['clasico', 'premium'] as const;
export type SiteDesign = (typeof SITE_DESIGNS)[number];

/** Tipografía de los titulares (las dos van incluidas en la web, sin Google Fonts). */
export const HEADING_FONTS = ['archivo', 'instrument'] as const;

/**
 * Secciones del diseño premium. «comercial» es la venta de la plataforma a otros
 * talleres: solo se ve en una web de demostración y la base de datos solo
 * acepta sus solicitudes en un taller con status = 'demo'.
 */
export const SITE_SECTIONS = ['presentacion', 'servicios', 'software', 'ventajas', 'proceso', 'comercial', 'solicitudes', 'contacto'] as const;
export type SiteSection = (typeof SITE_SECTIONS)[number];
const SECTION_DEFAULTS: Record<SiteSection, boolean> = {
  presentacion: true, servicios: true, software: true, ventajas: true, proceso: true, comercial: false, solicitudes: true, contacto: true,
};

/**
 * Funciones del software que la web ENSEÑA (capturas y textos). Enseñar no es
 * activar: lo que depende de un proveedor (matrículas, email) dice si está
 * activo o pendiente según la configuración real del servidor.
 */
export const SOFTWARE_FEATURES = ['ordenes', 'clientes', 'portal', 'avisos', 'solicitudes', 'equipo', 'matriculas'] as const;
export type SoftwareFeature = (typeof SOFTWARE_FEATURES)[number];

const flags = <K extends string>(keys: readonly K[], defaults: Record<K, boolean>) =>
  z
    .object(Object.fromEntries(keys.map(k => [k, z.boolean().default(defaults[k]).catch(defaults[k])])) as Record<K, z.ZodCatch<z.ZodDefault<z.ZodBoolean>>>)
    .default(defaults as never)
    .catch(defaults as never);

export const siteThemeSchema = z.object({
  accent: hex.default('#e4572e').catch('#e4572e'),
  heroVideo: videoUrl,
  servicesVideo: videoUrl,
  scrollFrames: scrollFramesSchema.nullable().default(null).catch(null),
  design: z.enum(SITE_DESIGNS).default('clasico').catch('clasico'),
  headingFont: z.enum(HEADING_FONTS).default('archivo').catch('archivo'),
  /** Logotipo (SVG o PNG con fondo transparente). Sin logotipo se escribe el nombre. */
  logo: assetUrl.nullable().default(null).catch(null),
  /** Colores del diseño premium; el acento es «accent». */
  colors: z
    .object({ background: hex.nullable().default(null).catch(null), surface: hex.nullable().default(null).catch(null), text: hex.nullable().default(null).catch(null) })
    .default({ background: null, surface: null, text: null })
    .catch({ background: null, surface: null, text: null }),
  sections: flags(SITE_SECTIONS, SECTION_DEFAULTS),
  software: flags(SOFTWARE_FEATURES, { ordenes: true, clientes: true, portal: true, avisos: true, solicitudes: true, equipo: true, matriculas: true }),
});
export type SiteTheme = z.output<typeof siteThemeSchema>;

export type SiteService = z.output<typeof serviceSchema>;
export type SiteContent = z.output<typeof siteContentSchema>;

/** Datos legales del titular de la web (LSSI art. 10). Lo que falte se queda en null: nunca se inventa. */
export interface SiteLegal {
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  registry: string | null;
  email: string | null;
}
export const EMPTY_LEGAL: SiteLegal = { legalName: null, taxId: null, address: null, registry: null, email: null };

export interface PublicSite {
  /** null = web de demostración local sin base de datos: no puede recibir solicitudes. */
  workshopId: string | null;
  slug: string;
  name: string;
  isDemoContent: boolean;
  accent: string;
  /** Vídeos de fondo; sin vídeo, la web usa un fondo animado. */
  videos: { hero: string | null; services: string | null };
  /** Secuencia de fotogramas controlada por el scroll (sustituye a los vídeos de portada y servicios). */
  scrollFrames: ScrollFrames | null;
  design: SiteDesign;
  headingFont: SiteTheme['headingFont'];
  logo: string | null;
  colors: SiteTheme['colors'];
  sections: Record<SiteSection, boolean>;
  software: Record<SoftwareFeature, boolean>;
  /** Sección comercial visible y con formulario: solo en webs de demostración. */
  salesEnabled: boolean;
  content: SiteContent;
  legal: SiteLegal;
}

/** Une los datos del taller con su tema y contenido ya validados. */
export function buildPublicSite(args: {
  workshopId: string | null;
  slug: string;
  name: string;
  isDemoContent: boolean;
  theme: unknown;
  content: unknown;
  legal?: SiteLegal;
}): PublicSite {
  const content = siteContentSchema.safeParse(args.content ?? {});
  const theme = siteThemeSchema.parse(typeof args.theme === 'object' && args.theme ? args.theme : {});
  return {
    workshopId: args.workshopId,
    slug: args.slug,
    name: args.name,
    isDemoContent: args.isDemoContent,
    accent: theme.accent,
    videos: { hero: theme.heroVideo, services: theme.servicesVideo },
    scrollFrames: theme.scrollFrames,
    design: theme.design,
    headingFont: theme.headingFont,
    logo: theme.logo,
    colors: theme.colors,
    sections: theme.sections,
    software: theme.software,
    salesEnabled: theme.sections.comercial && args.isDemoContent,
    content: content.success ? content.data : siteContentSchema.parse({}),
    legal: args.legal ?? EMPTY_LEGAL,
  };
}

const optText = z.string().nullish().transform(v => (v && v.trim() ? v.trim() : null));
const legalSchema = z.object({
  legal_name: optText, tax_id: optText, address_line: optText, postal_code: optText, city: optText, province: optText,
  registry_info: optText, email: optText,
}).partial();

function toLegal(raw: z.output<typeof legalSchema> | undefined): SiteLegal {
  if (!raw) return EMPTY_LEGAL;
  const place = [raw.postal_code, raw.city].filter(Boolean).join(' ');
  const address = [raw.address_line, place, raw.province && raw.province !== raw.city ? raw.province : null].filter(Boolean).join(', ');
  return { legalName: raw.legal_name ?? null, taxId: raw.tax_id ?? null, address: raw.address_line ? address : null, registry: raw.registry_info ?? null, email: raw.email ?? null };
}

const rpcResultSchema = z.object({
  // guid: cualquier identificador con forma de UUID (los de demostración no siguen el estándar RFC).
  workshop: z.object({ id: z.guid(), slug: z.string(), name: z.string() }),
  site: z.object({
    is_demo_content: z.boolean(),
    theme: z.unknown(),
    content: z.unknown(),
  }),
  legal: legalSchema.nullish(),
});

/** Convierte la respuesta de get_public_site en un PublicSite seguro de usar. */
export function parsePublicSite(raw: unknown): PublicSite | null {
  const parsed = rpcResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { workshop, site, legal } = parsed.data;
  return buildPublicSite({
    workshopId: workshop.id,
    slug: workshop.slug,
    name: workshop.name,
    isDemoContent: site.is_demo_content,
    theme: site.theme,
    content: site.content,
    legal: toLegal(legal ?? undefined),
  });
}

/**
 * Comprueba un archivo de configuración de taller (talleres/*.json) con más
 * rigor que la web: la web ignora lo que no entiende, pero aquí cualquier
 * clave desconocida o valor que la web descartaría es un error que conviene
 * ver antes de publicar. Devuelve la lista de problemas (vacía = correcto).
 */
export function configProblems(raw: unknown, schema: z.ZodType, path = ''): string[] {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map(i => `${path}${i.path.join('.')}: ${i.message}`);
  const problems: string[] = [];
  const walk = (a: unknown, b: unknown, at: string) => {
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return void problems.push(`${at.replace(/\.$/, '')}: lista no válida`);
      a.forEach((v, i) => walk(v, b[i], `${at}${i}.`));
    } else if (a && typeof a === 'object') {
      if (!b || typeof b !== 'object' || Array.isArray(b)) return void problems.push(`${at || '(raíz)'}: valor no válido`);
      for (const [k, v] of Object.entries(a)) {
        if (!(k in b)) problems.push(`${at}${k}: clave desconocida`);
        else walk(v, (b as Record<string, unknown>)[k], `${at}${k}.`);
      }
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push(`${at.replace(/\.$/, '')}: valor no válido (la web usaría ${JSON.stringify(b)})`);
    }
  };
  walk(raw, parsed.data, path);
  return problems;
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
