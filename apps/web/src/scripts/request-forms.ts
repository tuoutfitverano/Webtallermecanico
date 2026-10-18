/**
 * Formularios de solicitud en el navegador.
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
const FIELD_ORDER = ['name', 'contact', 'phone', 'email', 'preferredContact', 'topic', 'service', 'plate', 'make', 'model', 'preferredDate', 'preferredTime', 'message', 'privacyAccepted'];

function setupTabs(root: HTMLElement) {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const select = (kind: string, focus = false) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === kind;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
      if (on && focus) tab.focus();
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab.dataset.tab!));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
      select(next.dataset.tab!, true);
    });
  });

  // Enlaces de la página que abren una pestaña concreta (y opcionalmente un servicio).
  document.addEventListener('click', e => {
    const link = (e.target as Element).closest<HTMLElement>('[data-open-tab], [data-service]');
    if (!link) return;
    const kind = link.dataset.openTab ?? 'cita';
    select(kind);
    if (link.dataset.service) {
      const sel = document.querySelector<HTMLSelectElement>(`#solicitar-${kind} select[name="service"]`);
      if (sel) sel.value = link.dataset.service;
    }
  });
  const fromHash = location.hash.match(/^#solicitar-(cita|presupuesto|contacto)$/);
  select(fromHash ? fromHash[1]! : 'cita');
}

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

function newKey(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('[name="idempotencyKey"]')!;
  input.value = crypto.randomUUID();
}

function resetCaptcha(form: HTMLFormElement) {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile) window.turnstile.reset(widget);
}

function showSuccess(form: HTMLFormElement, res: Extract<ServerResponse, { ok: true }>) {
  const panel = form.parentElement!;
  const success = panel.querySelector<HTMLElement>('[data-success]')!;
  const kind = form.dataset.kind;
  success.querySelector('[data-success-title]')!.textContent =
    kind === 'cita' ? 'Solicitud de cita recibida' : kind === 'presupuesto' ? 'Solicitud de presupuesto recibida' : 'Mensaje recibido';
  success.querySelector('[data-success-text]')!.textContent =
    kind === 'cita'
      ? 'El taller revisará tu solicitud y te contactará para confirmar la cita. Hasta entonces no está reservada.'
      : 'El taller ha recibido tu solicitud y te contestará lo antes posible.';
  success.querySelector('[data-success-ref]')!.textContent = res.reference || requestReference(res.id);
  form.hidden = true;
  success.hidden = false;
  success.focus();
}

async function submit(form: HTMLFormElement) {
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

function setupForm(form: HTMLFormElement) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    void submit(form);
  });
  // Al corregir un campo, su error desaparece.
  form.addEventListener('input', e => {
    const wrap = (e.target as Element).closest<HTMLElement>('[data-field]');
    if (!wrap?.classList.contains('has-error')) return;
    wrap.classList.remove('has-error');
    const err = form.querySelector<HTMLElement>(`#${form.dataset.kind}-err-${wrap.dataset.field}`);
    if (err) err.hidden = true;
    if (['phone', 'email'].includes(wrap.dataset.field!)) {
      const group = form.querySelector<HTMLElement>(`#${form.dataset.kind}-err-contact`);
      if (group) group.hidden = true;
      form.querySelector('[data-field="contact"]')?.classList.remove('has-error');
    }
  });
  const panel = form.parentElement!;
  panel.querySelector('[data-again]')?.addEventListener('click', () => {
    form.reset();
    newKey(form);
    resetCaptcha(form);
    panel.querySelector<HTMLElement>('[data-success]')!.hidden = true;
    form.hidden = false;
    form.querySelector<HTMLElement>('[name="name"]')?.focus();
  });
}

const root = document.querySelector<HTMLElement>('[data-req]');
if (root) {
  root.classList.add('js');
  setupTabs(root);
  root.querySelectorAll<HTMLFormElement>('[data-req-form]').forEach(setupForm);
}
