/**
 * Utilidades comunes de las páginas del área privada.
 */
import type { AstroGlobal } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authOrigin, createAuthClient, getSessionUser, isSameOriginPost, requestOrigin, type SessionUser } from './auth.ts';
import { currentPath, loginUrl } from '../auth/redirect.ts';
import { readFormLimited } from './body.ts';

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

/**
 * Peticiones de cuentas con la verificación en dos pasos activada que aún no
 * han escrito el código: para el resto del área privada es como si no hubiera
 * sesión, y redirectToLogin las manda a /acceso/verificar.
 */
const mfaPending = new WeakSet<Request>();

/** ¿Esta petición tiene sesión, pero le falta el código de la verificación en dos pasos? */
export function pendingSecondFactor(Astro: AstroGlobal): boolean {
  return mfaPending.has(Astro.request);
}

/** ¿La sesión necesita todavía el código de la verificación en dos pasos? */
export async function needsSecondFactor(supabase: SupabaseClient, user: SessionUser): Promise<boolean> {
  if (user.aal === 'aal2') return false;
  try {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.nextLevel === 'aal2';
  } catch {
    return false;
  }
}

/**
 * @param opts.allowPendingMfa Solo /acceso/verificar: recibe al usuario aunque le falte el código.
 */
export async function authPage(Astro: AstroGlobal, opts: { allowPendingMfa?: boolean } = {}): Promise<AuthPage> {
  const extraHeaders: Record<string, string> = {};
  const supabase = createAuthClient({
    request: Astro.request,
    url: Astro.url,
    cookies: Astro.cookies,
    responseHeaders: Astro.response.headers,
    extraHeaders,
  });
  let user = await getSessionUser(supabase);
  if (user && supabase && !opts.allowPendingMfa && (await needsSecondFactor(supabase, user))) {
    mfaPending.add(Astro.request);
    user = null;
  }
  const isPost = Astro.request.method === 'POST';
  let form: FormData | null = null;
  if (isPost && isSameOriginPost(Astro.request)) {
    // Con límite de tamaño (lib/server/body.ts): uno mayor se trata como petición no válida.
    form = await readFormLimited(Astro.request);
  }
  return { supabase, user, origin: authOrigin(Astro.request, Astro.url), self: requestOrigin(Astro.request, Astro.url), isPost, form, extraHeaders };
}

/**
 * Respuesta para páginas que exigen sesión: redirige al acceso y vuelve luego aquí.
 * Si el navegador traía una cookie de sesión que ya no es válida, avisa de que
 * la sesión ha caducado (en vez de un acceso sin explicación).
 */
export function redirectToLogin(Astro: AstroGlobal): Response {
  if (mfaPending.has(Astro.request)) {
    return Astro.redirect(`/acceso/verificar?next=${encodeURIComponent(currentPath(Astro.url))}`, 303);
  }
  const hadSession = /(^|;\s*)sb-[^=]*-auth-token/.test(Astro.request.headers.get('cookie') ?? '');
  return Astro.redirect(`${loginUrl(currentPath(Astro.url))}${hadSession ? '&caducada=1' : ''}`, 303);
}

export function formText(form: FormData | null, name: string): string {
  const v = form?.get(name);
  return typeof v === 'string' ? v : '';
}
