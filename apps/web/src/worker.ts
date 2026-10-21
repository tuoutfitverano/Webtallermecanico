/**
 * Entrada del Worker de Cloudflare: la web (fetch, el manejador de Astro) y la
 * tarea programada (scheduled) que procesa avisos y mantenimiento cada pocos
 * minutos. La frecuencia está en wrangler.jsonc (triggers.crons).
 */
import { handle } from '@astrojs/cloudflare/handler';
import { runScheduled, type ScheduledEnv } from './lib/server/scheduled.ts';

interface WaitUntil { waitUntil(promise: Promise<unknown>): void }

export default {
  fetch: handle,
  scheduled(_controller: unknown, env: ScheduledEnv, ctx: WaitUntil) {
    ctx.waitUntil(
      runScheduled(env, request => handle(request, env as never, ctx as never)).then(code => {
        // Solo un código de evento: nunca datos.
        if (code === 'cron_ok') console.info(code);
        else console.warn(code);
      }),
    );
  },
};
