/**
 * Textos y valores de presupuestos, resúmenes de servicios, cobros, planificación y
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
export const INVOICE_KIND_LABELS: Readonly<Record<'ordinaria' | 'rectificativa', string>> = { ordinaria: 'Resumen de servicios', rectificativa: 'Corrección de resumen' };
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

/** NIF/NIE/CIF: mayúsculas y sin espacios, puntos ni guiones. */
export function normalizeTaxId(text: string): string {
  return text.toUpperCase().replace(/[\s.-]/g, '');
}
/** Solo la forma general (8 a 12 letras y números). Para validar de verdad, `checkTaxId`. */
export function isTaxIdShape(text: string): boolean {
  return /^[A-Z0-9]{8,12}$/.test(text);
}

const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';
/**
 * Prefijos de país admitidos para identificadores EXTRANJEROS (NIF-IVA de la UE
 * y otros habituales). Con prefijo no se puede comprobar el control: se acepta la forma.
 */
export const FOREIGN_TAX_PREFIXES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'XI', 'GB', 'CH', 'NO', 'IS', 'LI', 'AD', 'MC', 'SM', 'GI', 'MA', 'US',
] as const;

export type TaxIdCheck =
  | { ok: true; kind: 'nif' | 'nie' | 'cif' | 'extranjero'; value: string }
  | { ok: false; reason: 'formato' | 'control' | 'extranjero' };

/**
 * Comprueba un identificador fiscal. Los españoles (DNI/NIF, NIF K/L/M, NIE y
 * CIF, también con prefijo «ES») se validan con su letra o dígito de control;
 * los extranjeros solo con `allowForeign` y con el prefijo del país delante.
 * Misma regla en la base de datos: `private.tax_id_check` (hay prueba de paridad).
 */
export function checkTaxId(input: string, opts: { allowForeign?: boolean } = {}): TaxIdCheck {
  let v = normalizeTaxId(input);
  if (/^ES[A-Z0-9]{9}$/.test(v)) v = v.slice(2);
  if (/^\d{8}[A-Z]$/.test(v)) {
    return NIF_LETTERS[Number(v.slice(0, 8)) % 23] === v[8] ? { ok: true, kind: 'nif', value: v } : { ok: false, reason: 'control' };
  }
  if (/^[KLM]\d{7}[A-Z]$/.test(v)) {
    return NIF_LETTERS[Number(v.slice(1, 8)) % 23] === v[8] ? { ok: true, kind: 'nif', value: v } : { ok: false, reason: 'control' };
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = Number(String('XYZ'.indexOf(v[0]!)) + v.slice(1, 8));
    return NIF_LETTERS[n % 23] === v[8] ? { ok: true, kind: 'nie', value: v } : { ok: false, reason: 'control' };
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const digits = v.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) {
        const twice = d * 2;
        sum += Math.floor(twice / 10) + (twice % 10);
      } else {
        sum += d;
      }
    }
    const control = (10 - (sum % 10)) % 10;
    const last = v[8]!;
    const first = v[0]!;
    // Cifra obligatoria: A, B, E, H. Letra: P, Q, R, S, N, W y los no residentes (provincia 00). El resto, cualquiera.
    const mustDigit = 'ABEH'.includes(first);
    const mustLetter = !mustDigit && ('PQRSNW'.includes(first) || digits.startsWith('00'));
    const okDigit = last === String(control);
    const okLetter = last === CIF_LETTERS[control];
    const ok = mustLetter ? okLetter : mustDigit ? okDigit : okDigit || okLetter;
    return ok ? { ok: true, kind: 'cif', value: v } : { ok: false, reason: 'control' };
  }
  if (/^[A-Z]{2}[A-Z0-9]{2,14}$/.test(v) && (FOREIGN_TAX_PREFIXES as readonly string[]).includes(v.slice(0, 2))) {
    return opts.allowForeign ? { ok: true, kind: 'extranjero', value: v } : { ok: false, reason: 'extranjero' };
  }
  return { ok: false, reason: 'formato' };
}

/** Mensaje para el formulario (sin detalles técnicos). */
export function taxIdMessage(reason: 'formato' | 'control' | 'extranjero', opts: { allowForeign?: boolean } = {}): string {
  if (reason === 'control') return 'La letra o el dígito de control no coincide: revisa el NIF/NIE/CIF.';
  if (reason === 'extranjero') return 'Aquí hace falta un NIF, NIE o CIF español.';
  return opts.allowForeign
    ? 'No es un NIF, NIE ni CIF español. Si es extranjero, escríbelo con el código del país delante (p. ej. FR…, PT…).'
    : 'No es un NIF, NIE ni CIF español válido.';
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

/**
 * Los mensajes de la base de datos hablan de «facturas» (nombre interno de la
 * tabla); en pantalla el documento es un resumen de servicios, no una factura.
 */
const SUMMARY_MESSAGES: Readonly<Record<string, string>> = {
  'Añade al menos una línea antes de emitir la factura.': 'Añade al menos una línea antes de emitir el resumen.',
  'El cobro supera lo que queda pendiente de la factura.': 'El cobro supera lo que queda pendiente del resumen.',
  'El importe del cobro debe tener el mismo signo que la factura.': 'El importe del cobro debe tener el mismo signo que el resumen.',
  'El registro de facturas no se modifica ni se borra.': 'El registro de resúmenes no se modifica ni se borra.',
  'Explica el motivo de la rectificación.': 'Explica el motivo de la corrección.',
  'Factura no encontrada.': 'Resumen no encontrado.',
  'La factura ya está emitida.': 'El resumen ya está emitido.',
  'La fecha de emisión no puede ser anterior a la de la última factura de la serie.': 'La fecha de emisión no puede ser anterior a la del último resumen de la serie.',
  'Solo el propietario o un administrador hace facturas rectificativas.': 'Solo el propietario o un administrador hace correcciones.',
  'Solo se rectifica una factura ordinaria emitida.': 'Solo se corrige un resumen emitido.',
  'Solo se registran cobros de facturas emitidas.': 'Solo se registran cobros de resúmenes emitidos.',
  'Solo una factura rectificativa lleva cantidades negativas.': 'Solo una corrección lleva cantidades negativas.',
  'Una factura emitida no se borra.': 'Un resumen emitido no se borra.',
  'Una factura emitida no se modifica: corrígela con una factura rectificativa.': 'Un resumen emitido no se modifica: corrígelo con una corrección.',
  'Una factura ordinaria no puede tener total negativo.': 'Un resumen no puede tener total negativo.',
  'Una línea no cambia de factura.': 'Una línea no cambia de resumen.',
};
export function summaryMessage(message: string): string {
  return SUMMARY_MESSAGES[message] ?? message;
}
