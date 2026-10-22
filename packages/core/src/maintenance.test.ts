import { describe, expect, it } from 'vitest';
import { describeServiceInterval, serviceDueState, serviceIntervalSchema } from './maintenance.ts';

describe('serviceIntervalSchema', () => {
  it('acepta meses, km o las dos cosas (con puntos de miles)', () => {
    const r = serviceIntervalSchema.safeParse({ name: '  Cambio   de aceite ', everyMonths: '12', everyKm: '15.000' });
    expect(r.success && r.data).toEqual({ name: 'Cambio de aceite', everyMonths: 12, everyKm: 15000, active: true });
    expect(serviceIntervalSchema.safeParse({ name: 'Pre-ITV', everyMonths: '12', everyKm: '' }).success).toBe(true);
  });
  it('exige al menos meses o km, y en los mismos límites que la base de datos', () => {
    expect(serviceIntervalSchema.safeParse({ name: 'Nada', everyMonths: '', everyKm: '' }).success).toBe(false);
    expect(serviceIntervalSchema.safeParse({ name: 'Mucho', everyMonths: '241', everyKm: '' }).success).toBe(false);
    expect(serviceIntervalSchema.safeParse({ name: 'Poco', everyMonths: '', everyKm: '499' }).success).toBe(false);
    expect(serviceIntervalSchema.safeParse({ name: 'Medio', everyMonths: '1,5', everyKm: '' }).success).toBe(false);
    expect(serviceIntervalSchema.safeParse({ name: 'X', everyMonths: '12', everyKm: '' }).success).toBe(false);
  });
});

describe('describeServiceInterval', () => {
  it('lo dice en lenguaje claro', () => {
    expect(describeServiceInterval(12, 15000)).toBe('Cada 1 año o 15.000 km');
    expect(describeServiceInterval(24, null)).toBe('Cada 2 años');
    expect(describeServiceInterval(6, null)).toBe('Cada 6 meses');
    expect(describeServiceInterval(null, 100000)).toBe('Cada 100.000 km');
  });
});

describe('serviceDueState', () => {
  const today = '2026-10-22';
  it('vencido por fecha o por km, pronto si queda poco, al día si no', () => {
    expect(serviceDueState({ dueOn: '2026-10-21', dueKm: null }, today, null)).toBe('vencido');
    expect(serviceDueState({ dueOn: '2027-10-22', dueKm: 95000 }, today, 95000)).toBe('vencido');
    expect(serviceDueState({ dueOn: '2026-11-10', dueKm: null }, today, null)).toBe('pronto');
    expect(serviceDueState({ dueOn: '2027-10-22', dueKm: 95000 }, today, 94500)).toBe('pronto');
    expect(serviceDueState({ dueOn: '2027-10-22', dueKm: 95000 }, today, 80000)).toBe('al_dia');
    expect(serviceDueState({ dueOn: null, dueKm: 95000 }, today, null)).toBe('al_dia');
  });
});
