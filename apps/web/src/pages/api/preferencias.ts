/**
 * POST /api/preferencias — guarda en este dispositivo el color elegido para el
 * panel y el portal (cookie de personalización pedida por la propia persona).
 * Es la reserva sin JavaScript del selector de color.
 */
import type { APIRoute } from 'astro';
import { PANEL_COLOR_COOKIE, isPanelColor } from '../../lib/panel/colors.ts';
import { safeNext } from '../../lib/auth/redirect.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Envío no permitido.', { status: 403 });
  const form = await request.formData().catch(() => null);
  const color = form?.get('color');
  const next = safeNext(form?.get('next'), url.origin, '/panel');
  if (isPanelColor(color)) {
    cookies.set(PANEL_COLOR_COOKIE, color, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: false });
  }
  return new Response(null, { status: 303, headers: { location: next, 'cache-control': 'no-store' } });
};

export const ALL: APIRoute = () => new Response('Método no permitido.', { status: 405 });
