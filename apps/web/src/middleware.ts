/**
 * Se ejecuta antes de cada página y cada endpoint.
 *
 *  · Cabeceras de seguridad en TODAS las respuestas (web pública, área
 *    privada y API): sin incrustar la web en otras (clickjacking), sin
 *    adivinar tipos de archivo, sin cámara/micrófono/ubicación, HTTPS
 *    obligatorio en producción.
 *  · Área privada: si APP_URL está definido, el acceso y la cuenta solo se
 *    sirven en ese dominio (las webs de los talleres no guardan sesiones), y
 *    ninguna caché guarda páginas con datos de la sesión.
 *
 * Quién puede ver cada página lo decide cada página y, sobre todo, la base
 * de datos (RLS).
 */
import { defineMiddleware } from 'astro:middleware';
import { appOrigin } from './lib/server/config.ts';
import { setPrivateHeaders } from './lib/server/auth.ts';

// /presupuesto/<código>: enlace público con un código secreto: sin caché y sin enviar la dirección a otros sitios.
const PRIVATE_PATHS = /^\/(acceso|registro|recuperar|salir|cuenta|invitacion|auth|panel|portal|mi-area|acceso-denegado|presupuesto)(\/|$)/;

function setSecurityHeaders(headers: Headers, https: boolean) {
  // Sin restringir scripts (la web usa scripts en línea y Turnstile): solo lo que no rompe nada.
  headers.set('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (!headers.has('referrer-policy')) headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (https) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

function withHeaders(response: Response, apply: (h: Headers) => void): Response {
  try {
    apply(response.headers);
    return response;
  } catch {
    // Algunas respuestas (redirecciones) tienen cabeceras de solo lectura.
    const copy = new Response(response.body, response);
    apply(copy.headers);
    return copy;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const https = context.url.protocol === 'https:';
  const isPrivate = PRIVATE_PATHS.test(context.url.pathname);

  if (isPrivate) {
    const app = appOrigin();
    if (app && context.url.origin !== app) {
      const redirect = context.redirect(`${app}${context.url.pathname}${context.url.search}`, 308);
      return withHeaders(redirect, h => setSecurityHeaders(h, https));
    }
  }

  const response = await next();
  return withHeaders(response, h => {
    if (isPrivate) setPrivateHeaders(h);
    setSecurityHeaders(h, https);
  });
});
