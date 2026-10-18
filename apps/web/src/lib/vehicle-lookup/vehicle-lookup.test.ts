/**
 * Pruebas de la consulta por matrícula.
 * ⚠ SIMULADAS: el proveedor y la base de datos son dobles de prueba. Aquí no
 * se llama a ningún proveedor real.
 */
import { describe, expect, it, vi } from 'vitest';
import { createOpenapiProvider, mapEsCar, outcomeFromResponse } from './openapi.ts';
import { lookupVehicle, type LookupDeps, type LookupRow } from './service.ts';
import { applyLookup, reviewRows } from './review.ts';
import type { ProviderOutcome, VehicleLookupProvider } from './types.ts';

// Forma del ejemplo publicado por el proveedor (5776CNS · Audi A3), con los campos documentados.
const SAMPLE = {
  success: true, message: '', error: null,
  data: {
    CarMake: 'AUDI', CarModel: 'A3', Variation: '1.6 ATTRACTION', RegistrationDate: '17/11/2003',
    Fuel: 'Gasolina', DynamicPower: '102.0', EngineSize: '1595', Doors: '3', VehicleIdentificationNumber: null, IndicativePrice: '22000',
  },
};

describe('Openapi · conversión de la respuesta', () => {
  it('convierte una respuesta válida al modelo interno', () => {
    expect(outcomeFromResponse(200, JSON.stringify(SAMPLE))).toEqual({
      kind: 'encontrado',
      data: { make: 'AUDI', model: 'A3', version: '1.6 ATTRACTION', year: 2003, year_kind: 'primera_matriculacion', fuel: 'gasolina', power_cv: 102, engine_cc: 1595 },
    });
  });

  it('no inventa lo que no viene: sin fecha, combustible ni potencia, no hay año, combustible ni potencia', () => {
    expect(mapEsCar({ CarMake: 'SEAT', CarModel: 'IBIZA' })).toEqual({ make: 'SEAT', model: 'IBIZA' });
  });

  it('admite el formato { CurrentTextValue } y descarta valores sospechosos', () => {
    expect(mapEsCar({
      CarMake: { CurrentTextValue: 'RENAULT' }, CarModel: { CurrentTextValue: 'CLIO' },
      RegistrationDate: '31/12/1850', Fuel: 'Queroseno', DynamicPower: '-5', EngineSize: 'mucha', VehicleIdentificationNumber: 'NO-ES-UN-VIN',
    })).toEqual({ make: 'RENAULT', model: 'CLIO' });
  });

  it('reconoce combustibles solo cuando no hay dudas', () => {
    const fuel = (f: string) => mapEsCar({ CarMake: 'X', Fuel: f })?.fuel;
    expect(fuel('DIÉSEL')).toBe('diesel');
    expect(fuel('Híbrido enchufable')).toBe('hibrido_enchufable');
    expect(fuel('Eléctrico')).toBe('electrico');
    expect(fuel('Mezcla rara')).toBeUndefined();
  });

  it('respuestas incompletas o mal formadas → "respuesta no válida", sin datos', () => {
    expect(outcomeFromResponse(200, '<html>error</html>')).toEqual({ kind: 'respuesta_invalida' });
    expect(outcomeFromResponse(200, '"texto"')).toEqual({ kind: 'respuesta_invalida' });
    expect(outcomeFromResponse(200, JSON.stringify({ success: true, data: { Fuel: 'Gasolina' } }))).toEqual({ kind: 'respuesta_invalida' });
    expect(outcomeFromResponse(200, JSON.stringify({ success: true, data: 'AUDI' }))).toEqual({ kind: 'respuesta_invalida' });
  });

  it('distingue no encontrado, credenciales, límite y caída del servicio', () => {
    expect(outcomeFromResponse(404, '')).toEqual({ kind: 'no_encontrado' });
    expect(outcomeFromResponse(200, JSON.stringify({ success: false, data: null }))).toEqual({ kind: 'no_encontrado' });
    expect(outcomeFromResponse(200, JSON.stringify({ success: true, data: {} }))).toEqual({ kind: 'no_encontrado' });
    expect(outcomeFromResponse(401, '')).toEqual({ kind: 'credenciales' });
    expect(outcomeFromResponse(403, '')).toEqual({ kind: 'credenciales' });
    expect(outcomeFromResponse(402, '')).toEqual({ kind: 'limite_proveedor' });
    expect(outcomeFromResponse(429, '')).toEqual({ kind: 'limite_proveedor' });
    expect(outcomeFromResponse(503, '')).toEqual({ kind: 'no_disponible' });
    expect(outcomeFromResponse(418, '')).toEqual({ kind: 'error' });
  });
});

