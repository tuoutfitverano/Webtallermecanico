/**
 * Formularios de solicitud en el navegador: pestañas y avisos al corregir.
 *
 * El envío y la validación (con las mismas reglas que el servidor, que pesan)
 * están en request-forms-submit.ts y se descargan al usar un formulario: al
 * entrar en un campo, al pulsarlo o, como muy tarde, al enviar. Sin JavaScript
 * el formulario se envía igual (el servidor valida y responde).
 */
import type * as Submit from './request-forms-submit.ts';

let pending: Promise<typeof Submit> | null = null;
const load = () => (pending ??= import('./request-forms-submit.ts'));

function setupTabs(root: HTMLElement) {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const select = (kind: string, focus = false) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === kind;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
      if (on && focus) tab.focus();
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab.dataset.tab!));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
      select(next.dataset.tab!, true);
    });
  });

  // Enlaces de la página que abren una pestaña concreta (y opcionalmente un servicio).
  document.addEventListener('click', e => {
    const link = (e.target as Element).closest<HTMLElement>('[data-open-tab], [data-service]');
    if (!link) return;
    const kind = link.dataset.openTab ?? 'cita';
    select(kind);
    if (link.dataset.service) {
      const sel = document.querySelector<HTMLSelectElement>(`#solicitar-${kind} select[name="service"]`);
      if (sel) sel.value = link.dataset.service;
    }
  });
  const fromHash = location.hash.match(/^#solicitar-(cita|presupuesto|contacto)$/);
  select(fromHash ? fromHash[1]! : 'cita');
}

function setupForm(form: HTMLFormElement) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    void load().then(m => m.submit(form));
  });
  // Al empezar a usarlo se descarga ya la validación, antes de pulsar Enviar.
  form.addEventListener('focusin', () => void load(), { once: true });
  form.addEventListener('pointerdown', () => void load(), { once: true });
  // Al corregir un campo, su error desaparece.
  form.addEventListener('input', e => {
    const wrap = (e.target as Element).closest<HTMLElement>('[data-field]');
    if (!wrap?.classList.contains('has-error')) return;
    wrap.classList.remove('has-error');
    const err = form.querySelector<HTMLElement>(`#${form.dataset.kind}-err-${wrap.dataset.field}`);
    if (err) err.hidden = true;
    if (['phone', 'email'].includes(wrap.dataset.field!)) {
      const group = form.querySelector<HTMLElement>(`#${form.dataset.kind}-err-contact`);
      if (group) group.hidden = true;
      form.querySelector('[data-field="contact"]')?.classList.remove('has-error');
    }
  });
  const panel = form.parentElement!;
  panel.querySelector('[data-again]')?.addEventListener('click', () => void load().then(m => m.again(form)));
}

// Formularios del taller (con pestañas) y, en la web de demostración, el de digitalización.
const root = document.querySelector<HTMLElement>('[data-req]');
if (root) {
  root.classList.add('js');
  setupTabs(root);
}
document.querySelectorAll<HTMLFormElement>('[data-req-form]').forEach(setupForm);
