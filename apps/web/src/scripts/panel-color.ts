/**
 * Color del panel/portal: aplica la elección al instante (sin recargar) y la
 * recuerda en este dispositivo si se han aceptado las cookies de preferencias
 * (cookie para el servidor y localStorage para la vista previa sin servidor).
 * Sin JavaScript, el formulario hace lo mismo.
 */
import { isPanelColor, PANEL_COLOR_COOKIE } from '../lib/panel/colors.ts';
import { rememberPreference } from './consent.ts';

/** Elegido en esta visita: se vuelve a aplicar en cada cambio de página. */
let chosen: string | null = null;

function apply(color: string) {
  document.documentElement.dataset.color = color;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.color-pick-option')) {
    b.setAttribute('aria-pressed', String(b.value === color));
  }
}


document.addEventListener('click', e => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.color-pick-option');
  if (!btn || !isPanelColor(btn.value)) return;
  e.preventDefault();
  apply(btn.value);
  chosen = btn.value;
  rememberPreference(PANEL_COLOR_COOKIE, btn.value);
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

// El menú marca el color que se ve (puede venir de localStorage, no del servidor).
const sync = () => { const c = document.documentElement.dataset.color; if (isPanelColor(c)) apply(c); };
sync();
document.addEventListener('astro:after-swap', () => { if (chosen) document.documentElement.dataset.color = chosen; });
document.addEventListener('astro:page-load', sync);
