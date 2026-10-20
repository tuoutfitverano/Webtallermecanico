/**
 * Aviso de cookies: la persona acepta o rechaza las cookies de preferencias.
 *
 *  · Técnicas (siempre): sesión del área privada, protección del inicio de
 *    sesión, taller abierto en el panel y esta misma elección. Sin ellas la
 *    web no funciona como se pide.
 *  · Preferencias (solo si se aceptan): modo claro u oscuro y color del panel.
 *    Si se rechazan, la elección se aplica mientras se navega por el panel o el
 *    portal, pero no se guarda en el dispositivo (y se borra lo guardado).
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
/** Cookies que solo se guardan con el consentimiento. */
export const PREFERENCE_COOKIES = [THEME_COOKIE, PANEL_COLOR_COOKIE] as const;

export function consentFrom(value: unknown): Consent | null {
  return typeof value === 'string' && (CONSENTS as readonly string[]).includes(value) ? (value as Consent) : null;
}
