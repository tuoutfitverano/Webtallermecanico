// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// Las webs de los talleres se generan en el momento según el dominio que
// visita el usuario (una sola aplicación sirve a todos los talleres).
// Cloudflare Workers ejecuta ese código cerca del visitante.
export default defineConfig({
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
  },
});
