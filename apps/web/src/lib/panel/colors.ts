/**
 * Colores del panel y del portal que puede elegir cada persona.
 *
 * Solo cambian las superficies (barra lateral, tarjetas y menús), que hoy son
 * verdes; el fondo sigue negro. En los tonos pastel el texto de las tarjetas
 * pasa a oscuro (panel.css). La elección se guarda en este dispositivo (cookie
 * «color_panel» y, para la vista previa sin servidor, localStorage): no es un
 * dato personal ni cambia nada de la cuenta.
 */
export const PANEL_COLORS = [
  { id: 'verde', label: 'Verde', swatch: '#1F4536' },
  { id: 'salvia', label: 'Salvia', swatch: '#DCE7D6' },
  { id: 'menta', label: 'Menta', swatch: '#CFEBDD' },
  { id: 'cielo', label: 'Cielo', swatch: '#D4E4F5' },
  { id: 'lavanda', label: 'Lavanda', swatch: '#E3DCF4' },
  { id: 'rosa', label: 'Rosa', swatch: '#F5DCE2' },
  { id: 'melocoton', label: 'Melocotón', swatch: '#F8DFCB' },
  { id: 'arena', label: 'Arena', swatch: '#EFE7D4' },
] as const;

export type PanelColor = (typeof PANEL_COLORS)[number]['id'];
export const DEFAULT_PANEL_COLOR: PanelColor = 'verde';
export const PANEL_COLOR_COOKIE = 'color_panel';

export function isPanelColor(value: unknown): value is PanelColor {
  return typeof value === 'string' && PANEL_COLORS.some(c => c.id === value);
}

/** El color guardado si es válido; si no, el de siempre (verde). */
export function panelColor(value: unknown): PanelColor {
  return isPanelColor(value) ? value : DEFAULT_PANEL_COLOR;
}
