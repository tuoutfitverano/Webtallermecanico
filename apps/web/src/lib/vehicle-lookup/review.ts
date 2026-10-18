/**
 * Revisión de los datos del proveedor antes de usarlos en el formulario.
 *
 * Regla: un dato escrito a mano NUNCA se sustituye sin que la persona lo
 * marque expresamente. Los campos vacíos se proponen marcados.
 */
import { FUEL_LABELS, YEAR_KIND_LABELS } from '@talleres/core';
import type { VehicleData } from './types.ts';

/** Campos del proveedor que pasan al formulario de vehículo. */
export const APPLICABLE_FIELDS = ['make', 'model', 'year', 'fuel'] as const;
export type ApplicableField = (typeof APPLICABLE_FIELDS)[number];

export const LOOKUP_FIELD_LABELS: Readonly<Record<keyof VehicleData, string>> = {
  make: 'Marca',
  model: 'Modelo',
  version: 'Versión',
  year: 'Año',
  year_kind: 'Tipo de año',
  fuel: 'Combustible',
  power_cv: 'Potencia',
  engine_cc: 'Cilindrada',
  vin: 'Bastidor (VIN)',
};

export interface ReviewRow {
  field: keyof VehicleData;
  label: string;
  /** Valor del proveedor, ya formateado para mostrar. */
  shown: string;
  /** Solo los campos que pasan al formulario llevan casilla. */
  applicable: boolean;
  /** Lo que hay escrito en el formulario, si es distinto (hay que confirmar para sustituirlo). */
  conflict: string | null;
  /** Casilla marcada por defecto (campo vacío o igual). */
  checked: boolean;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function reviewRows(data: VehicleData, form: Record<string, string>): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const add = (field: keyof VehicleData, shown: string, current: string | null, applicable: boolean) => {
    const conflict = applicable && current && !same(current, shown) ? current : null;
    rows.push({ field, label: LOOKUP_FIELD_LABELS[field], shown, applicable, conflict, checked: applicable && !conflict });
  };
  if (data.make) add('make', data.make, form.make ?? '', true);
  if (data.model) add('model', data.model, form.model ?? '', true);
  if (data.version) add('version', data.version, null, false);
  if (data.year && data.year_kind) {
    const shown = `${data.year} (${YEAR_KIND_LABELS[data.year_kind].toLowerCase()})`;
    const current = form.year ? `${form.year}${form.year_kind && form.year_kind in YEAR_KIND_LABELS ? ` (${YEAR_KIND_LABELS[form.year_kind as keyof typeof YEAR_KIND_LABELS].toLowerCase()})` : ''}` : '';
    add('year', shown, current, true);
  }
  if (data.fuel) {
    const current = form.fuel && form.fuel in FUEL_LABELS ? FUEL_LABELS[form.fuel as keyof typeof FUEL_LABELS] : '';
    add('fuel', FUEL_LABELS[data.fuel], current, true);
  }
  if (data.power_cv) add('power_cv', `${data.power_cv} CV`, null, false);
  if (data.engine_cc) add('engine_cc', `${data.engine_cc} cm³`, null, false);
  if (data.vin) add('vin', data.vin, null, false);
  return rows;
}

/** Pasa al formulario SOLO los campos marcados. El resto queda como estaba. */
export function applyLookup(data: VehicleData, form: Record<string, string>, chosen: ReadonlySet<string>): Record<string, string> {
  const out = { ...form };
  if (chosen.has('make') && data.make) out.make = data.make;
  if (chosen.has('model') && data.model) out.model = data.model;
  if (chosen.has('year') && data.year && data.year_kind) {
    out.year = String(data.year);
    out.year_kind = data.year_kind;
  }
  if (chosen.has('fuel') && data.fuel) out.fuel = data.fuel;
  return out;
}
