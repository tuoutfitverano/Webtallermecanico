/**
 * Averigua qué taller hay que mostrar a partir del dominio de la visita.
 * Una sola aplicación sirve a todos los talleres (multiempresa).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePublicSite, type PublicSite } from './content.ts';
import { DEMO_SITE } from './demo.ts';

/** En desarrollo, localhost se trata como el dominio de la web de demostración. */
const DEV_HOST_ALIASES: Record<string, string> = {
  localhost: 'demo.localhost',
  '127.0.0.1': 'demo.localhost',
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; site: PublicSite | null }>();

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

export interface ResolveOptions {
  /** Cliente con clave publicable, o null si Supabase no está configurado. */
  supabase: SupabaseClient | null;
  dev: boolean;
}

export async function resolveSite(rawHost: string, { supabase, dev }: ResolveOptions): Promise<PublicSite | null> {
  let host = normalizeHost(rawHost);
  if (dev && DEV_HOST_ALIASES[host]) host = DEV_HOST_ALIASES[host];

  if (!supabase) {
    // Sin base de datos solo existe la demo local, y solo en desarrollo.
    return dev && host === 'demo.localhost' ? DEMO_SITE : null;
  }

  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.site;

  const { data, error } = await supabase.rpc('get_public_site', { p_hostname: host });
  if (error) throw new Error(`get_public_site falló (${error.code ?? 'sin código'})`);
  const site = data ? parsePublicSite(data) : null;
  cache.set(host, { at: Date.now(), site });
  return site;
}

/** Solo para pruebas. */
export function clearSiteCache(): void {
  cache.clear();
}
