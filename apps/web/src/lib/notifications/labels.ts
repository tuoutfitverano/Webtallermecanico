/** Textos de los avisos para el panel y el portal (valores de la base de datos → español claro). */

export const NOTIFICATION_EVENTS = ['vehiculo_recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  vehiculo_recibido: 'Vehículo recibido (orden creada)',
  diagnosis: 'En diagnosis',
  esperando_recambios: 'Esperando recambios',
  en_reparacion: 'En reparación',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
};

export type NotificationStatus = 'pendiente' | 'procesando' | 'enviado' | 'entregado' | 'fallido' | 'cancelado';
export const STATUS_LABELS: Readonly<Record<NotificationStatus, string>> = {
  pendiente: 'Pendiente',
  procesando: 'Enviándose',
  enviado: 'Enviado al proveedor',
  entregado: 'Entregado',
  fallido: 'Fallido',
  cancelado: 'Cancelado',
};

export const CHANNEL_LABELS: Readonly<Record<string, string>> = { app: 'Portal', email: 'Email' };

/** Motivo general (sin detalles técnicos ni datos personales). */
export const ERROR_LABELS: Readonly<Record<string, string>> = {
  no_disponible: 'El proveedor de email no respondía',
  limite_proveedor: 'Límite de envíos del proveedor',
  credenciales: 'Configuración del proveedor incorrecta',
  rechazado: 'El proveedor rechazó el email (dirección no válida)',
  conflicto: 'Envío duplicado detectado',
  error: 'Error inesperado',
  reintentos_agotados: 'Se agotaron los reintentos',
  rebotado: 'La dirección rechazó el email (rebote)',
  queja: 'El cliente lo marcó como spam: se han desactivado sus emails',
  fallido: 'El proveedor no pudo entregarlo',
  sustituida: 'Sustituido por un aviso más reciente',
  estado_corregido: 'El estado se corrigió antes de enviarlo',
  caducada: 'No se envió a tiempo (más de 2 días)',
  preferencia: 'El cliente no quiere avisos por email',
  sin_consentimiento: 'Sin consentimiento comercial',
  desactivado: 'Email desactivado en el taller',
  taller_suspendido: 'Taller suspendido',
};
