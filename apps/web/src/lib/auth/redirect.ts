/**
 * Redirecciones seguras después de iniciar sesión, confirmar el correo, etc.
 *
 * El destino llega en un parámetro (`next`) que cualquiera puede manipular.
 * Solo se acepta una ruta del MISMO sitio; cualquier otra cosa (otro dominio,
 * "//evil.com", "/\evil.com", "javascript:"…) se sustituye por el destino por
 * defecto. Así nadie puede usar nuestros enlaces para mandar a la gente a
 * una web falsa.
 */
export const DEFAULT_AFTER_LOGIN = '/panel';

export function safeNext(raw: unknown, origin: string, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value || value.length > 1000) return fallback;
  // Caracteres de control o barras invertidas: los navegadores los "arreglan" de formas peligrosas.
  if (value.includes('\\') || [...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return fallback;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Nunca volver a las propias pantallas de acceso (evita bucles).
  if (/^\/(acceso|registro|salir|auth\/)/.test(url.pathname)) return fallback;
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}

/** Ruta actual (para volver a ella después de iniciar sesión). */
export function currentPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/** Enlace a la pantalla de acceso que, al terminar, vuelve a `path`. */
export function loginUrl(path: string): string {
  return `/acceso?next=${encodeURIComponent(path)}`;
}
