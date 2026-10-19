// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// Las webs de los talleres se generan en el momento según el dominio que
// visita el usuario (una sola aplicación sirve a todos los talleres).
// Cloudflare Workers ejecuta ese código cerca del visitante.
export default defineConfig({
  adapter: cloudflare(),
  // La barra de desarrollo de Astro tapa la barra de pestañas del panel en las
  // pruebas de navegador; en producción no existe.
  devToolbar: { enabled: process.env.E2E !== '1' },
  vite: {
    plugins: [tailwindcss()],
  },
  // Variables de entorno. Todas se leen en el SERVIDOR en tiempo de ejecución
  // (access: 'secret'), así se pueden cambiar en Cloudflare sin recompilar y
  // ninguna acaba dentro del JavaScript del navegador. La clave publicable de
  // Turnstile se pasa a la página desde el servidor.
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      SUPABASE_PUBLISHABLE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURNSTILE_SITE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      TURNSTILE_SECRET_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      REQUEST_HASH_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Dominio del área privada (acceso, cuenta, invitaciones). Ver docs/PUESTA_EN_MARCHA.md.
      APP_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Consulta de datos por matrícula (Fase 6). Ver docs/CONSULTA_MATRICULAS.md.
      VEHICLE_LOOKUP_PROVIDER: envField.string({ context: 'server', access: 'secret', optional: true }),
      OPENAPI_AUTOMOTIVE_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      OPENAPI_AUTOMOTIVE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      VEHICLE_LOOKUP_TIMEOUT_MS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Notificaciones por email (Fase 7). Ver docs/NOTIFICACIONES.md.
      EMAIL_PROVIDER: envField.string({ context: 'server', access: 'secret', optional: true }),
      EMAIL_FROM: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_API_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      RESEND_WEBHOOK_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      NOTIFICATIONS_CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
    validateSecrets: false,
  },
});
