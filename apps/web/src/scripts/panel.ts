/**
 * JavaScript del panel (opcional: sin él todo funciona con formularios normales).
 *  · Bloquea el botón al enviar y muestra un texto de espera (evita dobles envíos).
 *  · El selector de taller cambia al elegir, sin pulsar "Cambiar".
 * Con la navegación de Astro (ClientRouter) se vuelve a preparar en cada página.
 */
function init() {
  for (const form of document.querySelectorAll<HTMLFormElement>('form[data-busy]')) {
    if (form.dataset.ready) continue;
    form.dataset.ready = '1';
    form.addEventListener('submit', e => {
      if (form.getAttribute('aria-busy') === 'true') {
        e.preventDefault();
        return;
      }
      form.setAttribute('aria-busy', 'true');
      const button = (e.submitter as HTMLButtonElement | null) ?? form.querySelector<HTMLButtonElement>('button[type=submit]');
      if (!button) return;
      setTimeout(() => {
        button.disabled = true;
        button.classList.add('is-busy');
        const label = button.querySelector<HTMLElement>('[data-label]');
        const busy = button.dataset.busyLabel ?? form.dataset.busy;
        if (label && busy) label.textContent = busy;
      }, 0);
    });
  }
  // Al elegir un vehículo, se propone su cliente (se puede cambiar).
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-sets-customer]')) {
    if (select.dataset.ready) continue;
    select.dataset.ready = '1';
    select.addEventListener('change', () => {
      const target = document.getElementById(select.dataset.setsCustomer ?? '') as HTMLSelectElement | null;
      const customer = select.selectedOptions[0]?.dataset.customer;
      if (target && customer) target.value = customer;
    });
  }
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-autosubmit]')) {
    if (select.dataset.ready) continue;
    select.dataset.ready = '1';
    select.addEventListener('change', () => select.form?.requestSubmit());
  }
  // Botón "Copiar" de los enlaces de invitación (si el navegador no deja, se selecciona el texto).
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    if (btn.dataset.ready) continue;
    btn.dataset.ready = '1';
    btn.addEventListener('click', async () => {
      const input = document.getElementById(btn.dataset.copy ?? '') as HTMLInputElement | null;
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
        btn.textContent = 'Copiado';
      } catch {
        input.select();
        btn.textContent = 'Selecciona y copia';
      }
    });
  }
}

document.addEventListener('astro:page-load', init);
init();
