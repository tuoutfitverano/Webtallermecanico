import { describe, expect, it } from 'vitest';
import { DEMO_CONFIG } from './demo.ts';
import { exportedSite, exportedSiteFrom, WEB_EXPORT } from './export.ts';

describe('copia de la web de un taller', () => {
  it('desde el archivo del taller: sin nada de la plataforma', () => {
    const site = exportedSiteFrom(DEMO_CONFIG);
    expect(site?.name).toBe(DEMO_CONFIG.name);
    expect(site?.workshopId).toBe(null);
    expect(site?.salesEnabled).toBe(false);
    expect(Object.values(site!.software).every(v => v === false)).toBe(true);
    expect(site?.sections).toMatchObject({ software: false, ventajas: false, comercial: false });
    // Lo del taller se conserva tal cual.
    expect(site?.sections.servicios).toBe(true);
    expect(site?.content.phone).toBe(DEMO_CONFIG.content.phone);
  });

  it('desde los datos de la base de datos (misma forma que get_public_site)', () => {
    const site = exportedSiteFrom({
      workshop: { id: 'd0000000-0000-4000-8000-000000000001', slug: 'taller-x', name: 'Taller X' },
      site: { is_demo_content: false, theme: { sections: { comercial: true, software: true } }, content: { phone: '600 000 000' } },
      legal: { legal_name: 'Taller X SL' },
    });
    expect(site?.name).toBe('Taller X');
    expect(site?.workshopId).toBe(null);
    expect(site?.sections).toMatchObject({ software: false, comercial: false });
  });

  it('datos que no son de un taller: no hay copia', () => {
    expect(exportedSiteFrom(null)).toBe(null);
    expect(exportedSiteFrom({ cualquier: 'cosa' })).toBe(null);
  });

  it('fuera de la exportación no hace nada', () => {
    expect(WEB_EXPORT).toBe(false);
    expect(exportedSite()).toBe(null);
  });
});
