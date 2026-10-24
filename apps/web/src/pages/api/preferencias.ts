/**
 * POST /api/preferencias — la reserva sin JavaScript del aviso de cookies y de
 * los botones de modo y de color:
 *  · «cookies»: acepta o rechaza las cookies de preferencias (cookie técnica
 *    «consentimiento»). Al rechazar se borran las preferencias guardadas.
 *  · «tema» y «color»: el modo claro u oscuro y el color del panel; con las
 *    cookies de preferencias aceptadas se guardan 1 año; si no, solo durante
 *    la visita (cookie de sesión).
 */
import type { APIRoute } from 'astro';
import { PANEL_COLOR_COOKIE, isPanelColor } from '../../lib/panel/colors.ts';
import { THEME_COOKIE, isTheme } from '../../lib/theme.ts';
import { CONSENT_COOKIE, CONSENT_MAX_AGE, PREFERENCE_COOKIES, consentFrom } from '../../lib/consent.ts';
import { safeNext } from '../../lib/auth/redirect.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response('Envío no permitido.', { status: 403 });
  const form = await request.formData().catch(() => null);
  const color = form?.get('color');
  const theme = form?.get('tema');
  // Volver a la página desde la que se pulsó. safeNext no deja volver a /acceso o /registro
  // (evita bucles al iniciar sesión), pero aquí sí hay que volver a ellas.
  const rawNext = form?.get('next');
  const authBack = typeof rawNext === 'string' && /^\/(acceso|registro|recuperar)(\/[\w-]+)?(\?[\w=&%.-]*)?$/.test(rawNext) ? rawNext : null;
  const next = authBack ?? safeNext(rawNext, url.origin, '/');
  const options = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: url.protocol === 'https:', httpOnly: false } as const;
  const answer = consentFrom(form?.get('cookies'));
  if (answer) {
    cookies.set(CONSENT_COOKIE, answer, { ...options, maxAge: CONSENT_MAX_AGE });
    if (answer === 'rechazadas') for (const name of PREFERENCE_COOKIES) cookies.delete(name, { path: '/' });
  }
  const accepted = (answer ?? consentFrom(cookies.get(CONSENT_COOKIE)?.value)) === 'aceptadas';
  // Con las cookies de preferencias aceptadas, 1 año; si no, solo esta visita (cookie de sesión).
  const keep = accepted ? options : { ...options, maxAge: undefined };
  if (isPanelColor(color)) cookies.set(PANEL_COLOR_COOKIE, color, keep);
  if (isTheme(theme)) cookies.set(THEME_COOKIE, theme, keep);
  return new Response(null, { status: 303, headers: { location: next, 'cache-control': 'no-store' } });
};

export const ALL: APIRoute = () => new Response('Método no permitido.', { status: 405 });
