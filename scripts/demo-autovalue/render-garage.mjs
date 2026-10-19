/**
 * Convierte garage.html en una imagen PNG (con Chromium de Playwright).
 *   node scripts/demo-autovalue/render-garage.mjs <salida.png> [escala]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const [out, scale = '1.5'] = process.argv.slice(2);
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
await page.goto(`file://${fileURLToPath(new URL('./garage.html', import.meta.url))}?s=${scale}`, { waitUntil: 'commit' });
await page.waitForFunction(() => document.title === 'listo', null, { timeout: 120_000 });
const data = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
