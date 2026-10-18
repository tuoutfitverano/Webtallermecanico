import { defineConfig } from 'vitest/config';

// Pruebas unitarias (Vitest). Las de navegador están en e2e/ y las ejecuta Playwright.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
