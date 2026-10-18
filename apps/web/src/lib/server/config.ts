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
import { createOpenapiProvider } from '../vehicle-lookup/openapi.ts';
import type { LookupDeps, LookupRow } from '../vehicle-lookup/service.ts';
import type { VehicleLookupProvider } from '../vehicle-lookup/types.ts';

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

/**
 * Proveedor de datos por matrícula, o null si no está configurado. Necesita
 * también la clave secreta de Supabase: sin ella no se puede guardar el
 * resultado y la consulta no se ofrece.
 */
function vehicleLookupProvider(): VehicleLookupProvider | null {
  const kind = env('VEHICLE_LOOKUP_PROVIDER').trim().toLowerCase();
  if (!kind || !getServiceClient()) return null;
  const timeout = Number(env('VEHICLE_LOOKUP_TIMEOUT_MS'));
  const timeoutMs = Number.isFinite(timeout) && timeout >= 1000 && timeout <= 30000 ? timeout : 8000;
  if (kind === 'openapi') {
    const token = env('OPENAPI_AUTOMOTIVE_TOKEN');
    const baseUrl = providerUrl(env('OPENAPI_AUTOMOTIVE_URL'));
    if (!token || baseUrl === null) return null;
    return createOpenapiProvider({ token, baseUrl, timeoutMs });
  }
  log('vehicle_lookup_unknown_provider');
  return null;
}

/** URL del proveedor: https; http solo en desarrollo y en este ordenador (pruebas). '' = la de producción. */
function providerUrl(raw: string): string | null {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return url.origin;
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return isDev && local && url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** ¿Se puede ofrecer el botón "Consultar datos"? */
export function vehicleLookupAvailable(): boolean {
  return vehicleLookupProvider() !== null;
}

/**
 * Dependencias de la consulta: permisos y límites con el token del usuario
 * (`userClient`, RLS); el resultado lo guarda el servidor con la clave secreta.
 */
export function vehicleLookupDeps(userClient: SupabaseClient): LookupDeps {
  const service = getServiceClient();
  const first = (data: unknown) => ((Array.isArray(data) ? data[0] : null) ?? null) as LookupRow | null;
  return {
    provider: vehicleLookupProvider(),
    async start({ workshopId, plate, provider, requestKey }) {
      const { data, error } = await userClient.rpc('start_vehicle_lookup', {
        p_workshop_id: workshopId, p_plate: plate, p_provider: provider, p_request_key: requestKey,
      });
      return { data: first(data), error };
    },
    async complete(lookupId, status, result) {
      if (!service) return { error: { code: 'sin_clave' } };
      const { error } = await service.rpc('complete_vehicle_lookup', { p_lookup_id: lookupId, p_status: status, p_result: result });
      return { error };
    },
    async read(lookupId) {
      const { data } = await userClient.from('vehicle_lookups').select('id, status, result, completed_at').eq('id', lookupId).maybeSingle();
      return data ? { lookup_id: data.id, state: 'en_curso', status: data.status, result: data.result, completed_at: data.completed_at } as LookupRow : null;
    },
    log,
  };
}
