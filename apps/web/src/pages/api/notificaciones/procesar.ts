/**
 * POST /api/notificaciones/procesar — envía los emails pendientes y los reintentos, y
 * hace el mantenimiento programado (borrar huellas antispam caducadas, etc.).
 *
 * Lo llama un aviso programado cada minuto (Supabase Cron + pg_net, ver
 * docs/NOTIFICACIONES.md) con "Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>".
 * Sin ese secreto configurado, el endpoint no existe (404). Procesa un lote
 * limitado por llamada: no hay bucles infinitos.
 */
import type { APIRoute } from 'astro';
import { dispatchPendingEmails, notificationsCronSecret, runMaintenance } from '../../../lib/server/config.ts';
import { bearerMatches } from '../../../lib/notifications/auth.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const secret = notificationsCronSecret();
  if (!secret) return json(404, { ok: false });
  if (!bearerMatches(request.headers.get('authorization'), secret)) return json(401, { ok: false });
  const [summary, maintenance] = await Promise.all([dispatchPendingEmails({ limit: 50 }), runMaintenance()]);
  return json(200, { ok: true, ...summary, maintenance });
};

export const ALL: APIRoute = () => json(405, { ok: false });
