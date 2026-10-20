/**
 * Comportamiento de la vista previa estática (sin servidor ni base de datos).
 * Nada se guarda ni se finge guardar: cada acción explica que es una vista previa.
 */
import '../../apps/web/src/scripts/panel.ts';
import '../../apps/web/src/scripts/panel-color.ts';
import '../../apps/web/src/scripts/theme.ts';

function toast(text: string) {
  let box = document.getElementById('vp-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'vp-toast';
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100;max-width:min(92vw,520px);padding:12px 16px;border-radius:14px;background:#fde68a;color:#0a0a0b;font:500 .9rem/1.4 Barlow,system-ui,sans-serif;box-shadow:0 10px 30px rgb(0 0 0 / .5)';
    document.body.append(box);
  }
  box.textContent = text;
  box.hidden = false;
  clearTimeout(Number(box.dataset.t));
  box.dataset.t = String(setTimeout(() => { box!.hidden = true; }, 4500));
}

document.addEventListener('submit', e => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (form.dataset.vpLogout !== undefined) {
    location.href = 'acceso.html';
    return;
  }
  toast(form.method.toLowerCase() === 'get'
    ? 'Vista previa: las búsquedas y filtros funcionan en la web desplegada. Aquí se ven los datos de demostración.'
    : 'Vista previa: aquí no se guarda nada. En la web desplegada este botón guarda los cambios en la base de datos.');
}, true);

document.addEventListener('click', e => {
  const link = (e.target as Element).closest('a[data-vp-off]');
  if (!link) return;
  e.preventDefault();
  toast('Esta pantalla no está incluida en la vista previa.');
}, true);
