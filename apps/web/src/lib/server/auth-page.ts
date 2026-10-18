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
}

export async function authPage(Astro: AstroGlobal): Promise<AuthPage> {
  const supabase = createAuthClient({
    request: Astro.request,
    url: Astro.url,
    cookies: Astro.cookies,
    responseHeaders: Astro.response.headers,
  });
  const user = await getSessionUser(supabase);
  const isPost = Astro.request.method === 'POST';
  let form: FormData | null = null;
  if (isPost && isSameOriginPost(Astro.request)) {
    form = await Astro.request.formData().catch(() => null);
  }
  return { supabase, user, origin: authOrigin(Astro.request, Astro.url), self: requestOrigin(Astro.request, Astro.url), isPost, form };
}

/** Respuesta para páginas que exigen sesión: redirige al acceso y vuelve luego aquí. */
export function redirectToLogin(Astro: AstroGlobal): Response {
  return Astro.redirect(loginUrl(currentPath(Astro.url)), 303);
}

export function formText(form: FormData | null, name: string): string {
  const v = form?.get(name);
  return typeof v === 'string' ? v : '';
}
