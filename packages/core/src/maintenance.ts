/**
 * Mantenimientos periódicos del taller (cambio de aceite, revisión, pre-ITV…):
 * cada cuántos meses y/o kilómetros. Las mismas reglas que la base de datos
 * (service_intervals); el servidor decide con ellas y la base de datos vuelve a comprobarlas.
 */
import { z } from 'zod';

export const SERVICE_MONTHS = { min: 1, max: 240 } as const;
export const SERVICE_KM = { min: 500, max: 500_000 } as const;

const optInt = (min: number, max: number, message: string) =>
  z.preprocess(
    v => (v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v.replace(/[.\s]/g, '')) : v),
    z.number({ error: message }).int(message).min(min, message).max(max, message).nullable(),
  );

export const serviceIntervalSchema = z
  .object({
    name: z.string({ error: 'Escribe el nombre.' }).transform(v => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(2, 'Escribe el nombre (mínimo 2 caracteres).').max(80, 'Máximo 80 caracteres.')),
    everyMonths: optInt(SERVICE_MONTHS.min, SERVICE_MONTHS.max, `Meses entre ${SERVICE_MONTHS.min} y ${SERVICE_MONTHS.max}.`),
    everyKm: optInt(SERVICE_KM.min, SERVICE_KM.max, `Kilómetros entre 500 y 500.000.`),
    active: z.boolean().default(true),
  })
  .refine(v => v.everyMonths !== null || v.everyKm !== null, { path: ['everyMonths'], message: 'Pon cada cuántos meses, cada cuántos kilómetros o las dos cosas.' });

export type ServiceIntervalInput = z.infer<typeof serviceIntervalSchema>;

/** «Cada 12 meses o 15.000 km» (lo primero que llegue). */
export function describeServiceInterval(everyMonths: number | null, everyKm: number | null): string {
  const parts: string[] = [];
  if (everyMonths !== null) {
    parts.push(everyMonths % 12 === 0 ? `${everyMonths / 12} ${everyMonths === 12 ? 'año' : 'años'}` : `${everyMonths} ${everyMonths === 1 ? 'mes' : 'meses'}`);
  }
  if (everyKm !== null) parts.push(`${everyKm.toLocaleString('es-ES')} km`);
  return parts.length ? `Cada ${parts.join(' o ')}` : '';
}

/** Estado de un mantenimiento según la fecha y los km previstos (hoy y km actuales). */
export type ServiceDueState = 'vencido' | 'pronto' | 'al_dia';
export const SERVICE_DUE_LABELS: Record<ServiceDueState, string> = { vencido: 'Le toca ya', pronto: 'Pronto', al_dia: 'Al día' };

export function serviceDueState(
  next: { dueOn: string | null; dueKm: number | null },
  today: string,
  mileage: number | null,
  soon: { days: number; km: number } = { days: 30, km: 1000 },
): ServiceDueState {
  const daysLeft = next.dueOn ? Math.round((Date.parse(next.dueOn) - Date.parse(today)) / 86_400_000) : null;
  const kmLeft = next.dueKm !== null && mileage !== null ? next.dueKm - mileage : null;
  if ((daysLeft !== null && daysLeft < 0) || (kmLeft !== null && kmLeft <= 0)) return 'vencido';
  if ((daysLeft !== null && daysLeft <= soon.days) || (kmLeft !== null && kmLeft <= soon.km)) return 'pronto';
  return 'al_dia';
}
