/**
 * Vehículos: valores permitidos y validación del formulario de alta/edición.
 *
 * Los mismos valores existen como tipos en la base de datos (ver
 * supabase/migrations). Si cambias uno, cambia el otro y sus pruebas.
 */
import { z } from 'zod';
import { checkPlate, type PlateKind } from './plates.ts';

export const FUEL_TYPES = [
  'gasolina',
  'diesel',
  'hibrido',
  'hibrido_enchufable',
  'electrico',
  'glp',
  'gnc',
  'hidrogeno',
  'otro',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_LABELS: Readonly<Record<FuelType, string>> = {
  gasolina: 'Gasolina',
  diesel: 'Diésel',
  hibrido: 'Híbrido',
  hibrido_enchufable: 'Híbrido enchufable',
  electrico: 'Eléctrico',
  glp: 'GLP',
  gnc: 'GNC',
  hidrogeno: 'Hidrógeno',
  otro: 'Otro',
};

/** Qué significa el año guardado: no siempre se conoce el de fabricación. */
export const YEAR_KINDS = ['fabricacion', 'primera_matriculacion'] as const;
export type YearKind = (typeof YEAR_KINDS)[number];
export const YEAR_KIND_LABELS: Readonly<Record<YearKind, string>> = {
  fabricacion: 'Año de fabricación',
  primera_matriculacion: 'Año de primera matriculación',
};

/** De dónde salen los datos del vehículo. */
export const DATA_SOURCES = ['manual', 'cliente', 'proveedor_externo'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
export const DATA_SOURCE_LABELS: Readonly<Record<DataSource, string>> = {
  manual: 'Introducidos manualmente',
  cliente: 'Aportados por el cliente',
  proveedor_externo: 'Proveedor externo de datos',
};

export const VERIFICATION_STATUSES = ['pendiente', 'verificado', 'rechazado'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const VERIFICATION_LABELS: Readonly<Record<VerificationStatus, string>> = {
  pendiente: 'Pendiente de verificar',
  verificado: 'Verificado',
  rechazado: 'Datos incorrectos',
};

export const MIN_VEHICLE_YEAR = 1900;
export const maxVehicleYear = (now = new Date()) => now.getFullYear() + 1;

/** Texto opcional: los espacios sobrantes se quitan y "" se guarda como null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .nullish()
    .transform(v => (v ? v : null));

/**
 * Datos que el usuario puede enviar al registrar un vehículo.
 * Ojo: el origen de los datos y el estado de verificación NO están aquí a
 * propósito. Al crear desde el panel siempre son "manual" y "pendiente";
 * el servidor los fija, el formulario no puede cambiarlos.
 */
export const vehicleInputSchema = z
  .object({
    plate: z.string({ error: 'Escribe la matrícula.' }),
    /** El usuario confirma que una matrícula no estándar es correcta. */
    confirmNonStandardPlate: z.boolean().default(false),
    make: z.string().trim().min(1, 'Indica la marca.').max(60, 'Máximo 60 caracteres.'),
    model: z.string().trim().min(1, 'Indica el modelo.').max(80, 'Máximo 80 caracteres.'),
    year: z
      .number({ error: 'El año debe ser un número.' })
      .int('El año debe ser un número entero.')
      .min(MIN_VEHICLE_YEAR, `El año no puede ser anterior a ${MIN_VEHICLE_YEAR}.`)
      .nullish()
      .transform(v => v ?? null),
    yearKind: z.enum(YEAR_KINDS).nullish().transform(v => v ?? null),
    fuel: z.enum(FUEL_TYPES, { error: 'Elige un combustible de la lista.' }).nullish().transform(v => v ?? null),
    customerId: z.uuid('Cliente no válido.').nullish().transform(v => v ?? null),
    internalNotes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    const check = checkPlate(v.plate, { allowNonStandard: v.confirmNonStandardPlate });
    if (!check.ok) ctx.addIssue({ code: 'custom', path: ['plate'], message: check.error });

    // Matrícula, marca, modelo y año son obligatorios (el año, con su tipo).
    if (v.year === null) ctx.addIssue({ code: 'custom', path: ['year'], message: 'Indica el año del vehículo.' });
    if (v.year !== null && v.year > maxVehicleYear()) {
      ctx.addIssue({ code: 'custom', path: ['year'], message: `El año no puede ser posterior a ${maxVehicleYear()}.` });
    }
    if (v.year !== null && v.yearKind === null) {
      ctx.addIssue({ code: 'custom', path: ['yearKind'], message: 'Indica si es el año de fabricación o de primera matriculación.' });
    }
  })
  .transform(v => {
    const { analysis } = checkPlate(v.plate, { allowNonStandard: true });
    return {
      plate: analysis.normalized,
      plateKind: analysis.kind as PlateKind,
      make: v.make,
      model: v.model,
      year: v.year,
      yearKind: v.year === null ? null : v.yearKind,
      fuel: v.fuel,
      customerId: v.customerId,
      internalNotes: v.internalNotes,
    };
  });

export type VehicleInput = z.input<typeof vehicleInputSchema>;
export type VehicleData = z.output<typeof vehicleInputSchema>;

/** Devuelve los errores agrupados por campo, listos para enseñarlos en el formulario. */
export function validateVehicle(input: unknown):
  | { ok: true; data: VehicleData }
  | { ok: false; errors: Partial<Record<string, string>> } {
  const r = vehicleInputSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const errors: Partial<Record<string, string>> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}
