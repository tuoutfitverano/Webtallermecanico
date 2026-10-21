/**
 * Lee el formulario de vehículo y lo valida con las reglas compartidas
 * (@talleres/core). Devuelve los valores escritos (para volver a pintarlos)
 * y, si todo es correcto, la fila lista para guardar.
 */
import { validateVehicle } from '@talleres/core';
import { field } from '../server/panel.ts';

export const VEHICLE_FIELDS = [
  'plate', 'make', 'model', 'year', 'year_kind', 'fuel', 'customer_id', 'internal_notes',
  'version', 'vin', 'mileage', 'next_service_date', 'next_service_km', 'next_service_notes',
] as const;

/** Kilómetros escritos con o sin puntos de miles («120.500»). Vacío = null; texto raro = NaN (lo rechaza la validación). */
function readKm(text: string): number | null {
  const t = text.trim().replace(/[.\s]/g, '');
  if (t === '') return null;
  return /^\d{1,7}$/.test(t) ? Number(t) : Number.NaN;
}

export function readVehicleForm(form: FormData) {
  const values: Record<string, string> = {};
  for (const k of VEHICLE_FIELDS) values[k] = field(form, k);
  const yearText = values.year!.trim();
  const result = validateVehicle({
    plate: values.plate,
    confirmNonStandardPlate: field(form, 'confirm_plate') === 'on',
    make: values.make,
    model: values.model,
    year: yearText === '' ? null : /^\d{1,4}$/.test(yearText) ? Number(yearText) : Number.NaN,
    yearKind: values.year_kind || null,
    fuel: values.fuel || null,
    customerId: values.customer_id || null,
    internalNotes: values.internal_notes,
    version: values.version,
    vin: values.vin,
    mileage: readKm(values.mileage!),
    nextServiceDate: values.next_service_date || null,
    nextServiceKm: readKm(values.next_service_km!),
    nextServiceNotes: values.next_service_notes,
  });
  if (!result.ok) {
    const needsPlateConfirmation = Boolean(result.errors.plate?.includes('confirma'));
    return { ok: false as const, values, errors: result.errors, needsPlateConfirmation };
  }
  const d = result.data;
  return {
    ok: true as const,
    values,
    row: {
      plate: d.plate,
      make: d.make,
      model: d.model,
      year: d.year,
      year_kind: d.yearKind,
      fuel: d.fuel,
      customer_id: d.customerId,
      internal_notes: d.internalNotes,
      version: d.version,
      vin: d.vin,
      mileage: d.mileage,
      next_service_date: d.nextServiceDate,
      next_service_km: d.nextServiceKm,
      next_service_notes: d.nextServiceNotes,
    },
  };
}
