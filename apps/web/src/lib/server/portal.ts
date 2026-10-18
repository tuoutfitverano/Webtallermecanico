/**
 * Contexto común de las páginas del portal del cliente.
 *
 *  · Exige sesión (si no, a /acceso y vuelta aquí).
 *  · Los datos salen SOLO de las funciones portal_* de la base de datos, que
 *    devuelven lo del propio cliente y únicamente los campos autorizados. El
 *    navegador nunca elige de quién son los datos.
 */
import type { AstroGlobal } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authPage, redirectToLogin } from './auth-page.ts';
import { logAuth, type SessionUser } from './auth.ts';

export interface PortalRecord {
  customer_id: string;
  workshop_id: string;
  workshop_name: string;
  workshop_phone: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  linked_at: string | null;
}

export interface Portal {
  supabase: SupabaseClient;
  user: SessionUser;
  /** Fichas de cliente vinculadas (una por taller). Vacío = sin vincular. */
  records: PortalRecord[];
  isPost: boolean;
  form: FormData | null;
  loadError: boolean;
}

export async function portalPage(Astro: AstroGlobal): Promise<Portal | Response> {
  const page = await authPage(Astro);
  if (page.isPost && !page.form) return new Response('Origen no permitido.', { status: 403 });
  if (!page.user || !page.supabase) return redirectToLogin(Astro);
  const { data, error } = await page.supabase.rpc('portal_profile');
  if (error) logAuth('portal_profile_error', error.code);
  return {
    supabase: page.supabase,
    user: page.user,
    records: (data ?? []) as PortalRecord[],
    isPost: page.isPost,
    form: page.form,
    loadError: Boolean(error),
  };
}

/** Nombre de pila para el saludo (sin apellidos ni otros datos). */
export function firstName(records: PortalRecord[]): string {
  return (records[0]?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
}
