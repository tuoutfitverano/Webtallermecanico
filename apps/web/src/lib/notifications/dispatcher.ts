/**
 * Despachador de emails pendientes (sin dependencias de Astro: se prueba con
 * dobles en notifications.test.ts).
 *
 *  · Sin proveedor configurado NO reclama nada: los avisos siguen
 *    "pendientes" (y caducan a los 2 días). Nunca se marcan como enviados.
 *  · Reclama un lote (la base de datos evita que dos procesos cojan el mismo),
 *    envía con clave de idempotencia y anota el resultado. Los reintentos, sus
 *    esperas y el límite los decide record_email_result en la base de datos.
 *  · Si anotar el resultado falla, el aviso se queda "procesando" y la base de
 *    datos lo devuelve a la cola a los 10 minutos; el proveedor descarta el
 *    duplicado gracias a la clave de idempotencia.
 */
import { isKnownTemplate, renderEmail, type ClaimedNotification } from './templates.ts';
import type { ChannelSender, SendOutcome } from './types.ts';

export interface DispatchDeps {
  sender: ChannelSender | null;
  claim(args: { limit: number; orderId: string | null }): Promise<{ data: ClaimedNotification[] | null; error: { code?: string } | null }>;
  record(id: string, outcome: SendOutcome, provider: string): Promise<{ error: { code?: string } | null }>;
  portalOrigin: string | null;
  log(event: string, meta?: Record<string, string | number | boolean>): void;
}

export interface DispatchSummary {
  configured: boolean;
  claimed: number;
  accepted: number;
  retrying: number;
  failed: number;
  unrecorded: number;
}

export async function dispatchEmails(deps: DispatchDeps, opts: { limit?: number; orderId?: string | null } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { configured: Boolean(deps.sender), claimed: 0, accepted: 0, retrying: 0, failed: 0, unrecorded: 0 };
  const sender = deps.sender;
  if (!sender) return summary;

  const { data, error } = await deps.claim({ limit: Math.min(Math.max(opts.limit ?? 20, 1), 50), orderId: opts.orderId ?? null });
  if (error) {
    deps.log('notifications_claim_error', { code: error.code ?? 'desconocido' });
    return summary;
  }
  const batch = data ?? [];
  summary.claimed = batch.length;

  for (const n of batch) {
    let outcome: SendOutcome;
    if (!isKnownTemplate(n.template)) {
      // Plantilla desconocida: mejor no enviar nada que enviar algo incorrecto.
      outcome = { kind: 'permanente', code: 'error' };
    } else {
      const email = renderEmail(n, deps.portalOrigin);
      try {
        outcome = await sender.send({ id: n.id, to: n.recipient, subject: email.subject, html: email.html, text: email.text, fromName: n.workshop_name, replyTo: n.reply_to });
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
  // Solo recuentos: ni direcciones, ni nombres, ni contenidos.
  deps.log('notifications_dispatch', { ...summary });
  return summary;
}
