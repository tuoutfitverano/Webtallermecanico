/**
 * POST /api/notificaciones/procesar — envía los emails, WhatsApp y notificaciones al móvil pendientes y los reintentos, y
 * hace el mantenimiento programado (borrar huellas antispam caducadas, etc.).
 *
 * Lo llama un aviso programado cada minuto (Supabase Cron + pg_net, ver
 * docs/NOTIFICACIONES.md) con "Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>".
 * Sin ese secreto configurado, el endpoint no existe (404). Procesa un lote
 * limitado por llamada: no hay bucles infinitos.
 */
import type { APIRoute } from 'astro';
import { dispatchPendingEmails, dispatchPendingPush, dispatchPendingWhatsapp, notificationsCronSecret, runMaintenance } from '../../../lib/server/config.ts';
import { bearerMatches } from '../../../lib/notifications/auth.ts';
import { logEvent } from '../../../lib/server/log.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const secret = notificationsCronSecret();
  if (!secret) return json(404, { ok: false });
  if (!bearerMatches(request.headers.get('authorization'), secret)) return json(401, { ok: false });
  // Cada parte va por su cuenta: si una falla (p. ej. el proveedor de correo no responde), las demás se hacen igual.
  const started = Date.now();
  const [email, whatsapp, push, maintenance] = await Promise.allSettled([
    dispatchPendingEmails({ limit: 50 }),
    dispatchPendingWhatsapp({ limit: 50 }),
    dispatchPendingPush({ limit: 100 }),
    runMaintenance(),
  ]);
  const parts = { email, whatsapp, push, maintenance };
  const failed = Object.entries(parts).filter(([, r]) => r.status === 'rejected').map(([name]) => name);
  for (const name of failed) logEvent('cron_part_error', { part: name });
  logEvent('cron_run', { ms: Date.now() - started, failed: failed.length });
  const value = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
  // Con alguna parte fallida, 500: la tarea programada y cualquier monitor lo ven como fallo.
  return json(failed.length ? 500 : 200, { ...(value(email) ?? {}), ok: failed.length === 0, failedParts: failed, whatsapp: value(whatsapp), push: value(push), maintenance: value(maintenance) });
};

export const ALL: APIRoute = () => json(405, { ok: false });
