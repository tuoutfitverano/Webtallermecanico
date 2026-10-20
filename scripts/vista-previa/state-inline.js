/* global __COLORS__ -- lo sustituye build.py por la lista de colores de lib/panel/colors.ts */
// Vista previa: aplica antes de pintar la elección que viene de la página anterior
// (?vp=modo.color.cookies, window.name o localStorage). Ver state.ts.
(() => {
  const root = document.documentElement;
  const lists = { t: ['claro', 'oscuro'], c: __COLORS__, k: ['aceptadas', 'rechazadas'] };
  const parse = raw => {
    if (!raw) return {};
    const [t, c, k] = String(raw).split('.');
    const out = {};
    for (const [key, value] of [['t', t], ['c', c], ['k', k]]) if (lists[key].includes(value)) out[key] = value;
    return out;
  };
  const read = f => { try { return f(); } catch { return null; } };
  const fromUrl = parse(read(() => new URLSearchParams(location.search).get('vp')));
  const fromName = parse(read(() => (window.name.startsWith('vp:') ? window.name.slice(3) : '')));
  const fromStorage = parse(read(() => localStorage.getItem('vp')));
  const state = {};
  for (const key of ['t', 'c', 'k']) {
    const v = fromUrl[key] ?? fromName[key] ?? fromStorage[key];
    if (v) state[key] = v;
  }
  if (state.t) root.dataset.theme = state.t;
  if (state.c && root.hasAttribute('data-color')) root.dataset.color = state.c;
  if (state.k) root.dataset.cookies = state.k;
  window.__vp = state;
})();
