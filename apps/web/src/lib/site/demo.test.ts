import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_CONFIG, DEMO_SITE } from './demo.ts';
import { parsePublicSite, siteContentSchema, siteThemeSchema } from './content.ts';

describe('web de demostración', () => {
  it('la demo local, seed.sql y talleres/autovalue.json coinciden', () => {
    const seed = readFileSync(fileURLToPath(new URL('../../../../../supabase/seed.sql', import.meta.url)), 'utf8');
    const theme = seed.match(/\$tema\$([\s\S]*?)\$tema\$/)?.[1];
    const content = seed.match(/\$contenido\$([\s\S]*?)\$contenido\$/)?.[1];
    expect(theme && content, 'no encuentro el tema y el contenido del taller demo en seed.sql').toBeTruthy();
    expect(JSON.parse(theme!)).toEqual(DEMO_CONFIG.theme);
    expect(JSON.parse(content!)).toEqual(DEMO_CONFIG.content);
    expect(seed).toContain(`'${DEMO_CONFIG.slug}', '${DEMO_CONFIG.name}', '${DEMO_CONFIG.status}'`);
    expect(DEMO_SITE.content).toEqual(siteContentSchema.parse(DEMO_CONFIG.content));
    expect(DEMO_SITE.scrollFrames).toEqual(siteThemeSchema.parse(DEMO_CONFIG.theme).scrollFrames);
  });

  it('el contenido de un taller se valida y lo que falta tiene valores neutros', () => {
    const site = parsePublicSite({
      workshop: { id: 'd0000000-0000-4000-8000-000000000001', slug: 'x', name: 'Taller X' },
      site: { is_demo_content: false, theme: { accent: 'rojo' }, content: { phone: '600 000 000', services: 'no-es-una-lista' } },
    });
    expect(site?.accent).toBe('#e4572e');
    expect(site?.videos).toEqual({ hero: null, services: null });
    expect(site?.content.services).toEqual([]);
    expect(parsePublicSite({ cualquier: 'cosa' })).toBe(null);
  });
});

describe('vídeos de fondo', () => {
  it('solo acepta direcciones https; lo demás se ignora sin romper el resto del tema', () => {
    const site = parsePublicSite({
      workshop: { id: 'd0000000-0000-4000-8000-000000000001', slug: 'x', name: 'Taller X' },
      site: {
        is_demo_content: false,
        theme: { accent: '#112233', heroVideo: 'http://ejemplo.es/v.mp4', servicesVideo: 'https://ejemplo.es/s.mp4' },
        content: {},
      },
    });
    expect(site?.accent).toBe('#112233');
    expect(site?.videos).toEqual({ hero: null, services: 'https://ejemplo.es/s.mp4' });
  });

  it('un vídeo con javascript: u otro esquema no se acepta', () => {
    expect(siteThemeSchema.parse({ heroVideo: 'javascript:alert(1)' }).heroVideo).toBe(null);
  });
});

describe('coche que gira con el scroll', () => {
  const base = { src: '/demo/x/{n}.webp', count: 10, poster: '/demo/x/p.webp' };
  it('acepta rutas de la propia web y https, con el punto del zoom', () => {
    expect(siteThemeSchema.parse({ scrollFrames: { ...base, focusX: 0.3, focusY: 0.4 } }).scrollFrames).toEqual({ ...base, focusX: 0.3, focusY: 0.4, backdrop: null, frameTop: 0, srcHd: null, backdropHd: null, turn: 1, endFrame: null, reverse: false, turnGap: 1.3, zoomGap: 1.7 });
    expect(siteThemeSchema.parse({ scrollFrames: { ...base, endFrame: 7, reverse: true } }).scrollFrames).toMatchObject({ endFrame: 7, reverse: true });
    expect(siteThemeSchema.parse({ scrollFrames: { ...base, backdrop: '/demo/x/garaje.webp', frameTop: 0.36 } }).scrollFrames?.backdrop).toBe('/demo/x/garaje.webp');
    expect(siteThemeSchema.parse({ scrollFrames: { ...base, src: 'https://cdn.ejemplo.es/{n}.webp' } }).scrollFrames?.focusX).toBe(0.5);
  });
  it('rechaza otros esquemas, rutas de otro dominio (//) o sin {n}, sin romper el resto del tema', () => {
    for (const bad of [{ ...base, srcHd: '/demo/x/4k.webp' }, { ...base, backdrop: 'javascript:alert(1)' }, { ...base, src: 'javascript:{n}' }, { ...base, src: '//otro.es/{n}.webp' }, { ...base, src: '/demo/x/1.webp' }, { ...base, poster: 'http://x.es/p.webp' }, { ...base, count: 1 }, { ...base, endFrame: 2.5 }, { ...base, endFrame: 0 }, { ...base, reverse: 'si' }]) {
      const theme = siteThemeSchema.parse({ accent: '#112233', scrollFrames: bad });
      expect(theme.scrollFrames).toBe(null);
      expect(theme.accent).toBe('#112233');
    }
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
