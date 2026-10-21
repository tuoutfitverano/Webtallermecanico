/**
 * Contexto común de las páginas del panel del taller.
 *
 *  · Exige sesión (si no, a /acceso y vuelta aquí).
 *  · Los talleres salen de my_workshops() con el token del usuario.
 *  · El taller activo se recuerda en una cookie, pero es solo una
 *    preferencia: se valida SIEMPRE contra las membresías del usuario. Un id
 *    de taller manipulado se ignora. Y aunque no se ignorase, RLS no
 *    devolvería nada de un taller ajeno.
 */
import type { AstroGlobal } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authPage, redirectToLogin } from './auth-page.ts';
import { logAuth, type SessionUser } from './auth.ts';
import type { MemberRole } from '../auth/validate.ts';

export interface PanelWorkshop {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: MemberRole;
}

export interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: MemberRole;
  active: boolean;
}

export interface Panel {
  supabase: SupabaseClient;
  user: SessionUser;
  workshops: PanelWorkshop[];
  /** null si la persona no pertenece a ningún taller. */
  workshop: PanelWorkshop | null;
  /** Propietario o administrador del taller activo (equipo, configuración, rectificativas). */
  isManager: boolean;
  /** Oficina: propietario, administrador o recepción (órdenes, presupuestos, facturas, cobros). */
  isOffice: boolean;
  isOwner: boolean;
  isPost: boolean;
  form: FormData | null;
  /** Origen para los enlaces que se comparten (invitaciones): APP_URL en producción. */
  origin: string;
  /** Error al cargar los talleres (sin conexión con la base de datos, etc.). */
  loadError: boolean;
}

const COOKIE = 'panel_taller';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function panelPage(Astro: AstroGlobal): Promise<Panel | Response> {
  const page = await authPage(Astro);
  if (page.isPost && !page.form) return new Response('Origen no permitido.', { status: 403 });
  if (!page.user || !page.supabase) return redirectToLogin(Astro);

  const { data, error } = await page.supabase.rpc('my_workshops');
  if (error) logAuth('panel_workshops_error', error.code);
  const workshops: PanelWorkshop[] = ((data ?? []) as Array<{ workshop_id: string; name: string; slug: string; status: string; role: MemberRole }>)
    .map(w => ({ id: w.workshop_id, name: w.name, slug: w.slug, status: w.status, role: w.role }));

  // Un cliente (sin ser personal de ningún taller) no entra en el panel: página de acceso denegado.
  if (!error && workshops.length === 0) {
    const { data: records } = await page.supabase.rpc('portal_profile');
    if ((records ?? []).length > 0) return Astro.rewrite('/acceso-denegado');
  }

  // ?taller=<id> cambia de taller (si es uno de los suyos); si no, la cookie; si no, el primero.
  const asked = Astro.url.searchParams.get('taller');
  const remembered = Astro.cookies.get(COOKIE)?.value;
  const pick = (id: string | undefined | null) => (id && UUID.test(id) ? workshops.find(w => w.id === id) : undefined);
  const workshop = pick(asked) ?? pick(remembered) ?? workshops[0] ?? null;
  if (workshop && workshop.id !== remembered) {
    Astro.cookies.set(COOKIE, workshop.id, { path: '/', sameSite: 'lax', httpOnly: true, secure: Astro.url.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
  }

  const isOwner = workshop?.role === 'propietario';
  return {
    supabase: page.supabase,
    user: page.user,
    workshops,
    workshop,
    isManager: isOwner || workshop?.role === 'administrador',
    isOffice: isOwner || workshop?.role === 'administrador' || workshop?.role === 'recepcionista',
    isOwner,
    isPost: page.isPost,
    form: page.form,
    origin: page.origin,
    loadError: Boolean(error),
  };
}

/** Equipo del taller (nombres y roles). Los correos solo llegan a gestores. */
export async function loadTeam(panel: Panel): Promise<TeamMember[]> {
  if (!panel.workshop) return [];
  const { data, error } = await panel.supabase.rpc('workshop_team', { p_workshop_id: panel.workshop.id });
  if (error) logAuth('panel_team_error', error.code);
  return (data ?? []) as TeamMember[];
}

export function memberName(team: TeamMember[], userId: string | null | undefined, me?: string): string {
  if (!userId) return 'Sin asignar';
  if (userId === me) return 'Tú';
  const m = team.find(t => t.user_id === userId);
  return m?.full_name || m?.email || 'Otra persona';
}

export function field(form: FormData | null, name: string): string {
  const v = form?.get(name);
  return typeof v === 'string' ? v : '';
}

export function isUuid(value: string | undefined | null): value is string {
  return Boolean(value && UUID.test(value));
}
