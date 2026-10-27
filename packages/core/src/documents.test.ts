import { describe, expect, it } from 'vitest';
import { checkTaxId, INVOICE_KIND_LABELS, summaryMessage, isTaxIdShape, isVin, normalizeTaxId, normalizeVin, quoteLabel, whatsappLink, whatsappNumber } from './documents.ts';

describe('documentos', () => {
  it('etiqueta de presupuesto con versión', () => {
    expect(quoteLabel(12)).toBe('P-12');
    expect(quoteLabel(12, 3)).toBe('P-12 v3');
  });
  it('NIF: forma básica', () => {
    expect(normalizeTaxId(' b-12.345.678 ')).toBe('B12345678');
    expect(isTaxIdShape('B12345678')).toBe(true);
    expect(isTaxIdShape('B12')).toBe(false);
  });
  it('VIN: 17 caracteres sin I, O, Q', () => {
    expect(isVin(normalizeVin('wvw zzz 1jz xw 000001'))).toBe(true);
    expect(isVin('WVWZZZ1JZXW00000O')).toBe(false);
    expect(isVin('ABC')).toBe(false);
  });
});

describe('WhatsApp (igual que la base de datos)', () => {
  it('normaliza móviles y descarta fijos', () => {
    expect(whatsappNumber('600 00 00 01')).toBe('34600000001');
    expect(whatsappNumber('+34 700-123-456')).toBe('34700123456');
    expect(whatsappNumber('0034600000001')).toBe('34600000001');
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('912345678')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it('enlace con el texto codificado', () => {
    expect(whatsappLink('600000001', 'Hola & adiós')).toBe('https://wa.me/34600000001?text=Hola%20%26%20adi%C3%B3s');
    expect(whatsappLink('912345678', 'x')).toBeNull();
  });
});

describe('NIF/NIE/CIF con control (auditoría H03)', () => {
  it('acepta identificadores españoles correctos', () => {
    for (const [id, kind] of [
      ['12345678Z', 'nif'], ['00000000T', 'nif'], ['K1234567L', 'nif'],
      ['X1234567L', 'nie'], ['Y1234567X', 'nie'], ['Z1234567R', 'nie'],
      ['B12345674', 'cif'], ['Q2826000H', 'cif'], ['A28015865', 'cif'], ['B00000000', 'cif'],
    ] as const) {
      expect(checkTaxId(id), id).toEqual({ ok: true, kind, value: id });
    }
    expect(checkTaxId(' es-b12.345.674 ')).toEqual({ ok: true, kind: 'cif', value: 'B12345674' });
  });

  it('rechaza los que tienen la forma correcta pero el control mal', () => {
    for (const id of ['12345678A', '00000000A', 'K1234567A', 'X1234567A', 'Z1234567X', 'B12345678', 'B1234567D', 'Q2826000A', 'Q28260008', 'A2801586E']) {
      expect(checkTaxId(id), id).toEqual({ ok: false, reason: 'control' });
    }
  });

  it('formatos imposibles', () => {
    for (const id of ['', '1234', 'ABCDEFGHI', '123456789', 'I1234567A', 'AA1234567', 'ES123']) {
      expect(checkTaxId(id, { allowForeign: true }).ok, id).toBe(false);
    }
  });

  it('extranjeros: solo con el prefijo del país y solo donde se permiten', () => {
    expect(checkTaxId('FR12345678901', { allowForeign: true })).toEqual({ ok: true, kind: 'extranjero', value: 'FR12345678901' });
    expect(checkTaxId('PT123456789', { allowForeign: true }).ok).toBe(true);
    expect(checkTaxId('FR12345678901')).toEqual({ ok: false, reason: 'extranjero' });
  });
});

describe('resúmenes de servicios', () => {
  it('los mensajes de la base de datos no hablan de facturas', () => {
    expect(summaryMessage('Una factura emitida no se borra.')).toBe('Un resumen emitido no se borra.');
    expect(summaryMessage('Otro mensaje.')).toBe('Otro mensaje.');
    expect(INVOICE_KIND_LABELS.ordinaria).toBe('Resumen de servicios');
  });
});
