#!/usr/bin/env node
/**
 * Comprueba que nada secreto ni del servidor ha acabado en los archivos que
 * descarga el navegador (apps/web/dist/client) después de `npm run build`.
 *
 * Busca nombres de variables secretas, claves con formato de Supabase y el
 * cliente del proveedor de matrículas (que solo debe vivir en el servidor).
 * Si se le pasan valores reales en CHECK_SECRET_VALUES (separados por comas),
 * también los busca. Sale con error si encuentra algo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../apps/web/dist/client/', import.meta.url).pathname;
const FORBIDDEN = [
  'SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY', 'REQUEST_HASH_SECRET', 'OPENAPI_AUTOMOTIVE_TOKEN',
  'VEHICLE_LOOKUP_PROVIDER', 'sb_secret_', 'service_role', 'automotive.openapi.com', '/ES-car/', 'complete_vehicle_lookup',
  ...(process.env.CHECK_SECRET_VALUES ?? '').split(',').map(s => s.trim()).filter(s => s.length >= 8),
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|css|html|json|txt|map)$/.test(name)) yield path;
  }
}

let found = 0;
let scanned = 0;
try {
  for (const file of files(ROOT)) {
    scanned++;
    const text = readFileSync(file, 'utf8');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) {
        found++;
        console.error(`✘ "${needle.length > 24 ? `${needle.slice(0, 6)}…` : needle}" aparece en ${file.slice(ROOT.length)}`);
      }
    }
  }
} catch {
  console.error('✘ No existe apps/web/dist/client: ejecuta antes `npm run build`.');
  process.exit(1);
}
if (found) process.exit(1);
console.log(`✔ Código del navegador sin secretos (${scanned} archivos revisados)`);
