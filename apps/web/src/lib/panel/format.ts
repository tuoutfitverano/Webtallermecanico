/**
 * Formatos del panel. Las fechas se muestran siempre en hora de España
 * peninsular (Europe/Madrid), venga de donde venga el servidor.
 */
const TZ = 'Europe/Madrid';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: TZ }).format(new Date(iso));
}

/** Valor para un <input type="datetime-local"> (hora de Madrid). */
export function toLocalInput(iso: string | Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
  return parts.replace(' ', 'T');
}

/**
 * Lo escrito en un <input type="datetime-local"> es hora de Madrid. Se manda a
 * PostgreSQL con la zona horaria explícita y él hace la conversión (incluido el
 * cambio de horario de verano).
 */
export function localInputToDb(value: string): string {
  return `${value.replace('T', ' ')} ${TZ}`;
}

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  problem_description: 'descripción del problema',
  diagnosis: 'diagnosis',
  work_done: 'trabajo realizado',
  internal_notes: 'notas internas',
  vehicle_id: 'vehículo',
  customer_id: 'cliente',
  received_at: 'fecha de recepción',
  show_details_to_customer: 'detalles visibles para el cliente',
  customer_notes: 'mensaje para el cliente (borrado)',
  mileage_in: 'kilómetros',
  priority: 'prioridad',
  scheduled_on: 'día planificado',
  due_at: 'entrega prevista',
  estimated_minutes: 'tiempo estimado',
  approved_quote_id: 'presupuesto aprobado',
  approved_at: 'fecha de aprobación',
};

/** «2026-10-28» → «28 oct 2026» (fechas sin hora, tal cual). */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** Hoy en Madrid, «AAAA-MM-DD». */
export function todayMadrid(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 135 → «2 h 15 min». */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
