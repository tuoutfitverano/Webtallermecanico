/**
 * SQL del taller para la versión real: el archivo del taller (talleres/<taller>.json)
 * con la dirección real de la web y, si el taller aún no existe, su propietario.
 *
 *   node scripts/publicar/taller-sql.ts talleres/autovalue.json <dominio> [correo-propietario]
 *
 * Sin correo solo actualiza la web de un taller que ya existe. No toca ninguna base
 * de datos: lo ejecuta crear-taller.sh.
 */
import { readFileSync } from 'node:fs';
import { checkWorkshopConfig, configToSql, workshopConfigSchema } from '../../apps/web/src/lib/site/workshop-config.ts';

const [file, host, owner] = process.argv.slice(2);
if (!file || !host) {
  console.error('Uso: node scripts/publicar/taller-sql.ts talleres/<taller>.json <dominio> [correo]');
  process.exit(2);
}
const raw = { ...JSON.parse(readFileSync(file, 'utf8')), domains: [host], ownerEmail: owner || null };
const problems = checkWorkshopConfig(raw);
if (problems.length) {
  console.error(`✘ ${problems.join('; ')}`);
  process.exit(1);
}
process.stdout.write(configToSql(workshopConfigSchema.parse(raw), file));
