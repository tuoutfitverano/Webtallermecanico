/**
 * Líneas (mano de obra, piezas…) de órdenes, presupuestos y facturas: lectura
 * del formulario y paso a las columnas de la base de datos. Las reglas de
 * validación y de cálculo son las de packages/core (money.ts); la base de
 * datos vuelve a comprobar los límites.
 */
import { fieldErrors, lineInputSchema, parseEuros, type LineData, type MoneyLine } from '@talleres/core';

export const LINE_FIELDS = ['kind', 'description', 'part_number', 'quantity', 'unit_price', 'discount', 'tax_rate'] as const;

export interface LineRow {
  id: string;
  position: number;
  kind: 'mano_obra' | 'pieza' | 'otro';
  description: string;
  part_number: string | null;
  quantity: number | string;
  unit_price_cents: number;
  discount_pct: number | string;
  tax_rate: number | string;
}
export const LINE_SELECT = 'id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate';

/** «1,5» / «1.5» → 1.5; vacío → valor por defecto; texto raro → NaN (lo rechaza la validación). */
function num(text: string, fallback?: number): number {
  const t = text.trim().replace(',', '.');
  if (t === '' && fallback !== undefined) return fallback;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export function readLine(form: FormData, defaults: { taxRate: number; labourRateCents?: number | null; allowNegative?: boolean }):
  | { ok: true; data: LineData; values: Record<string, string> }
  | { ok: false; errors: Record<string, string>; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const f of LINE_FIELDS) {
    const v = form.get(f);
    values[f] = typeof v === 'string' ? v : '';
  }
  // Mano de obra sin precio: el precio por hora del taller (si lo tiene configurado).
  const price = !(values.unit_price ?? '').trim() && values.kind === 'mano_obra' && defaults.labourRateCents
    ? defaults.labourRateCents
    : parseEuros(values.unit_price ?? '');
  const quantity = num(values.quantity ?? '', 1);
  // Rectificativas: cantidades negativas (se valida el valor absoluto y se recupera el signo).
  const negative = Boolean(defaults.allowNegative) && quantity < 0;
  const parsed = lineInputSchema.safeParse({
    kind: values.kind,
    description: values.description,
    partNumber: values.part_number,
    quantity: negative ? -quantity : quantity,
    unitPriceCents: price ?? Number.NaN,
    discountPct: num(values.discount ?? '', 0),
    taxRate: num(values.tax_rate ?? '', defaults.taxRate),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error) as Record<string, string>;
    if (price === null) errors.unitPriceCents = 'Escribe el precio en euros, p. ej. 45 o 45,90.';
    return { ok: false, errors, values };
  }
  return { ok: true, data: negative ? { ...parsed.data, quantity: -parsed.data.quantity } : parsed.data, values };
}

/** Columnas de la base de datos para una línea. */
export function lineColumns(d: LineData) {
  return {
    kind: d.kind, description: d.description, part_number: d.partNumber, quantity: d.quantity,
    unit_price_cents: d.unitPriceCents, discount_pct: d.discountPct, tax_rate: d.taxRate,
  };
}

export function toMoneyLine(r: Pick<LineRow, 'quantity' | 'unit_price_cents' | 'discount_pct' | 'tax_rate'>): MoneyLine {
  return { quantity: Number(r.quantity), unitPriceCents: Number(r.unit_price_cents), discountPct: Number(r.discount_pct), taxRate: Number(r.tax_rate) };
}
