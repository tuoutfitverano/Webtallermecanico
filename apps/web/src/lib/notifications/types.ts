/**
 * Notificaciones: tipos comunes de los canales externos.
 *
 * Cada canal (hoy email; en el futuro, SMS o WhatsApp Business Platform con
 * plantillas aprobadas) se adapta a la misma forma: recibe un mensaje ya
 * preparado y devuelve si el proveedor lo ha ACEPTADO, si hay que
 * reintentarlo o si es un rechazo definitivo. "Aceptado" no es "entregado":
 * la entrega solo la confirma el proveedor después (webhook).
 */

export interface OutgoingMessage {
  /** Id del aviso: se usa como clave de idempotencia (un reintento no duplica el envío). */
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Nombre visible del remitente (el taller). */
  fromName: string;
  replyTo?: string | null;
}

export type SendOutcome =
  | { kind: 'aceptado'; messageId: string }
  /** Error pasajero: se reintentará con espera. `code` es general, sin datos personales. */
  | { kind: 'temporal'; code: SendErrorCode }
  /** Rechazo definitivo: no se reintenta solo. */
  | { kind: 'permanente'; code: SendErrorCode };

/**
 * `sin_confirmacion`: el proveedor respondió 2xx pero sin el identificador del
 * mensaje. No se da por enviado (no se podría seguir su entrega).
 */
export type SendErrorCode = 'no_disponible' | 'limite_proveedor' | 'credenciales' | 'rechazado' | 'conflicto' | 'sin_confirmacion' | 'error';

/** Identificador del proveedor utilizable: texto no vacío, sin espacios raros y de longitud razonable. */
export function validMessageId(id: unknown): id is string {
  return typeof id === 'string' && /^[\x21-\x7e]{1,200}$/.test(id);
}

export interface ChannelSender {
  /** Identificador interno (minúsculas): se guarda con cada aviso. */
  id: string;
  send(message: OutgoingMessage): Promise<SendOutcome>;
}
