/**
 * Matrículas españolas: normalización, reconocimiento de formato y presentación.
 *
 * Regla de oro: en la base de datos se guarda SIEMPRE la versión normalizada
 * (solo letras mayúsculas y números, sin espacios ni guiones). Así "1950 bxf",
 * "1950-BXF" y "1950BXF" son la misma matrícula y no se pueden duplicar.
 * El formato bonito ("1950 BXF") se calcula solo para mostrarlo.
 */

/** Consonantes que usa el sistema de matrícula nacional (sin vocales, Ñ ni Q). */
const CONSONANTES = 'BCDFGHJKLMNPRSTVWXYZ';

/** Códigos provinciales del sistema anterior a septiembre del 2000. */
export const PROVINCIAS: Readonly<Record<string, string>> = {
  A: 'Alicante', AB: 'Albacete', AL: 'Almería', AV: 'Ávila', B: 'Barcelona', BA: 'Badajoz',
  BI: 'Bizkaia', BU: 'Burgos', C: 'A Coruña', CA: 'Cádiz', CC: 'Cáceres', CE: 'Ceuta',
  CO: 'Córdoba', CR: 'Ciudad Real', CS: 'Castellón', CU: 'Cuenca', GC: 'Las Palmas',
  GE: 'Girona', GI: 'Girona', GR: 'Granada', GU: 'Guadalajara', H: 'Huelva', HU: 'Huesca',
  IB: 'Illes Balears', J: 'Jaén', L: 'Lleida', LE: 'León', LO: 'La Rioja', LU: 'Lugo',
  M: 'Madrid', MA: 'Málaga', ML: 'Melilla', MU: 'Murcia', NA: 'Navarra', O: 'Asturias',
  OR: 'Ourense', OU: 'Ourense', P: 'Palencia', PM: 'Illes Balears', PO: 'Pontevedra',
  S: 'Cantabria', SA: 'Salamanca', SE: 'Sevilla', SG: 'Segovia', SO: 'Soria',
  SS: 'Gipuzkoa', T: 'Tarragona', TE: 'Teruel', TF: 'Santa Cruz de Tenerife', TO: 'Toledo',
  V: 'Valencia', VA: 'Valladolid', VI: 'Álava', Z: 'Zaragoza', ZA: 'Zamora',
};

export type PlateKind =
  | 'actual' // 1950 BXF (desde 2000)
  | 'provincial' // GU-1234-A, M-1234-AB (1971-2000)
  | 'provincial_numerica' // M-123456 (anterior a 1971)
  | 'ciclomotor' // C 1234 BCD
  | 'remolque' // R 1234 BCD
  | 'especial' // E 1234 BCD (vehículos especiales)
  | 'historica' // H 1234 BCD
  | 'no_reconocida'; // extranjera, diplomática, temporal, errónea…

export const PLATE_KIND_LABELS: Readonly<Record<PlateKind, string>> = {
  actual: 'Nacional (desde 2000)',
  provincial: 'Provincial antigua',
  provincial_numerica: 'Provincial antigua (solo números)',
  ciclomotor: 'Ciclomotor',
  remolque: 'Remolque',
  especial: 'Vehículo especial',
  historica: 'Vehículo histórico',
  no_reconocida: 'Formato no reconocido',
};

export interface PlateAnalysis {
  /** Texto tal y como lo escribió el usuario. */
  input: string;
  /** Versión que se guarda: solo A-Z y 0-9. */
  normalized: string;
  /** Versión para mostrar: "1950 BXF", "GU-1234-A"… */
  display: string;
  kind: PlateKind;
  /** true si coincide con algún formato español conocido. */
  recognized: boolean;
  /** Provincia, solo en matrículas provinciales. */
  province?: { code: string; name: string };
}

/** Longitudes admitidas para la versión normalizada (también se comprueban en la base de datos). */
export const PLATE_MIN_LENGTH = 2;
export const PLATE_MAX_LENGTH = 12;

/**
 * Quita espacios, guiones, puntos y tildes, y pasa a mayúsculas.
 * No "corrige" letras (por ejemplo, no cambia O por 0): eso podría
 * convertir una matrícula en otra distinta sin que nadie se dé cuenta.
 */
export function normalizePlate(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const C = `[${CONSONANTES}]`;
const RE_ACTUAL = new RegExp(`^(\\d{4})(${C}{3})$`);
const RE_PREFIJO = new RegExp(`^([CREH])(\\d{4})(${C}{3})$`);
const RE_PROVINCIAL = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/;
const RE_PROVINCIAL_NUM = /^([A-Z]{1,2})(\d{1,6})$/;

const PREFIJOS: Record<string, PlateKind> = { C: 'ciclomotor', R: 'remolque', E: 'especial', H: 'historica' };

export function analyzePlate(input: string): PlateAnalysis {
  const normalized = normalizePlate(input);
  const base = { input, normalized };

  let m = RE_ACTUAL.exec(normalized);
  if (m) return { ...base, display: `${m[1]} ${m[2]}`, kind: 'actual', recognized: true };

  m = RE_PREFIJO.exec(normalized);
  if (m) {
    const kind = PREFIJOS[m[1]!]!;
    return { ...base, display: `${m[1]} ${m[2]} ${m[3]}`, kind, recognized: true };
  }

  m = RE_PROVINCIAL.exec(normalized);
  if (m && PROVINCIAS[m[1]!]) {
    return {
      ...base,
      display: `${m[1]}-${m[2]}-${m[3]}`,
      kind: 'provincial',
      recognized: true,
      province: { code: m[1]!, name: PROVINCIAS[m[1]!]! },
    };
  }

  m = RE_PROVINCIAL_NUM.exec(normalized);
  if (m && PROVINCIAS[m[1]!]) {
    return {
      ...base,
      display: `${m[1]}-${m[2]}`,
      kind: 'provincial_numerica',
      recognized: true,
      province: { code: m[1]!, name: PROVINCIAS[m[1]!]! },
    };
  }

  return { ...base, display: normalized, kind: 'no_reconocida', recognized: false };
}

/** Formato para mostrar a partir de la matrícula guardada. */
export function formatPlate(plate: string): string {
  return analyzePlate(plate).display;
}

export type PlateCheck =
  | { ok: true; analysis: PlateAnalysis }
  | { ok: false; analysis: PlateAnalysis; error: string; needsConfirmation?: boolean };

/**
 * Valida una matrícula para guardarla.
 * Las que no siguen un formato español conocido (extranjeras, diplomáticas,
 * temporales…) solo se aceptan si el usuario lo confirma expresamente.
 */
export function checkPlate(input: string, { allowNonStandard = false } = {}): PlateCheck {
  const analysis = analyzePlate(input);
  const n = analysis.normalized;
  if (n.length === 0) return { ok: false, analysis, error: 'Escribe la matrícula.' };
  if (n.length < PLATE_MIN_LENGTH || n.length > PLATE_MAX_LENGTH) {
    return { ok: false, analysis, error: `La matrícula debe tener entre ${PLATE_MIN_LENGTH} y ${PLATE_MAX_LENGTH} letras o números.` };
  }
  if (!analysis.recognized && !allowNonStandard) {
    return {
      ok: false,
      analysis,
      needsConfirmation: true,
      error: 'No parece una matrícula española. Revísala o confirma que es correcta (por ejemplo, extranjera).',
    };
  }
  return { ok: true, analysis };
}
