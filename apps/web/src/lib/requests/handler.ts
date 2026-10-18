/**
 * Lógica del endpoint POST /api/solicitudes, separada de Astro para poder
 * probarla sin servidor ni base de datos.
 *
 * Regla de oro: solo se responde "ok" cuando el almacenamiento confirma que la
 * solicitud se ha guardado. Validar en el navegador no cuenta como enviado.
 */
import { requestReference, validateWebRequest, type FieldErrors } from '@talleres/core';
import type { PublicSite } from '../site/content.ts';
import type { CaptchaVerifier } from './antispam.ts';
import { StoreError, type RequestStore } from './store.ts';

export type ErrorCode =
  | 'forbidden_origin'
  | 'bad_request'
  | 'validation'
  | 'captcha_failed'
  | 'site_not_found'
  | 'rate_limited'
  | 'storage_unavailable'
  | 'not_configured';

export type SubmissionResponse =
  | { ok: true; id: string; reference: string; duplicate: boolean }
  | { ok: false; error: ErrorCode; message: string; fields?: FieldErrors };

export interface SubmissionResult {
  status: number;
  body: SubmissionResponse;
}

export interface SubmissionInput {
  /** Cabecera Host de la petición (incluye el puerto si lo hay). */
  host: string;
  /** Cabecera Origin, si el navegador la envía. */
  origin: string | null;
  /** IP del visitante según Cloudflare, o null. */
  ip: string | null;
  body: unknown;
}

