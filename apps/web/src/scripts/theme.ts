/**
 * Modo claro / oscuro: aplica la elección al instante (sin recargar) y la recuerda
 * en este dispositivo (cookie para el servidor y localStorage para la vista previa
 * sin servidor). Avisa con el evento «tema» (el coche que gira vuelve a pintar su
 * fondo). Sin JavaScript, el formulario del botón hace lo mismo.
 */
import { isTheme, THEME_COOKIE, type Theme } from '../lib/theme.ts';

const current = (): Theme => (isTheme(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'oscuro');

function sync(theme: Theme) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) b.value = theme === 'claro' ? 'oscuro' : 'claro';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'claro' ? 'light' : 'dark');
  const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const color = bar?.dataset[theme];
  if (bar && color) bar.content = color;
}

function remember(theme: Theme) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`; } catch { /* sin cookies: vale con localStorage */ }
  try { localStorage.setItem(THEME_COOKIE, theme); } catch { /* sin almacenamiento: vale con la cookie */ }
}

document.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-theme-toggle]');
  if (!btn) return;
  e.preventDefault();
  const theme: Theme = current() === 'claro' ? 'oscuro' : 'claro';
  document.documentElement.dataset.theme = theme;
  sync(theme);
  remember(theme);
  dispatchEvent(new CustomEvent('tema', { detail: theme }));
});

// El modo puede venir de localStorage (vista previa) y no del servidor: botones y barra al día.
sync(current());
document.addEventListener('astro:page-load', () => sync(current()));
