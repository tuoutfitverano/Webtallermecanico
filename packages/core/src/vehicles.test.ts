import { describe, expect, it } from 'vitest';
import { maxVehicleYear, validateVehicle } from './vehicles.ts';

describe('validateVehicle', () => {
  it('acepta el vehículo de demostración sin inventar el año', () => {
    const r = validateVehicle({ plate: '1950 bxf', make: ' Volkswagen ', model: 'Golf', fuel: 'gasolina', year: null });
    expect(r).toEqual({
      ok: true,
      data: {
        plate: '1950BXF',
        plateKind: 'actual',
        make: 'Volkswagen',
        model: 'Golf',
        year: null,
        yearKind: null,
        fuel: 'gasolina',
        customerId: null,
        internalNotes: null,
      },
    });
  });

  it('no deja fijar el origen de datos ni la verificación desde el formulario', () => {
    const r = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', dataSource: 'proveedor_externo', verificationStatus: 'verificado' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).not.toHaveProperty('dataSource');
      expect(r.data).not.toHaveProperty('verificationStatus');
    }
  });

  it('exige marca y modelo', () => {
    const r = validateVehicle({ plate: '1950BXF', make: '  ', model: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.make).toBe('Indica la marca.');
      expect(r.errors.model).toBe('Indica el modelo.');
    }
  });

  it('valida la matrícula y pide confirmación si no es estándar', () => {
    const r = validateVehicle({ plate: 'WOB12345', make: 'BMW', model: 'X1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.plate).toMatch(/confirma/);
    const ok = validateVehicle({ plate: 'WOB12345', make: 'BMW', model: 'X1', confirmNonStandardPlate: true });
    expect(ok.ok && ok.data.plateKind).toBe('no_reconocida');
  });

  it('controla el año y pide saber qué año es', () => {
    const future = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', year: maxVehicleYear() + 1, yearKind: 'fabricacion' });
    expect(future.ok).toBe(false);
    const sinTipo = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', year: 2015 });
    expect(sinTipo.ok).toBe(false);
    if (!sinTipo.ok) expect(sinTipo.errors.yearKind).toBeDefined();
    const bien = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', year: 2015, yearKind: 'primera_matriculacion' });
    expect(bien.ok).toBe(true);
  });

  it('rechaza combustibles fuera de la lista', () => {
    const r = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', fuel: 'nuclear' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fuel).toBe('Elige un combustible de la lista.');
  });
});
