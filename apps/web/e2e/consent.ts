/**
 * Las pruebas entran con el aviso de cookies ya respondido («aceptadas») para que
 * no tape botones: lo usa la configuración por defecto y los contextos que crean
 * las propias pruebas. El aviso en sí se prueba en calidad.spec.ts con contextos sin él.
 */
import type { BrowserContext } from '@playwright/test';

const HOSTS = ['demo.localhost', 'plantilla.localhost', 'localhost', '127.0.0.1'];

export const ACCEPTED_COOKIES = {
  cookies: HOSTS.map(domain => ({ name: 'consentimiento', value: 'aceptadas', domain, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const })),
  origins: [],
};

export async function acceptCookies(context: BrowserContext) {
  await context.addCookies(ACCEPTED_COOKIES.cookies);
  return context;
}
