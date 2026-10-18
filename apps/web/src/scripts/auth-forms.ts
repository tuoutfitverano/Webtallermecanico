/**
 * Mejora los formularios del área privada (funcionan también sin JavaScript):
 *  · Al enviar, bloquea el botón y muestra un texto de espera (evita envíos dobles).
 *  · Botones "Copiar" para los enlaces de invitación.
 * El resultado lo decide siempre el servidor: aquí no se da nada por hecho.
 */
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-busy]')) {
  form.addEventListener('submit', e => {
    if (form.getAttribute('aria-busy') === 'true') {
      e.preventDefault();
      return;
    }
    const button = (e.submitter as HTMLButtonElement | null) ?? form.querySelector<HTMLButtonElement>('button[type=submit]');
    form.setAttribute('aria-busy', 'true');
    if (button) {
      // Se desactiva en el siguiente ciclo para no perder el name/value del botón pulsado.
      setTimeout(() => {
        button.disabled = true;
        button.classList.add('is-busy');
        const label = button.querySelector<HTMLElement>('[data-label]');
        if (label && form.dataset.busy) label.textContent = form.dataset.busy;
      }, 0);
    }
  });
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
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
