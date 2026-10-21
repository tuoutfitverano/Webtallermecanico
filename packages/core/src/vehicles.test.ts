import { describe, expect, it } from 'vitest';
import { maxVehicleYear, validateVehicle } from './vehicles.ts';

describe('validateVehicle', () => {
  it('matrícula, marca, modelo y año son obligatorios', () => {
    const r = validateVehicle({ plate: '', make: '', model: '', year: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.plate).toBeDefined();
      expect(r.errors.make).toBe('Indica la marca.');
      expect(r.errors.model).toBe('Indica el modelo.');
      expect(r.errors.year).toBe('Indica el año del vehículo.');
    }
  });

  it('normaliza un vehículo completo', () => {
    const r = validateVehicle({ plate: '1950 bxf', make: ' Volkswagen ', model: 'Golf', fuel: 'gasolina', year: 2018, yearKind: 'primera_matriculacion' });
    expect(r).toEqual({
      ok: true,
      data: {
        plate: '1950BXF',
        plateKind: 'actual',
        make: 'Volkswagen',
        model: 'Golf',
        year: 2018,
        yearKind: 'primera_matriculacion',
        fuel: 'gasolina',
        customerId: null,
        internalNotes: null,
        version: null,
        vin: null,
        mileage: null,
        nextServiceDate: null,
        nextServiceKm: null,
        nextServiceNotes: null,
      },
    });
  });

  it('versión, bastidor, kilómetros y próxima revisión (opcionales)', () => {
    const base = { plate: '1950BXF', make: 'VW', model: 'Golf', year: 2018, yearKind: 'fabricacion' as const };
    const r = validateVehicle({ ...base, version: ' 1.5 TSI ', vin: 'wvw zzz1kz 8w123456', mileage: 120500, nextServiceDate: '2027-03-01', nextServiceKm: 135000, nextServiceNotes: 'Cambio de aceite' });
    expect(r.ok && r.data).toMatchObject({ version: '1.5 TSI', vin: 'WVWZZZ1KZ8W123456', mileage: 120500, nextServiceDate: '2027-03-01', nextServiceKm: 135000 });
    const bad = validateVehicle({ ...base, vin: 'WVWZZZ1KZ8W12345O', mileage: -1, nextServiceDate: '01/03/2027' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.vin).toMatch(/17/);
      expect(bad.errors.mileage).toBeDefined();
      expect(bad.errors.nextServiceDate).toBe('Fecha no válida.');
    }
  });

  it('no deja fijar el origen de datos ni la verificación desde el formulario', () => {
    const r = validateVehicle({ plate: '1950BXF', make: 'VW', model: 'Golf', year: 2015, yearKind: 'fabricacion', dataSource: 'proveedor_externo', verificationStatus: 'verificado' });
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
    const ok = validateVehicle({ plate: 'WOB12345', make: 'BMW', model: 'X1', confirmNonStandardPlate: true, year: 2012, yearKind: 'fabricacion' });
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
