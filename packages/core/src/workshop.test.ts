import { describe, expect, it } from 'vitest';
import { customerInputSchema, fieldErrors, isRepairStatus, orderCreateSchema, orderLabel, orderUpdateSchema, REPAIR_STATUS_CUSTOMER_TEXT, REPAIR_STATUS_LABELS, REPAIR_STATUSES } from './workshop.ts';

describe('clientes', () => {
  it('acepta un cliente con solo nombre y normaliza el correo', () => {
    const r = customerInputSchema.parse({ fullName: '  Ana García ', phone: '', email: 'ANA@Correo.ES', internalNotes: '' });
    expect(r).toEqual({ fullName: 'Ana García', phone: null, email: 'ana@correo.es', internalNotes: null });
  });
  it('rechaza teléfonos y correos no válidos, y nombres vacíos', () => {
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
