/**
 * Canal email con Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 *   POST {base}/emails
 *   Authorization: Bearer <RESEND_API_KEY>
 *   Idempotency-Key: <id del aviso>   (Resend descarta el duplicado durante 24 h)
 *
 * Solo se usa en el servidor: la clave nunca llega al navegador.
 */
import type { ChannelSender, SendOutcome } from './types.ts';

export const RESEND_API_URL = 'https://api.resend.com';

export interface ResendOptions {
  apiKey: string;
  /** Dirección remitente de un dominio verificado en Resend, p. ej. avisos@tudominio.es */
  fromAddress: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createResendSender(opts: ResendOptions): ChannelSender {
  const base = (opts.baseUrl || RESEND_API_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'resend',
    async send(m) {
      const body = {
        from: `${displayName(m.fromName)} <${opts.fromAddress}>`,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.id },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
      } catch {
        return { kind: 'temporal', code: 'no_disponible' };
      }
      return outcomeFromResend(res.status, await res.text().catch(() => ''));
    },
  };
}

/** Traduce la respuesta de Resend. Exportado para las pruebas. */
export function outcomeFromResend(status: number, body: string): SendOutcome {
  if (status >= 200 && status < 300) {
    let id: unknown;
    try {
      id = (JSON.parse(body) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    // Sin id no podemos seguir la entrega, pero el proveedor lo ha aceptado.
    return { kind: 'aceptado', messageId: typeof id === 'string' && id.length <= 200 ? id : '' };
  }
  if (status === 429) return { kind: 'temporal', code: 'limite_proveedor' };
  // Clave o dominio mal configurados: se reintenta (con espera) por si se corrige.
  if (status === 401 || status === 403) return { kind: 'temporal', code: 'credenciales' };
  if (status === 409) return { kind: 'permanente', code: 'conflicto' };
  if (status === 400 || status === 422) return { kind: 'permanente', code: 'rechazado' };
  if (status >= 500) return { kind: 'temporal', code: 'no_disponible' };
  return { kind: 'temporal', code: 'error' };
}

/** Nombre del remitente sin caracteres que rompan la cabecera "From". */
function displayName(name: string): string {
  const clean = [...name].filter(c => c.charCodeAt(0) >= 32 && !'"<>\\'.includes(c)).join('').trim().slice(0, 80);
  return `"${clean || 'Taller'}"`;
}
