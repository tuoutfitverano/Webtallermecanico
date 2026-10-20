/**
 * Comprueba el archivo de un taller y escribe el SQL que lo carga en Supabase.
 *
 *   npm run taller:sql -- talleres/mi-taller.json > mi-taller.sql
 *
 * No toca ninguna base de datos: el SQL se revisa y se ejecuta a mano en el
 * SQL Editor (es la base de datos de producción). Ver docs/PLANTILLA_TALLERES.md.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { checkWorkshopConfig, configToSql, workshopConfigSchema } from '../../apps/web/src/lib/site/workshop-config.ts';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run taller:sql -- talleres/<taller>.json');
  process.exit(2);
}
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`✘ No se puede leer ${file}: ${(err as Error).message}`);
  process.exit(1);
}
const problems = checkWorkshopConfig(raw);
if (problems.length) {
  console.error(`✘ ${file} tiene ${problems.length} problema(s):`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
process.stdout.write(configToSql(workshopConfigSchema.parse(raw), relative(process.cwd(), file)));
console.error(`✔ ${file} es correcto. SQL generado: revísalo antes de ejecutarlo.`);
