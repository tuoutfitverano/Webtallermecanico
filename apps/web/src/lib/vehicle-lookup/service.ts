/**
 * Lógica de la consulta por matrícula (sin dependencias de Astro: se prueba
 * con dobles en service.test.ts).
 *
 *  1. Sin proveedor configurado → "no disponible" (y no se llama a nadie).
 *  2. Matrícula normalizada y validada (reglas de @talleres/core).
 *  3. start_vehicle_lookup con el token del usuario: permisos, límites,
 *     doble clic y reutilización de una respuesta reciente del MISMO taller.
 *  4. Solo si es una consulta nueva, se llama al proveedor.
 *  5. complete_vehicle_lookup con la clave secreta guarda el resultado
 *     validado. Si no se puede guardar, no se muestra como éxito.
 *
 * Nada de esto crea el vehículo: el usuario revisa los datos y decide.
 */
import { checkPlate } from '@talleres/core';
import type { ProviderOutcome, VehicleData, VehicleLookupProvider } from './types.ts';

export type LookupStatus = ProviderOutcome['kind'] | 'pendiente';

export interface LookupRow {
  lookup_id: string;
  state: 'nueva' | 'reutilizada' | 'en_curso';
  status: LookupStatus;
  result: VehicleData | null;
  completed_at: string | null;
}

interface DbError { code?: string; message?: string }

export interface LookupDeps {
  /** null = no hay proveedor contratado/configurado (o falta la clave secreta del servidor). */
  provider: VehicleLookupProvider | null;
  start(args: { workshopId: string; plate: string; provider: string; requestKey: string }): Promise<{ data: LookupRow | null; error: DbError | null }>;
  complete(lookupId: string, status: ProviderOutcome['kind'], result: VehicleData | null): Promise<{ error: DbError | null }>;
  /** Vuelve a leer una consulta (para esperar a otra petición que la está haciendo). */
  read(lookupId: string): Promise<LookupRow | null>;
  log(event: string, meta?: Record<string, string | number | boolean>): void;
  sleep?: (ms: number) => Promise<void>;
}

export type LookupErrorCode =
  | 'no_configurado'
  | 'matricula'
  | 'confirmar_matricula'
  | 'sin_permiso'
  | 'limite'
  | 'en_curso'
  | 'no_encontrado'
  | 'respuesta_invalida'
  | 'limite_proveedor'
  | 'no_disponible'
  | 'credenciales'
  | 'guardado'
  | 'error';

export type LookupView =
  | { ok: true; lookupId: string; plate: string; providerName: string; data: VehicleData; reused: boolean; consultedAt: string }
  | { ok: false; code: LookupErrorCode; message: string };

/** Mensajes para el usuario: claros y sin detalles técnicos ni secretos. */
export const LOOKUP_MESSAGES: Readonly<Record<LookupErrorCode, string>> = {
  no_configurado: 'La consulta automática por matrícula no está disponible: el taller no tiene contratado un proveedor de datos. Introduce los datos a mano.',
  matricula: 'Revisa la matrícula antes de consultarla.',
  confirmar_matricula: 'No parece una matrícula española. Confirma que es correcta para consultarla (el proveedor solo tiene matrículas españolas).',
  sin_permiso: 'No tienes permiso para consultar matrículas en este taller.',
  limite: 'Se ha alcanzado el límite de consultas. Introduce los datos a mano o inténtalo más tarde.',
  en_curso: 'Esta matrícula se está consultando ahora mismo. Espera unos segundos y vuelve a pulsar «Consultar datos».',
  no_encontrado: 'El proveedor no tiene datos de esta matrícula. Comprueba que está bien escrita o introduce los datos a mano.',
  respuesta_invalida: 'El proveedor ha respondido con datos que no podemos usar. No se ha rellenado nada: introduce los datos a mano.',
  limite_proveedor: 'El proveedor de datos no acepta más consultas ahora mismo (límite o saldo agotado). Introduce los datos a mano.',
  no_disponible: 'El proveedor de datos no responde. Inténtalo en unos minutos o introduce los datos a mano.',
  credenciales: 'La consulta automática no está disponible por un problema de configuración del proveedor. Avisa al responsable de la plataforma; mientras, introduce los datos a mano.',
  guardado: 'No hemos podido guardar el resultado de la consulta. Inténtalo de nuevo o introduce los datos a mano.',
  error: 'No se ha podido hacer la consulta. Introduce los datos a mano.',
};

const fail = (code: LookupErrorCode, message = LOOKUP_MESSAGES[code]): LookupView => ({ ok: false, code, message });

export async function lookupVehicle(
  deps: LookupDeps,
  input: { workshopId: string; plate: string; allowNonStandard: boolean; requestKey: string },
): Promise<LookupView> {
  const provider = deps.provider;
  if (!provider) return fail('no_configurado');

  const check = checkPlate(input.plate, { allowNonStandard: input.allowNonStandard });
  if (!check.ok) return fail(check.needsConfirmation ? 'confirmar_matricula' : 'matricula', check.error);
  const plate = check.analysis.normalized;

  const { data: row, error } = await deps.start({ workshopId: input.workshopId, plate, provider: provider.id, requestKey: input.requestKey });
  if (error || !row) {
    deps.log('vehicle_lookup_start_error', { code: error?.code ?? 'sin_datos' });
    if (error?.code === '42501') return fail('sin_permiso');
    // Los límites de la base de datos traen un mensaje pensado para el usuario.
    if (error?.code === 'PT429') return fail('limite', error.message || LOOKUP_MESSAGES.limite);
    if (error?.code === '22023') return fail('matricula');
    return fail('error');
  }

  if (row.state === 'nueva') {
    let outcome: ProviderOutcome;
    try {
      outcome = await provider.lookup(plate);
    } catch {
      outcome = { kind: 'error' };
    }
    const saved = await deps.complete(row.lookup_id, outcome.kind, outcome.kind === 'encontrado' ? outcome.data : null);
    deps.log('vehicle_lookup', { provider: provider.id, result: outcome.kind, saved: !saved.error });
    if (saved.error) return fail('guardado');
    if (outcome.kind !== 'encontrado') return fail(outcome.kind);
    return { ok: true, lookupId: row.lookup_id, plate, providerName: provider.name, data: outcome.data, reused: false, consultedAt: new Date().toISOString() };
  }

  // Otra petición (doble clic) la está haciendo: se espera un poco a que termine.
  let current: LookupRow | null = row;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  for (let i = 0; current?.status === 'pendiente' && i < 24; i++) {
    await sleep(500);
    current = await deps.read(row.lookup_id);
  }
  if (!current || current.status === 'pendiente') return fail('en_curso');
  deps.log('vehicle_lookup_reused', { provider: provider.id, result: current.status });
  if (current.status !== 'encontrado') return fail(current.status);
  if (!current.result) return fail('respuesta_invalida');
  return {
    ok: true, lookupId: current.lookup_id, plate, providerName: provider.name, data: current.result,
    reused: row.state === 'reutilizada', consultedAt: current.completed_at ?? new Date().toISOString(),
  };
}
