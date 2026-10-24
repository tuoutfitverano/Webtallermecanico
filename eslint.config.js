// @ts-check
/**
 * Revisión de código (ESLint). Se ejecuta con `npm run lint`.
 * No se revisan los prototipos estáticos (demo/, atrium-mtl/) ni archivos generados.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/dist-exportar/**', 'web-exportada/**', '**/.astro/**', '**/.wrangler/**',
      'demo/**', 'atrium-mtl/**', '.cache/**', '.playwright-mcp/**', 'test-results/**', 'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Los registros del servidor pasan por log(); console.info solo ahí.
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['scripts/**/*.mjs', '**/*.config.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
);
