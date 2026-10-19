/** Comprueba "Authorization: Bearer <secreto>" en tiempo constante. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = header.slice(7);
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
