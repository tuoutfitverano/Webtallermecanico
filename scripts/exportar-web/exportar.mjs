#!/usr/bin/env node
/**
 * Genera la copia de la web de un taller que se la lleva (contrato de web:
 * web pagada = se la queda aunque deje el servicio). Ver docs/EXPORTAR_WEB.md.
 *
 *   npm run web:exportar -- talleres/<taller>.json
 *   npm run web:exportar -- datos-del-taller.json   (salida de private.exported_site)
 *
 * Opciones: --salida <carpeta> (por defecto web-exportada/<taller>), --sin-zip.
 *
 * 1. Compila la web pública en modo copia (lib/site/export.ts) SIN ninguna
 *    variable de entorno de la plataforma: en la copia no puede acabar ningún secreto.
 * 2. Recoge solo los archivos que usa (páginas, estilos, scripts, fuentes, imágenes
 *    y fotogramas del coche) y añade LEEME.txt, _headers y .htaccess.
 * 3. La prueba con un navegador real sin la plataforma (comprobar.mjs). Si algo
 *    falla, no se crea el .zip.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExport } from './comprobar.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = join(ROOT, 'apps/web');
const BUILT = join(WEB, 'dist-exportar/client');

/** Ruta para mostrar: relativa si está dentro de la carpeta actual. */
const shown = p => {
  const r = relative(process.cwd(), p);
  return !r || r.startsWith('..') ? p : r;
};

function fail(message) {
  console.error(`✘ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const [, value] = args.splice(i, 2);
  return value ?? '';
};
const outArg = flag('--salida');
const noZip = args.includes('--sin-zip');
const input = args.find(a => !a.startsWith('--'));
if (!input) {
  console.error('Uso: npm run web:exportar -- talleres/<taller>.json [--salida <carpeta>] [--sin-zip]');
  process.exit(2);
}

// ---------------------------------------------------------------- datos del taller
const dataFile = resolve(input);
let raw;
try {
  raw = JSON.parse(readFileSync(dataFile, 'utf8'));
} catch (err) {
  fail(`No se puede leer ${input}: ${err.message}`);
}
if (!raw || typeof raw !== 'object') fail(`${input} está vacío: ¿existe ese taller?`);
const slug = String(raw.slug ?? raw.workshop?.slug ?? '');
const isDemo = Boolean(raw.isDemoContent ?? raw.site?.is_demo_content);
const name = String(raw.name ?? raw.workshop?.name ?? slug);
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) fail(`${input} no tiene un identificador de taller (slug) válido`);
const out = resolve(outArg || join(ROOT, 'web-exportada', slug));
if (out === ROOT || out === WEB || ROOT.startsWith(out + '/')) fail(`--salida no puede ser ${out}`);

// ---------------------------------------------------------------- 1. compilar
console.log(`▸ Compilando la web de ${name} (${slug}) en modo copia`);
rmSync(join(WEB, 'dist-exportar'), { recursive: true, force: true });
// Solo lo imprescindible para compilar: ni claves ni direcciones de la plataforma.
const env = { WEB_EXPORT: '1', WEB_EXPORT_SITE_FILE: dataFile, ASTRO_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' };
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'CI', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE']) {
  if (process.env[key]) env[key] = process.env[key];
}
const build = spawnSync('npx', ['astro', 'build'], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' });
if (build.status !== 0) {
  console.error(build.stdout.split('\n').slice(-30).join('\n'), build.stderr.split('\n').slice(-30).join('\n'));
  fail('La compilación ha fallado (arriba, el motivo)');
}

// ---------------------------------------------------------------- 2. recoger archivos
const needed = new Set();
const missing = new Set();
const isFile = p => existsSync(p) && statSync(p).isFile();

/** Ruta de la web («/privacidad», «/_astro/a.css») → archivo de la compilación, o null. */
function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]).replace(/^\/+/, '');
  if (clean.split('/').includes('..')) return null;
  for (const candidate of [clean, posix.join(clean, 'index.html')]) {
    if (candidate && isFile(join(BUILT, candidate))) return candidate;
  }
  return clean === '' ? 'index.html' : null;
}

function want(urlPath, from) {
  if (!urlPath || urlPath.startsWith('//') || !urlPath.startsWith('/')) return;
  const file = fileFor(urlPath);
  if (file) visit(file);
  else missing.add(`${urlPath} (en ${from})`);
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function visit(file) {
  if (needed.has(file)) return;
  needed.add(file);
  const text = () => readFileSync(join(BUILT, file), 'utf8');
  if (file.endsWith('.html')) {
    for (const [tag] of text().matchAll(/<[a-zA-Z][^>]*>/g)) {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'srcset') for (const part of value.split(',')) want(part.trim().split(/\s+/)[0], file);
        else if (value.includes('{n}')) {
          // Fotogramas del coche: todos, de 000 al último (data-count).
          const count = Number(attrs['data-count']);
          if (!(count >= 1 && count <= 2000)) missing.add(`${value} sin data-count (en ${file})`);
          else for (let n = 0; n < count; n++) want(value.replace('{n}', String(n).padStart(3, '0')), file);
        } else if (value.startsWith('/')) want(value, file);
      }
      for (const [, url] of tag.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) want(decode(url), file);
    }
  } else if (file.endsWith('.css')) {
    for (const [, url] of text().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (url.startsWith('data:') || /^https?:/.test(url)) continue;
      want(url.startsWith('/') ? url : '/' + posix.join(posix.dirname(file), url), file);
    }
  } else if (/\.m?js$/.test(file)) {
    const src = text();
    for (const [, spec] of src.matchAll(/(?:import|from)\s*\(?\s*["'](\.{1,2}\/[^"']+|\/_astro\/[^"']+)["']/g)) {
      want(spec.startsWith('/') ? spec : '/' + posix.join(posix.dirname(file), spec), file);
    }
    for (const [, spec] of src.matchAll(/["'`]\/?(_astro\/[^"'`]+)["'`]/g)) want('/' + spec, file);
  }
}

for (const page of ['index.html', '404.html', 'aviso-legal/index.html', 'privacidad/index.html', 'cookies/index.html']) {
  if (!isFile(join(BUILT, page))) fail(`La compilación no ha generado ${page}`);
  visit(page);
}
if (missing.size) {
  for (const m of missing) console.error(`  · falta ${m}`);
  fail('La web pide archivos que no existen (lista de arriba)');
}

// ---------------------------------------------------------------- copiar
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let bytes = 0;
for (const file of [...needed].sort()) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  cpSync(join(BUILT, file), join(out, file));
  bytes += statSync(join(BUILT, file)).size;
}

