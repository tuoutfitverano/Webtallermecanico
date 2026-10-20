/**
 * POST /api/preferencias — guarda en este dispositivo lo que la propia persona
 * elige: el modo claro u oscuro (cookie «tema», en toda la aplicación) y el
 * color del panel y del portal (cookie «color_panel»). Son cookies de
 * personalización pedidas por la persona. Es la reserva sin JavaScript de los
 * botones de modo y de color.
 */
import type { APIRoute } from 'astro';
import { PANEL_COLOR_COOKIE, isPanelColor } from '../../lib/panel/colors.ts';
import { THEME_COOKIE, isTheme } from '../../lib/theme.ts';
import { safeNext } from '../../lib/auth/redirect.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Envío no permitido.', { status: 403 });
  const form = await request.formData().catch(() => null);
  const color = form?.get('color');
  const theme = form?.get('tema');
  const next = safeNext(form?.get('next'), url.origin, '/');
  const options = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: false } as const;
  if (isPanelColor(color)) cookies.set(PANEL_COLOR_COOKIE, color, options);
  if (isTheme(theme)) cookies.set(THEME_COOKIE, theme, options);
  return new Response(null, { status: 303, headers: { location: next, 'cache-control': 'no-store' } });
};

export const ALL: APIRoute = () => new Response('Método no permitido.', { status: 405 });
