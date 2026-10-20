/**
 * Modo claro / oscuro: aplica la elección al instante (sin recargar) y la recuerda
 * en este dispositivo si se han aceptado las cookies de preferencias (cookie para
 * el servidor y localStorage para la vista previa sin servidor); si no, dura lo
 * que dure la visita. Avisa con el evento «tema» (el coche que gira vuelve a
 * pintar su fondo). Sin JavaScript, el formulario del botón hace lo mismo.
 */
import { isTheme, THEME_COOKIE, type Theme } from '../lib/theme.ts';
import { rememberPreference } from './consent.ts';

const current = (): Theme => (isTheme(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'oscuro');

function sync(theme: Theme) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) b.value = theme === 'claro' ? 'oscuro' : 'claro';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'claro' ? 'light' : 'dark');
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = bar?.dataset[theme];
  if (bar && color) bar.content = color;
}

/** Elegido en esta visita: se vuelve a aplicar en cada cambio de página del panel y del portal. */
let chosen: Theme | null = null;

document.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-theme-toggle]');
  if (!btn) return;
  e.preventDefault();
  const theme: Theme = current() === 'claro' ? 'oscuro' : 'claro';
  document.documentElement.dataset.theme = theme;
  chosen = theme;
  sync(theme);
  rememberPreference(THEME_COOKIE, theme);
  dispatchEvent(new CustomEvent('tema', { detail: theme }));
});

// El modo puede venir de localStorage (vista previa) y no del servidor: botones y barra al día.
sync(current());
document.addEventListener('astro:after-swap', () => { if (chosen) document.documentElement.dataset.theme = chosen; });
document.addEventListener('astro:page-load', () => sync(current()));
