import { describe, expect, it } from 'vitest';
import { isTaxIdShape, isVin, normalizeTaxId, normalizeVin, quoteLabel, whatsappLink, whatsappNumber } from './documents.ts';

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
