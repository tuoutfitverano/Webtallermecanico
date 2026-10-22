import { describe, expect, it } from 'vitest';
import { exportFileName, isCsvTable, toCsv } from './export.ts';

describe('toCsv', () => {
  it('cabecera, separador «;», BOM y comillas cuando hace falta', () => {
    const csv = toCsv([{ name: 'Ana; "la del Golf"', km: 12000 }, { name: 'Luis', extra: { a: 1 } }]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['name;km;extra', '"Ana; ""la del Golf""";12000;', 'Luis;;"{""a"":1}"', '']);
  });
  it('no deja fórmulas: una celda que empieza por = + - @ va como texto', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: '+34 600', c: -5 }]).split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")";'+34 600;-5`);
  });
  it('sin filas: solo la marca BOM y una línea vacía', () => {
    expect(toCsv([])).toBe('\uFEFF\r\n');
  });
});

describe('nombres y tablas', () => {
  it('nombre de archivo seguro', () => {
    expect(exportFileName('autovalue', '2026-10-22', '', 'json')).toBe('copia-autovalue-2026-10-22.json');
    expect(exportFileName('Mi Taller/../x', '2026-10-22', 'clientes', 'csv')).toBe('copia-mi-taller-x-clientes-2026-10-22.csv');
  });
  it('solo las tablas previstas', () => {
    expect(isCsvTable('clientes')).toBe(true);
    expect(isCsvTable('toString')).toBe(false);
    expect(isCsvTable('workshop_invitations')).toBe(false);
  });
});
