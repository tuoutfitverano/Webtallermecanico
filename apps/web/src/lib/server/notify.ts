/**
 * Tras guardar un cambio en una orden: intenta enviar YA sus emails pendientes
 * (si los hay y hay proveedor). En Cloudflare se hace después de responder
 * (waitUntil), así la página no espera al proveedor. Si falla, no pasa nada:
 * el aviso sigue en la cola y lo recoge el proceso programado.
 */
import type { AstroGlobal } from 'astro';
import { dispatchPendingEmails } from './config.ts';
import { requestOrigin } from './auth.ts';

export async function dispatchOrderEmails(Astro: AstroGlobal, orderId: string): Promise<void> {
  const task = dispatchPendingEmails({ orderId, limit: 5, origin: requestOrigin(Astro.request, Astro.url) }).then(
    () => undefined,
    () => undefined,
  );
  const ctx = (Astro.locals as { cfContext?: { waitUntil?: (p: Promise<unknown>) => void } }).cfContext;
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}