export interface SubmissionDeps {
  resolveSite(host: string): Promise<PublicSite | null>;
  /** null = almacenamiento no configurado. */
  store: RequestStore | null;
  /** null = Turnstile no configurado. */
  captcha: CaptchaVerifier | null;
  /** En producción la comprobación anti-bots es obligatoria. */
  requireCaptcha: boolean;
  fingerprint(ip: string | null): Promise<string | null>;
  today(): string;
  /** Registro técnico SIN datos personales. */
  log(event: string, meta?: Record<string, string | number | boolean>): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Campos que se aceptan del formulario; cualquier otro se ignora. */
const STRING_FIELDS = [
  'kind', 'name', 'phone', 'email', 'preferredContact', 'topic', 'plate', 'make', 'model',
  'service', 'preferredDate', 'preferredTime', 'message',
] as const;

const fail = (status: number, error: ErrorCode, message: string, fields?: FieldErrors): SubmissionResult => ({
  status,
  body: fields ? { ok: false, error, message, fields } : { ok: false, error, message },
});

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function phoneHint(site: PublicSite | null): string {
  return site?.content.phone ? ` También puedes llamarnos al ${site.content.phone}.` : '';
}

export async function handleSubmission(input: SubmissionInput, deps: SubmissionDeps): Promise<SubmissionResult> {
  const host = input.host.toLowerCase();

  // 1. Solo se aceptan envíos desde la propia web.
  if (input.origin && hostOf(input.origin) !== host) {
    deps.log('request_rejected', { reason: 'origin' });
    return fail(403, 'forbidden_origin', 'Envío no permitido.');
  }

  // 2. Forma del cuerpo.
  const body = input.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'bad_request', 'No hemos podido leer el formulario. Recarga la página e inténtalo de nuevo.');
  }
  const raw = body as Record<string, unknown>;

  // 3. Campo trampa: las personas no lo ven; si viene relleno, es un bot.
  if (typeof raw.website === 'string' && raw.website.trim() !== '') {
    deps.log('request_rejected', { reason: 'honeypot' });
    return fail(400, 'bad_request', 'No hemos podido enviar el formulario.');
  }

  const idempotencyKey = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : '';
  if (!UUID_RE.test(idempotencyKey)) {
    return fail(400, 'bad_request', 'No hemos podido leer el formulario. Recarga la página e inténtalo de nuevo.');
  }

  // 4. Taller según el dominio (nunca según lo que diga el formulario).
  let site: PublicSite | null;
  try {
    site = await deps.resolveSite(host);
  } catch {
    deps.log('request_failed', { reason: 'site_lookup' });
    return fail(503, 'storage_unavailable', 'No hemos podido enviar tu solicitud. No se ha guardado; inténtalo de nuevo en unos minutos.');
  }
  if (!site) return fail(404, 'site_not_found', 'Esta web no está disponible.');

  // 5. Validación en el servidor (la del navegador no cuenta).
  const fields: Record<string, unknown> = {};
  for (const key of STRING_FIELDS) {
    const v = raw[key];
    if (typeof v === 'string') fields[key] = v;
  }
  fields.privacyAccepted = raw.privacyAccepted === true || raw.privacyAccepted === 'on' || raw.privacyAccepted === 'true';
  const result = validateWebRequest(fields, { services: site.content.services.map(s => s.id), today: deps.today() });
  if (!result.ok) {
    return fail(422, 'validation', 'Revisa los campos marcados.', result.errors);
  }

  // 6. Configuración mínima para poder guardar de verdad.
  if (!deps.store || !site.workshopId) {
    deps.log('request_failed', { reason: 'storage_not_configured' });
    return fail(503, 'not_configured', `Ahora mismo no podemos recibir solicitudes por la web. No se ha guardado nada.${phoneHint(site)}`);
  }

  // 7. Anti-bots.
  if (deps.captcha) {
    const token = typeof raw.turnstileToken === 'string' ? raw.turnstileToken : '';
    const verdict = await deps.captcha.verify(token, input.ip, host.replace(/:\d+$/, ''));
    if (verdict === 'invalid') {
      deps.log('request_rejected', { reason: 'captcha' });
      return fail(400, 'captcha_failed', 'No hemos podido comprobar que no eres un robot. Vuelve a intentarlo.');
    }
    if (verdict === 'error') {
      deps.log('request_failed', { reason: 'captcha_unreachable' });
      return fail(503, 'storage_unavailable', `No hemos podido enviar tu solicitud. No se ha guardado; inténtalo de nuevo en unos minutos.${phoneHint(site)}`);
    }
  } else if (deps.requireCaptcha) {
    deps.log('request_failed', { reason: 'captcha_not_configured' });
    return fail(503, 'not_configured', `Ahora mismo no podemos recibir solicitudes por la web. No se ha guardado nada.${phoneHint(site)}`);
  }

  // 8. Guardar. Solo aquí se puede responder ok.
  try {
    const saved = await deps.store.submit({
      workshopId: site.workshopId,
      data: result.data,
      idempotencyKey,
      clientHash: await deps.fingerprint(input.ip),
      sourcePath: typeof raw.sourcePath === 'string' ? raw.sourcePath.slice(0, 300) : null,
    });
    deps.log('request_saved', { kind: result.data.kind, duplicate: saved.duplicate });
    return {
      status: saved.duplicate ? 200 : 201,
      body: { ok: true, id: saved.id, reference: requestReference(saved.id), duplicate: saved.duplicate },
    };
  } catch (err) {
    const code = err instanceof StoreError ? err.code : 'unavailable';
    deps.log('request_failed', { reason: `store_${code}` });
    if (code === 'rate_limited') {
      return fail(429, 'rate_limited', `Has enviado varias solicitudes seguidas. Espera unos minutos antes de volver a intentarlo.${phoneHint(site)}`);
    }
    if (code === 'invalid') return fail(422, 'validation', 'Revisa los datos del formulario.');
    if (code === 'site_unavailable') return fail(404, 'site_not_found', 'Esta web no está recibiendo solicitudes ahora mismo.');
    return fail(503, 'storage_unavailable', `No hemos podido enviar tu solicitud. No se ha guardado; inténtalo de nuevo en unos minutos.${phoneHint(site)}`);
  }
}
