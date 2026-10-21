/**
 * Modo claro u oscuro, elegido por cada persona (botón con sol/luna en la web,
 * el acceso, el panel y el portal). Se guarda en este dispositivo (cookie «tema»
 * y, para la vista previa sin servidor, localStorage); no es un dato personal.
 *
 * Se mantiene en todas las páginas durante la visita; con las cookies de
 * preferencias aceptadas, 1 año (lib/consent.ts).
 *
 * Sin elección, cada zona usa el suyo: el área privada (acceso, panel del
 * taller y portal del cliente), claro; la web pública, oscuro.
 */
export const THEMES = ['oscuro', 'claro'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = 'tema';

/** Modo predeterminado de cada zona cuando la persona no ha elegido. */
export const DEFAULT_THEME = { web: 'oscuro', panel: 'claro', portal: 'claro', acceso: 'claro' } as const satisfies Record<string, Theme>;

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** El modo guardado si es válido; si no, el predeterminado de la zona. */
export function themeFor(value: unknown, fallback: Theme): Theme {
  return isTheme(value) ? value : fallback;
}

/** Color de la barra del navegador en móvil (meta theme-color) para cada modo. */
export const THEME_BAR: Record<Theme, string> = { oscuro: '#000000', claro: '#F5F1E9' };
