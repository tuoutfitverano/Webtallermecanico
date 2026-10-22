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
import { createResendSender } from '../notifications/resend.ts';
import { dispatchEmails, type DispatchDeps, type DispatchSummary } from '../notifications/dispatcher.ts';
import { renderInvitationEmail, type ClaimedNotification } from '../notifications/templates.ts';
import type { ChannelSender } from '../notifications/types.ts';
import { createMetaWhatsappSender, dispatchWhatsapp, type ClaimedWhatsapp, type WhatsappSender } from '../notifications/whatsapp.ts';

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

// ---------------------------------------------------------------- notificaciones (Fase 7)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Canal email, o null si no está configurado. Sin proveedor, los avisos por
 * email se quedan "pendientes": nunca se dan por enviados.
 */
function emailSender(): ChannelSender | null {
  const kind = env('EMAIL_PROVIDER').trim().toLowerCase();
  if (!kind || !getServiceClient()) return null;
  const from = env('EMAIL_FROM').trim();
  if (!EMAIL_RE.test(from)) return null;
  if (kind === 'resend') {
    const apiKey = env('RESEND_API_KEY');
    const baseUrl = providerUrl(env('RESEND_API_URL'));
    if (!apiKey || baseUrl === null) return null;
    return createResendSender({ apiKey, fromAddress: from, baseUrl });
  }
  log('email_unknown_provider');
  return null;
}

/** ¿Hay email configurado en la plataforma? (para el panel: no se puede activar si no). */
export function emailAvailable(): boolean {
  return emailSender() !== null;
}

/**
 * Envía por correo una invitación al área de cliente. Devuelve «enviado» solo si
 * el proveedor la ha ACEPTADO; sin proveedor, «sin_proveedor» (la invitación
 * queda pendiente de envío y el panel lo dice: nunca se simula).
 */
export async function sendInvitationEmail(inv: { id: string; to: string; workshopName: string; url: string; expiresAt: Date; replyTo?: string | null }): Promise<'enviado' | 'sin_proveedor' | 'error'> {
  const sender = emailSender();
  if (!sender) return 'sin_proveedor';
  const mail = renderInvitationEmail(inv.workshopName, inv.url, inv.expiresAt);
  const outcome = await sender.send({ id: `invitacion-${inv.id}`, to: inv.to, subject: mail.subject, html: mail.html, text: mail.text, fromName: inv.workshopName, replyTo: inv.replyTo ?? null });
  if (outcome.kind === 'aceptado') return 'enviado';
  log('invitation_email_error', { code: outcome.code });
  return 'error';
}

/** Envía los emails pendientes (de una orden o de todos). Solo con la clave secreta, desde el servidor. */
export async function dispatchPendingEmails(opts: { orderId?: string | null; limit?: number; origin?: string | null } = {}): Promise<DispatchSummary> {
  const service = getServiceClient();
  const deps: DispatchDeps = {
    sender: service ? emailSender() : null,
    async claim({ limit, orderId }) {
      const { data, error } = await service!.rpc('claim_email_notifications', { p_limit: limit, p_order_id: orderId });
      return { data: (data ?? null) as ClaimedNotification[] | null, error };
    },
    async record(id, outcome, provider) {
      const { error } = await service!.rpc('record_email_result', {
        p_id: id,
        p_result: outcome.kind,
        p_provider: provider,
        p_message_id: outcome.kind === 'aceptado' ? outcome.messageId || null : null,
        p_error_code: outcome.kind === 'aceptado' ? null : outcome.code,
      });
      return { error };
    },
    portalOrigin: appOrigin() ?? opts.origin ?? null,
    log,
  };
  return dispatchEmails(deps, { orderId: opts.orderId ?? null, limit: opts.limit });
}

/** Anota una confirmación del proveedor (webhook ya verificado). */
export async function recordEmailDelivery(provider: string, messageId: string, outcome: string): Promise<boolean> {
  const service = getServiceClient();
  if (!service) return false;
  const { error } = await service.rpc('record_email_delivery', { p_provider: provider, p_message_id: messageId, p_outcome: outcome });
  if (error) log('email_delivery_error', { code: error.code ?? 'desconocido' });
  return !error;
}

/**
 * Canal WhatsApp (API oficial de WhatsApp Business), o null si no está
 * configurado. Sin él, los avisos por WhatsApp se quedan "pendientes".
 */
function whatsappSender(): WhatsappSender | null {
  const kind = env('WHATSAPP_PROVIDER').trim().toLowerCase();
  if (!kind || !getServiceClient()) return null;
  if (kind === 'meta') {
    const token = env('WHATSAPP_TOKEN');
    const phoneNumberId = env('WHATSAPP_PHONE_NUMBER_ID').trim();
    const baseUrl = providerUrl(env('WHATSAPP_API_URL'));
    if (!token || !/^[0-9]{5,30}$/.test(phoneNumberId) || baseUrl === null) return null;
    const path = baseUrl ? new URL(env('WHATSAPP_API_URL')).pathname.replace(/\/+$/, '') : '';
    return createMetaWhatsappSender({
      token,
      phoneNumberId,
      template: env('WHATSAPP_TEMPLATE').trim() || undefined,
      baseUrl: baseUrl ? baseUrl + path : undefined,
    });
  }
  log('whatsapp_unknown_provider');
  return null;
}

