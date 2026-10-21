/**
 * Envío de los formularios de solicitud (se descarga al usar un formulario,
 * ver request-forms.ts).
 *
 *  · Valida con las MISMAS reglas que el servidor (@talleres/core) para avisar
 *    antes de enviar, pero la decisión final es siempre del servidor.
 *  · Solo muestra "Solicitud recibida" cuando el servidor confirma que la ha
 *    guardado (respuesta ok). Cualquier otro caso es un error visible.
 *  · Evita envíos duplicados: botón bloqueado mientras se envía y una clave de
 *    idempotencia por envío (si el mismo envío llega dos veces, se guarda una).
 */
import { requestReference, validateWebRequest, type FieldErrors } from '@talleres/core';

type ServerResponse =
  | { ok: true; id: string; reference: string; duplicate: boolean }
  | { ok: false; error: string; message: string; fields?: FieldErrors };

declare global {
  interface Window {
    turnstile?: { reset(el?: Element | string): void };
  }
}

const TIMEOUT_MS = 15_000;
const FIELD_ORDER = ['name', 'businessName', 'contact', 'phone', 'email', 'preferredContact', 'topic', 'service', 'plate', 'make', 'model', 'preferredDate', 'preferredTime', 'message', 'privacyAccepted'];

function readForm(form: HTMLFormElement): Record<string, unknown> {
  const fd = new FormData(form);
  const data: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') data[k] = v;
  data.privacyAccepted = fd.get('privacyAccepted') === 'on';
  const token = fd.get('cf-turnstile-response');
  if (typeof token === 'string') data.turnstileToken = token;
  delete data['cf-turnstile-response'];
  return data;
}

function showErrors(form: HTMLFormElement, errors: FieldErrors) {
  let first: HTMLElement | null = null;
  for (const wrap of form.querySelectorAll<HTMLElement>('[data-field]')) {
    const name = wrap.dataset.field!;
    const msg = errors[name];
    const el = form.querySelector<HTMLElement>(`#${form.dataset.kind}-err-${name}`);
    const control = wrap.matches('fieldset') ? null : wrap.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea');
    if (el) {
      el.textContent = msg ?? '';
      el.hidden = !msg;
    }
    wrap.classList.toggle('has-error', Boolean(msg));
    if (control) control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  for (const name of FIELD_ORDER) {
    if (!errors[name]) continue;
    first = name === 'contact'
      ? form.querySelector<HTMLElement>('[name="phone"]')
      : form.querySelector<HTMLElement>(`[name="${name}"]`);
    if (first) break;
  }
  first?.focus();
}

function setStatus(form: HTMLFormElement, kind: 'error' | 'info' | '', message: string) {
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  status.className = `form-status ${kind ? `is-${kind}` : ''}`;
  status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  status.textContent = message;
}

function setBusy(form: HTMLFormElement, busy: boolean) {
  const btn = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const label = btn.querySelector<HTMLElement>('[data-label]')!;
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  form.setAttribute('aria-busy', String(busy));
  if (busy) {
    btn.dataset.idle = label.textContent ?? '';
    label.textContent = 'Enviando…';
  } else if (btn.dataset.idle) {
    label.textContent = btn.dataset.idle;
  }
}

export function newKey(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('[name="idempotencyKey"]')!;
  input.value = crypto.randomUUID();
}

export function resetCaptcha(form: HTMLFormElement) {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile) window.turnstile.reset(widget);
}

function showSuccess(form: HTMLFormElement, res: Extract<ServerResponse, { ok: true }>) {
  const panel = form.parentElement!;
  const success = panel.querySelector<HTMLElement>('[data-success]')!;
  const kind = form.dataset.kind;
  success.querySelector('[data-success-title]')!.textContent =
    kind === 'cita' ? 'Solicitud de cita recibida'
      : kind === 'presupuesto' ? 'Solicitud de presupuesto recibida'
        : kind === 'digitalizacion' ? 'Solicitud recibida' : 'Mensaje recibido';
  success.querySelector('[data-success-text]')!.textContent =
    kind === 'cita'
      ? 'El taller revisará tu solicitud y te contactará para confirmar la cita. Hasta entonces no está reservada.'
      : kind === 'digitalizacion'
        ? 'Te contactaremos con los datos que nos has dado para enseñarte la demostración. No has contratado nada.'
        : 'El taller ha recibido tu solicitud y te contestará lo antes posible.';
  success.querySelector('[data-success-ref]')!.textContent = res.reference || requestReference(res.id);
  form.hidden = true;
  success.hidden = false;
  success.focus();
}

export async function submit(form: HTMLFormElement) {
  if (form.getAttribute('aria-busy') === 'true') return; // ya se está enviando
  const data = readForm(form);
  const services = JSON.parse(form.dataset.services ?? '[]') as string[];

  const check = validateWebRequest(data, { services });
  if (!check.ok) {
    showErrors(form, check.errors);
    setStatus(form, 'error', 'Revisa los campos marcados.');
    return;
  }
  showErrors(form, {});
  if (form.querySelector('.cf-turnstile') && !data.turnstileToken) {
    setStatus(form, 'error', 'Espera a que termine la comprobación anti-robots y vuelve a pulsar Enviar.');
    return;
  }

  setBusy(form, true);
  setStatus(form, 'info', 'Enviando tu solicitud…');
  let res: ServerResponse | null = null;
  let httpStatus = 0;
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...data, sourcePath: location.pathname }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      credentials: 'same-origin',
    });
    httpStatus = response.status;
    res = (await response.json().catch(() => null)) as ServerResponse | null;
  } catch {
    // Red caída o tiempo agotado: res sigue siendo null y se trata como error.
  } finally {
    setBusy(form, false);
  }

  if (res && res.ok === true && (httpStatus === 200 || httpStatus === 201)) {
    setStatus(form, '', '');
    showSuccess(form, res);
    return;
  }

  // A partir de aquí NO se ha guardado nada (o no podemos saberlo).
  resetCaptcha(form);
  if (res && res.ok === false) {
    if (res.fields) showErrors(form, res.fields);
    setStatus(form, 'error', res.message);
    if (res.error === 'captcha_failed' || res.error === 'bad_request') newKey(form);
  } else {
    // Sin respuesta clara (red caída, tiempo agotado). Se conserva la clave de
    // idempotencia: si el servidor sí la guardó, el reintento no la duplicará.
    setStatus(form, 'error', 'No hemos podido confirmar el envío. Tu solicitud no consta como recibida: comprueba tu conexión e inténtalo de nuevo.');
  }
}


/** «Enviar otra»: formulario vacío, clave nueva y comprobación anti-robots de nuevo. */
export function again(form: HTMLFormElement) {
  form.reset();
  newKey(form);
  resetCaptcha(form);
  form.parentElement!.querySelector<HTMLElement>('[data-success]')!.hidden = true;
  form.hidden = false;
  form.querySelector<HTMLElement>('[name="name"]')?.focus();
}
