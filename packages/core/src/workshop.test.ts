import { describe, expect, it } from 'vitest';
import { billingSettingsSchema, customerInputSchema, fieldErrors, isRepairStatus, orderCreateSchema, orderLabel, orderUpdateSchema, workshopProfileSchema, REPAIR_STATUS_CUSTOMER_TEXT, REPAIR_STATUS_LABELS, REPAIR_STATUSES } from './workshop.ts';

describe('clientes', () => {
  it('acepta un cliente con solo nombre y normaliza el correo', () => {
    const r = customerInputSchema.parse({ fullName: '  Ana García ', phone: '', email: 'ANA@Correo.ES', internalNotes: '' });
    expect(r).toEqual({ fullName: 'Ana García', phone: null, email: 'ana@correo.es', internalNotes: null, taxId: null, addressLine: null, postalCode: null, city: null, province: null });
  });
  it('rechaza teléfonos y correos no válidos, y nombres vacíos', () => {
    const fiscal = customerInputSchema.parse({ fullName: 'Talleres Pérez SL', taxId: 'b-12.345.674', postalCode: '28001', city: 'Madrid' });
    expect(fiscal).toMatchObject({ taxId: 'B12345674', postalCode: '28001', city: 'Madrid', addressLine: null });
    expect(customerInputSchema.safeParse({ fullName: 'Ana', taxId: '12', postalCode: '2800' }).success).toBe(false);
    // Auditoría H03: forma correcta pero letra de control equivocada → error; extranjero con prefijo → admitido.
    const wrong = customerInputSchema.safeParse({ fullName: 'Ana', taxId: '12345678A' });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toMatch(/control/);
    expect(customerInputSchema.parse({ fullName: 'Ana', taxId: '12345678z' }).taxId).toBe('12345678Z');
    expect(customerInputSchema.parse({ fullName: 'Client SARL', taxId: 'FR 123 456 789 01' }).taxId).toBe('FR12345678901');
    const r = customerInputSchema.safeParse({ fullName: 'A', phone: '123', email: 'no-es-correo' });
    expect(r.success).toBe(false);
    const errors = fieldErrors(r.error!);
    expect(Object.keys(errors).sort()).toEqual(['email', 'fullName', 'phone']);
  });
  it('acepta teléfonos con prefijo y separadores', () => {
    expect(customerInputSchema.safeParse({ fullName: 'Taller Cliente SL', phone: '+34 600-12-34-56' }).success).toBe(true);
  });
});

describe('órdenes de reparación', () => {
  it('tiene los seis estados en orden y con texto', () => {
    expect(REPAIR_STATUSES).toEqual(['recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado']);
    expect(REPAIR_STATUS_LABELS.listo).toBe('Listo para recoger');
    expect(isRepairStatus('listo')).toBe(true);
    expect(isRepairStatus('inventado')).toBe(false);
  });
  it('valida la creación', () => {
    const ok = orderCreateSchema.safeParse({
      vehicleId: '7e000001-0000-4000-8000-00000000000a',
      customerId: 'c1000000-0000-4000-8000-00000000000a',
      assignedTo: '',
      problemDescription: '  Ruido al frenar ',
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.assignedTo).toBe(null);
    expect(ok.data?.problemDescription).toBe('Ruido al frenar');
    const bad = orderCreateSchema.safeParse({ vehicleId: 'x', customerId: '', problemDescription: 'a' });
    expect(Object.keys(fieldErrors(bad.error!)).sort()).toEqual(['customerId', 'problemDescription', 'vehicleId']);
  });
  it('valida la edición y rechaza estados inventados', () => {
    expect(orderUpdateSchema.safeParse({ status: 'volando', problemDescription: 'Ruido' }).success).toBe(false);
    expect(orderUpdateSchema.parse({ status: 'listo', problemDescription: 'Ruido', diagnosis: '  ' }).diagnosis).toBe(null);
  });
  it('explica cada estado al cliente sin prometer fechas', () => {
    for (const st of REPAIR_STATUSES) {
      expect(REPAIR_STATUS_CUSTOMER_TEXT[st].length).toBeGreaterThan(10);
      expect(REPAIR_STATUS_CUSTOMER_TEXT[st]).not.toMatch(/\d|mañana|hoy|días?/i);
    }
  });
  it('por defecto el cliente no ve los detalles técnicos', () => {
    expect(orderUpdateSchema.parse({ status: 'listo', problemDescription: 'Ruido' }).showDetailsToCustomer).toBe(false);
  });
  it('etiqueta las órdenes como OR-n', () => {
    expect(orderLabel(12)).toBe('OR-12');
  });
});

describe('datos del taller', () => {
  it('acepta solo el nombre y deja el resto vacío', () => {
    const r = workshopProfileSchema.parse({ name: '  Taller Uno ', legalName: '', taxId: '', contactEmail: '', contactPhone: '', logoUrl: '' });
    expect(r).toEqual({ name: 'Taller Uno', legalName: null, taxId: null, contactEmail: null, contactPhone: null, logoUrl: null, addressLine: null, postalCode: null, city: null, province: null, registryInfo: null, legalEmail: null });
  });
  it('valida y normaliza el correo legal y la inscripción registral', () => {
    expect(workshopProfileSchema.safeParse({ name: 'Taller', legalEmail: 'no-es-correo' }).success).toBe(false);
    const r = workshopProfileSchema.parse({ name: 'Taller', legalEmail: 'Legal@Taller.ES', registryInfo: '  RM Madrid, tomo 1 ' });
    expect(r.legalEmail).toBe('legal@taller.es');
    expect(r.registryInfo).toBe('RM Madrid, tomo 1');
  });
  it('normaliza correo y NIF', () => {
    const r = workshopProfileSchema.parse({ name: 'Taller', contactEmail: 'Hola@Taller.ES', taxId: 'b12345674' });
    expect(r.contactEmail).toBe('hola@taller.es');
    expect(r.taxId).toBe('B12345674');
    expect(workshopProfileSchema.safeParse({ name: 'Taller', taxId: 'B12345678' }).success).toBe(false);
    expect(workshopProfileSchema.safeParse({ name: 'Taller', taxId: 'FR12345678901' }).success).toBe(false);
  });
  it('ajustes de facturación con los límites de la base de datos', () => {
    const ok = billingSettingsSchema.parse({ defaultTaxRate: 21, quoteValidityDays: 30, labourRateCents: 4500, invoiceSeries: ' f ', rectifyingSeries: 'r', paymentTermsDays: 0 });
    expect(ok).toMatchObject({ invoiceSeries: 'F', rectifyingSeries: 'R', quoteConditions: null });
    const bad = billingSettingsSchema.safeParse({ defaultTaxRate: 120, quoteValidityDays: 0, labourRateCents: null, invoiceSeries: 'F', rectifyingSeries: 'F', paymentTermsDays: 400 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual(['defaultTaxRate', 'paymentTermsDays', 'quoteValidityDays', 'rectifyingSeries']);
  });
  it('rechaza nombre vacío, correo, teléfono y logotipo no válidos', () => {
    const r = workshopProfileSchema.safeParse({ name: ' ', contactEmail: 'no', contactPhone: '12', logoUrl: 'http://x.es/logo.png' });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(['contactEmail', 'contactPhone', 'logoUrl', 'name']);
  });
});
