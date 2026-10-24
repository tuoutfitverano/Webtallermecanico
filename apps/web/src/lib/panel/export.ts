/**
 * Copia de datos del taller: el archivo completo (JSON) y tablas sueltas en CSV
 * para abrir con Excel o LibreOffice (separador «;», como en España, y BOM para
 * que se vean bien las tildes).
 */

/** Tablas que se pueden bajar en CSV: nombre en la URL → tabla de la copia. */
export const CSV_TABLES = {
  clientes: { table: 'customers', label: 'Clientes' },
  vehiculos: { table: 'vehicles', label: 'Vehículos' },
  ordenes: { table: 'repair_orders', label: 'Órdenes de reparación' },
  trabajos: { table: 'repair_order_items', label: 'Trabajos y piezas de las órdenes' },
  presupuestos: { table: 'quotes', label: 'Presupuestos' },
  facturas: { table: 'invoices', label: 'Facturas' },
  cobros: { table: 'payments', label: 'Cobros' },
  mantenimientos: { table: 'vehicle_services', label: 'Mantenimientos de los vehículos' },
} as const;
export type CsvTable = keyof typeof CSV_TABLES;
export const isCsvTable = (v: string): v is CsvTable => Object.hasOwn(CSV_TABLES, v);

/**
 * Texto que una hoja de cálculo podría ejecutar como fórmula: empieza por = + - @
 * (o sus versiones de ancho completo) o por tabulador/salto, AUNQUE vaya detrás
 * de espacios o caracteres invisibles (auditoría H05).
 */
const FORMULA_START = /^[\p{Z}\p{Cc}\p{Cf}\s]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/u;

/** Una celda de CSV: comillas cuando hace falta y nunca una fórmula (se antepone «'», que la deja como texto). */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value !== 'number' && typeof value !== 'bigint' && FORMULA_START.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Filas (objetos) → CSV con cabecera. Las columnas, en el orden en que aparecen. */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const lines = [columns.map(cell).join(';'), ...rows.map(r => columns.map(c => cell(r[c])).join(';'))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** «copia-autovalue-2026-10-22.json» (solo letras, números y guiones). */
export function exportFileName(slug: string, day: string, suffix: string, ext: 'json' | 'csv'): string {
  const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `copia-${safe(slug) || 'taller'}${suffix ? `-${safe(suffix)}` : ''}-${safe(day)}.${ext}`;
}