// Lo que nunca puede ir en la copia: claves y piezas de la plataforma.
const FORBIDDEN = [
  'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'TURNSTILE_SECRET_KEY', 'REQUEST_HASH_SECRET', 'OPENAPI_AUTOMOTIVE_TOKEN',
  'sb_secret_', 'sb_publishable_', 'service_role', 'supabase.co', 'challenges.cloudflare.com', '/api/solicitudes',
  'RESEND_API_KEY', 'WHATSAPP_TOKEN',
];
for (const file of needed) {
  if (!/\.(html|css|js|mjs|json|txt|svg)$/.test(file)) continue;
  const text = readFileSync(join(out, file), 'utf8');
  for (const needle of FORBIDDEN) if (text.includes(needle)) fail(`«${needle}» aparece en ${file}: la copia no se entrega`);
}

// Los textos legales de un taller real tienen que estar completos (LSSI): sin «[Falta: …]».
const incomplete = [...needed].filter(f => f.endsWith('.html') && readFileSync(join(out, f), 'utf8').includes('[Falta:'));
if (incomplete.length && !isDemo) {
  fail(`Faltan datos legales del taller (${incomplete.join(', ')}): complétalos en su panel (Taller → Datos legales) y vuelve a generar la copia`);
}

// Frases del propio taller que hablan de lo que la copia ya no tiene (portal, formularios…):
// no se cambian solas (son sus textos), pero se avisan aquí y en el LEEME para revisarlas.
const PLATFORM_WORDS = /\b(portal|área de clientes|formularios?|online|en línea|desde la web)\b/i;
const toReview = new Set();
// Solo las páginas con textos del taller: los legales de la copia ya están escritos para ella.
for (const file of ['index.html', '404.html']) {
  const text = readFileSync(join(out, file), 'utf8')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const line of text.split('\n').map(l => l.replace(/\s+/g, ' ').trim())) {
    if (line && PLATFORM_WORDS.test(line)) toReview.add(line);
  }
}

