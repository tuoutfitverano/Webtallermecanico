/**
 * Se ejecuta antes de cada página. Solo actúa en el área privada:
 *
 *  · Si APP_URL está definido, el acceso y la cuenta solo se sirven en ese
 *    dominio (las webs de los talleres no guardan sesiones).
 *  · Añade cabeceras para que ninguna caché guarde páginas con datos de la
 *    sesión y para que los enlaces con códigos no se filtren a otras webs.
 *
 * Quién puede ver cada página lo decide cada página (requireUser) y, sobre
 * todo, la base de datos (RLS).
 */
import { defineMiddleware } from 'astro:middleware';
import { appOrigin } from './lib/server/config.ts';
import { setPrivateHeaders } from './lib/server/auth.ts';

const PRIVATE_PATHS = /^\/(acceso|registro|recuperar|salir|cuenta|invitacion|auth|panel|portal|mi-area|acceso-denegado)(\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!PRIVATE_PATHS.test(context.url.pathname)) return next();

  const app = appOrigin();
  if (app && context.url.origin !== app) {
    return context.redirect(`${app}${context.url.pathname}${context.url.search}`, 308);
  }

  const response = await next();
  try {
    setPrivateHeaders(response.headers);
    return response;
  } catch {
    // Algunas respuestas (redirecciones) tienen cabeceras de solo lectura.
    const copy = new Response(response.body, response);
    setPrivateHeaders(copy.headers);
    return copy;
  }
});
