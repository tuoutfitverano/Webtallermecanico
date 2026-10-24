#!/usr/bin/env node
/**
 * Comprueba que la copia de la web de un taller funciona SOLA, sin la plataforma.
 *
 *   node scripts/exportar-web/comprobar.mjs web-exportada/<taller>
 *
 * La sirve con un servidor de archivos mínimo (como cualquier alojamiento) y
 * la recorre con un navegador real en móvil, ordenador y pantalla grande, con
 * TODO lo de fuera bloqueado (como si la plataforma ya no existiera):
 *  · las páginas responden y una dirección inexistente da la página 404;
 *  · no falta ningún archivo ni hay errores en la consola;
 *  · no hay formularios, ni «Área de clientes», ni llamadas a la plataforma;
 *  · no se guarda nada en el navegador (ni cookies ni almacenamiento);
 *  · los botones de llamar, WhatsApp y correo están, y el coche gira al bajar.
 * Lo que la copia cargue de otras webs (p. ej. un vídeo alojado fuera) se
 * avisa: seguirá funcionando mientras esa otra web lo tenga.
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serveFolder } from './servidor.mjs';

const PAGES = ['/', '/aviso-legal', '/privacidad', '/cookies'];
const DEVICES = [
  { name: 'móvil', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'ordenador', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  // Más de 2000 px reales: la web pide las imágenes 4K si el taller las tiene.
  { name: 'pantalla grande', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
];
// Cosas de la plataforma que nunca deben aparecer en la copia.
const PLATFORM = [/\/api\//, /supabase/i, /challenges\.cloudflare\.com/, /\/area-cliente/, /\/portal(\/|$)/, /\/acceso(\/|$)/, /\/panel(\/|$)/];

async function scrollThrough(page) {
  // Bajar poco a poco hasta el final (así se descargan los fotogramas y se ven las animaciones).
  for (let i = 0; i < 80; i++) {
    const done = await page.evaluate(() => {
      window.scrollBy(0, Math.round(innerHeight * 0.6));
      return innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    });
    await page.waitForTimeout(60);
    if (done) break;
  }
  await page.waitForTimeout(300);
}

/** Devuelve { problems, external }: problemas encontrados y archivos que la copia pide a otras webs. */
export async function checkExport(dir) {
  const server = await serveFolder(resolve(dir));
  const origin = new URL(server.url).origin;
  const problems = [];
  const external = new Set();
  // Igual que las pruebas de navegador (apps/web/playwright.config.ts): el navegador de
  // Playwright o, si no está, el ya instalado en el equipo.
  const bundled = chromium.executablePath();
  const preinstalled = process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : '';
  const executablePath = !existsSync(bundled) && preinstalled && existsSync(preinstalled) ? preinstalled : undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    for (const device of DEVICES) {
      const { name, ...options } = device;
      const context = await browser.newContext(options);
      // Todo lo de fuera, bloqueado: la copia tiene que funcionar sin la plataforma.
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        external.add(url);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const where = () => `${name} · ${new URL(page.url()).pathname}`;
      page.on('console', msg => {
        if (msg.type() !== 'error' || /ERR_BLOCKED_BY_CLIENT/.test(msg.text())) return;
        // La propia página 404 (la que se pide a propósito) no es un error de la copia.
        if (msg.location().url === page.url() && / 404 /.test(msg.text())) return;
        problems.push(`${where()}: error en la consola: ${msg.text()}`);
      });
      page.on('pageerror', err => problems.push(`${where()}: error de JavaScript: ${err.message}`));
      page.on('response', res => {
        if (res.url().startsWith(origin) && res.status() >= 400 && !res.request().isNavigationRequest()) {
          problems.push(`${where()}: falta ${new URL(res.url()).pathname} (${res.status()})`);
        }
      });
      page.on('request', req => {
        const path = req.url().startsWith(origin) ? new URL(req.url()).pathname : req.url();
        if (PLATFORM.some(re => re.test(path))) problems.push(`${where()}: pide algo de la plataforma: ${path}`);
      });

      for (const path of PAGES) {
        const res = await page.goto(server.url + path, { waitUntil: 'load' });
        if (res?.status() !== 200) problems.push(`${name} · ${path}: responde ${res?.status()}`);
        await scrollThrough(page);
        const html = await page.content();
        if (await page.locator('form').count()) problems.push(`${name} · ${path}: tiene un formulario`);
        for (const re of PLATFORM) if (re.test(html)) problems.push(`${name} · ${path}: enlaza a la plataforma (${re.source})`);
        if (/name="cf-turnstile|challenges\.cloudflare/.test(html)) problems.push(`${name} · ${path}: lleva el antispam de la plataforma`);
      }

      // Portada: botones de contacto y el coche que gira (si el taller lo tiene).
      await page.goto(server.url + '/', { waitUntil: 'load' });
      const ways = page.locator('#solicitar a[href^="tel:"], #solicitar a[href^="https://wa.me/"], #solicitar a[href^="mailto:"]');
      if (!(await ways.count())) problems.push(`${name}: no están los botones de llamar, WhatsApp o correo`);
      if (await page.locator('[data-stage]').count()) {
        await scrollThrough(page);
        const live = await page.locator('[data-stage].is-live').count();
        if (!live) problems.push(`${name}: el coche no llega a moverse al bajar`);
      }

      // Dirección inexistente: la página 404 del taller.
      const missing = await page.goto(server.url + '/no-existe-esta-pagina', { waitUntil: 'load' });
      if (missing?.status() !== 404) problems.push(`${name}: una dirección inexistente responde ${missing?.status()}`);
      if (!(await page.locator('h1').count())) problems.push(`${name}: la página 404 está vacía`);

      // Nada guardado en el navegador.
      const cookies = await context.cookies();
      if (cookies.length) problems.push(`${name}: guarda cookies (${cookies.map(c => c.name).join(', ')})`);
      const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
      if (stored) problems.push(`${name}: guarda ${stored} dato(s) en el navegador`);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return { problems: [...new Set(problems)], external: [...external].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Uso: node scripts/exportar-web/comprobar.mjs <carpeta de la copia>');
    process.exit(2);
  }
  const { problems, external } = await checkExport(dir);
  for (const url of external) console.warn(`! Carga algo de otra web (bloqueado en la prueba): ${url}`);
  if (problems.length) {
    for (const p of problems) console.error(`✘ ${p}`);
    process.exit(1);
  }
  console.log(`✔ La copia funciona sola: ${PAGES.length} páginas y la 404, en ${DEVICES.map(d => d.name).join(', ')}, sin la plataforma`);
}
