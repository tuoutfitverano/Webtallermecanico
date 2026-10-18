#!/usr/bin/env node
/**
 * Comprueba que el servidor Playwright MCP del proyecto arranca y controla el
 * navegador: conexión MCP, lista de herramientas, navegar, leer la página,
 * pulsar un botón y verificar el resultado. No necesita internet ni servidor web.
 *
 * Uso: npm run test:mcp
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 60_000;

const server = spawn(process.execPath, [join(ROOT, 'scripts', 'playwright-mcp.mjs')], { cwd: ROOT });
let serverLog = '';
server.stderr.on('data', d => { serverLog += d; });

const pending = new Map();
createInterface({ input: server.stdout }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});

let nextId = 0;
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`Sin respuesta a "${method}"`)), TIMEOUT_MS);
    pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const callTool = async (name, args) => {
  const res = await request('tools/call', { name, arguments: args });
  const text = (res.result?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (res.error || res.result?.isError) throw new Error(`${name} falló:\n${text || JSON.stringify(res.error)}`);
  return text;
};

let passed = 0;
function check(cond, label) {
  if (!cond) throw new Error(`Comprobación fallida: ${label}`);
  passed++;
  console.log(`✔ ${label}`);
}

const PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
  <title>Prueba MCP</title>
  <h1>Taller de prueba</h1>
  <button onclick="document.querySelector('output').textContent='Cita solicitada'">Pedir cita</button>
  <output></output>`);

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-playwright-mcp', version: '1' },
  });
  check(init.result?.serverInfo?.name === 'Playwright', `servidor MCP conectado (Playwright ${init.result?.serverInfo?.version})`);
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = (await request('tools/list', {})).result.tools.map(t => t.name);
  for (const t of ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_verify_text_visible']) {
    check(tools.includes(t), `herramienta disponible: ${t}`);
  }

  const nav = await callTool('browser_navigate', { url: PAGE });
  check(nav.includes('Prueba MCP'), 'el navegador abre la página');

  const snap = await callTool('browser_snapshot', {});
  const ref = snap.match(/button "Pedir cita" \[ref=(e\d+)\]/)?.[1];
  check(Boolean(ref), 'la página se lee como árbol de accesibilidad');

  const click = await callTool('browser_click', { element: 'Botón Pedir cita', target: ref });
  check(click.includes("getByRole('button', { name: 'Pedir cita' })"), 'pulsa el botón y devuelve el código Playwright equivalente');

  await callTool('browser_verify_text_visible', { text: 'Cita solicitada' });
  check(true, 'verifica el resultado en pantalla');

  await callTool('browser_close', {});
  console.log(`\n✔ Playwright MCP funciona (${passed} comprobaciones)`);
  server.kill();
  process.exit(0);
} catch (err) {
  console.error(`\n✘ ${err.message}`);
  if (serverLog) console.error(`\nRegistro del servidor:\n${serverLog}`);
  server.kill();
  process.exit(1);
}
