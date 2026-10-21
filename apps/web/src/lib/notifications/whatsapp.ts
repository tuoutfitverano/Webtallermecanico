/**
 * Canal WhatsApp con la API oficial de WhatsApp Business (Cloud API de Meta).
 *
 *   POST {base}/{phone_number_id}/messages
 *   Authorization: Bearer <WHATSAPP_TOKEN>
 *   { messaging_product: 'whatsapp', to, type: 'template', template: {…} }
 *
 * Un taller no puede escribir primero a un cliente con texto libre: solo con
 * una PLANTILLA aprobada por Meta. La nuestra («reparacion_estado_v1») tiene
 * tres huecos: {{1}} taller, {{2}} título del aviso y {{3}} detalle. El texto
 * fijo de la plantilla se escribe en el administrador de WhatsApp de Meta
 * (ver docs/NOTIFICACIONES.md).
 *
 * Meta no admite clave de idempotencia: el id del aviso viaja en
 * `biz_opaque_callback_data` y la base de datos evita reclamar dos veces el
 * mismo aviso. Solo se usa en el servidor: el token nunca llega al navegador.
 *
 * Sin dependencias de Astro: se prueba con dobles en notifications.test.ts.
 */
import type { ClaimedNotification } from './templates.ts';
import type { DispatchSummary } from './dispatcher.ts';
import type { SendOutcome } from './types.ts';

export const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';
export const WHATSAPP_TEMPLATE = 'reparacion_estado_v1';

export interface WhatsappMessage {
  /** Id del aviso (viaja como dato opaco para seguir la entrega). */
  id: string;
  /** Número en formato internacional sin «+» (34600000000). */
  to: string;
  params: [workshop: string, title: string, detail: string];
}

export interface WhatsappSender {
  id: string;
  send(message: WhatsappMessage): Promise<SendOutcome>;
}

