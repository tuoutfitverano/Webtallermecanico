/**
 * Lee el formulario de cliente y lo valida con las reglas compartidas
 * (@talleres/core). Devuelve lo escrito (para volver a pintarlo) y, si todo es
 * correcto, las columnas listas para guardar.
 */
import { customerInputSchema, fieldErrors } from '@talleres/core';
import { field } from '../server/panel.ts';

export const CUSTOMER_FIELDS = ['full_name', 'phone', 'email', 'internal_notes', 'tax_id', 'address_line', 'postal_code', 'city', 'province'] as const;

export function readCustomerForm(form: FormData) {
  const values: Record<string, string> = {};
  for (const k of CUSTOMER_FIELDS) values[k] = field(form, k);
  const parsed = customerInputSchema.safeParse({
    fullName: values.full_name, phone: values.phone, email: values.email, internalNotes: values.internal_notes,
    taxId: values.tax_id, addressLine: values.address_line, postalCode: values.postal_code, city: values.city, province: values.province,
  });
  if (!parsed.success) return { ok: false as const, values, errors: fieldErrors(parsed.error) };
  const d = parsed.data;
  return {
    ok: true as const, values, data: d,
    row: {
      full_name: d.fullName, phone: d.phone, email: d.email, internal_notes: d.internalNotes,
      tax_id: d.taxId, address_line: d.addressLine, postal_code: d.postalCode, city: d.city, province: d.province,
    },
  };
}
