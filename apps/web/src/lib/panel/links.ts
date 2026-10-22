/** Estado del acceso de un cliente a su área (customer_link_overview), con textos para el panel. */
export type LinkStatus = 'activa' | 'pendiente' | 'caducada' | 'revocada' | 'sin_cuenta';

export const LINK_STATUS: Record<LinkStatus, { short: string; long: string; tone: string }> = {
  activa: { short: 'Cuenta activa', long: 'Ha activado su cuenta y ve su área de cliente.', tone: 'pill-ok' },
  pendiente: { short: 'Invitación pendiente', long: 'Tiene una invitación sin aceptar todavía.', tone: 'pill-warn' },
  caducada: { short: 'Invitación caducada', long: 'Su invitación caducó sin usarse. Puedes crear otra.', tone: 'pill-bad' },
  revocada: { short: 'Acceso retirado', long: 'Tuvo acceso y se le retiró. La ficha y su historial se conservan.', tone: '' },
  sin_cuenta: { short: 'Sin acceso', long: 'Todavía no tiene acceso a su área de cliente.', tone: '' },
};
