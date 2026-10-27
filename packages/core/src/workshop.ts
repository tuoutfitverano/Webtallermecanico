/**
 * Reglas del panel del taller: clientes y órdenes de reparación.
 * Las usa el servidor para decidir; la base de datos vuelve a comprobar lo esencial.
 */
import { z } from 'zod';
import { checkTaxId, normalizeTaxId, taxIdMessage } from './documents.ts';

const optText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres.`).nullish().transform(v => (v ? v : null));

// ---------------------------------------------------------------- clientes
export const customerInputSchema = z
  .object({
    fullName: z.string({ error: 'Escribe el nombre.' }).trim().min(2, 'Escribe el nombre (mínimo 2 caracteres).').max(120, 'Máximo 120 caracteres.'),
    phone: optText(30),
    email: optText(254),
    internalNotes: optText(2000),
    // Datos para facturar (opcionales; la factura completa necesita NIF y dirección).
    taxId: optText(20),
    addressLine: optText(200),
    postalCode: optText(5),
    city: optText(80),
    province: optText(80),
  })
  .superRefine((v, ctx) => {
    if (v.taxId) {
      // Con letra o dígito de control (auditoría H03); extranjeros con el prefijo del país.
      const tax = checkTaxId(v.taxId, { allowForeign: true });
      if (!tax.ok) ctx.addIssue({ code: 'custom', path: ['taxId'], message: taxIdMessage(tax.reason, { allowForeign: true }) });
    }
    if (v.postalCode && !/^\d{5}$/.test(v.postalCode)) {
      ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'El código postal tiene 5 cifras.' });
    }
    if (v.phone) {
      const digits = v.phone.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15 || !/^[+\d\s().-]+$/.test(v.phone)) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Teléfono no válido (9 a 15 cifras).' });
      }
    }
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Correo electrónico no válido.' });
    }
  })
  .transform(v => ({ ...v, email: v.email ? v.email.toLowerCase() : null, taxId: v.taxId ? normalizeTaxId(v.taxId).replace(/^ES(?=[A-Z0-9]{9}$)/, '') : null }));

export type CustomerData = z.output<typeof customerInputSchema>;

// ---------------------------------------------------------------- órdenes
export const REPAIR_STATUSES = ['recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_STATUS_LABELS: Readonly<Record<RepairStatus, string>> = {
  recibido: 'Vehículo recibido',
  diagnosis: 'En diagnosis',
  esperando_recambios: 'Esperando recambios',
  en_reparacion: 'En reparación',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
};
/**
 * Explicación sencilla de cada estado para el cliente (portal). Solo describe
 * el estado; nunca promete fechas que el taller no haya confirmado.
 */
export const REPAIR_STATUS_CUSTOMER_TEXT: Readonly<Record<RepairStatus, string>> = {
  recibido: 'El taller ha recibido tu vehículo. El siguiente paso es revisarlo.',
  diagnosis: 'El taller está revisando tu vehículo para saber qué necesita.',
  esperando_recambios: 'El taller está esperando las piezas necesarias para continuar.',
  en_reparacion: 'El taller está trabajando en tu vehículo.',
  listo: 'Tu vehículo está listo. Puedes pasar a recogerlo en el horario del taller.',
  entregado: 'Vehículo entregado. La reparación ha terminado.',
};

export function isRepairStatus(v: unknown): v is RepairStatus {
  return typeof v === 'string' && (REPAIR_STATUSES as readonly string[]).includes(v);
}

/** Número visible de una orden: OR-12. */
export function orderLabel(n: number): string {
  return `OR-${n}`;
}

const uuid = z.uuid('Selección no válida.');
/** Selector opcional: vacío ("Sin asignar") = null. */
const optUuid = z.preprocess(v => (v === '' ? null : v), uuid.nullish()).transform(v => v ?? null);

export const orderCreateSchema = z.object({
  vehicleId: uuid,
  customerId: uuid,
  assignedTo: optUuid,
  receivedAt: z.preprocess(v => (v === '' ? null : v), z.iso.datetime({ local: true, error: 'Fecha de recepción no válida.' }).nullish()).transform(v => v ?? null),
  problemDescription: z.string({ error: 'Describe el problema.' }).trim().min(3, 'Describe el problema (mínimo 3 caracteres).').max(4000, 'Máximo 4000 caracteres.'),
  internalNotes: optText(4000),
});
export type OrderCreateData = z.output<typeof orderCreateSchema>;

/** Campos que se pueden editar de una orden (el servidor decide cuáles aplica según el rol). */
export const orderUpdateSchema = z.object({
  status: z.enum(REPAIR_STATUSES, { error: 'Estado no válido.' }),
  assignedTo: optUuid,
  problemDescription: z.string().trim().min(3, 'Describe el problema (mínimo 3 caracteres).').max(4000, 'Máximo 4000 caracteres.'),
  diagnosis: optText(4000),
  workDone: optText(4000),
  internalNotes: optText(4000),
  /** Mensaje para el cliente (portal). */
  customerNotes: optText(2000),
  /** Si el cliente ve la diagnosis y el trabajo realizado. */
  showDetailsToCustomer: z.boolean().default(false),
});
export type OrderUpdateData = z.output<typeof orderUpdateSchema>;

// ---------------------------------------------------------------- datos del taller
/**
 * Datos de la cuenta del taller que pueden cambiar propietario y administradores.
 * El identificador (slug) y el estado comercial solo los cambia la plataforma.
 */
export const workshopProfileSchema = z
  .object({
    name: z.string({ error: 'Escribe el nombre.' }).trim().min(2, 'Escribe el nombre (mínimo 2 caracteres).').max(120, 'Máximo 120 caracteres.'),
    legalName: optText(160),
    taxId: optText(20),
    contactEmail: optText(254),
    contactPhone: optText(30),
    logoUrl: optText(500),
    // Dirección (cabecera de presupuestos y facturas).
    addressLine: optText(200),
    postalCode: optText(5),
    city: optText(80),
    province: optText(80),
    // Datos legales de la web (LSSI art. 10): inscripción registral y correo para asuntos legales.
    registryInfo: optText(300),
    legalEmail: optText(254),
  })
  .superRefine((v, ctx) => {
    if (v.legalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.legalEmail)) {
      ctx.addIssue({ code: 'custom', path: ['legalEmail'], message: 'Correo electrónico no válido.' });
    }
    if (v.postalCode && !/^\d{5}$/.test(v.postalCode)) {
      ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'El código postal tiene 5 cifras.' });
    }
    if (v.taxId) {
      // El taller factura en España: NIF, NIE o CIF español con su control.
      const tax = checkTaxId(v.taxId);
      if (!tax.ok) ctx.addIssue({ code: 'custom', path: ['taxId'], message: taxIdMessage(tax.reason) });
    }
    if (v.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail)) {
      ctx.addIssue({ code: 'custom', path: ['contactEmail'], message: 'Correo electrónico no válido.' });
    }
    if (v.contactPhone) {
      const digits = v.contactPhone.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15 || !/^[+\d\s().-]+$/.test(v.contactPhone)) {
        ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: 'Teléfono no válido (9 a 15 cifras).' });
      }
    }
    if (v.logoUrl && !/^https:\/\/[^\s]+$/.test(v.logoUrl)) {
      ctx.addIssue({ code: 'custom', path: ['logoUrl'], message: 'Debe ser una dirección que empiece por https://' });
    }
  })
  .transform(v => ({ ...v, contactEmail: v.contactEmail ? v.contactEmail.toLowerCase() : null, legalEmail: v.legalEmail ? v.legalEmail.toLowerCase() : null, taxId: v.taxId ? normalizeTaxId(v.taxId).replace(/^ES(?=[A-Z0-9]{9}$)/, '') : null }));

export type WorkshopProfileData = z.output<typeof workshopProfileSchema>;

/** Ajustes de presupuestos y facturas del taller (los mismos límites que la base de datos). */
export const billingSettingsSchema = z
  .object({
    defaultTaxRate: z.number({ error: 'IVA no válido.' }).min(0, 'IVA no válido.').max(100, 'IVA no válido.'),
    quoteValidityDays: z.number({ error: 'Días no válidos.' }).int('Días no válidos.').min(1, 'Entre 1 y 365 días.').max(365, 'Entre 1 y 365 días.'),
    labourRateCents: z.number().int().min(0).max(100_000_000).nullable(),
    invoiceSeries: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'De 1 a 6 letras o números.'),
    rectifyingSeries: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'De 1 a 6 letras o números.'),
    paymentTermsDays: z.number({ error: 'Días no válidos.' }).int('Días no válidos.').min(0, 'Entre 0 y 365 días.').max(365, 'Entre 0 y 365 días.'),
    quoteConditions: optText(2000),
    invoiceFooter: optText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.invoiceSeries === v.rectifyingSeries) {
      ctx.addIssue({ code: 'custom', path: ['rectifyingSeries'], message: 'La serie de las correcciones debe ser distinta de la de los resúmenes.' });
    }
  });

/** Convierte los errores de zod en { campo: mensaje } para los formularios. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) out[issue.path.join('.') || '_'] ??= issue.message;
  return out;
}
