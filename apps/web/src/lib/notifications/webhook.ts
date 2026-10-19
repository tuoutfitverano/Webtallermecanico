/**
 * Webhooks de Resend (entregas, rebotes, quejas). Resend los firma con Svix:
 *   cabeceras svix-id, svix-timestamp, svix-signature ("v1,<base64> v1,<base64>…")
 *   firma = base64( HMAC-SHA256( clave, `${id}.${timestamp}.${cuerpo}` ) )
 *   clave = base64 decodificado del secreto "whsec_…"
 * Se rechaza lo que no esté firmado o tenga más de 5 minutos (repeticiones).
 */

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(secret: string, id: string, timestamp: string, body: string): Promise<string | null> {
  const keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  if (!keyBytes || keyBytes.length === 0) return null;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToBase64(sig);
}

export async function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature || id.length > 200 || signature.length > 2000) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const expected = await signSvix(secret, id, timestamp, body);
  if (!expected) return false;
  return signature.split(' ').some(part => {
    const [version, sig] = part.split(',');
    return version === 'v1' && typeof sig === 'string' && safeEqual(sig, expected);
  });
}

export type DeliveryOutcome = 'entregado' | 'rebotado' | 'queja' | 'fallido' | 'retrasado';

/** Evento de Resend → resultado interno. Los que no nos interesan (aperturas, clics…) se ignoran. */
export function parseResendEvent(json: unknown): { messageId: string; outcome: DeliveryOutcome } | null {
  if (typeof json !== 'object' || json === null) return null;
  const { type, data } = json as { type?: unknown; data?: { email_id?: unknown } };
  const messageId = data?.email_id;
  if (typeof messageId !== 'string' || !messageId || messageId.length > 200) return null;
  const map: Record<string, DeliveryOutcome> = {
    'email.delivered': 'entregado',
    'email.bounced': 'rebotado',
    'email.complained': 'queja',
    'email.failed': 'fallido',
    'email.delivery_delayed': 'retrasado',
  };
  const outcome = typeof type === 'string' ? map[type] : undefined;
  return outcome ? { messageId, outcome } : null;
}
