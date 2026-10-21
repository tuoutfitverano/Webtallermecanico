import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCsp, contentSecurityPolicy, sha256Base64 } from './csp.ts';
import { INLINE_SCRIPTS, PANEL_COLOR_SCRIPT, THEME_SCRIPT } from '../inline-scripts.ts';

/** Ejecuta un script en línea con un documento mínimo y devuelve los data-* que ha puesto. */
function run(script: string, cookie: string, session: Record<string, string> = {}) {
  const dataset: Record<string, string> = {};
  const document = { cookie, documentElement: { dataset }, addEventListener() {} };
  const storage = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
  new Function('document', 'sessionStorage', 'localStorage', script)(document, storage(session), storage({}));
  return dataset;
}

describe('CSP', () => {
  it('la huella coincide con la de Node (la que calcula el navegador)', async () => {
    for (const s of INLINE_SCRIPTS) expect(await sha256Base64(s)).toBe(createHash('sha256').update(s, 'utf8').digest('base64'));
  });

  it('solo deja scripts propios, Turnstile y los scripts en línea conocidos', async () => {
    const csp = await contentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com( 'sha256-[A-Za-z0-9+/]+=*'){4}$/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(await buildCsp(['x'])).toContain(`'sha256-${createHash('sha256').update('x').digest('base64')}'`);
  });
});

describe('scripts en línea', () => {
  it('el modo y el consentimiento se aplican desde la cookie, y un valor desconocido no cambia nada', () => {
    expect(run(THEME_SCRIPT, 'tema=claro; consentimiento=rechazadas')).toEqual({ theme: 'claro', cookies: 'rechazadas' });
    expect(run(THEME_SCRIPT, 'tema=rosa')).toEqual({});
    expect(run(THEME_SCRIPT, '', { tema: 'oscuro' })).toEqual({ theme: 'oscuro' });
  });

  it('el color del panel solo acepta colores de la lista', () => {
    expect(run(PANEL_COLOR_SCRIPT, 'color_panel=verde')).toEqual({ color: 'verde' });
    expect(run(PANEL_COLOR_SCRIPT, 'color_panel=<x>')).toEqual({});
  });
});
