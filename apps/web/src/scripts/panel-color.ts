/**
 * Color del panel/portal: aplica la elección al instante (sin recargar) y la
 * recuerda en este dispositivo (cookie para el servidor y localStorage para la
 * vista previa sin servidor). Sin JavaScript, el formulario hace lo mismo.
 */
import { isPanelColor, PANEL_COLOR_COOKIE } from '../lib/panel/colors.ts';

function apply(color: string) {
  document.documentElement.dataset.color = color;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.color-pick-option')) {
    b.setAttribute('aria-pressed', String(b.value === color));
  }
}

function remember(color: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PANEL_COLOR_COOKIE}=${color}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  try { localStorage.setItem(PANEL_COLOR_COOKIE, color); } catch { /* sin almacenamiento: vale con la cookie */ }
}

document.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.color-pick-option');
  if (!btn || !isPanelColor(btn.value)) return;
  e.preventDefault();
  apply(btn.value);
  remember(btn.value);
  btn.closest('details')?.removeAttribute('open');
});

// Al cerrar el menú con Escape, el foco vuelve al botón.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector<HTMLDetailsElement>('[data-color-pick][open]');
  if (!open) return;
  open.removeAttribute('open');
  open.querySelector('summary')?.focus();
});
