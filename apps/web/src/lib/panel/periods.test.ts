import { describe, expect, it } from 'vitest';
import { resolvePeriod } from './periods.ts';

const p = (q: string) => resolvePeriod(new URLSearchParams(q), '2026-03-15');

describe('Periodos de las estadísticas', () => {
  it('por defecto, este mes hasta hoy', () => {
    expect(p('')).toMatchObject({ id: 'mes', from: '2026-03-01', to: '2026-03-15', error: null });
  });
  it('mes anterior completo (también en enero)', () => {
    expect(p('periodo=mes-anterior')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolvePeriod(new URLSearchParams('periodo=mes-anterior'), '2026-01-10')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('30 días incluye hoy', () => {
    expect(p('periodo=30d')).toMatchObject({ from: '2026-02-14', to: '2026-03-15' });
  });
  it('fechas a mano: válidas, ordenadas y con límite', () => {
    expect(p('desde=2026-01-01&hasta=2026-01-31')).toMatchObject({ id: 'custom', from: '2026-01-01', to: '2026-01-31', error: null });
    expect(p('desde=2026-02-30&hasta=2026-03-01').error).toBe('Fechas no válidas.');
    expect(p('desde=2026-03-10&hasta=2026-03-01').error).toMatch(/después/);
    expect(p('desde=2020-01-01&hasta=2026-01-01').error).toMatch(/como mucho/);
    expect(p('desde=x&hasta=y').from).toBe('2026-03-01');
  });
});
