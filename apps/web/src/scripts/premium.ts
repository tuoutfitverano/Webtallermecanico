/**
 * Diseño «premium» (/premium): cabecera al bajar, menú del móvil,
 * paralaje suave de las capturas y progreso de la línea del proceso.
 * Sin JavaScript todo se ve (menú abierto, línea completa). Con «reducir
 * movimiento» no hay paralaje ni línea animada.
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

const layers = reduced ? [] : [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
const stack = document.querySelector<HTMLElement>('[data-pm-stack]');
const steps = document.querySelector<HTMLElement>('[data-pm-progress]');

let queued = false;
function update() {
  queued = false;
  const vh = innerHeight;
  header?.classList.toggle('is-scrolled', scrollY > 24);

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
