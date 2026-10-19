/** Los valores de dominio de packages/core deben coincidir con los tipos de la base de datos. */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUEL_TYPES, REPAIR_STATUSES, REQUEST_KINDS, REQUEST_STATUSES } from '@talleres/core';

const dir = new URL('../../../../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
const enumValues = (name: string) => {
  const m = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`).exec(sql);
  return m ? [...m[1]!.matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
};

describe('Tipos sincronizados con la base de datos', () => {
  it.each([
    ['request_status', REQUEST_STATUSES],
    ['request_kind', REQUEST_KINDS],
    ['repair_status', REPAIR_STATUSES],
    ['fuel_type', FUEL_TYPES],
  ] as const)('%s', (name, values) => {
    expect(enumValues(name)?.slice().sort()).toEqual([...values].sort());
  });

  it('los estados de reparación están en el mismo orden (el orden importa para detectar vueltas atrás)', () => {
    expect(enumValues('repair_status')).toEqual([...REPAIR_STATUSES]);
  });
});