export interface MetaOptions {
  token: string;
  phoneNumberId: string;
  template?: string;
  language?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createMetaWhatsappSender(opts: MetaOptions): WhatsappSender {
  const base = (opts.baseUrl || WHATSAPP_API_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'meta',
    async send(m) {
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: m.to,
        type: 'template',
        biz_opaque_callback_data: m.id,
        template: {
          name: opts.template || WHATSAPP_TEMPLATE,
          language: { code: opts.language || 'es' },
          components: [{ type: 'body', parameters: m.params.map(text => ({ type: 'text', text })) }],
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(`${base}/${encodeURIComponent(opts.phoneNumberId)}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
      } catch {
        return { kind: 'temporal', code: 'no_disponible' };
      }
      return outcomeFromMeta(res.status, await res.text().catch(() => ''));
    },
  };
}

/** Traduce la respuesta de Meta. Exportado para las pruebas. */
export function outcomeFromMeta(status: number, body: string): SendOutcome {
  let json: { messages?: { id?: unknown }[]; error?: { code?: unknown } } = {};
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    json = {};
  }
  if (status >= 200 && status < 300) {
    const id = json.messages?.[0]?.id;
    return { kind: 'aceptado', messageId: typeof id === 'string' && id.length <= 200 ? id : '' };
  }
  const code = typeof json.error?.code === 'number' ? json.error.code : null;
  // Límites de envío (por número, por cuenta o de la plataforma).
  if (status === 429 || code === 4 || code === 80007 || code === 130429 || code === 131056) return { kind: 'temporal', code: 'limite_proveedor' };
  // Token caducado o sin permisos: se reintenta (con espera) por si se corrige.
  if (status === 401 || status === 403 || code === 190 || code === 10 || code === 200) return { kind: 'temporal', code: 'credenciales' };
  if (status >= 500 || code === 131000 || code === 2) return { kind: 'temporal', code: 'no_disponible' };
  // Número sin WhatsApp, plantilla no aprobada, parámetros incorrectos…
  if (status === 400 || status === 404 || status === 422) return { kind: 'permanente', code: 'rechazado' };
  return { kind: 'temporal', code: 'error' };
}

/**
 * Meta no admite saltos de línea, tabuladores ni más de 4 espacios seguidos
 * dentro de un parámetro. Exportado para las pruebas.
 */
export function templateParam(s: string, max: number): string {
  const clean = s.replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || '—';
}

export function whatsappParams(n: Pick<ClaimedNotification, 'workshop_name' | 'title' | 'body'>): WhatsappMessage['params'] {
  return [templateParam(n.workshop_name, 60), templateParam(n.title, 120), templateParam(n.body, 700)];
}

// ---------------------------------------------------------------- despachador

export type ClaimedWhatsapp = Omit<ClaimedNotification, 'reply_to'>;

export interface WhatsappDispatchDeps {
  sender: WhatsappSender | null;
  claim(args: { limit: number; orderId: string | null }): Promise<{ data: ClaimedWhatsapp[] | null; error: { code?: string } | null }>;
  record(id: string, outcome: SendOutcome, provider: string): Promise<{ error: { code?: string } | null }>;
  log(event: string, meta?: Record<string, string | number | boolean>): void;
}

/**
 * Igual que los emails: sin proveedor no reclama nada (los avisos siguen
 * "pendientes" y nunca se dan por enviados); los reintentos y sus esperas los
 * decide la base de datos (record_whatsapp_result).
 */
export async function dispatchWhatsapp(deps: WhatsappDispatchDeps, opts: { limit?: number; orderId?: string | null } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { configured: Boolean(deps.sender), claimed: 0, accepted: 0, retrying: 0, failed: 0, unrecorded: 0 };
  const sender = deps.sender;
  if (!sender) return summary;

  const { data, error } = await deps.claim({ limit: Math.min(Math.max(opts.limit ?? 20, 1), 50), orderId: opts.orderId ?? null });
  if (error) {
    deps.log('whatsapp_claim_error', { code: error.code ?? 'desconocido' });
    return summary;
  }
  const batch = data ?? [];
  summary.claimed = batch.length;

  for (const n of batch) {
    let outcome: SendOutcome;
    if (n.template !== WHATSAPP_TEMPLATE || !/^[0-9]{8,15}$/.test(n.recipient)) {
      outcome = { kind: 'permanente', code: 'error' };
    } else {
      try {
        outcome = await sender.send({ id: n.id, to: n.recipient, params: whatsappParams(n) });
      } catch {
        outcome = { kind: 'temporal', code: 'error' };
      }
    }
    const saved = await deps.record(n.id, outcome, sender.id);
    if (saved.error) summary.unrecorded++;
    else if (outcome.kind === 'aceptado') summary.accepted++;
    else if (outcome.kind === 'temporal') summary.retrying++;
    else summary.failed++;
  }
  deps.log('whatsapp_dispatch', { ...summary });
  return summary;
}

// ---------------------------------------------------------------- webhook

/**
 * Meta firma cada aviso con el secreto de la app:
 *   X-Hub-Signature-256: sha256=<hex( HMAC-SHA256( secreto, cuerpo ) )>
 */
export async function signMeta(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verifyMetaSignature(secret: string, header: string | null, body: string): Promise<boolean> {
  if (!secret || !header || header.length !== 71) return false;
  const expected = await signMeta(secret, body);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/** Alta del webhook en Meta (GET con hub.challenge): solo si el token coincide. */
export function metaChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const given = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge') ?? '';
  if (!verifyToken || params.get('hub.mode') !== 'subscribe' || given.length !== verifyToken.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ verifyToken.charCodeAt(i);
  return diff === 0 && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

export type WhatsappDelivery = 'entregado' | 'leido' | 'fallido';

/** Estados de mensajes del aviso de Meta. Lo demás (mensajes entrantes, «sent») se ignora. */
export function parseMetaStatuses(json: unknown): { messageId: string; outcome: WhatsappDelivery }[] {
  const out: { messageId: string; outcome: WhatsappDelivery }[] = [];
  const map: Record<string, WhatsappDelivery> = { delivered: 'entregado', read: 'leido', failed: 'fallido' };
  const entries = (json as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries.slice(0, 20)) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes.slice(0, 20)) {
      const statuses = (change as { value?: { statuses?: unknown } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses.slice(0, 100)) {
        const { id, status } = (s ?? {}) as { id?: unknown; status?: unknown };
        const outcome = typeof status === 'string' ? map[status] : undefined;
        if (outcome && typeof id === 'string' && id && id.length <= 200) out.push({ messageId: id, outcome });
      }
    }
  }
  return out;
}
