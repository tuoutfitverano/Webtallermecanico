/**
 * Aviso de cookies y memoria de las preferencias.
 *
 * Las preferencias (modo claro u oscuro, color del panel) se aplican en TODAS
 * las páginas en cuanto la persona las elige:
 *  · con las cookies de preferencias aceptadas, se recuerdan en este
 *    dispositivo (cookie de 1 año y localStorage);
 *  · si no las ha aceptado (o las ha rechazado), solo durante la visita: cookie
 *    de sesión y sessionStorage, que se borran al cerrar el navegador. Es una
 *    personalización pedida por la propia persona, sin datos personales.
 * Lo que elija antes de responder se guarda al aceptar; al rechazar, lo guardado
 * en el dispositivo se borra y la elección de esta visita sigue hasta cerrar.
 */
import { CONSENT_COOKIE, CONSENT_MAX_AGE, PREFERENCE_COOKIES, consentFrom, type Consent } from '../lib/consent.ts';

const root = document.documentElement;
/** Preferencias elegidas en esta visita (se guardan si se acepta). */
const pending = new Map<string, string>();

export const canRemember = () => root.dataset.cookies === 'aceptadas';

function cookie(name: string, value: string, maxAge: number | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  const age = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  try { document.cookie = `${name}=${value}; Path=/${age}; SameSite=Lax${secure}`; } catch { /* sin cookies: vale con el almacenamiento */ }
}
const tryDo = (f: () => void) => { try { f(); } catch { /* sin almacenamiento */ } };

/** Guardado en el dispositivo (1 año). Para «consentimiento» y, si se aceptan, las preferencias. */
function write(name: string, value: string, maxAge = 31536000) {
  cookie(name, value, maxAge);
  tryDo(() => localStorage.setItem(name, value));
  tryDo(() => sessionStorage.setItem(name, value));
}
/** Solo esta visita: cookie de sesión y sessionStorage; lo que hubiera en el dispositivo se borra. */
function writeVisit(name: string, value: string) {
  cookie(name, value, null);
  tryDo(() => sessionStorage.setItem(name, value));
  tryDo(() => localStorage.removeItem(name));
}
function erase(name: string) {
  cookie(name, '', 0);
  tryDo(() => localStorage.removeItem(name));
  tryDo(() => sessionStorage.removeItem(name));
}

/** Recuerda una preferencia: en el dispositivo si hay consentimiento; si no, durante esta visita. */
export function rememberPreference(name: string, value: string) {
  pending.set(name, value);
  if (canRemember()) write(name, value);
  else writeVisit(name, value);
}

function decide(consent: Consent) {
  root.dataset.cookies = consent;
  write(CONSENT_COOKIE, consent, CONSENT_MAX_AGE);
  // Lo elegido en esta visita (en esta página o en las anteriores).
  const chosen = (name: string) => pending.get(name) ?? (() => { try { return sessionStorage.getItem(name); } catch { return null; } })();
  if (consent === 'aceptadas') for (const name of PREFERENCE_COOKIES) {
    const value = chosen(name);
    if (value) write(name, value);
  }
  else for (const name of PREFERENCE_COOKIES) {
    const value = chosen(name);
    if (value) writeVisit(name, value);
    else erase(name);
  }
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
