/**
 * Mensajes de error comprensibles. Se elige el texto a partir del CÓDIGO del
 * error (nunca se muestra el mensaje técnico tal cual).
 */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'El correo o la contraseña no son correctos.',
  email_not_confirmed: 'Todavía no has confirmado tu correo. Abre el enlace que te enviamos (revisa también la carpeta de spam).',
  user_already_exists: 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.',
  email_exists: 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.',
  weak_password: 'La contraseña es demasiado débil. Usa al menos 10 caracteres con mayúsculas, minúsculas y números.',
  same_password: 'La nueva contraseña tiene que ser distinta de la actual.',
  over_email_send_rate_limit: 'Hemos enviado demasiados correos seguidos. Espera unos minutos y vuelve a intentarlo.',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  otp_expired: 'El enlace ha caducado o ya se ha usado. Pide uno nuevo.',
  flow_state_expired: 'El enlace ha caducado. Pide uno nuevo.',
  flow_state_not_found: 'El enlace ya se ha usado o no es válido. Pide uno nuevo.',
  bad_code_verifier: 'Abre el enlace en el mismo navegador donde lo pediste, o pide uno nuevo.',
  signup_disabled: 'El registro está cerrado. Pide una invitación al taller.',
  email_address_invalid: 'Ese correo electrónico no es válido.',
  reauthentication_needed: 'Por seguridad, vuelve a iniciar sesión antes de cambiar la contraseña.',
  session_not_found: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  captcha_failed: 'No se ha superado la comprobación anti-robots. Inténtalo de nuevo.',
  user_banned: 'Esta cuenta está bloqueada. Contacta con el taller o con la plataforma.',
};

export const GENERIC_AUTH_ERROR = 'No se ha podido completar. Inténtalo de nuevo en unos minutos.';
export const AUTH_UNAVAILABLE = 'El servicio de acceso no está disponible en este momento. Inténtalo más tarde.';

export interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
}

export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return GENERIC_AUTH_ERROR;
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]!;
  // Sin respuesta del servidor de Auth (caído, sin red, mal configurado).
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status ?? 0) >= 500) return AUTH_UNAVAILABLE;
  return GENERIC_AUTH_ERROR;
}

/**
 * Errores de las funciones de base de datos (invitaciones, equipo). Esas
 * funciones lanzan mensajes escritos por nosotros con códigos conocidos:
 * solo esos se muestran; cualquier otro error se sustituye por uno genérico.
 */
const SAFE_DB_CODES = new Set(['42501', '22023', '23505', 'PT429']);

export function dbErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code && SAFE_DB_CODES.has(error.code) && error.message) return error.message;
  return GENERIC_AUTH_ERROR;
}