// Cabeceras para los alojamientos que las leen (Netlify, Cloudflare Pages: _headers; Apache: .htaccess).
writeFileSync(join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`);
writeFileSync(join(out, '.htaccess'), `ErrorDocument 404 /404.html
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
</IfModule>
`);

// ---------------------------------------------------------------- 3. comprobar
console.log(`▸ ${needed.size} archivos (${(bytes / 1048576).toFixed(1)} MB). Probándola sin la plataforma…`);
const { problems, external } = await checkExport(out);
if (problems.length) {
  for (const p of problems) console.error(`  · ${p}`);
  fail(`La copia no funciona sola (lista de arriba). Queda en ${shown(out)} para revisarla; no se ha creado el .zip`);
}

const today = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' }).format(new Date());
writeFileSync(join(out, 'LEEME.txt'), `WEB DE ${name.toUpperCase()}
Copia para publicarla en el alojamiento que quieras. Generada el ${today}.

QUÉ ES
Los archivos de tu web: páginas (HTML), estilos (CSS), JavaScript, tipos de
letra e imágenes. Funcionan en cualquier alojamiento web, sin la plataforma.

CÓMO PUBLICARLA
1. Elige un alojamiento web (sirve cualquiera, también los gratuitos para
   webs «estáticas»).
2. Sube TODO el contenido de esta carpeta, tal cual, a la carpeta principal
   de tu dominio (la que se ve en https://tudominio.es/).
3. Apunta tu dominio a ese alojamiento (tu proveedor te dice cómo).
Abrir index.html con doble clic no basta: la web tiene que estar publicada
en un dominio (o en un servidor de pruebas).

QUÉ CAMBIA RESPECTO A LA WEB CON LA PLATAFORMA
- Los formularios de cita y presupuesto pasan a ser botones de llamar,
  WhatsApp y correo (los formularios necesitan la plataforma para guardar
  las solicitudes).
- No hay «Área de clientes» ni la parte del programa de gestión: son
  servicios de la plataforma con su cuota.
- No hay aviso de cookies porque esta web no usa ninguna. Si le añades
  estadísticas, publicidad u otras herramientas, necesitarás tu propio aviso.

TEXTOS LEGALES
Ahora eres tú quien publica la web: revisa el aviso legal y la política de
privacidad y mantenlos al día. Tu alojamiento puede registrar datos técnicos
de las visitas (como la dirección IP); si es así, añádelo a la privacidad.

TEXTOS QUE CONVIENE REVISAR
${toReview.size ? `Estas frases de tu web hablan de cosas que esta copia no tiene (portal,
formularios…). Cámbialas o quítalas:
${[...toReview].map(t => `- «${t}»`).join('\n')}` : 'Ninguno.'}

ARCHIVOS QUE SE CARGAN DE OTRAS WEBS
${external.length ? external.map(u => `- ${u} (funcionará mientras esa web lo tenga)`).join('\n') : 'Ninguno: todo lo que necesita la web está en esta carpeta.'}

ARCHIVOS ESPECIALES
_headers y .htaccess: cabeceras de seguridad y página de «no encontrada» para
los alojamientos que los leen. Los demás los ignoran sin problema.

USO
El diseño y el código de esta web se usan según tu contrato de web: para la
web de tu taller. Para cambiar textos o fotos hay que editar estos archivos
(o pedírselo a un profesional).
`);

console.log(`✔ Copia de la web lista en ${shown(out)}`);
for (const url of external) console.warn(`! Carga algo de otra web: ${url}`);
for (const text of toReview) console.warn(`! Texto que conviene revisar (está en el LEEME): «${text}»`);

if (!noZip) {
  const zipFile = `${out}.zip`;
  rmSync(zipFile, { force: true });
  const zip = spawnSync('zip', ['-r', '-X', '-q', zipFile, '.'], { cwd: out, stdio: 'inherit' });
  if (zip.status !== 0) fail('No se ha podido crear el .zip (¿está instalado «zip»?). La carpeta sí está lista');
  console.log(`✔ Para entregar: ${shown(zipFile)} (${(statSync(zipFile).size / 1048576).toFixed(1)} MB)`);
}
