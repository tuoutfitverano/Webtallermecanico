/**
 * Aviso de cookies y memoria de las preferencias.
 *
 * Las preferencias (modo claro u oscuro, color del panel) solo se guardan en el
 * dispositivo si la persona ha aceptado las cookies de preferencias. Lo que elija
 * antes de responder se guarda al aceptar; si rechaza, se borra lo guardado y la
 * elección solo dura mientras navega (theme.ts y panel-color.ts la vuelven a
 * aplicar en cada cambio de página del panel y del portal).
 */
import { CONSENT_COOKIE, CONSENT_MAX_AGE, PREFERENCE_COOKIES, consentFrom, type Consent } from '../lib/consent.ts';

const root = document.documentElement;
/** Preferencias elegidas en esta visita (se guardan si se acepta). */
const pending = new Map<string, string>();

export const canRemember = () => root.dataset.cookies === 'aceptadas';

function write(name: string, value: string, maxAge = 31536000) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`; } catch { /* sin cookies: vale con localStorage */ }
  try { if (maxAge > 0) localStorage.setItem(name, value); else localStorage.removeItem(name); } catch { /* sin almacenamiento */ }
}

/** Recuerda una preferencia: en el dispositivo si hay consentimiento; si no, solo en esta visita. */
export function rememberPreference(name: string, value: string) {
  pending.set(name, value);
  if (canRemember()) write(name, value);
}

function decide(consent: Consent) {
  root.dataset.cookies = consent;
  write(CONSENT_COOKIE, consent, CONSENT_MAX_AGE);
  if (consent === 'aceptadas') for (const [name, value] of pending) write(name, value);
  else for (const name of PREFERENCE_COOKIES) write(name, '', 0);
  for (const bar of document.querySelectorAll<HTMLElement>('[data-cookie-bar]')) bar.hidden = true;
  for (const el of document.querySelectorAll<HTMLElement>('[data-consent-state]')) el.textContent = consent === 'aceptadas' ? 'Aceptadas' : 'Rechazadas';
  dispatchEvent(new CustomEvent('cookies', { detail: consent }));
}

// Hueco al final de la página del alto real del aviso (más el margen y, en el panel, las pestañas).
function reserveSpace() {
  const bar = document.querySelector<HTMLElement>('[data-cookie-bar]');
  if (!bar || bar.hidden || root.dataset.cookies) return;
  const fit = () => document.body.style.setProperty('--cookie-space', `${Math.ceil(innerHeight - bar.getBoundingClientRect().top) + 16}px`);
  fit();
  new ResizeObserver(fit).observe(bar);
  addEventListener('resize', fit);
}
reserveSpace();
document.addEventListener('astro:page-load', reserveSpace);

document.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('button[name="cookies"]');
  const consent = consentFrom(btn?.value);
  if (!btn || !consent) return;
  e.preventDefault();
  decide(consent);
});
