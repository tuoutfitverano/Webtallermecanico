/**
 * /api/notificaciones/whatsapp — avisos de Meta sobre los WhatsApp enviados.
 *
 *  · GET: alta del webhook en Meta (devuelve hub.challenge solo si el token
 *    de verificación coincide con WHATSAPP_VERIFY_TOKEN).
 *  · POST: estados (entregado, leído, fallido). Solo se acepta con la firma
 *    X-Hub-Signature-256 válida (secreto de la app). Responder 2xx evita que
 *    Meta reintente sin motivo.
 *
 * Sin los secretos configurados, el endpoint no existe (404).
 */
import type { APIRoute } from 'astro';
import { recordWhatsappDelivery, whatsappWebhookSecrets } from '../../../lib/server/config.ts';
import { metaChallenge, parseMetaStatuses, verifyMetaSignature } from '../../../lib/notifications/whatsapp.ts';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const GET: APIRoute = ({ url }) => {
  const { verifyToken } = whatsappWebhookSecrets();
  if (!verifyToken) return json(404, { ok: false });
  const challenge = metaChallenge(url.searchParams, verifyToken);
  return challenge === null
    ? json(403, { ok: false })
    : new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
};

export const POST: APIRoute = async ({ request }) => {
  const { appSecret } = whatsappWebhookSecrets();
  if (!appSecret) return json(404, { ok: false });
  const body = await request.text();
  if (body.length > 256_000) return json(413, { ok: false });
  if (!(await verifyMetaSignature(appSecret, request.headers.get('x-hub-signature-256'), body))) return json(401, { ok: false });

  let statuses: ReturnType<typeof parseMetaStatuses>;
  try {
    statuses = parseMetaStatuses(JSON.parse(body));
  } catch {
    return json(400, { ok: false });
  }
  let failed = 0;
  for (const s of statuses) if (!(await recordWhatsappDelivery(s.messageId, s.outcome))) failed++;
  // Si algo no se pudo guardar, 500: Meta lo reintentará más tarde (anotar es idempotente).
  return failed ? json(500, { ok: false }) : json(200, { ok: true, recorded: statuses.length });
};

export const ALL: APIRoute = () => json(405, { ok: false });
