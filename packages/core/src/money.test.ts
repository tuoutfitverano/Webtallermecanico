import { describe, expect, it } from 'vitest';
import { documentTotals, formatCents, lineBaseCents, lineInputSchema, parseEuros } from './money.ts';

describe('importes', () => {
  it('base de línea: cantidad × precio × (1 − descuento), al céntimo', () => {
    expect(lineBaseCents({ quantity: 1, unitPriceCents: 4500, discountPct: 0, taxRate: 21 })).toBe(4500);
    expect(lineBaseCents({ quantity: 1.5, unitPriceCents: 4500, discountPct: 0, taxRate: 21 })).toBe(6750);
    expect(lineBaseCents({ quantity: 3, unitPriceCents: 333, discountPct: 10, taxRate: 21 })).toBe(899); // 899,1 → 899
    expect(lineBaseCents({ quantity: 1, unitPriceCents: 1, discountPct: 50, taxRate: 21 })).toBe(1); // 0,5 → 1 (mitad hacia arriba)
    expect(lineBaseCents({ quantity: 2, unitPriceCents: 1999, discountPct: 100, taxRate: 21 })).toBe(0);
    expect(lineBaseCents({ quantity: 99999.99, unitPriceCents: 100_000_000, discountPct: 0.01, taxRate: 21 })).toBe(9_998_999_000_100);
  });

  it('impuesto por tipo, sobre la suma de bases de ese tipo', () => {
    const t = documentTotals([
      { quantity: 1, unitPriceCents: 1001, discountPct: 0, taxRate: 21 },
      { quantity: 1, unitPriceCents: 1001, discountPct: 0, taxRate: 21 },
      { quantity: 2, unitPriceCents: 1550, discountPct: 0, taxRate: 10 },
      { quantity: 1, unitPriceCents: 500, discountPct: 0, taxRate: 0 },
    ]);
    // 21 %: base 2002 → 420,42 → 420. 10 %: base 3100 → 310. 0 %: 500 → 0.
    expect(t.taxes).toEqual([
      { rate: 21, baseCents: 2002, taxCents: 420 },
      { rate: 10, baseCents: 3100, taxCents: 310 },
      { rate: 0, baseCents: 500, taxCents: 0 },
    ]);
    expect(t).toMatchObject({ subtotalCents: 5602, taxCents: 730, totalCents: 6332 });
  });

  it('sin líneas, todo a cero', () => {
    expect(documentTotals([])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0, taxes: [] });
  });

  it('formato y lectura de euros', () => {
    expect(formatCents(123456)).toMatch(/^1234,56\s€$/); // norma española: sin punto en 4 cifras
    expect(formatCents(12345678)).toMatch(/^123\.456,78\s€$/);
    expect(parseEuros('12,5')).toBe(1250);
    expect(parseEuros('12.50 €')).toBe(1250);
    expect(parseEuros('0')).toBe(0);
    expect(parseEuros('-3')).toBeNull();
    expect(parseEuros('abc')).toBeNull();
    expect(parseEuros('1,234')).toBeNull();
  });

  it('valida una línea', () => {
    expect(lineInputSchema.safeParse({ kind: 'pieza', description: 'Pastillas', quantity: 1, unitPriceCents: 4500, taxRate: 21 }).success).toBe(true);
    expect(lineInputSchema.safeParse({ kind: 'pieza', description: '', quantity: 0, unitPriceCents: -1, taxRate: 121 }).success).toBe(false);
    expect(lineInputSchema.safeParse({ kind: 'pieza', description: 'x', quantity: 1.234, unitPriceCents: 1, taxRate: 21 }).success).toBe(false);
  });
});
