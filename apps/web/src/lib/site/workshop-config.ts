/**
 * Archivo de configuración de un taller (talleres/<taller>.json).
 *
 * Un archivo por taller con todo lo que es SUYO: nombre, dominios, textos,
 * servicios, contacto, colores, logotipo, secciones visibles y funciones del
 * software que se enseñan. Los componentes y el diseño son compartidos.
 *
 * El archivo no se lee en producción: la web lee la base de datos
 * (workshop_sites). Este módulo sirve para:
 *  · comprobar el archivo antes de publicarlo (configProblems, más estricto
 *    que la web);
 *  · generar el SQL que lo carga en Supabase (scripts/taller/sql.ts);
 *  · la demo local sin base de datos (AutoValue, lib/site/demo.ts).
 */
import { z } from 'zod';
import { buildPublicSite, configProblems, siteContentSchema, siteThemeSchema, type PublicSite } from './content.ts';

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const workshopConfigSchema = z
  .object({
    /** Identificador corto y estable (minúsculas, números y guiones). */
    slug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])$/, 'slug: minúsculas, números y guiones (2 a 60)'),
    name: z.string().trim().min(2).max(120),
    /** «demo» = taller ficticio de demostración; «activo» = taller real. */
    status: z.enum(['demo', 'activo']),
    /** Cuenta (ya registrada y con el correo confirmado) que será propietaria. null = el taller ya existe. */
    ownerEmail: z.email().nullable(),
    /** Dominios de la web; el primero es el principal. */
    domains: z.array(z.string().regex(HOSTNAME_RE, 'dominio no válido')).min(1).max(10),
    published: z.boolean(),
    /** true mientras haya datos de ejemplo: la web lo avisa y no aparece en buscadores. */
    isDemoContent: z.boolean(),
    theme: z.record(z.string(), z.unknown()),
    content: z.record(z.string(), z.unknown()),
  })
  .strict();
export type WorkshopConfig = z.output<typeof workshopConfigSchema>;

/** Problemas del archivo (vacío = se puede publicar). */
export function checkWorkshopConfig(raw: unknown): string[] {
  const base = workshopConfigSchema.safeParse(raw);
  if (!base.success) return base.error.issues.map(i => `${i.path.join('.') || '(archivo)'}: ${i.message}`);
  const cfg = base.data;
  const problems = [
    ...configProblems(cfg.theme, siteThemeSchema, 'theme.'),
    ...configProblems(cfg.content, siteContentSchema, 'content.'),
  ];
  if (cfg.status !== 'demo' && cfg.theme.sections && (cfg.theme.sections as Record<string, unknown>).comercial === true) {
    problems.push('theme.sections.comercial: la sección comercial es solo para talleres de demostración');
  }
  if (cfg.status === 'demo' && !cfg.isDemoContent) problems.push('isDemoContent: un taller de demostración debe marcar su contenido como de demostración');
  return problems;
}

/** La web tal y como se vería con este archivo (sin base de datos: no recibe solicitudes). */
export function siteFromConfig(cfg: WorkshopConfig, workshopId: string | null = null): PublicSite {
  return buildPublicSite({ workshopId, slug: cfg.slug, name: cfg.name, isDemoContent: cfg.isDemoContent, theme: cfg.theme, content: cfg.content });
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;
const sqlJson = (v: unknown) => {
  const json = JSON.stringify(v, null, 2);
  if (json.includes('$cfg$')) throw new Error('El archivo contiene la secuencia reservada $cfg$.');
  return `$cfg$${json}$cfg$::jsonb`;
};

/**
 * SQL para cargar el archivo en Supabase (SQL Editor). No se ejecuta solo:
 * se revisa y se pega a mano, porque toca la base de datos de producción.
 */
export function configToSql(cfg: WorkshopConfig, source: string): string {
  const slug = sqlText(cfg.slug);
  const lines = [
    `-- Web del taller «${cfg.name}», generada desde ${source}.`,
    '-- Revísala y ejecútala en el SQL Editor de Supabase. Se puede repetir: actualiza lo que ya exista.',
    'begin;',
    '',
  ];
  if (cfg.ownerEmail) {
    lines.push(
      '-- 1. Alta del taller y su propietario (la cuenta debe existir y tener el correo confirmado).',
      `select private.create_workshop(${slug}, ${sqlText(cfg.name)}, ${sqlText(cfg.ownerEmail)}, ${sqlText(cfg.status)})`,
      ` where not exists (select 1 from public.workshops where slug = ${slug});`,
      '',
    );
  } else {
    lines.push('-- 1. El taller ya existe (ownerEmail = null): solo se actualiza su web.', '');
  }
  lines.push(
    '-- 2. Nombre, contenido y aspecto de la web.',
    `update public.workshops set name = ${sqlText(cfg.name)} where slug = ${slug};`,
    'update public.workshop_sites s',
    `   set theme = ${sqlJson(cfg.theme)},`,
    `       content = ${sqlJson(cfg.content)},`,
    `       is_demo_content = ${cfg.isDemoContent}, published = ${cfg.published}`,
    '  from public.workshops w',
    ` where w.id = s.workshop_id and w.slug = ${slug};`,
    '',
    '-- 3. Dominios. verified_at = now() SOLO cuando el dominio ya apunte a la web (Cloudflare).',
  );
  cfg.domains.forEach((host, i) => {
    lines.push(
      'insert into public.workshop_domains (hostname, workshop_id, is_primary, verified_at)',
      `select ${sqlText(host)}, w.id, ${i === 0}, now() from public.workshops w where w.slug = ${slug}`,
      'on conflict (hostname) do nothing;',
    );
  });
  lines.push('', '-- Comprueba el resultado antes de confirmar:', `select w.slug, w.status, s.published, s.is_demo_content from public.workshops w join public.workshop_sites s on s.workshop_id = w.id where w.slug = ${slug};`, 'commit;', '');
  return lines.join('\n');
}
