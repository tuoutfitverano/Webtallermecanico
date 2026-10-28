/**
 * Notificaciones en el móvil (Web Push, RFC 8030 + VAPID RFC 8292), sin
 * proveedor de pago: se envía un «toque» VACÍO al servicio de notificaciones
 * del navegador del cliente (Google, Apple, Mozilla…). Sin datos dentro: al
 * recibirlo, el propio móvil pide el aviso a la web con su sesión (public/sw.js).
 *
 * La firma VAPID (JWT ES256) identifica a la plataforma ante esos servicios.
 * Claves: VAPID_PUBLIC_KEY (la ve el navegador) y VAPID_PRIVATE_KEY (secreta),
 * en base64url; se crean con `node scripts/push/claves.mjs`.
 */

export interface VapidKeys {
  /** Punto público P-256 sin comprimir (65 bytes), base64url. */
  publicKey: string;
  /** Escalar privado (32 bytes), base64url. */
  privateKey: string;
  /** Contacto de la plataforma: https://… o mailto:… */
  subject: string;
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** ¿Las claves tienen la forma correcta? (no se usa una clave rota) */
export function validVapidKeys(keys: VapidKeys): boolean {
  try {
    const pub = fromB64url(keys.publicKey);
    const priv = fromB64url(keys.privateKey);
    return pub.length === 65 && pub[0] === 4 && priv.length === 32 && /^(https:\/\/|mailto:)\S+$/.test(keys.subject);
  } catch {
    return false;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  let key = keyCache.get(keys.privateKey);
  if (!key) {
    const pub = fromB64url(keys.publicKey);
    key = crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: false,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    keyCache.set(keys.privateKey, key);
  }
  return key;
}

/** Cabecera Authorization «vapid t=<JWT>, k=<clave pública>» para un servicio (origen del endpoint). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: keys.subject,
  })}`;
  // WebCrypto firma ECDSA en formato «r||s» (64 bytes), justo el que pide JWT.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(keys), new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

/**
 * Servicios de notificaciones de los navegadores. Solo a ellos se envían los
 * «toques»: una dirección cualquiera (https://otra-web/…) haría que el servidor
 * llamara, firmado, a sitios ajenos. En pruebas, el servicio simulado escucha
 * en 127.0.0.1 (http), inalcanzable desde Cloudflare.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
export function isKnownPushService(endpoint: string): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === 'http:') return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return url.protocol === 'https:' && (url.port === '' || url.port === '443') && PUSH_HOSTS.some(h => h.test(url.hostname));
}

/**
 * Envía el «toque» a un dispositivo. Devuelve el código HTTP del servicio del
 * navegador (201 = aceptado; 404/410 = el dispositivo ya no existe) o 0 si no
 * hubo respuesta.
 */
export async function sendPush(endpoint: string, keys: VapidKeys, opts: { timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<number> {
  const doFetch = opts.fetch ?? fetch;
  // Dirección que no es de un servicio de notificaciones: no se llama y se da por desaparecida (se borra).
  if (!isKnownPushService(endpoint)) return 410;
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { authorization: await vapidAuthorization(endpoint, keys), ttl: '86400', urgency: 'normal', 'content-length': '0' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    return res.status;
  } catch {
    return 0;
  }
}
