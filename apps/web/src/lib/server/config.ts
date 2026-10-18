/**
 * Configuración del servidor y montaje de dependencias.
 * Este archivo SOLO se importa desde páginas y endpoints del servidor.
 */
import {
  REQUEST_HASH_SECRET,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
  TURNSTILE_SECRET_KEY,
  TURNSTILE_SITE_KEY,
} from 'astro:env/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPublicClient, createServiceClient } from '../supabase.ts';
import { resolveSite } from '../site/resolve.ts';
import type { PublicSite } from '../site/content.ts';
import { clientFingerprint, createTurnstileVerifier } from '../requests/antispam.ts';
import { createSupabaseStore } from '../requests/store.ts';
import type { SubmissionDeps } from '../requests/handler.ts';

export const isDev = import.meta.env.DEV;

let publicClient: SupabaseClient | null | undefined;
let serviceClient: SupabaseClient | null | undefined;

function getPublicClient(): SupabaseClient | null {
  if (publicClient === undefined) {
    publicClient = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? createPublicClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
  }
  return publicClient;
}

function getServiceClient(): SupabaseClient | null {
  if (serviceClient === undefined) {
    serviceClient = SUPABASE_URL && SUPABASE_SECRET_KEY ? createServiceClient(SUPABASE_URL, SUPABASE_SECRET_KEY) : null;
  }
  return serviceClient;
}

export function siteForHost(host: string): Promise<PublicSite | null> {
  return resolveSite(host, { supabase: getPublicClient(), dev: isDev });
}

/** Clave pública de Turnstile para pintar el widget, o null si no está configurado. */
export function turnstileSiteKey(): string | null {
  return TURNSTILE_SITE_KEY || null;
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
  const hashSecret = REQUEST_HASH_SECRET || (isDev ? 'solo-para-desarrollo' : '');
  return {
    resolveSite: siteForHost,
    store: service ? createSupabaseStore(service) : null,
    captcha: TURNSTILE_SECRET_KEY ? createTurnstileVerifier(TURNSTILE_SECRET_KEY) : null,
    requireCaptcha: !isDev,
    fingerprint: ip => clientFingerprint(ip, hashSecret, madridToday()),
    today: madridToday,
    log,
  };
}
