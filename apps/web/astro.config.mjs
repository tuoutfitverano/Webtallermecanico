// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// Copia de la web de UN taller para que se la lleve (scripts/exportar-web/).
// Solo con WEB_EXPORT=1: las páginas públicas se generan como archivos HTML y
// los datos del taller se fijan al compilar. En producción no se usa nunca.
const WEB_EXPORT = process.env.WEB_EXPORT === '1';
const EXPORT_PAGES = ['index', 'aviso-legal', 'privacidad', 'cookies', '404'].map(p => `src/pages/${p}.astro`);
const exportSite = WEB_EXPORT ? readFileSync(process.env.WEB_EXPORT_SITE_FILE ?? '', 'utf8') : '';
/** @type {import('astro').AstroIntegration} */
const webExport = {
  name: 'exportar-web',
  hooks: {
    'astro:route:setup': ({ route }) => {
      if (EXPORT_PAGES.includes(route.component)) route.prerender = true;
    },
  },
};

// Las webs de los talleres se generan en el momento según el dominio que
// visita el usuario (una sola aplicación sirve a todos los talleres).
// Cloudflare Workers ejecuta ese código cerca del visitante.
export default defineConfig({
  // Sin el servicio de imágenes de Cloudflare (de pago por transformación): la web
  // ya sirve imágenes optimizadas (WebP) y no usa <Image> de Astro.
  adapter: cloudflare({ imageService: 'passthrough' }),
  ...(WEB_EXPORT ? { outDir: './dist-exportar', integrations: [webExport] } : {}),
  // La barra de desarrollo de Astro tapa la barra de pestañas del panel en las
  // pruebas de navegador; en producción no existe.
  devToolbar: { enabled: process.env.E2E !== '1' },
  vite: {
    plugins: [tailwindcss()],
    // Nada en línea: los scripts propios van como archivos (la CSP solo admite
    // en línea los de lib/inline-scripts.ts, por su huella).
    build: { assetsInlineLimit: 0 },
    // Ver lib/site/export.ts. Fuera de la exportación quedan vacíos (y su código se elimina).
    define: {
      'import.meta.env.WEB_EXPORT': JSON.stringify(WEB_EXPORT ? '1' : ''),
      'import.meta.env.WEB_EXPORT_SITE': JSON.stringify(exportSite),
    },
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
      // Avisos por WhatsApp (API oficial de WhatsApp Business). Ver docs/NOTIFICACIONES.md.
      WHATSAPP_PROVIDER: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_PHONE_NUMBER_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_TEMPLATE: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_API_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_APP_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      WHATSAPP_VERIFY_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      NOTIFICATIONS_CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
    validateSecrets: false,
  },
});
