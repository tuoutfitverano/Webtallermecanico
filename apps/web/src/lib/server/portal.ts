/**
 * Contexto común de las páginas del portal del cliente.
 *
 *  · Exige sesión (si no, a /acceso y vuelta aquí).
 *  · Los datos salen SOLO de las funciones portal_* de la base de datos, que
 *    devuelven lo del propio cliente y únicamente los campos autorizados. El
 *    navegador nunca elige de quién son los datos.
 *  · Multitaller: una cuenta puede estar vinculada a varios talleres. Se trabaja
 *    con UNO cada vez (?taller= o la cookie portal_taller, solo preferencias):
 *    el servidor comprueba que es uno de los suyos y la base de datos recibe el
 *    taller elegido (cabecera x-portal-taller), que solo estrecha lo que ve.
 */
import type { AstroGlobal } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authPage, redirectToLogin } from './auth-page.ts';
import { logAuth, type SessionUser } from './auth.ts';
import { PORTAL_WORKSHOP_COOKIE, pickWorkshop } from '../portal/workshop.ts';

export { PORTAL_WORKSHOP_COOKIE };

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
  /** Ficha del taller elegido (como lista: una o ninguna). Vacío = sin vincular. */
  records: PortalRecord[];
  /** Todas las fichas vinculadas (una por taller), para «Mis talleres» y el selector. */
  allRecords: PortalRecord[];
  /** Taller elegido (null = la cuenta no está vinculada a ninguno). */
  workshop: PortalRecord | null;
  isPost: boolean;
  form: FormData | null;
  loadError: boolean;
  /** Avisos sin leer (para el indicador del menú). */
  unread: number;
}

export async function portalPage(Astro: AstroGlobal): Promise<Portal | Response> {
  const page = await authPage(Astro);
  if (page.isPost && !page.form) return new Response('Origen no permitido.', { status: 403 });
  if (!page.user || !page.supabase) return redirectToLogin(Astro);
  // Primero, todas sus fichas (sin taller elegido): así se valida la elección.
  const { data, error } = await page.supabase.rpc('portal_profile');
  if (error) logAuth('portal_profile_error', error.code);
  const allRecords = (data ?? []) as PortalRecord[];
  const remembered = Astro.cookies.get(PORTAL_WORKSHOP_COOKIE)?.value;
  const workshop = pickWorkshop(allRecords, Astro.url.searchParams.get('taller'), remembered);
  if (workshop) {
    if (workshop.workshop_id !== remembered) {
      Astro.cookies.set(PORTAL_WORKSHOP_COOKIE, workshop.workshop_id, { path: '/', sameSite: 'lax', httpOnly: true, secure: Astro.url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
    }
    // Desde aquí, todas las funciones portal_* devuelven solo lo de este taller.
    page.extraHeaders['x-portal-taller'] = workshop.workshop_id;
  }
  const unread = await page.supabase.rpc('portal_unread_notifications');
  return {
    supabase: page.supabase,
    user: page.user,
    records: workshop ? [workshop] : [],
    allRecords,
    workshop,
    isPost: page.isPost,
    form: page.form,
    loadError: Boolean(error),
    unread: typeof unread.data === 'number' ? unread.data : 0,
  };
}

/** Nombre de pila para el saludo (sin apellidos ni otros datos). */
export function firstName(records: PortalRecord[]): string {
  return (records[0]?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
}
