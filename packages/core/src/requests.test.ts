import { describe, expect, it } from 'vitest';
import { requestReference, validateWebRequest } from './requests.ts';

const rules = { services: ['mantenimiento', 'frenos'], today: '2026-10-18' };
const base = { name: 'Ana Pérez', phone: '600 123 456', privacyAccepted: true };

describe('validateWebRequest', () => {
  it('acepta una solicitud de contacto completa', () => {
    const r = validateWebRequest({ ...base, kind: 'contacto', topic: 'informacion', message: '¿Abrís los sábados por la mañana?' }, rules);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ kind: 'contacto', topic: 'informacion', service: null, plate: null });
  });

  it('acepta una cita con matrícula, normalizándola, sin inventar datos del vehículo', () => {
    const r = validateWebRequest({ ...base, kind: 'cita', service: 'frenos', plate: '1950 bxf', preferredDate: '2026-10-20', preferredTime: 'manana' }, rules);
    expect(r).toEqual({
      ok: true,
      data: {
        kind: 'cita', name: 'Ana Pérez', phone: '600 123 456', email: null, preferredContact: null, topic: null,
        plate: '1950BXF', make: null, model: null, service: 'frenos', preferredDate: '2026-10-20', preferredTime: 'manana', message: null,
      },
    });
  });

  it('exige teléfono o correo', () => {
    const r = validateWebRequest({ kind: 'contacto', name: 'Ana', topic: 'otro', message: 'Hola, una consulta.', privacyAccepted: true }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.contact).toMatch(/teléfono o un correo/);
  });

  it('valida el formato del teléfono y del correo', () => {
    const r = validateWebRequest({ ...base, phone: '12', email: 'no-es-un-correo', kind: 'contacto', topic: 'otro', message: 'Consulta de prueba.' }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.phone).toBeDefined();
      expect(r.errors.email).toBeDefined();
    }
  });

  it('obliga a aceptar la privacidad', () => {
    const r = validateWebRequest({ ...base, privacyAccepted: false, kind: 'contacto', topic: 'otro', message: 'Consulta de prueba.' }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.privacyAccepted).toMatch(/privacidad/);
  });

  it('exige servicio en citas y presupuestos y solo de la lista del taller', () => {
    const sin = validateWebRequest({ ...base, kind: 'cita' }, rules);
    expect(!sin.ok && sin.errors.service).toBeTruthy();
    const raro = validateWebRequest({ ...base, kind: 'cita', service: 'tuning-nuclear' }, rules);
    expect(!raro.ok && raro.errors.service).toBe('Elige un servicio de la lista.');
    expect(validateWebRequest({ ...base, kind: 'cita', service: 'otro' }, rules).ok).toBe(true);
  });

  it('exige descripción en presupuestos', () => {
    const r = validateWebRequest({ ...base, kind: 'presupuesto', service: 'frenos', message: 'corto' }, rules);
    expect(!r.ok && r.errors.message).toBeTruthy();
  });

  it('no acepta fechas pasadas ni a más de un año', () => {
    const pasada = validateWebRequest({ ...base, kind: 'cita', service: 'frenos', preferredDate: '2026-10-17' }, rules);
    expect(!pasada.ok && pasada.errors.preferredDate).toMatch(/anterior a hoy/);
    const lejana = validateWebRequest({ ...base, kind: 'cita', service: 'frenos', preferredDate: '2027-12-01' }, rules);
    expect(!lejana.ok && lejana.errors.preferredDate).toMatch(/próximo año/);
    const hoy = validateWebRequest({ ...base, kind: 'cita', service: 'frenos', preferredDate: '2026-10-18' }, rules);
    expect(hoy.ok).toBe(true);
  });

  it('coherencia del canal preferido', () => {
    const r = validateWebRequest({ name: 'Ana', phone: '600123456', preferredContact: 'email', kind: 'contacto', topic: 'otro', message: 'Consulta de prueba.', privacyAccepted: true }, rules);
    expect(!r.ok && r.errors.email).toMatch(/correo/);
  });

  it('descarta campos que no corresponden al tipo de solicitud', () => {
    const r = validateWebRequest({ ...base, kind: 'contacto', topic: 'otro', message: 'Consulta de prueba.', plate: '1950BXF', service: 'frenos' }, rules);
    expect(r.ok && r.data.plate).toBe(null);
    expect(r.ok && r.data.service).toBe(null);
  });

  it('rechaza tipos desconocidos y textos demasiado largos', () => {
    expect(validateWebRequest({ ...base, kind: 'spam' }, rules).ok).toBe(false);
    const largo = validateWebRequest({ ...base, kind: 'contacto', topic: 'otro', message: 'x'.repeat(2001) }, rules);
    expect(!largo.ok && largo.errors.message).toMatch(/máximo/);
  });
});

describe('requestReference', () => {
  it('genera una referencia corta', () => {
    expect(requestReference('3f2a9c1e-1234-4abc-9def-0123456789ab')).toBe('3F2A9C1E');
  });
});

describe('validateWebRequest — formularios reales', () => {
  it('los desplegables vacíos ("Me da igual") cuentan como no indicados', () => {
    const r = validateWebRequest({ ...base, kind: 'cita', service: 'frenos', preferredContact: '', preferredTime: '', preferredDate: '', plate: '' }, rules);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ preferredContact: null, preferredTime: null, preferredDate: null, plate: null });
  });

  it('enseña todos los errores a la vez con el formulario vacío', () => {
    const r = validateWebRequest({ kind: 'cita', name: '', phone: '', email: '', service: '', preferredContact: '', preferredTime: '', message: '' }, rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['contact', 'name', 'privacyAccepted', 'service']);
  });

  it('rechaza valores de desplegable inventados', () => {
    const r = validateWebRequest({ ...base, kind: 'contacto', topic: 'hackeo', preferredContact: 'paloma', message: 'Consulta de prueba.' }, rules);
    expect(!r.ok && r.errors.topic).toBeTruthy();
    expect(!r.ok && r.errors.preferredContact).toBeTruthy();
  });
});
