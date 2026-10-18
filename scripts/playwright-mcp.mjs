#!/usr/bin/env node
/**
 * Lanzador del servidor Playwright MCP para este proyecto.
 *
 * Usa SIEMPRE la versión de Playwright fijada en package.json (no "@latest")
 * y adapta el arranque al lugar donde se ejecuta, para que el mismo
 * `.mcp.json` sirva en tu ordenador y en la nube de Claude Code:
 *
 *  · Sin pantalla (Linux sin DISPLAY, como la nube) → navegador sin ventana.
 *  · Ejecutando como administrador (root)          → sin sandbox de Chromium,
 *    porque Chromium no puede activarlo así. En tu ordenador no se toca.
 *  · Si el Chromium de esta versión no está descargado pero el sistema trae
 *    uno preinstalado (la nube lo tiene en $PLAYWRIGHT_BROWSERS_PATH/chromium),
 *    se usa ese.
 *
 * Cualquier variable PLAYWRIGHT_MCP_* que definas tiene prioridad sobre estas
 * reglas. Los argumentos extra que recibas se pasan tal cual al servidor.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, '.playwright-mcp');
const require = createRequire(import.meta.url);

function log(msg) {
  // stdout está reservado para el protocolo MCP: los avisos van por stderr.
  process.stderr.write(`[playwright-mcp] ${msg}\n`);
}

let playwrightPkg;
try {
  playwrightPkg = require.resolve('playwright/package.json', { paths: [ROOT] });
} catch {
  log('No encuentro Playwright. Ejecuta "npm install" en la raíz del proyecto.');
  process.exit(1);
}
const cli = join(dirname(playwrightPkg), 'cli.js');

const args = [
  cli, 'mcp',
  // Cada sesión empieza limpia: no se guardan inicios de sesión entre usos.
  '--isolated',
  // Capturas y archivos automáticos, fuera de Git (ver .gitignore).
  '--output-dir', OUTPUT_DIR,
  // Herramientas extra para comprobar elementos y generar localizadores de pruebas.
  '--caps', 'testing',
];

const env = process.env;
const has = name => env[name] !== undefined && env[name] !== '';

if (!has('PLAYWRIGHT_MCP_HEADLESS') && process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
  args.push('--headless');
  log('Sin pantalla: navegador en modo invisible (--headless).');
}

if (!has('PLAYWRIGHT_MCP_SANDBOX') && !has('PLAYWRIGHT_MCP_NO_SANDBOX') && process.getuid?.() === 0) {
  args.push('--no-sandbox');
  log('Ejecutando como root: Chromium sin sandbox (--no-sandbox).');
}

if (!has('PLAYWRIGHT_MCP_EXECUTABLE_PATH') && !has('PLAYWRIGHT_MCP_BROWSER')) {
  let bundled = '';
  try {
    bundled = require(require.resolve('playwright', { paths: [ROOT] })).chromium.executablePath();
  } catch { /* se informa abajo */ }
  if (!bundled || !existsSync(bundled)) {
    const preinstalled = has('PLAYWRIGHT_BROWSERS_PATH') ? join(env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : '';
    if (preinstalled && existsSync(preinstalled)) {
      args.push('--executable-path', preinstalled);
      log(`Usando el Chromium preinstalado: ${preinstalled}`);
    } else {
      log('Falta el navegador. Ejecuta una vez: npx playwright install chromium');
    }
  }
}

args.push(...process.argv.slice(2));
mkdirSync(OUTPUT_DIR, { recursive: true });

const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
