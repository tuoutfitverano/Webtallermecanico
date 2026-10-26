/**
 * Notificaciones en el móvil (Web Push) del portal del cliente.
 *
 *  POST (formulario, desde la propia web, con sesión):
 *    accion=activar&endpoint=…  → guarda este dispositivo (save_push_subscription)
 *    accion=quitar&endpoint=…   → lo quita
 *  GET (lo pide public/sw.js al recibir el «toque»): el último aviso de la
 *    persona, con su sesión. Sin sesión, un texto general sin datos.
 *
 * Las reglas (de quién es cada dispositivo, límites) las pone la base de datos.
 */
import type { APIRoute, APIContext } from 'astro';
import { createAuthClient, getSessionUser, isSameOriginPost, logAuth } from '../../../lib/server/auth.ts';
import { readFormLimited } from '../../../lib/server/body.ts';
import { pushKeys } from '../../../lib/server/config.ts';

export const prerender = false;

const json = (status: number, body: unknown, headers?: Headers) => {
  const h = new Headers(headers);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
};

function session(ctx: APIContext) {
  const responseHeaders = new Headers();
  const supabase = createAuthClient({ request: ctx.request, url: ctx.url, cookies: ctx.cookies, responseHeaders });
  return { supabase, responseHeaders };
}

const GENERIC = { title: 'Tienes un aviso nuevo', body: 'Abre tu portal para verlo.', url: '/portal/avisos' };

export const GET: APIRoute = async ctx => {
  const { supabase, responseHeaders } = session(ctx);
  const user = await getSessionUser(supabase);
  if (!user || !supabase) return json(200, GENERIC, responseHeaders);
  const { data, error } = await supabase.rpc('portal_push_preview');
  if (error) logAuth('push_preview_error', error.code);
  const row = (Array.isArray(data) ? data[0] : null) as { title: string; body: string; link_path: string; workshop_name: string } | null;
  if (!row) return json(200, GENERIC, responseHeaders);
  return json(200, { title: `${row.workshop_name}: ${row.title}`, body: row.body, url: row.link_path?.startsWith('/portal/') ? row.link_path : '/portal/avisos' }, responseHeaders);
};

export const POST: APIRoute = async ctx => {
  if (!isSameOriginPost(ctx.request)) return json(403, { ok: false });
  const form = await readFormLimited(ctx.request);
  if (!form) return json(400, { ok: false });
  const { supabase, responseHeaders } = session(ctx);
  const user = await getSessionUser(supabase);
  if (!user || !supabase) return json(401, { ok: false, reason: 'sesion' }, responseHeaders);
  if (!pushKeys()) return json(503, { ok: false, reason: 'no_disponible' }, responseHeaders);

  const action = String(form.get('accion') ?? '');
  const endpoint = String(form.get('endpoint') ?? '').trim();
  if (!endpoint || endpoint.length > 1000) return json(422, { ok: false, reason: 'endpoint' }, responseHeaders);
  const { error } = action === 'activar'
    ? await supabase.rpc('save_push_subscription', { p_endpoint: endpoint })
    : action === 'quitar'
      ? await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
      : { error: { code: '22023' } };
  if (error) {
    logAuth('push_subscription_error', error.code);
    return json(error.code === '23514' ? 422 : 400, { ok: false }, responseHeaders);
  }
  return json(200, { ok: true }, responseHeaders);
};

export const ALL: APIRoute = () => json(405, { ok: false });
