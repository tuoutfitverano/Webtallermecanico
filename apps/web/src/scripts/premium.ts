/**
 * Diseño «premium»: cabecera al bajar, menú del móvil, recorrido por las
 * pantallas del software, paralaje suave de las capturas, salida «desde la
 * ventanilla» hacia el software y progreso de la línea del proceso.
 * Sin JavaScript todo se ve (menú abierto, todas las pantallas, línea
 * completa). Con «reducir movimiento» no hay paralaje ni animaciones.
 */
const root = document.documentElement;
root.classList.add('pm-js');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const header = document.querySelector<HTMLElement>('[data-pm-header]');
const menu = document.querySelector<HTMLButtonElement>('[data-pm-menu]');
const nav = document.getElementById('pm-nav');

function setMenu(open: boolean) {
  if (!menu || !nav) return;
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
}

menu?.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
nav?.addEventListener('click', e => {
  if ((e.target as Element).closest('a')) setMenu(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menu.focus();
  }
});

// Recorrido por las pantallas: pestañas accesibles (flechas, Inicio, Fin) y botones anterior/siguiente.
function setupTour(tour: HTMLElement) {
  const tabs = [...tour.querySelectorAll<HTMLButtonElement>('[data-pm-tab]')];
  const panels = [...tour.querySelectorAll<HTMLElement>('[data-pm-panel]')];
  const counter = tour.querySelector<HTMLElement>('[data-pm-tour-n]');
  if (tabs.length < 2) return;
  let current = 0;
  const select = (i: number, focus = false) => {
    current = (i + tabs.length) % tabs.length;
    tabs.forEach((t, k) => {
      const on = k === current;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k]?.classList.toggle('is-off', !on);
      panels[k]?.toggleAttribute('inert', !on);
    });
    if (counter) counter.textContent = String(current + 1).padStart(2, '0');
    if (focus) tabs[current]!.focus();
    tabs[current]!.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  };
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => select(k));
    t.addEventListener('keydown', e => {
      const map: Record<string, number> = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      select(map[e.key]!, true);
    });
  });
  tour.querySelector('[data-pm-prev]')?.addEventListener('click', () => select(current - 1));
  tour.querySelector('[data-pm-next]')?.addEventListener('click', () => select(current + 1));
  for (const el of tour.querySelectorAll<HTMLElement>('[data-pm-tour-tabs], [data-pm-tour-nav]')) el.hidden = false;
  // Sin desplazar la página al empezar: se marca la primera sin scrollIntoView.
  tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === 0)); t.tabIndex = k === 0 ? 0 : -1; });
  panels.forEach((p, k) => { p.classList.toggle('is-off', k !== 0); p.toggleAttribute('inert', k !== 0); });
}
document.querySelectorAll<HTMLElement>('[data-pm-tour]').forEach(setupTour);

const layers = reduced ? [] : [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
const stack = document.querySelector<HTMLElement>('[data-pm-stack]');
const steps = document.querySelector<HTMLElement>('[data-pm-progress]');

let queued = false;
function update() {
  queued = false;
  const vh = innerHeight;
  header?.classList.toggle('is-scrolled', scrollY > 24);

  if (stack && !reduced) {
    // Al llegar desde la ventanilla tintada, las pantallas «se alejan» hasta su sitio.
    const r = stack.getBoundingClientRect();
    const enter = Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.9)));
    stack.style.transform = `scale(${(1.14 - 0.14 * enter).toFixed(4)})`;
    stack.style.opacity = (0.25 + 0.75 * enter).toFixed(3);
  }

  if (stack && layers.length) {
    const r = stack.getBoundingClientRect();
    // -1 cuando entra por abajo, 0 en el centro, 1 cuando sale por arriba.
    const t = Math.max(-1, Math.min(1, (vh / 2 - (r.top + r.height / 2)) / vh));
    for (const el of layers) {
      const k = Number(el.dataset.parallax) || 0;
      el.style.transform = `translate3d(0, ${(-t * k * r.height).toFixed(1)}px, 0)`;
    }
  }

  if (steps && !reduced) {
    const r = steps.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (vh * 0.8 - r.top) / (r.height + vh * 0.3)));
    steps.style.setProperty('--pm-progress', p.toFixed(3));
  } else if (steps) {
    steps.style.setProperty('--pm-progress', '1');
  }
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

addEventListener('scroll', queue, { passive: true });
addEventListener('resize', queue);
update();
