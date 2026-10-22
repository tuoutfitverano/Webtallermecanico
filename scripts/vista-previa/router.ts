/**
 * Vista previa: el panel y el portal cambian de sección SIN recargar la página,
 * como hace el ClientRouter en la web desplegada. Así el modo claro u oscuro, el
 * color y la respuesta a las cookies siguen en memoria al pasar de «Inicio» a
 * «Vehículos»: en la app de Claude cada página nueva puede llegar sin
 * almacenamiento y sin la parte «?vp=» del enlace, y la elección se perdía.
 *
 * Solo entre pantallas de la misma cuenta de demostración (t-, w- o c-); lo
 * demás (web pública, acceso) se abre como siempre. Si algo falla, también.
 */
const APP_PAGE = /^([tcw])-[\w-]+\.html$/;
/** Lo que eligió la persona: no lo cambia la página nueva (viene con los valores por defecto). */
const KEEP = ['data-theme', 'data-color', 'data-cookies'];

const fileOf = (href: string) => href.split(/[?#]/)[0]!.split('/').pop() ?? '';
const roleOf = (file: string) => APP_PAGE.exec(file)?.[1] ?? null;

let busy = false;

async function swap(file: string, hash: string, push: boolean): Promise<boolean> {
  let html: string;
  try {
    const res = await fetch(file);
    if (!res.ok) return false;
    html = await res.text();
  } catch {
    return false;
  }
  const next = new DOMParser().parseFromString(html, 'text/html');
  const root = document.documentElement;

  // Hojas de estilo: primero se cargan las nuevas y después se quitan las que sobran (sin destellos).
  const sheets = (doc: Document) => Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  const have = new Set(sheets(document).map(l => l.getAttribute('href')));
  const want = new Set(sheets(next).map(l => l.getAttribute('href')));
  await Promise.all(sheets(next).filter(l => !have.has(l.getAttribute('href'))).map(l => new Promise<void>(resolve => {
    const link = document.importNode(l, true);
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.append(link);
  })));
  for (const l of sheets(document)) if (!want.has(l.getAttribute('href'))) l.remove();
  for (const s of document.head.querySelectorAll('style')) s.remove();
  for (const s of next.head.querySelectorAll('style')) document.head.append(document.importNode(s, true));

  for (const { name } of Array.from(root.attributes)) if (!KEEP.includes(name) && !next.documentElement.hasAttribute(name)) root.removeAttribute(name);
  for (const { name, value } of Array.from(next.documentElement.attributes)) if (!KEEP.includes(name)) root.setAttribute(name, value);
  document.title = next.title;
  for (const s of next.body.querySelectorAll('script')) s.remove();
  document.body.replaceWith(document.importNode(next.body, true));

  if (push) {
    try { history.pushState({ vp: file }, '', file + hash); } catch { /* sin historial: la pantalla cambia igual */ }
  }
  const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  if (target) target.scrollIntoView(); else scrollTo(0, 0);
  // Los scripts del panel y del portal ya escuchan estos eventos (los del ClientRouter).
  document.dispatchEvent(new Event('astro:after-swap'));
  document.dispatchEvent(new Event('astro:page-load'));
  return true;
}

document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || busy) return;
  const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!link || link.target || link.hasAttribute('download')) return;
  const href = link.getAttribute('href')!;
  const file = fileOf(href);
  const role = roleOf(file);
  if (!role || role !== roleOf(fileOf(location.pathname))) return;
  e.preventDefault();
  busy = true;
  const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  void swap(file, hash, true).then(ok => { if (!ok) location.href = href; }).finally(() => { busy = false; });
});

addEventListener('popstate', () => {
  const file = fileOf(location.pathname);
  if (!roleOf(file)) return;
  void swap(file, location.hash, false).then(ok => { if (!ok) location.reload(); });
});
