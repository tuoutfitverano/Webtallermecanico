/**
 * Configuración del servidor y montaje de dependencias.
 * Este archivo SOLO se importa desde páginas y endpoints del servidor.
 */
import { getSecret } from 'astro:env/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPublicClient, createServiceClient } from '../supabase.ts';
import { resolveSite } from '../site/resolve.ts';
import type { PublicSite } from '../site/content.ts';
import { clientFingerprint, createTurnstileVerifier } from '../requests/antispam.ts';
import { createSupabaseStore } from '../requests/store.ts';
import type { SubmissionDeps } from '../requests/handler.ts';

export const isDev = import.meta.env.DEV;

/**
 * Lee una variable en el momento de usarla. En Cloudflare las variables solo
 * existen a partir de la primera petición: importarlas como constantes al
 * cargar el módulo puede dejarlas vacías en producción.
 */
const env = (key: string): string => getSecret(key) ?? '';

let publicClient: SupabaseClient | null | undefined;
let serviceClient: SupabaseClient | null | undefined;

function getPublicClient(): SupabaseClient | null {
  if (publicClient === undefined) {
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_PUBLISHABLE_KEY');
    publicClient = url && key ? createPublicClient(url, key) : null;
  }
  return publicClient;
}

function getServiceClient(): SupabaseClient | null {
  if (serviceClient === undefined) {
    const url = env('SUPABASE_URL');
    const key = env('SUPABASE_SECRET_KEY');
    serviceClient = url && key ? createServiceClient(url, key) : null;
  }
  return serviceClient;
}

export function siteForHost(host: string): Promise<PublicSite | null> {
  return resolveSite(host, { supabase: getPublicClient(), dev: isDev });
}

/** URL y clave publicable para el inicio de sesión, o null si falta configurarlo. */
export function authEnv(): { url: string; publishableKey: string } | null {
  const url = env('SUPABASE_URL');
  const publishableKey = env('SUPABASE_PUBLISHABLE_KEY');
  return url && publishableKey ? { url, publishableKey } : null;
}

/**
 * Dominio del área privada (p. ej. https://app.tudominio.es). Si está definido,
 * el acceso y la cuenta solo funcionan ahí y los enlaces de los correos
 * apuntan ahí. Sin definir (desarrollo), se usa el dominio de la visita.
 */
export function appOrigin(): string | null {
  const raw = env('APP_URL');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost');
    return url.protocol === 'https:' || local ? url.origin : null;
  } catch {
    return null;
  }
}

/** Clave pública de Turnstile para pintar el widget, o null si no está configurado. */
export function turnstileSiteKey(): string | null {
  return env('TURNSTILE_SITE_KEY') || null;
}

function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
}

/** Registro técnico: solo eventos y códigos, nunca datos del formulario. */
function log(event: string, meta: Record<string, string | number | boolean> = {}) {
  console.info(JSON.stringify({ event, ...meta }));
}

export function submissionDeps(): SubmissionDeps {
  const service = getServiceClient();
  const hashSecret = env('REQUEST_HASH_SECRET') || (isDev ? 'solo-para-desarrollo' : '');
  const turnstileSecret = env('TURNSTILE_SECRET_KEY');
  return {
    resolveSite: siteForHost,
    store: service ? createSupabaseStore(service) : null,
    captcha: turnstileSecret ? createTurnstileVerifier(turnstileSecret) : null,
    requireCaptcha: !isDev,
    fingerprint: ip => clientFingerprint(ip, hashSecret, madridToday()),
    today: madridToday,
    log,
  };
}
