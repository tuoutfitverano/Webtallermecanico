/**
 * Periodos de las estadísticas (fechas YYYY-MM-DD en hora de Madrid).
 * Sin dependencias: se prueba en periods.test.ts.
 */
export const PERIODS = [
  { id: 'mes', label: 'Este mes' },
  { id: 'mes-anterior', label: 'Mes anterior' },
  { id: '30d', label: 'Últimos 30 días' },
  { id: 'trimestre', label: 'Últimos 3 meses' },
  { id: 'anio', label: 'Este año' },
] as const;
export type PeriodId = (typeof PERIODS)[number]['id'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const valid = (day: string) => DAY.test(day) && iso(utc(day)) === day;

/** Máximo que se puede pedir de una vez (la consulta recorre semanas). */
export const MAX_PERIOD_DAYS = 400;

export function resolvePeriod(params: URLSearchParams, today: string): { id: PeriodId | 'custom'; from: string; to: string; error: string | null } {
  const t = utc(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const from = params.get('desde') ?? '';
  const to = params.get('hasta') ?? '';
  if (from || to) {
    if (!valid(from) || !valid(to)) return { ...resolvePeriod(new URLSearchParams(), today), error: 'Fechas no válidas.' };
    if (from > to) return { ...resolvePeriod(new URLSearchParams(), today), error: 'La fecha de inicio va después de la de fin.' };
    if ((utc(to).getTime() - utc(from).getTime()) / 86_400_000 > MAX_PERIOD_DAYS) {
      return { ...resolvePeriod(new URLSearchParams(), today), error: `Elige un periodo de ${MAX_PERIOD_DAYS} días como mucho.` };
    }
    return { id: 'custom', from, to, error: null };
  }
  const id = (PERIODS.find(p => p.id === params.get('periodo'))?.id ?? 'mes') as PeriodId;
  switch (id) {
    case 'mes-anterior': return { id, from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))), error: null };
    case '30d': return { id, from: iso(new Date(t.getTime() - 29 * 86_400_000)), to: today, error: null };
    case 'trimestre': return { id, from: iso(new Date(Date.UTC(y, m - 2, 1))), to: today, error: null };
    case 'anio': return { id, from: `${y}-01-01`, to: today, error: null };
    default: return { id: 'mes', from: iso(new Date(Date.UTC(y, m, 1))), to: today, error: null };
  }
}
