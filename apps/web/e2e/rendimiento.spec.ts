/**
 * Rendimiento medido de la portada (web pública del taller demo):
 *  · Al abrirla, sin hacer scroll, no se descargan los fotogramas del coche
 *    (solo la imagen fija) ni el código de validación de los formularios.
 *  · Los fotogramas llegan al empezar a bajar y la validación al usar un formulario.
 * Escribe las cifras en la salida (bytes, peticiones, LCP) para comparar.
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
test.skip(!PROXY, 'Lanza estas pruebas con scripts/test-e2e.sh');

const FRAME = /\/demo\/autovalue\/(giro|giro-4k|maletero)\//;
// Código pesado de los formularios: el módulo de envío y las reglas compartidas (zod).
const FORM_CODE = /request-forms-submit|\/packages\/core\/|\/zod\//;

function track(page: Page) {
  const urls: string[] = [];
  let bytes = 0;
  page.on('requestfinished', async r => {
    urls.push(r.url());
    try { bytes += (await r.sizes()).responseBodySize; } catch { /* petición cancelada */ }
  });
  return { urls, bytes: () => bytes };
}

test('portada: sin scroll no descarga los fotogramas ni la validación de formularios', async ({ page }) => {
  const net = track(page);
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const lcp = await page.evaluate(() => new Promise<number>(resolve => {
    new PerformanceObserver(list => { const e = list.getEntries(); resolve(e[e.length - 1]!.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => resolve(-1), 1000);
  }));
  const frames = net.urls.filter(u => FRAME.test(u)).length;
  const formCode = net.urls.some(u => FORM_CODE.test(u));
  console.info(`RENDIMIENTO portada sin scroll: ${Math.round(net.bytes() / 1024)} KB, ${net.urls.length} peticiones, ${frames} fotogramas, validación de formularios: ${formCode ? 'sí' : 'no'}, LCP ${Math.round(lcp)} ms`);
  expect(frames).toBe(0);
  expect(formCode).toBe(false);

  // Al bajar, el coche se activa y llegan sus fotogramas.
  await page.evaluate(() => scrollBy(0, 400));
  await expect(page.locator('.stage')).toHaveClass(/is-live/);
  await expect.poll(() => net.urls.filter(u => FRAME.test(u)).length).toBeGreaterThan(20);

  // Al usar un formulario llega su validación (antes de enviar).
  await page.locator('[data-req-form] [name="name"]').first().focus();
  await expect.poll(() => net.urls.some(u => FORM_CODE.test(u))).toBe(true);
});
