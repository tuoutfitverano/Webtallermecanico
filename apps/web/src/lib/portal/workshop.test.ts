import { describe, expect, it } from 'vitest';
import { invitationToken, pickWorkshop } from './workshop.ts';

const A = { workshop_id: 'aaaaaaaa-0000-0000-0000-000000000000', name: 'A' };
const B = { workshop_id: 'bbbbbbbb-0000-0000-0000-000000000000', name: 'B' };

describe('pickWorkshop', () => {
  it('elige el pedido, si no el recordado, si no el primero', () => {
    expect(pickWorkshop([A, B], B.workshop_id, A.workshop_id)).toBe(B);
    expect(pickWorkshop([A, B], null, B.workshop_id)).toBe(B);
    expect(pickWorkshop([A, B], undefined, undefined)).toBe(A);
  });
  it('nunca uno ajeno ni mal formado', () => {
    expect(pickWorkshop([A], 'cccccccc-0000-0000-0000-000000000000', null)).toBe(A);
    expect(pickWorkshop([A], "x' or 1=1", null)).toBe(A);
    expect(pickWorkshop([], A.workshop_id, A.workshop_id)).toBeNull();
  });
});

describe('invitationToken', () => {
  const code = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
  it('acepta el enlace completo o solo el código', () => {
    expect(invitationToken(`https://app.ejemplo.es/portal/invitacion?token=${code}`)).toBe(code);
    expect(invitationToken(`  ${code.toUpperCase()}  `)).toBe(code);
  });
  it('rechaza lo que no es un código', () => {
    expect(invitationToken('taller-garcia')).toBeNull();
    expect(invitationToken('https://evil.test/?token=abc')).toBeNull();
    expect(invitationToken('')).toBeNull();
  });
});
