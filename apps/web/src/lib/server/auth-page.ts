/**
 * Utilidades comunes de las páginas del área privada.
 */
import type { AstroGlobal } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authOrigin, createAuthClient, getSessionUser, isSameOriginPost, requestOrigin, type SessionUser } from './auth.ts';
import { currentPath, loginUrl } from '../auth/redirect.ts';

export interface AuthPage {
  /** null si Supabase no está configurado: las páginas lo dicen y no simulan nada. */
  supabase: SupabaseClient | null;
  user: SessionUser | null;
  /** Origen para los enlaces de los correos. */
  origin: string;
  /** Origen de esta petición (para validar redirecciones). */
  self: string;
  isPost: boolean;
  /** Formulario recibido (solo en POST desde nuestra propia web). */
  form: FormData | null;
  /** Cabeceras que se añaden a las siguientes llamadas a la base de datos (ver AuthRequestContext). */
  extraHeaders: Record<string, string>;
}

export async function authPage(Astro: AstroGlobal): Promise<AuthPage> {
  const extraHeaders: Record<string, string> = {};
  const supabase = createAuthClient({
    request: Astro.request,
    url: Astro.url,
    cookies: Astro.cookies,
    responseHeaders: Astro.response.headers,
    extraHeaders,
  });
  const user = await getSessionUser(supabase);
  const isPost = Astro.request.method === 'POST';
  let form: FormData | null = null;
  if (isPost && isSameOriginPost(Astro.request)) {
    form = await Astro.request.formData().catch(() => null);
  }
  return { supabase, user, origin: authOrigin(Astro.request, Astro.url), self: requestOrigin(Astro.request, Astro.url), isPost, form, extraHeaders };
}

/**
 * Respuesta para páginas que exigen sesión: redirige al acceso y vuelve luego aquí.
 * Si el navegador traía una cookie de sesión que ya no es válida, avisa de que
 * la sesión ha caducado (en vez de un acceso sin explicación).
 */
export function redirectToLogin(Astro: AstroGlobal): Response {
  const hadSession = /(^|;\s*)sb-[^=]*-auth-token/.test(Astro.request.headers.get('cookie') ?? '');
  return Astro.redirect(`${loginUrl(currentPath(Astro.url))}${hadSession ? '&caducada=1' : ''}`, 303);
}

export function formText(form: FormData | null, name: string): string {
  const v = form?.get(name);
  return typeof v === 'string' ? v : '';
}
