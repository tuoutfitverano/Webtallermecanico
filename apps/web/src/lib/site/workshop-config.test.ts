import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkWorkshopConfig, configToSql, siteFromConfig, workshopConfigSchema } from './workshop-config.ts';

const dir = new URL('../../../../../talleres/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Record<string, unknown>;

describe('archivos de talleres (talleres/*.json)', () => {
  it('hay al menos AutoValue y la plantilla', () => {
    expect(files).toEqual(expect.arrayContaining(['autovalue.json', 'plantilla.json']));
  });

  it.each(files)('%s es correcto (sin claves desconocidas ni valores que la web descartaría)', f => {
    expect(checkWorkshopConfig(load(f))).toEqual([]);
  });

  it('AutoValue: diseño premium, sección comercial (es una demo) y datos de demostración marcados', () => {
    const site = siteFromConfig(workshopConfigSchema.parse(load('autovalue.json')));
    expect(site.design).toBe('premium');
    expect(site.isDemoContent).toBe(true);
    expect(site.salesEnabled).toBe(true);
    expect(site.content.hero.title).toBe('La mecánica evoluciona. Tu taller también.');
  });

  it('la plantilla no activa la sección comercial ni se publica sola', () => {
    const cfg = workshopConfigSchema.parse(load('plantilla.json'));
    expect(cfg.published).toBe(false);
    expect(siteFromConfig(cfg).salesEnabled).toBe(false);
  });
});

describe('comprobación del archivo', () => {
  const ok = load('autovalue.json');
  it('detecta claves mal escritas y valores que la web ignoraría', () => {
    const bad = structuredClone(ok);
    (bad.theme as Record<string, unknown>).acent = '#123456';
    (bad.theme as Record<string, unknown>).design = 'moderno';
    (bad.content as Record<string, unknown>).telefono = '600';
    expect(checkWorkshopConfig(bad)).toEqual(expect.arrayContaining([
      'theme.acent: clave desconocida',
      expect.stringMatching(/^theme\.design: valor no válido/),
      'content.telefono: clave desconocida',
    ]));
  });

  it('la sección comercial solo en talleres de demostración', () => {
    const bad = { ...structuredClone(ok), status: 'activo', isDemoContent: false };
    expect(checkWorkshopConfig(bad)).toContain('theme.sections.comercial: la sección comercial es solo para talleres de demostración');
  });

  it('dominios, slug y correo del propietario con formato válido', () => {
    expect(checkWorkshopConfig({ ...ok, slug: 'Mi Taller', domains: ['http://x.es'], ownerEmail: 'no' }).length).toBeGreaterThanOrEqual(3);
  });

  it('una configuración mínima (solo lo obligatorio) también da una web completa', () => {
    const cfg = workshopConfigSchema.parse({ ...ok, theme: {}, content: {} });
    const site = siteFromConfig(cfg);
    expect(site.design).toBe('clasico');
    expect(site.sections.servicios).toBe(true);
    expect(site.sections.comercial).toBe(false);
    expect(site.content.services).toEqual([]);
  });
});

describe('SQL generado', () => {
  it('crea el taller solo si hay propietario, carga tema y contenido y añade los dominios', () => {
    const cfg = workshopConfigSchema.parse(load('plantilla.json'));
    const sql = configToSql(cfg, 'talleres/plantilla.json');
    expect(sql).toContain("select private.create_workshop('nombre-del-taller', 'NOMBRE DEL TALLER', 'propietario@correo-del-taller.es', 'activo')");
    expect(sql).toContain('$cfg${');
    expect(sql).toContain("'www.dominio-del-taller.es', w.id, true, now()");
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });

  it('escapa las comillas de los textos', () => {
    const cfg = workshopConfigSchema.parse({ ...load('autovalue.json'), name: "Taller O'Brien" });
    expect(configToSql(cfg, 'x')).toContain("set name = 'Taller O''Brien'");
  });
});
