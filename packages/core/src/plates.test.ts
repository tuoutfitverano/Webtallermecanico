import { describe, expect, it } from 'vitest';
import { analyzePlate, checkPlate, formatPlate, normalizePlate } from './plates.ts';

describe('normalizePlate', () => {
  it.each([
    ['1950BXF', '1950BXF'],
    ['1950 bxf', '1950BXF'],
    ['  1950-BXF ', '1950BXF'],
    ['1950.b x f', '1950BXF'],
    ['gu-1234-á', 'GU1234A'],
  ])('%s → %s', (input, out) => {
    expect(normalizePlate(input)).toBe(out);
  });

  it('no corrige letras por números (evita cambiar una matrícula por otra)', () => {
    expect(normalizePlate('1950BXO')).toBe('1950BXO');
  });
});

describe('analyzePlate', () => {
  it('reconoce el formato actual (ejemplo de demo 1950BXF)', () => {
    expect(analyzePlate('1950bxf')).toMatchObject({ normalized: '1950BXF', display: '1950 BXF', kind: 'actual', recognized: true });
  });

  it('rechaza vocales y Q en el formato actual', () => {
    expect(analyzePlate('1950BAF').kind).toBe('no_reconocida');
    expect(analyzePlate('1950BQF').kind).toBe('no_reconocida');
  });

  it('reconoce matrículas provinciales antiguas con su provincia', () => {
    const gu = analyzePlate('GU-1234-A');
    expect(gu).toMatchObject({ kind: 'provincial', display: 'GU-1234-A', province: { code: 'GU', name: 'Guadalajara' } });
    expect(analyzePlate('m 1234 ab')).toMatchObject({ kind: 'provincial', display: 'M-1234-AB', province: { name: 'Madrid' } });
    expect(analyzePlate('M-123456')).toMatchObject({ kind: 'provincial_numerica', display: 'M-123456' });
  });

  it('no inventa provincias que no existen', () => {
    expect(analyzePlate('XX-1234-A').kind).toBe('no_reconocida');
  });

  it('reconoce ciclomotores, remolques, especiales e históricos', () => {
    expect(analyzePlate('C1234BCD')).toMatchObject({ kind: 'ciclomotor', display: 'C 1234 BCD' });
    expect(analyzePlate('R 1234 BCD').kind).toBe('remolque');
    expect(analyzePlate('E1234BCD').kind).toBe('especial');
    expect(analyzePlate('H1234BCD').kind).toBe('historica');
  });

  it('formatPlate da el formato de presentación', () => {
    expect(formatPlate('1950BXF')).toBe('1950 BXF');
  });
});

describe('checkPlate', () => {
  it('acepta una matrícula española válida', () => {
    expect(checkPlate('1950 BXF').ok).toBe(true);
  });

  it('pide la matrícula si está vacía', () => {
    const r = checkPlate('  - ');
    expect(r.ok).toBe(false);
  });

  it('exige confirmación para formatos no reconocidos', () => {
    const r = checkPlate('AB123CD');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.needsConfirmation).toBe(true);
    expect(checkPlate('AB123CD', { allowNonStandard: true }).ok).toBe(true);
  });

  it('rechaza longitudes imposibles aunque se confirme', () => {
    expect(checkPlate('A', { allowNonStandard: true }).ok).toBe(false);
    expect(checkPlate('ABCDEFGHIJKLM', { allowNonStandard: true }).ok).toBe(false);
  });
});
