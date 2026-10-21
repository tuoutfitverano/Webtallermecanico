/**
 * Textos y valores de presupuestos, facturas, cobros, planificación y
 * recordatorios. Los valores coinciden con los tipos de la base de datos.
 */

export const QUOTE_STATUSES = ['borrador', 'enviado', 'aceptado', 'rechazado', 'caducado', 'sustituido', 'anulado'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  borrador: 'Borrador',
  enviado: 'Pendiente de respuesta',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  caducado: 'Caducado',
  sustituido: 'Sustituido por otra versión',
  anulado: 'Anulado',
};
export const QUOTE_RESPONSE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  portal: 'desde su portal',
  enlace: 'con el enlace del presupuesto',
  taller: 'en el taller (anotado por el personal)',
};
/** «P-12» o «P-12 v2». */
export function quoteLabel(number: number, version = 1): string {
  return version > 1 ? `P-${number} v${version}` : `P-${number}`;
}

export const INVOICE_STATUS_LABELS: Readonly<Record<'borrador' | 'emitida', string>> = { borrador: 'Borrador', emitida: 'Emitida' };
export const INVOICE_KIND_LABELS: Readonly<Record<'ordinaria' | 'rectificativa', string>> = { ordinaria: 'Factura', rectificativa: 'Factura rectificativa' };
export const PAYMENT_STATUS_LABELS: Readonly<Record<'pendiente' | 'parcial' | 'cobrada', string>> = {
  pendiente: 'Pendiente de cobro',
  parcial: 'Cobrada en parte',
  cobrada: 'Cobrada',
};
export const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'bizum', 'domiciliacion', 'otro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta (TPV del taller)',
  transferencia: 'Transferencia',
  bizum: 'Bizum',
  domiciliacion: 'Domiciliación',
  otro: 'Otro',
};

export const ORDER_PRIORITIES = ['baja', 'normal', 'alta', 'urgente'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export const ORDER_PRIORITY_LABELS: Readonly<Record<OrderPriority, string>> = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export function isOrderPriority(v: unknown): v is OrderPriority {
  return typeof v === 'string' && (ORDER_PRIORITIES as readonly string[]).includes(v);
}

export const REMINDER_KIND_LABELS: Readonly<Record<string, string>> = {
  revision: 'Revisión del vehículo',
  presupuesto_pendiente: 'Presupuesto sin respuesta',
  recogida_pendiente: 'Vehículo sin recoger',
  trabajo_retrasado: 'Trabajo retrasado (interno)',
};
export const REMINDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  pendiente: 'Pendiente',
  enviado: 'Aviso creado',
  sin_canal: 'Sin canal (el cliente no lo pidió o no hay datos)',
  descartado: 'Descartado',
};

/** NIF/NIE/CIF: mayúsculas y sin espacios ni guiones; solo se comprueba la forma (no el dígito de control). */
export function normalizeTaxId(text: string): string {
  return text.toUpperCase().replace(/[\s.-]/g, '');
}
export function isTaxIdShape(text: string): boolean {
  return /^[A-Z0-9]{8,12}$/.test(text);
}
/** VIN (bastidor): 17 caracteres sin I, O ni Q. */
export function normalizeVin(text: string): string {
  return text.toUpperCase().replace(/\s/g, '');
}
export function isVin(text: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(text);
}

/**
 * Número para WhatsApp (formato internacional sin «+»), igual que
 * private.whatsapp_number en la base de datos: móviles españoles 6xx/7xx con
 * o sin +34; de otro país, solo escritos con + o 00. Fijos: null.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  const intl = /^(\+|00)/.test(raw);
  const d = raw.replace(/^00/, '').replace(/\D/g, '');
  if (/^[67]\d{8}$/.test(d)) return `34${d}`;
  if (/^34[67]\d{8}$/.test(d)) return d;
  if (intl && !d.startsWith('34') && /^[1-9]\d{7,14}$/.test(d)) return d;
  return null;
}

/**
 * Enlace «abrir WhatsApp con el mensaje preparado» (wa.me). Enviarlo lo hace
 * la persona desde su WhatsApp: la plataforma no lo registra como enviado.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
