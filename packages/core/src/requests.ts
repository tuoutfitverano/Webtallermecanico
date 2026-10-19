/**
 * Solicitudes que llegan desde la web pública de un taller:
 * contacto, cita y presupuesto.
 *
 * Este esquema se usa DOS veces con el mismo código:
 *  · en el navegador, para avisar de errores antes de enviar;
 *  · en el servidor, que es el que decide de verdad (nunca confía en el navegador).
 * La base de datos vuelve a comprobar lo esencial (ver supabase/migrations).
 *
 * Una solicitud de cita NO es una cita confirmada: queda como "nueva"
 * hasta que el taller la revise.
 */
import { z } from 'zod';
import { normalizePlate, PLATE_MAX_LENGTH, PLATE_MIN_LENGTH } from './plates.ts';

export const REQUEST_KINDS = ['cita', 'presupuesto', 'contacto'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABELS: Readonly<Record<RequestKind, string>> = {
  cita: 'Solicitud de cita',
  presupuesto: 'Solicitud de presupuesto',
  contacto: 'Contacto',
};

/** Estados de una solicitud (igual que el tipo request_status de la base de datos). */
export const REQUEST_STATUSES = ['nueva', 'en_gestion', 'aceptada', 'rechazada', 'cerrada', 'spam'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  nueva: 'Nueva (sin atender)',
  en_gestion: 'En gestión',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  cerrada: 'Cerrada',
  spam: 'Spam',
};

/** Motivos del formulario de contacto. */
export const CONTACT_TOPICS = ['informacion', 'cita', 'presupuesto', 'estado_vehiculo', 'otro'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];
export const CONTACT_TOPIC_LABELS: Readonly<Record<ContactTopic, string>> = {
  informacion: 'Información general',
  cita: 'Cita',
  presupuesto: 'Presupuesto',
  estado_vehiculo: 'Estado de mi vehículo',
  otro: 'Otro motivo',
};

export const CONTACT_CHANNELS = ['telefono', 'whatsapp', 'email'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_CHANNEL_LABELS: Readonly<Record<ContactChannel, string>> = {
  telefono: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
};

export const TIME_SLOTS = ['manana', 'tarde', 'indiferente'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];
export const TIME_SLOT_LABELS: Readonly<Record<TimeSlot, string>> = {
  manana: 'Por la mañana',
  tarde: 'Por la tarde',
  indiferente: 'Me da igual',
};

/** Servicio comodín que siempre se acepta, además de los del taller. */
export const OTHER_SERVICE = 'otro';

export const LIMITS = {
  name: { min: 2, max: 120 },
  phoneDigits: { min: 9, max: 15 },
  email: 254,
  make: 60,
  model: 80,
  service: 60,
  message: { min: 10, max: 2000 },
  /** Hasta cuántos días en el futuro se puede pedir fecha. */
  maxDaysAhead: 365,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Texto opcional: quita espacios sobrantes y convierte "" en null. */
function optText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label}: máximo ${max} caracteres.`)
    .nullish()
    .transform(v => (v ? v : null));
}

export interface RequestRules {
  /** Servicios que ofrece este taller (identificadores). "otro" se acepta siempre. */
  services?: readonly string[];
  /** Fecha de hoy en formato AAAA-MM-DD (zona horaria del taller). */
  today?: string;
}

function isoToday(): string {
  // Fecha local de Madrid en formato AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSchema(rules: RequestRules) {
  const today = rules.today ?? isoToday();
  const services = new Set([...(rules.services ?? []), OTHER_SERVICE]);
  const oneOf = <T extends string>(list: readonly T[], v: string | null): v is T => v !== null && (list as readonly string[]).includes(v);

  // Los campos se leen de forma permisiva ("" = no indicado) y TODAS las reglas
  // se comprueban juntas en superRefine, para enseñar todos los errores a la vez.
  return z
    .object({
      kind: z.enum(REQUEST_KINDS, { error: 'Tipo de solicitud no válido.' }),
      name: optText(LIMITS.name.max, 'Nombre'),
      phone: optText(30, 'Teléfono'),
      email: optText(LIMITS.email, 'Correo'),
      preferredContact: optText(20, 'Canal'),
      topic: optText(40, 'Motivo'),
      plate: optText(30, 'Matrícula'),
      make: optText(LIMITS.make, 'Marca'),
      model: optText(LIMITS.model, 'Modelo'),
      service: optText(LIMITS.service, 'Servicio'),
      preferredDate: optText(10, 'Fecha'),
      preferredTime: optText(20, 'Franja'),
      message: optText(LIMITS.message.max, 'Mensaje'),
      privacyAccepted: z.unknown().optional(),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

      if (!v.name || v.name.length < LIMITS.name.min) add('name', 'Escribe tu nombre.');
      if (v.privacyAccepted !== true) add('privacyAccepted', 'Debes aceptar la política de privacidad para enviar la solicitud.');

      // Forma de contacto: al menos teléfono o correo, y que sean válidos.
      if (!v.phone && !v.email) add('contact', 'Indica un teléfono o un correo para poder responderte.');
      if (v.phone) {
        const digits = v.phone.replace(/\D/g, '');
        if (!PHONE_CHARS_RE.test(v.phone) || digits.length < LIMITS.phoneDigits.min || digits.length > LIMITS.phoneDigits.max) {
          add('phone', 'Teléfono no válido. Escribe al menos 9 cifras.');
        }
      }
      if (v.email && !EMAIL_RE.test(v.email)) add('email', 'Correo no válido. Revisa que tenga el formato nombre@dominio.es.');
      if (v.preferredContact !== null && !oneOf(CONTACT_CHANNELS, v.preferredContact)) add('preferredContact', 'Elige cómo prefieres que te contactemos.');
      if (v.preferredContact === 'email' && !v.email) add('email', 'Has elegido que te contactemos por correo: escríbelo.');
      if ((v.preferredContact === 'telefono' || v.preferredContact === 'whatsapp') && !v.phone) {
        add('phone', 'Has elegido llamada o WhatsApp: escribe tu teléfono.');
      }

      // Matrícula opcional: solo se normaliza y se comprueba la longitud.
      if (v.plate) {
        const n = normalizePlate(v.plate);
        if (n.length < PLATE_MIN_LENGTH || n.length > PLATE_MAX_LENGTH) add('plate', 'Matrícula no válida. Revísala o déjala en blanco.');
      }

      if (v.kind === 'contacto') {
        if (!oneOf(CONTACT_TOPICS, v.topic)) add('topic', 'Elige el motivo del contacto.');
        if (!v.message || v.message.length < LIMITS.message.min) add('message', `Cuéntanos tu consulta (mínimo ${LIMITS.message.min} caracteres).`);
      } else {
        if (!v.service) add('service', 'Elige el servicio que necesitas.');
        else if (!services.has(v.service)) add('service', 'Elige un servicio de la lista.');
      }
      if (v.kind === 'presupuesto' && (!v.message || v.message.length < LIMITS.message.min)) {
        add('message', `Describe qué le pasa al vehículo (mínimo ${LIMITS.message.min} caracteres).`);
      }

      if (v.preferredTime !== null && (v.kind !== 'cita' || !oneOf(TIME_SLOTS, v.preferredTime))) add('preferredTime', 'Elige una franja de la lista.');
      if (v.preferredDate) {
        if (v.kind !== 'cita') add('preferredDate', 'La fecha preferida solo se usa en las solicitudes de cita.');
        else if (!DATE_RE.test(v.preferredDate) || Number.isNaN(Date.parse(`${v.preferredDate}T00:00:00Z`))) add('preferredDate', 'Fecha no válida.');
        else if (v.preferredDate < today) add('preferredDate', 'La fecha preferida no puede ser anterior a hoy.');
        else if (v.preferredDate > addDays(today, LIMITS.maxDaysAhead)) add('preferredDate', 'Elige una fecha dentro del próximo año.');
      }
    })
    .transform(v => ({
      kind: v.kind,
      name: v.name ?? '',
      phone: v.phone,
      email: v.email ? v.email.toLowerCase() : null,
      preferredContact: v.preferredContact as ContactChannel | null,
      // Solo se guarda lo que corresponde a cada tipo de solicitud.
      topic: v.kind === 'contacto' ? (v.topic as ContactTopic | null) : null,
      plate: v.kind === 'contacto' || !v.plate ? null : normalizePlate(v.plate),
      make: v.kind === 'contacto' ? null : v.make,
      model: v.kind === 'contacto' ? null : v.model,
      service: v.kind === 'contacto' ? null : v.service,
      preferredDate: v.kind === 'cita' ? v.preferredDate : null,
      preferredTime: v.kind === 'cita' ? (v.preferredTime as TimeSlot | null) : null,
      message: v.message,
    }));
}

export type WebRequestInput = z.input<ReturnType<typeof buildSchema>>;
export type WebRequestData = z.output<ReturnType<typeof buildSchema>>;
export type FieldErrors = Partial<Record<string, string>>;

/**
 * Valida y normaliza una solicitud. Devuelve los errores agrupados por campo
 * (el campo "contact" agrupa teléfono + correo).
 */
export function validateWebRequest(
  input: unknown,
  rules: RequestRules = {},
): { ok: true; data: WebRequestData } | { ok: false; errors: FieldErrors } {
  const result = buildSchema(rules).safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Referencia corta y legible para enseñar al usuario (primeros 8 caracteres del id). */
export function requestReference(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}
