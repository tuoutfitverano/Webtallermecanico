/**
 * Registro estructurado (una línea JSON por evento) para Cloudflare Workers
 * Logs o cualquier recogedor de registros.
 *
 *  · Solo códigos de evento y datos técnicos (códigos de error, recuentos,
 *    duración, ruta sin identificadores): NUNCA datos del formulario, correos,
 *    teléfonos, matrículas ni tokens.
 *  · `level` sale del nombre: `*_error` / `*_excepcion` → error; si no, info.
 *    Así se puede montar una alerta con un filtro «level = error».
 */
export type LogValue = string | number | boolean;
export type LogLevel = 'info' | 'warn' | 'error';

export function levelFor(event: string): LogLevel {
  return /(_error|_excepcion|_exception)(_|$)/.test(event) ? 'error' : 'info';
}

export function logLine(event: string, meta: Record<string, LogValue> = {}, now = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level: levelFor(event), event, ...meta });
}

export function logEvent(event: string, meta: Record<string, LogValue> = {}): void {
  const line = logLine(event, meta);
  if (levelFor(event) === 'error') console.error(line);
  else console.info(line);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Ruta sin nada que identifique a nadie: sin la consulta (?…), con los
 * identificadores como «:id» y los códigos secretos (enlaces de presupuesto,
 * invitaciones) como «:código».
 */
export function safePath(pathname: string): string {
  return pathname
    .replace(UUID, ':id')
    .split('/')
    .map(part => (part.length >= 20 && /^[A-Za-z0-9_-]+$/.test(part) ? ':código' : part))
    .join('/')
    .slice(0, 120);
}

/** Identificador de la petición: el de Cloudflare (cf-ray) si viene; si no, uno nuevo. */
export function requestId(request: Request): string {
  const ray = request.headers.get('cf-ray');
  return ray && /^[A-Za-z0-9-]{8,64}$/.test(ray) ? ray : crypto.randomUUID();
}