describe('Openapi · cliente HTTP (fetch simulado)', () => {
  it('llama al endpoint documentado con el token en la cabecera', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 }));
    const provider = createOpenapiProvider({ token: 'tok', baseUrl: 'https://test.automotive.openapi.com/', fetchImpl });
    const out = await provider.lookup('5776CNS');
    expect(out.kind).toBe('encontrado');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://test.automotive.openapi.com/ES-car/5776CNS');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('sin base indicada usa la URL de producción', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    await createOpenapiProvider({ token: 't', fetchImpl }).lookup('1234BCD');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://automotive.openapi.com/ES-car/1234BCD');
  });

  it('tiempo agotado o red caída → "no disponible"', async () => {
    const slow: typeof fetch = (_u, init) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
    });
    expect(await createOpenapiProvider({ token: 't', timeoutMs: 20, fetchImpl: slow }).lookup('1234BCD')).toEqual({ kind: 'no_disponible' });
    const down: typeof fetch = async () => { throw new TypeError('fetch failed'); };
    expect(await createOpenapiProvider({ token: 't', fetchImpl: down }).lookup('1234BCD')).toEqual({ kind: 'no_disponible' });
  });
});

// ---------------------------------------------------------------- servicio
function fakeProvider(outcome: ProviderOutcome | (() => Promise<ProviderOutcome>)): VehicleLookupProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'simulado', name: 'Proveedor simulado', calls,
    async lookup(plate) { calls.push(plate); return typeof outcome === 'function' ? outcome() : outcome; },
  };
}
function deps(over: Partial<LookupDeps> = {}): LookupDeps & { completed: unknown[]; logs: string[] } {
  const completed: unknown[] = [];
  const logs: string[] = [];
  return {
    provider: fakeProvider({ kind: 'encontrado', data: { make: 'AUDI', model: 'A3' } }),
    start: async () => ({ data: { lookup_id: 'l1', state: 'nueva', status: 'pendiente', result: null, completed_at: null }, error: null }),
    complete: async (...args) => { completed.push(args); return { error: null }; },
    read: async () => null,
    log: (e, meta) => logs.push(`${e} ${JSON.stringify(meta ?? {})}`),
    sleep: async () => {},
    completed, logs,
    ...over,
  };
}
const input = { workshopId: 'w1', plate: '5776 cns', allowNonStandard: false, requestKey: 'k1' };

