import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_SITE } from './demo.ts';
import { parsePublicSite, siteContentSchema } from './content.ts';

describe('web de demostración', () => {
  it('la demo local y los datos de la base de datos (seed.sql) coinciden', () => {
    const seed = readFileSync(fileURLToPath(new URL('../../../../../supabase/seed.sql', import.meta.url)), 'utf8');
    const match = seed.match(/insert into public\.workshop_sites[\s\S]*?'(\{"accent"[^']*\})',\s*'([\s\S]*?)'\s*\);/);
    expect(match, 'no encuentro el contenido del taller demo en seed.sql').toBeTruthy();
    const content = siteContentSchema.parse(JSON.parse(match![2]!.replace(/''/g, "'")));
    expect(content).toEqual(DEMO_SITE.content);
    expect(JSON.parse(match![1]!).accent).toBe(DEMO_SITE.accent);
  });

  it('el contenido de un taller se valida y lo que falta tiene valores neutros', () => {
    const site = parsePublicSite({
      workshop: { id: 'd0000000-0000-4000-8000-000000000001', slug: 'x', name: 'Taller X' },
      site: { is_demo_content: false, theme: { accent: 'rojo' }, content: { phone: '600 000 000', services: 'no-es-una-lista' } },
    });
    expect(site?.accent).toBe('#e4572e');
    expect(site?.content.services).toEqual([]);
    expect(parsePublicSite({ cualquier: 'cosa' })).toBe(null);
  });
});

describe('identificadores', () => {
  it('acepta el id del taller demo aunque no sea un UUID estándar', () => {
    const site = parsePublicSite({
      workshop: { id: 'd0000000-0000-0000-0000-000000000001', slug: 'taller-demo', name: 'Taller Demo' },
      site: { is_demo_content: true, theme: {}, content: {} },
    });
    expect(site?.workshopId).toBe('d0000000-0000-0000-0000-000000000001');
  });
});
