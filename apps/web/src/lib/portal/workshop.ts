/**
 * Taller elegido en el portal del cliente (multitaller). Solo es una
 * preferencia: se elige entre los talleres a los que la cuenta YA está
 * vinculada; un identificador ajeno o mal formado se ignora.
 */
export const PORTAL_WORKSHOP_COOKIE = 'portal_taller';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?taller= (si es uno de los suyos), si no la cookie, si no el primero. */
export function pickWorkshop<T extends { workshop_id: string }>(records: T[], asked: string | null | undefined, remembered: string | null | undefined): T | null {
  const find = (id: string | null | undefined) => (id && UUID.test(id) ? records.find(r => r.workshop_id === id.toLowerCase()) : undefined);
  return find(asked) ?? find(remembered) ?? records[0] ?? null;
}

/**
 * Código de invitación a partir de lo que pega el cliente: el enlace completo
 * (…/portal/invitacion?token=…) o solo el código. null si no lo parece.
 */
export function invitationToken(input: string): string | null {
  const text = input.trim();
  let token = text;
  const m = /[?&]token=([^&#\s]+)/.exec(text);
  if (m) {
    try { token = decodeURIComponent(m[1]!); } catch { return null; }
  }
  return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : null;
}
