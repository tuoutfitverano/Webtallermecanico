import { describe, expect, it } from 'vitest';
import { agendaItemSchema, isAgendaKind } from './agenda.ts';

const ok = { title: '  Cambiar  pastillas ', kind: 'tarea', day: '2026-11-02', start: '09:00', end: '10:30', notes: '' };

describe('agenda', () => {
  it('acepta un apunte y lo limpia', () => {
    const r = agendaItemSchema.safeParse(ok);
    expect(r.success && r.data).toMatchObject({ title: 'Cambiar pastillas', notes: null });
  });
  it('la hora de fin va después de la de inicio', () => {
    const r = agendaItemSchema.safeParse({ ...ok, end: '09:00' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['end']);
  });
  it('rechaza horas, días y tipos que no existen', () => {
    expect(agendaItemSchema.safeParse({ ...ok, start: '25:00' }).success).toBe(false);
    expect(agendaItemSchema.safeParse({ ...ok, day: '2-11-2026' }).success).toBe(false);
    expect(agendaItemSchema.safeParse({ ...ok, kind: 'fiesta' }).success).toBe(false);
    expect(agendaItemSchema.safeParse({ ...ok, title: '   ' }).success).toBe(false);
    expect(isAgendaKind('cita')).toBe(true);
    expect(isAgendaKind('fiesta')).toBe(false);
  });
});
