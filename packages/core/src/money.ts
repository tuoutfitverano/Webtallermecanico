/**
 * Importes de presupuestos, órdenes y facturas.
 *
 * Todo en CÉNTIMOS (enteros) para no arrastrar errores de coma flotante. Las
 * mismas reglas están en la base de datos (private.line_base_cents y
 * private.doc_totals): la base de datos decide; esto sirve para enseñar el
 * cálculo al momento en el navegador y para las pruebas.
 *
 *  · Base de cada línea = cantidad × precio × (1 − descuento), redondeada al
 *    céntimo (la mitad, hacia arriba).
 *  · El impuesto se calcula por tipo (21 %, 10 %…): suma de bases de ese tipo
 *    × tipo, redondeada al céntimo. Así lo pide una factura: base y cuota por
 *    cada tipo impositivo.
 *  · Total = suma de bases + suma de cuotas.
 */
import { z } from 'zod';

export const LINE_KINDS = ['mano_obra', 'pieza', 'otro'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const LINE_KIND_LABELS: Readonly<Record<LineKind, string>> = { mano_obra: 'Mano de obra', pieza: 'Pieza', otro: 'Otro' };

/** Tipos de IVA habituales en España (el taller puede usar otro: el campo es libre de 0 a 100). */
export const COMMON_TAX_RATES = [21, 10, 4, 0] as const;

export interface MoneyLine {
  quantity: number;
  unitPriceCents: number;
  discountPct: number;
  taxRate: number;
}

export interface TaxBreakdown {
  rate: number;
  baseCents: number;
  taxCents: number;
}

export interface DocumentTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Base y cuota por cada tipo impositivo, de mayor a menor tipo. */
  taxes: TaxBreakdown[];
}

/** Redondeo «la mitad hacia arriba» (en valor absoluto) de num/den, con enteros grandes. */
function roundDiv(num: bigint, den: bigint): bigint {
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  return sign * ((abs * 2n + den) / (2n * den));
}

/** Número con hasta 2 decimales → centésimas exactas (1.25 → 125). */
const hundredths = (n: number) => BigInt(Math.round(n * 100));

export function lineBaseCents(l: MoneyLine): number {
  // q (centésimas) × precio × (10000 − d (centésimas de %)) / (100 × 10000)
  const num = hundredths(l.quantity) * BigInt(Math.round(l.unitPriceCents)) * (10000n - hundredths(l.discountPct));
  return Number(roundDiv(num, 1_000_000n));
}

export function documentTotals(lines: readonly MoneyLine[]): DocumentTotals {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const rate = Math.round(l.taxRate * 100) / 100;
    byRate.set(rate, (byRate.get(rate) ?? 0) + lineBaseCents(l));
  }
  const taxes = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, baseCents]) => ({ rate, baseCents, taxCents: Number(roundDiv(BigInt(baseCents) * hundredths(rate), 10_000n)) }));
  const subtotalCents = taxes.reduce((s, t) => s + t.baseCents, 0);
  const taxCents = taxes.reduce((s, t) => s + t.taxCents, 0);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents, taxes };
}

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
/** 123456 → «1.234,56 €». */
export function formatCents(cents: number): string {
  return EUR.format(cents / 100);
}

/** «12,5» o «12.50» → 1250 céntimos; null si no es un importe válido. */
export function parseEuros(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, '');
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(',', '.')) * 100);
}

/** Línea escrita en un formulario (presupuesto, orden o factura). */
export const lineInputSchema = z.object({
  kind: z.enum(LINE_KINDS, { error: 'Elige el tipo de línea.' }),
  description: z.string().trim().min(1, 'Describe la línea.').max(300, 'Máximo 300 caracteres.'),
  partNumber: z.string().trim().max(60, 'Máximo 60 caracteres.').nullish().transform(v => (v ? v : null)),
  quantity: z.number({ error: 'Cantidad no válida.' }).positive('La cantidad debe ser mayor que 0.').max(100000, 'Cantidad demasiado alta.')
    .refine(n => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'Como mucho 2 decimales.'),
  unitPriceCents: z.number({ error: 'Precio no válido.' }).int('Precio no válido.').min(0, 'El precio no puede ser negativo.').max(100_000_000, 'Precio demasiado alto.'),
  discountPct: z.number({ error: 'Descuento no válido.' }).min(0, 'El descuento va de 0 a 100.').max(100, 'El descuento va de 0 a 100.').default(0),
  taxRate: z.number({ error: 'Tipo de IVA no válido.' }).min(0, 'El IVA va de 0 a 100.').max(100, 'El IVA va de 0 a 100.'),
});
export type LineInput = z.input<typeof lineInputSchema>;
export type LineData = z.output<typeof lineInputSchema>;
