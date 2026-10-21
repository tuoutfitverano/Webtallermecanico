/**
 * Vista previa sin servidor: lleva de una página a otra lo que la persona elige
 * (modo claro u oscuro, color del panel y respuesta al aviso de cookies).
 *
 * En la app de Claude la vista previa puede no tener cookies ni localStorage
 * entre páginas, así que la elección viaja también en el propio enlace
 * (?vp=modo.color.cookies), en window.name y en sessionStorage (duran lo que la
 * pestaña). En la web
 * desplegada no hace falta nada de esto: lo guarda el servidor (cookies).
 * Solo se guarda en localStorage si se han aceptado las cookies de preferencias.
 * El script en línea de state-inline.js lo aplica antes de pintar cada página.
 */
type State = { t?: string; c?: string; k?: string };
const state: State = ((window as unknown as { __vp?: State }).__vp ??= {});

const encode = () => `${state.t ?? '-'}.${state.c ?? '-'}.${state.k ?? '-'}`;
const hasState = () => Boolean(state.t || state.c || state.k);

function save() {
  const v = encode();
  try { window.name = `vp:${v}`; } catch { /* sin window.name: queda el enlace */ }
  try { sessionStorage.setItem('vp', v); } catch { /* sin almacenamiento de la visita */ }
  try { if (state.k === 'aceptadas') localStorage.setItem('vp', v); else localStorage.removeItem('vp'); } catch { /* sin almacenamiento */ }
}

/** El enlace (o la dirección) con la elección actual, para la siguiente página. */
export function withState(href: string): string {
  if (!hasState() || !/^[\w\-./]+\.html(#.*)?$/.test(href)) return href;
  const [path, hash] = href.split('#');
  return `${path}?vp=${encode()}${hash ? `#${hash}` : ''}`;
}

addEventListener('tema', e => { state.t = (e as CustomEvent<string>).detail; save(); });
addEventListener('cookies', e => { state.k = (e as CustomEvent<string>).detail; save(); });
document.addEventListener('click', e => {
  const target = e.target as Element;
  const color = target.closest<HTMLButtonElement>('.color-pick-option');
  if (color) { state.c = color.value; save(); return; }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || link.dataset.vpOff !== undefined) return;
  const href = link.getAttribute('href')!;
  const next = withState(href);
  if (next !== href) link.setAttribute('href', next);
}, true);
