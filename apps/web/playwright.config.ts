/**
 * Pruebas de extremo a extremo de la web. Se lanzan con `npm run test:e2e`
 * desde la raíz (scripts/test-e2e.sh prepara base de datos, API y web).
 */
import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

// En la nube de Claude Code no se pueden descargar navegadores: si el de esta
// versión no está, se usa el Chromium preinstalado.
const bundled = chromium.executablePath();
const preinstalled = process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : '';
const executablePath = !existsSync(bundled) && preinstalled && existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: '../../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://demo.localhost:4321',
    trace: 'retain-on-failure',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],
});
