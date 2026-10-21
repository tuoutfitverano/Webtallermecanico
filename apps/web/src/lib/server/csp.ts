/**
 * Política de seguridad de contenidos (CSP) de todas las respuestas.
 *
 *  · Scripts: solo los archivos de la propia web, Turnstile (antispam de
 *    Cloudflare) y los scripts en línea de lib/inline-scripts.ts, por su
 *    huella SHA-256. Un script inyectado en la página (XSS) no se ejecuta.
 *  · Sin incrustar la web en otras, sin <base> ajeno, sin plugins y los
 *    formularios solo envían a la propia web.
 *  · Los estilos no se restringen: la web usa atributos style="" y no
 *    ejecutan código.
 */
import { INLINE_SCRIPTS } from '../inline-scripts.ts';

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const BASE = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function buildCsp(scripts: readonly string[] = INLINE_SCRIPTS): Promise<string> {
  const hashes = await Promise.all(scripts.map(async s => `'sha256-${await sha256Base64(s)}'`));
  return `${BASE}; script-src 'self' ${TURNSTILE_ORIGIN} ${hashes.join(' ')}`;
}

// Se calcula una vez por proceso: los textos no cambian.
let cached: Promise<string> | null = null;
export function contentSecurityPolicy(): Promise<string> {
  cached ??= buildCsp();
  return cached;
}