/** ¿Hay WhatsApp configurado en la plataforma? */
export function whatsappAvailable(): boolean {
  return whatsappSender() !== null;
}

/** Envía los WhatsApp pendientes (de una orden o de todos). Solo con la clave secreta, desde el servidor. */
export async function dispatchPendingWhatsapp(opts: { orderId?: string | null; limit?: number } = {}): Promise<DispatchSummary> {
  const service = getServiceClient();
  return dispatchWhatsapp({
    sender: service ? whatsappSender() : null,
    async claim({ limit, orderId }) {
      const { data, error } = await service!.rpc('claim_whatsapp_notifications', { p_limit: limit, p_order_id: orderId });
      return { data: (data ?? null) as ClaimedWhatsapp[] | null, error };
    },
    async record(id, outcome, provider) {
      const { error } = await service!.rpc('record_whatsapp_result', {
        p_id: id,
        p_result: outcome.kind,
        p_provider: provider,
        p_message_id: outcome.kind === 'aceptado' ? outcome.messageId || null : null,
        p_error_code: outcome.kind === 'aceptado' ? null : outcome.code,
      });
      return { error };
    },
    log,
  }, { orderId: opts.orderId ?? null, limit: opts.limit });
}

/** Anota una confirmación de WhatsApp (webhook ya verificado). */
export async function recordWhatsappDelivery(messageId: string, outcome: string): Promise<boolean> {
  const service = getServiceClient();
  if (!service) return false;
  const { error } = await service.rpc('record_whatsapp_delivery', { p_provider: 'meta', p_message_id: messageId, p_outcome: outcome });
  if (error) log('whatsapp_delivery_error', { code: error.code ?? 'desconocido' });
  return !error;
}

export function whatsappWebhookSecrets(): { appSecret: string; verifyToken: string } {
  return { appSecret: env('WHATSAPP_APP_SECRET'), verifyToken: env('WHATSAPP_VERIFY_TOKEN') };
}

export function resendWebhookSecret(): string {
  return env('RESEND_WEBHOOK_SECRET');
}

/** Secreto del aviso programado (cron). Vacío = el endpoint de proceso está desactivado. */
export function notificationsCronSecret(): string {
  const s = env('NOTIFICATIONS_CRON_SECRET');
  return s.length >= 24 ? s : '';
}

/** Tareas de mantenimiento (huellas antispam caducadas, consultas a medias). Solo recuentos. */
export async function runMaintenance(): Promise<Record<string, number> | null> {
  const service = getServiceClient();
  if (!service) return null;
  const { data, error } = await service.rpc('run_maintenance');
  if (error) {
    log('maintenance_error', { code: error.code ?? 'desconocido' });
    return null;
  }
  return (data ?? {}) as Record<string, number>;
}

// ---------------------------------------------------------------- presupuestos por enlace (público)

export interface PublicQuote {
  workshop_name: string; workshop_phone: string | null; number: number; version: number; status: string;
  title: string | null; notes: string | null; valid_until: string; conditions: string | null;
  vehicle: string | null; plate_hint: string | null;
  lines: Array<{ kind: 'mano_obra' | 'pieza' | 'otro'; description: string; part_number: string | null; quantity: number; unit_price_cents: number; discount_pct: number; tax_rate: number; base_cents: number }>;
  subtotal_cents: number; tax_cents: number; total_cents: number; taxes: Array<{ rate: number; base_cents: number; tax_cents: number }>;
}

/** Presupuesto de un enlace (solo servidor, clave secreta). 'no_disponible' si falta la configuración. */
export async function quoteByToken(token: string): Promise<PublicQuote | null | 'no_disponible'> {
  const service = getServiceClient();
  if (!service) return 'no_disponible';
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data, error } = await service.rpc('quote_by_token', { p_token: token });
  if (error) {
    log('quote_link_error', { code: error.code ?? 'desconocido' });
    return 'no_disponible';
  }
  return (data ?? null) as PublicQuote | null;
}

/** Respuesta del cliente por enlace. Del navegador solo se guarda una huella diaria de la IP. */
export async function respondQuoteByToken(token: string, accept: boolean, name: string, comment: string, ip: string | null):
  Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const service = getServiceClient();
  if (!service) return { ok: false, message: 'El servicio no está disponible en este momento. Inténtalo más tarde o llama al taller.' };
  const hashSecret = env('REQUEST_HASH_SECRET') || (isDev ? 'solo-para-desarrollo' : '');
  const ipHash = await clientFingerprint(ip, hashSecret, madridToday());
  const { data, error } = await service.rpc('respond_quote_by_token', {
    p_token: token, p_accept: accept, p_name: name, p_comment: comment || null, p_ip_hash: ipHash,
  });
  if (error) {
    log('quote_link_response_error', { code: error.code ?? 'desconocido' });
    // Los mensajes 22023 de la base de datos son para la persona (enlace caducado, falta el nombre…).
    return { ok: false, message: error.code === '22023' && error.message ? error.message : 'No se ha podido guardar tu respuesta. Inténtalo de nuevo.' };
  }
  return { ok: true, status: String(data) };
}