describe('Consulta · lógica de negocio', () => {
  it('sin proveedor configurado no llama a nadie y lo dice', async () => {
    const start = vi.fn();
    const r = await lookupVehicle(deps({ provider: null, start }), input);
    expect(r).toMatchObject({ ok: false, code: 'no_configurado' });
    expect(start).not.toHaveBeenCalled();
  });

  it('normaliza la matrícula antes de consultar y guarda el resultado', async () => {
    const d = deps();
    const r = await lookupVehicle(d, input);
    expect(r).toMatchObject({ ok: true, plate: '5776CNS', data: { make: 'AUDI', model: 'A3' }, reused: false });
    expect((d.provider as ReturnType<typeof fakeProvider>).calls).toEqual(['5776CNS']);
    expect(d.completed).toEqual([['l1', 'encontrado', { make: 'AUDI', model: 'A3' }]]);
  });

  it('valida la entrada: vacía o no española sin confirmar → no se consulta', async () => {
    const start = vi.fn();
    expect(await lookupVehicle(deps({ start }), { ...input, plate: '  ' })).toMatchObject({ ok: false, code: 'matricula' });
    expect(await lookupVehicle(deps({ start }), { ...input, plate: 'ABC123XYZ' })).toMatchObject({ ok: false, code: 'confirmar_matricula' });
    expect(start).not.toHaveBeenCalled();
    // Una histórica legítima sí se admite.
    expect(await lookupVehicle(deps(), { ...input, plate: 'H 1234 BCD' })).toMatchObject({ ok: true, plate: 'H1234BCD' });
  });

  it('sin permiso o con el límite agotado (lo decide la base de datos) → error claro y sin llamar al proveedor', async () => {
    const provider = fakeProvider({ kind: 'no_encontrado' });
    expect(await lookupVehicle(deps({ provider, start: async () => ({ data: null, error: { code: '42501' } }) }), input))
      .toMatchObject({ ok: false, code: 'sin_permiso' });
    expect(await lookupVehicle(deps({ provider, start: async () => ({ data: null, error: { code: 'PT429', message: 'El taller ha alcanzado el límite diario.' } }) }), input))
      .toEqual({ ok: false, code: 'limite', message: 'El taller ha alcanzado el límite diario.' });
    expect(provider.calls).toHaveLength(0);
  });

  it('reutiliza una respuesta reciente del taller sin volver a pagar', async () => {
    const provider = fakeProvider({ kind: 'error' });
    const r = await lookupVehicle(deps({
      provider,
      start: async () => ({ data: { lookup_id: 'l0', state: 'reutilizada', status: 'encontrado', result: { make: 'SEAT' }, completed_at: '2026-10-18T08:00:00Z' }, error: null }),
    }), input);
    expect(r).toMatchObject({ ok: true, lookupId: 'l0', reused: true, data: { make: 'SEAT' } });
    expect(provider.calls).toHaveLength(0);
  });

  it('doble clic: espera a la otra petición en lugar de consultar dos veces', async () => {
    const provider = fakeProvider({ kind: 'error' });
    const rows: Array<LookupRow | null> = [
      { lookup_id: 'l1', state: 'en_curso', status: 'pendiente', result: null, completed_at: null },
      { lookup_id: 'l1', state: 'en_curso', status: 'encontrado', result: { make: 'AUDI' }, completed_at: '2026-10-18T08:00:00Z' },
    ];
    const r = await lookupVehicle(deps({
      provider,
      start: async () => ({ data: { lookup_id: 'l1', state: 'en_curso', status: 'pendiente', result: null, completed_at: null }, error: null }),
      read: async () => rows.shift() ?? null,
    }), input);
    expect(r).toMatchObject({ ok: true, data: { make: 'AUDI' } });
    expect(provider.calls).toHaveLength(0);
  });

  it.each([
    ['no_encontrado'], ['respuesta_invalida'], ['limite_proveedor'], ['no_disponible'], ['credenciales'], ['error'],
  ] as const)('el fallo "%s" del proveedor se registra y se explica sin detalles técnicos', async kind => {
    const d = deps({ provider: fakeProvider({ kind }) });
    const r = await lookupVehicle(d, input);
    expect(r).toMatchObject({ ok: false, code: kind });
    expect(d.completed).toEqual([['l1', kind, null]]);
    if (!r.ok) expect(r.message).not.toMatch(/http|token|bearer|stack|undefined/i);
  });

  it('una excepción inesperada del proveedor no rompe la página', async () => {
    const r = await lookupVehicle(deps({ provider: fakeProvider(() => Promise.reject(new Error('boom'))) }), input);
    expect(r).toMatchObject({ ok: false, code: 'error' });
  });

  it('si no se puede guardar el resultado, no se presenta como éxito', async () => {
    const r = await lookupVehicle(deps({ complete: async () => ({ error: { code: 'XX000' } }) }), input);
    expect(r).toMatchObject({ ok: false, code: 'guardado' });
  });

  it('los registros no contienen la matrícula ni datos del vehículo', async () => {
    const d = deps();
    await lookupVehicle(d, input);
    expect(d.logs.join(' ')).not.toMatch(/5776|AUDI|A3/);
  });
});

describe('Revisión antes de guardar', () => {
  const data = { make: 'AUDI', model: 'A3', year: 2003, year_kind: 'primera_matriculacion' as const, fuel: 'gasolina' as const, power_cv: 102 };

  it('propone marcados los campos vacíos y desmarcados los que ya tienen otro valor', () => {
    const rows = reviewRows(data, { make: '', model: 'A3 Sportback', year: '', fuel: 'gasolina' });
    expect(rows.map(r => [r.field, r.checked, r.conflict])).toEqual([
      ['make', true, null], ['model', false, 'A3 Sportback'], ['year', true, null], ['fuel', true, null], ['power_cv', false, null],
    ]);
  });

  it('solo aplica los campos marcados: lo escrito a mano se conserva', () => {
    const form = { plate: '5776CNS', make: '', model: 'A3 Sportback', year: '', year_kind: '', fuel: '', internal_notes: 'Mía' };
    expect(applyLookup(data, form, new Set(['make', 'year']))).toEqual({
      ...form, make: 'AUDI', year: '2003', year_kind: 'primera_matriculacion',
    });
    expect(applyLookup(data, form, new Set())).toEqual(form);
  });
});
