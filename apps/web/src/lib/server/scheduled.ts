/**
 * Tarea programada del Worker (Cloudflare Cron Triggers, ver wrangler.jsonc):
 * cada pocos minutos llama a POST /api/notificaciones/procesar, que envía los
 * avisos pendientes (email, WhatsApp) y hace el mantenimiento (borra huellas
 * antispam caducadas, caduca presupuestos, genera recordatorios…).
 *
 * La petición va por la MISMA aplicación (sin salir a internet) y con el mismo
 * secreto que cualquier otra llamada: si falta APP_URL o el secreto, no hace
 * nada y lo deja registrado. Sin dependencias de Astro: se prueba en
 * scheduled.test.ts.
 */
export interface ScheduledEnv {
  APP_URL?: string;
  NOTIFICATIONS_CRON_SECRET?: string;
}

/** Mismo mínimo que notificationsCronSecret() en config.ts. */
const MIN_SECRET = 24;

export function cronRequest(env: ScheduledEnv): Request | null {
  const secret = env.NOTIFICATIONS_CRON_SECRET ?? '';
  if (secret.length < MIN_SECRET || !env.APP_URL) return null;
  let url: URL;
  try {
    url = new URL('/api/notificaciones/procesar', env.APP_URL);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
  return new Request(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
}

export type Handler = (request: Request) => Promise<Response>;

/** Ejecuta una vuelta. Devuelve un código corto para los registros (nunca datos). */
export async function runScheduled(env: ScheduledEnv, handler: Handler): Promise<string> {
  const request = cronRequest(env);
  if (!request) return 'cron_sin_configurar';
  try {
    const response = await handler(request);
    return response.ok ? 'cron_ok' : `cron_error_${response.status}`;
  } catch {
    return 'cron_excepcion';
  }
}
