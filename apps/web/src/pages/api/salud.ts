/**
 * GET /api/salud — para un monitor externo (p. ej. un comprobador gratuito de
 * disponibilidad o una alerta de Cloudflare).
 *
 *  · Sin credenciales: solo { ok } y 200/503. No dice nada más a nadie.
 *  · Con «Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>»: además el estado
 *    de la base de datos y cuántos avisos llevan más de 30 minutos sin salir
 *    (solo recuentos, ningún dato personal).
 */
import type { APIRoute } from 'astro';
import { healthCheck, notificationsCronSecret } from '../../lib/server/config.ts';
import { bearerMatches } from '../../lib/notifications/auth.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const GET: APIRoute = async ({ request }) => {
  const report = await healthCheck();
  // Sin base de datos configurada (demo local) la web pública funciona igual: no es una caída.
  const ok = report.database !== 'error';
  const secret = notificationsCronSecret();
  const detailed = Boolean(secret && bearerMatches(request.headers.get('authorization'), secret));
  if (!detailed) return json(ok ? 200 : 503, { ok });
  const alert = (report.stuckNotifications ?? 0) > 0 || (report.stuckPush ?? 0) > 0;
  return json(ok ? 200 : 503, { ok, alert, ...report });
};

export const ALL: APIRoute = () => json(405, { ok: false });
