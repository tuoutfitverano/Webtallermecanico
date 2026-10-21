/**
 * Aviso de cookies: la persona acepta o rechaza las cookies de preferencias.
 *
 *  · Técnicas (siempre): sesión del área privada, protección del inicio de
 *    sesión, taller abierto en el panel y esta misma elección. Sin ellas la
 *    web no funciona como se pide.
 *  · Preferencias: modo claro u oscuro y color del panel, solo cuando la
 *    persona los cambia. Se mantienen en todas las páginas hasta cerrar el
 *    navegador (cookie de sesión); si se aceptan, se recuerdan 1 año. Si se
 *    rechazan, se borra lo guardado en el dispositivo.
 *
 * No hay cookies de publicidad ni de analítica.
 */
import { PANEL_COLOR_COOKIE } from './panel/colors.ts';
import { THEME_COOKIE } from './theme.ts';

export const CONSENT_COOKIE = 'consentimiento';
export const CONSENTS = ['aceptadas', 'rechazadas'] as const;
export type Consent = (typeof CONSENTS)[number];
/** Un año: después se vuelve a preguntar. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;
/** Cookies que solo se guardan más allá de la visita con el consentimiento. */
export const PREFERENCE_COOKIES = [THEME_COOKIE, PANEL_COLOR_COOKIE] as const;

export function consentFrom(value: unknown): Consent | null {
  return typeof value === 'string' && (CONSENTS as readonly string[]).includes(value) ? (value as Consent) : null;
}
