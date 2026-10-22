/**
 * Sesión del usuario en el servidor con Supabase Auth (@supabase/ssr).
 *
 *  · La sesión vive en cookies; se crea un cliente NUEVO en cada petición
 *    (nunca se comparte entre visitantes).
 *  · Para saber quién es el usuario se usa getClaims(), que verifica la firma
 *    del token. Nunca getSession(): solo lee la cookie, que se puede falsificar.
 *  · Este cliente usa la clave PUBLICABLE + el token del usuario: la base de
 *    datos aplica RLS como a ese usuario. La clave secreta no se usa aquí.
 */
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { appOrigin, authEnv, isDev } from './config.ts';

export interface AuthRequestContext {
  request: Request;
  url: URL;
  cookies: AstroCookies;
  /** Cabeceras de la respuesta (Astro.response.headers en una página). */
  responseHeaders: Headers;
  /**
   * Cabeceras extra para la base de datos, que se pueden fijar DESPUÉS de crear el
   * cliente (p. ej. el taller elegido en el portal, ya validado). Solo estrechan.
   */
  extraHeaders?: Record<string, string>;
}

export interface SessionUser {
  id: string;
  email: string;
}

export function createAuthClient(ctx: AuthRequestContext): SupabaseClient | null {
  const env = authEnv();
  if (!env) return null;
  const extra = ctx.extraHeaders;
  return createServerClient(env.url, env.publishableKey, {
    ...(extra ? {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          if (Object.keys(extra).length === 0) return fetch(input, init);
          const headers = new Headers(init?.headers);
          for (const [k, v] of Object.entries(extra)) headers.set(k, v);
          return fetch(input, { ...init, headers });
        },
      },
    } : {}),
    // httpOnly: el JavaScript del navegador nunca lee la sesión (todo pasa por el servidor).
    cookieOptions: { path: '/', sameSite: 'lax', secure: ctx.url.protocol === 'https:', httpOnly: true },
    cookies: {
      getAll() {
        return parseCookieHeader(ctx.request.headers.get('cookie') ?? '').map(c => ({ name: c.name, value: c.value ?? '' }));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          ctx.cookies.set(name, value, {
            path: options.path ?? '/',
            maxAge: options.maxAge,
            expires: options.expires,
            sameSite: options.sameSite,
            secure: options.secure,
            httpOnly: true,
          });
        }
        // Evita que una CDN guarde una respuesta con la sesión de otra persona.
        for (const [key, value] of Object.entries(headers)) ctx.responseHeaders.set(key, value);
      },
    },
  });
}

/** Usuario con sesión válida (firma verificada), o null. */
export async function getSessionUser(supabase: SupabaseClient | null): Promise<SessionUser | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub || claims.is_anonymous) return null;
    return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
  } catch {
    return null;
  }
}

/**
 * Origen de la petición según la cabecera Host (en desarrollo, Astro.url no
 * siempre refleja el dominio que usa el navegador, p. ej. demo.localhost).
 */
export function requestOrigin(request: Request, url: URL): string {
  const host = request.headers.get('host');
  return host ? `${url.protocol}//${host.toLowerCase()}` : url.origin;
}

/**
 * Origen para los enlaces de los correos (confirmación, recuperación,
 * invitaciones). En producción debe definirse APP_URL; si falta, se usa el
 * dominio real de la petición en Cloudflare.
 */
export function authOrigin(request: Request, url: URL): string {
  return appOrigin() ?? (isDev ? requestOrigin(request, url) : url.origin);
}

/**
 * El formulario se ha enviado desde nuestra propia web (protección CSRF).
 * Astro ya lo comprueba (security.checkOrigin); esto es una segunda barrera.
 * Igual que en /api/solicitudes: el Origin tiene que coincidir con el Host.
 */
export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host')?.toLowerCase();
  if (origin) {
    try {
      return Boolean(host) && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** Cabeceras para todas las pantallas del área privada. */
export function setPrivateHeaders(headers: Headers) {
  headers.set('cache-control', 'private, no-store');
  // same-origin: los enlaces con códigos (invitaciones, correos) nunca se envían
  // a otras webs. ("no-referrer" haría que el navegador mande "Origin: null"
  // en nuestros propios formularios y se rechazarían.)
  headers.set('referrer-policy', 'same-origin');
  headers.set('x-frame-options', 'DENY');
  headers.set('x-robots-tag', 'noindex, nofollow');
}

/** Registro técnico: solo códigos, nunca correos ni contraseñas. */
export function logAuth(event: string, code?: string) {
  console.info(JSON.stringify({ event, ...(code ? { code } : {}) }));
}
