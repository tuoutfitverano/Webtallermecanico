/**
 * Protección de los formularios frente a spam y abusos.
 *
 *  1. Cloudflare Turnstile: comprobación anti-bots sin rompecabezas.
 *  2. Huella anónima del visitante para el límite de envíos (en la base de datos).
 *  3. Campo trampa ("honeypot") que las personas no ven y los bots rellenan
 *     (se comprueba en el manejador).
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'solicitud';

export type CaptchaResult = 'ok' | 'invalid' | 'error';

export interface CaptchaVerifier {
  verify(token: string, ip: string | null, expectedHost: string): Promise<CaptchaResult>;
}

/** Verifica el token de Turnstile en el servidor (nunca en el navegador). */
export function createTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): CaptchaVerifier {
  return {
    async verify(token, ip, expectedHost) {
      if (!token || token.length > 2048) return 'invalid';
      const form = new URLSearchParams({ secret, response: token });
      if (ip) form.set('remoteip', ip);
      let res: Response;
      try {
        res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
      } catch {
        return 'error';
      }
      if (!res.ok) return 'error';
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; hostname?: string; action?: string }
        | null;
      if (!data) return 'error';
      if (!data.success) return 'invalid';
      // Defensa extra: el token tiene que venir de esta web y de este formulario.
      if (data.hostname && data.hostname !== expectedHost) return 'invalid';
      if (data.action && data.action !== TURNSTILE_ACTION) return 'invalid';
      return 'ok';
    },
  };
}

/**
 * Huella anónima: HMAC-SHA256(secreto, IP + día). No permite recuperar el IP,
 * cambia cada día y solo sirve para contar envíos recientes.
 */
export async function clientFingerprint(ip: string | null, secret: string, day: string): Promise<string | null> {
  if (!ip || !secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ip}|${day}`));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
