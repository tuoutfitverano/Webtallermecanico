/**
 * Lectura del cuerpo de una petición con un límite REAL de bytes.
 *
 * `request.text()` o `formData()` leen el cuerpo entero antes de poder medirlo
 * (y `text.length` cuenta caracteres, no bytes). Aquí se rechaza si la longitud
 * declarada ya supera el límite y, si no se declara (o miente), se lee por
 * partes y se corta la lectura en cuanto se pasa: nunca se guarda en memoria
 * más de `maxBytes` (+ el último trozo recibido).
 */

/** Límite general de cualquier POST (el mayor de los endpoints: webhook de WhatsApp). */
export const MAX_POST_BYTES = 300_000;
/** Formularios del área privada (el campo más largo admite 4.000 caracteres). */
export const MAX_FORM_BYTES = 128 * 1024;

/** Longitud declarada mayor que el límite (o no numérica). Sin cabecera: false (se mide al leer). */
export function declaredTooLarge(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get('content-length');
  if (raw === null) return false;
  if (!/^\d{1,15}$/.test(raw.trim())) return true;
  return Number(raw) > maxBytes;
}

/** Bytes del cuerpo, o null si supera `maxBytes`. */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (declaredTooLarge(request, maxBytes)) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Texto UTF-8 del cuerpo, o null si supera `maxBytes` (en bytes, no en caracteres). */
export async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readBodyBytes(request, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** Formulario (urlencoded o multipart) con límite; null si es demasiado grande o no se entiende. */
export async function readFormLimited(request: Request, maxBytes: number = MAX_FORM_BYTES): Promise<FormData | null> {
  const bytes = await readBodyBytes(request, maxBytes).catch(() => null);
  if (bytes === null) return null;
  const type = request.headers.get('content-type') ?? '';
  return new Response(bytes, { headers: { 'content-type': type } }).formData().catch(() => null);
}
