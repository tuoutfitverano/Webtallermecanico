/**
 * Consulta de datos de vehículos por matrícula: tipos comunes.
 *
 * Cualquier proveedor externo se adapta a esta interfaz. El formulario de
 * vehículos y la lógica de consulta no saben qué proveedor hay detrás, así
 * que cambiarlo no obliga a reescribir nada más.
 */
import type { FuelType, YearKind } from '@talleres/core';

/** Datos de un vehículo ya convertidos al modelo interno. Solo lo que el proveedor devolvió de verdad. */
export interface VehicleData {
  make?: string;
  model?: string;
  version?: string;
  year?: number;
  year_kind?: YearKind;
  fuel?: FuelType;
  /** Potencia en CV, tal y como la da el proveedor. */
  power_cv?: number;
  /** Cilindrada en cm³. */
  engine_cc?: number;
  vin?: string;
}

/** Lo que puede pasar al preguntar a un proveedor (sin detalles técnicos ni secretos). */
export type ProviderOutcome =
  | { kind: 'encontrado'; data: VehicleData }
  | { kind: 'no_encontrado' }
  | { kind: 'respuesta_invalida' }
  | { kind: 'limite_proveedor' }
  | { kind: 'no_disponible' }
  | { kind: 'credenciales' }
  | { kind: 'error' };

export interface VehicleLookupProvider {
  /** Identificador interno (minúsculas): se guarda con cada consulta. */
  id: string;
  /** Nombre para mostrar al usuario ("Datos devueltos por …"). */
  name: string;
  /** Recibe la matrícula YA normalizada (solo A-Z y 0-9). */
  lookup(plate: string): Promise<ProviderOutcome>;
}
