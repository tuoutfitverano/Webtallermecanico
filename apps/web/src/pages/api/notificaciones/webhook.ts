/**
 * POST /api/notificaciones/webhook — confirmaciones de Resend (entregado,
 * rebotado, queja, fallido). Solo se acepta si la firma Svix es válida y
 * reciente. Responder 2xx evita que el proveedor reintente sin motivo.
 */
import type { APIRoute } from 'astro';
import { recordEmailDelivery, resendWebhookSecret } from '../../../lib/server/config.ts';
import { parseResendEvent, verifySvix } from '../../../lib/notifications/webhook.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const secret = resendWebhookSecret();
  if (!secret) return json(404, { ok: false });
  const body = await request.text();
  if (body.length > 64_000) return json(413, { ok: false });
  const valid = await verifySvix(secret, {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }, body);
  if (!valid) return json(401, { ok: false });

  let event: ReturnType<typeof parseResendEvent>;
  try {
    event = parseResendEvent(JSON.parse(body));
  } catch {
    return json(400, { ok: false });
  }
  if (!event || event.outcome === 'retrasado') return json(200, { ok: true, ignored: true });
  const saved = await recordEmailDelivery('resend', event.messageId, event.outcome);
  // Si no se pudo guardar, 500: el proveedor lo reintentará más tarde.
  return saved ? json(200, { ok: true }) : json(500, { ok: false });
};

export const ALL: APIRoute = () => json(405, { ok: false });
