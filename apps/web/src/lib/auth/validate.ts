/**
 * Comprobaciones básicas de los formularios de acceso. Supabase Auth vuelve a
 * comprobarlo todo; esto solo sirve para avisar pronto y con claridad.
 */
// Igual que supabase/config.toml (minimum_password_length y password_requirements).
export const PASSWORD_MIN = 10;
// bcrypt (el algoritmo de Supabase Auth) solo usa los primeros 72 bytes.
export const PASSWORD_MAX = 72;

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Escribe una contraseña.';
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return `La contraseña es demasiado larga (máximo ${PASSWORD_MAX} caracteres).`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La contraseña debe tener mayúsculas, minúsculas y números.';
  }
  return null;
}

export function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export const ROLE_LABELS = {
  propietario: 'Propietario/a',
  administrador: 'Administrador/a',
  mecanico: 'Mecánico/a',
  recepcionista: 'Recepción',
} as const;
export type MemberRole = keyof typeof ROLE_LABELS;
export const INVITABLE_ROLES: readonly MemberRole[] = ['administrador', 'recepcionista', 'mecanico'];
export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && value in ROLE_LABELS;
}
