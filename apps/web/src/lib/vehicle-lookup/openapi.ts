/**
 * Proveedor: Openapi.com · "Spanish Car Check" (matrículas españolas).
 *
 * Documentación oficial (consultada el 18-10-2026, ver docs/CONSULTA_MATRICULAS.md):
 *   https://openapi.com/products/spanish-car-check
 *   https://console.openapi.com/apis/automotive/documentation
 *
 *   GET {base}/ES-car/{matrícula}
 *   Authorization: Bearer <token>
 *   base: https://automotive.openapi.com (producción)
 *         https://test.automotive.openapi.com (pruebas del propio proveedor)
 *
 * Respuesta documentada: { success, message, error, data: { … } }. Los
 * nombres exactos de algunos campos de `data` difieren entre la ficha del
 * producto y el ejemplo publicado, así que la conversión es tolerante: lee
 * solo lo que reconoce, valida cada valor y descarta lo demás. Nunca rellena
 * un dato que no venga en la respuesta.
 *
 * Este archivo solo se usa en el servidor: el token nunca llega al navegador.
 */
import { FUEL_TYPES, type FuelType } from '@talleres/core';
import type { ProviderOutcome, VehicleData, VehicleLookupProvider } from './types.ts';

export const OPENAPI_PRODUCTION_URL = 'https://automotive.openapi.com';

export interface OpenapiOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createOpenapiProvider(opts: OpenapiOptions): VehicleLookupProvider {
  const base = (opts.baseUrl || OPENAPI_PRODUCTION_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'openapi',
    name: 'Openapi (Spanish Car Check)',
    async lookup(plate) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/ES-car/${encodeURIComponent(plate)}`, {
          headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Tiempo agotado, DNS, conexión rechazada…
        return { kind: 'no_disponible' };
      }
      return outcomeFromResponse(res.status, await res.text().catch(() => ''));
    },
  };
}

/** Traduce la respuesta HTTP a un resultado interno. Exportado para las pruebas. */
export function outcomeFromResponse(status: number, body: string): ProviderOutcome {
  if (status === 401 || status === 403) return { kind: 'credenciales' };
  if (status === 404) return { kind: 'no_encontrado' };
  // 402: sin saldo; 429: demasiadas peticiones.
  if (status === 402 || status === 429) return { kind: 'limite_proveedor' };
  if (status >= 500) return { kind: 'no_disponible' };
  if (status < 200 || status >= 300) return { kind: 'error' };

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: 'respuesta_invalida' };
  }
  if (!isObject(json)) return { kind: 'respuesta_invalida' };
  if (json.success === false) return { kind: 'no_encontrado' };
  const raw = Array.isArray(json.data) ? json.data[0] : json.data;
  if (raw === null || raw === undefined || (isObject(raw) && Object.keys(raw).length === 0)) return { kind: 'no_encontrado' };
  if (!isObject(raw)) return { kind: 'respuesta_invalida' };
  const data = mapEsCar(raw);
  return data ? { kind: 'encontrado', data } : { kind: 'respuesta_invalida' };
}

/**
 * Convierte `data` del proveedor al modelo interno. Devuelve null si no hay
 * al menos marca o modelo (un resultado sin ellos no sirve para registrar).
 */
export function mapEsCar(raw: Record<string, unknown>): VehicleData | null {
  const out: VehicleData = {};
  const make = text(pick(raw, 'CarMake', 'Make', 'Brand', 'Marca'), 60);
  const model = text(pick(raw, 'CarModel', 'Model', 'Modelo'), 80);
  const version = text(pick(raw, 'Variation', 'Version', 'Variant'), 120);
  if (make) out.make = make;
  if (model) out.model = model;
  if (version) out.version = version;

  const year = yearFrom(pick(raw, 'RegistrationDate', 'RegistrationYear', 'FirstRegistrationDate'));
  if (year) {
    out.year = year;
    // La fecha que da el proveedor es la de matriculación, no la de fabricación.
    out.year_kind = 'primera_matriculacion';
  }
  const fuel = fuelFrom(text(pick(raw, 'Fuel', 'FuelType', 'Combustible'), 40));
  if (fuel) out.fuel = fuel;
  const cv = number(pick(raw, 'DynamicPower', 'PowerCV', 'Power'), 1, 2000);
  if (cv) out.power_cv = Math.round(cv);
  const cc = number(pick(raw, 'EngineSize', 'Displacement', 'EngineCC'), 20, 20000);
  if (cc) out.engine_cc = Math.round(cc);
  const vin = text(pick(raw, 'VehicleIdentificationNumber', 'VIN', 'Vin'), 17)?.toUpperCase();
  // Un VIN tiene 17 caracteres sin I, O ni Q. Si no lo cumple, no se guarda.
  if (vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) out.vin = vin;

  return out.make || out.model ? out : null;
}

// ---------------------------------------------------------------- ayudas
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Primer campo presente. Admite { CurrentTextValue: "…" }, un formato que usan algunos servicios de matrículas. */
function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    let v = raw[k];
    if (isObject(v)) v = v.CurrentTextValue ?? v.Value ?? v.value;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  // Sin caracteres de control ni espacios repetidos.
  const s = [...String(v)].map(c => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('').replace(/\s+/g, ' ').trim();
  return s && s.length <= max ? s : undefined;
}

function number(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').trim()) : Number.NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Año a partir de "17/11/2003", "2003-11-17" o 2003. Nada de años imposibles. */
function yearFrom(v: unknown): number | undefined {
  let y: number | undefined;
  if (typeof v === 'number') y = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s) ?? null;
    if (m) y = Number(m[3]);
    else if (/^\d{4}(-\d{2}-\d{2}([T ].*)?)?$/.test(s)) y = Number(s.slice(0, 4));
  }
  const max = new Date().getUTCFullYear() + 1;
  return y !== undefined && Number.isInteger(y) && y >= 1900 && y <= max ? y : undefined;
}

/** Solo combustibles reconocibles sin dudas. Si no está claro, no se rellena. */
function fuelFrom(v: string | undefined): FuelType | undefined {
  if (!v) return undefined;
  const s = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const table: Array<[RegExp, FuelType]> = [
    [/enchufable|plug.?in|phev/, 'hibrido_enchufable'],
    [/hibrid|hybrid|hev/, 'hibrido'],
    [/^(gasolina|petrol|gasoline|benzin)/, 'gasolina'],
    [/^(diesel|gasoil|gasoleo)/, 'diesel'],
    [/^(electric|bev)/, 'electrico'],
    [/^(glp|lpg|autogas)/, 'glp'],
    [/^(gnc|cng|gas natural)/, 'gnc'],
    [/^(hidrogeno|hydrogen)/, 'hidrogeno'],
  ];
  const found = table.find(([re]) => re.test(s))?.[1];
  return found && (FUEL_TYPES as readonly string[]).includes(found) ? found : undefined;
}
