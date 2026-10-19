/**
 * Coche que gira con el scroll y zoom final hacia la ventanilla tintada
 * (ver components/ScrollStage.astro). Dibuja fotogramas en un <canvas>.
 *
 *  · Solo se activa con JavaScript, sin «reducir movimiento» y sin ahorro de
 *    datos. Si no, se queda la imagen fija (nada depende de esto).
 *  · Los fotogramas se cargan en orden; mientras falta alguno se dibuja el
 *    cargado más cercano.
 */
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeIn = (t: number) => t * t * t;

/**
 * Tamaño aproximado de la zona de destino (la ventanilla) respecto a la imagen:
 * el zoom final la hace cubrir toda la pantalla, también en móvil (pantalla alta).
 */
const TARGET_W = 0.11;
const TARGET_H = 0.09;
const MIN_ZOOM = 16;

function enabled(): boolean {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}

function start(stage: HTMLElement) {
  const canvas = stage.querySelector<HTMLCanvasElement>('.stage-canvas');
  const dim = stage.querySelector<HTMLElement>('.stage-dim');
  const hero = stage.querySelector<HTMLElement>('.stage-content > section:first-child');
  const turnGap = stage.querySelector<HTMLElement>('.stage-gap-turn');
  const zoomGap = stage.querySelector<HTMLElement>('.stage-gap-zoom');
  const ctx = canvas?.getContext('2d');
  const src = stage.dataset.src ?? '';
  const count = Number(stage.dataset.count);
  const fx = Number(stage.dataset.focusX ?? 0.5);
  const fy = Number(stage.dataset.focusY ?? 0.5);
  if (!canvas || !ctx || !dim || !hero || !turnGap || !zoomGap || !src.includes('{n}') || !(count >= 2)) return;
  const second = turnGap.nextElementSibling as HTMLElement | null;

  document.documentElement.classList.add('stage-on');

  // ---- Fotogramas (en orden: el primero, el que se ve al cargar)
  const frames: Array<HTMLImageElement | null> = Array.from({ length: count }, () => null);
  const url = (i: number) => src.replace('{n}', String(i).padStart(3, '0'));
  let next = 0;
  const loadNext = () => {
    if (next >= count) return;
    const i = next++;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { frames[i] = img; if (i === 0) stage.classList.add('is-live'); queue(); loadNext(); };
    img.onerror = loadNext;
    img.src = url(i);
  };
  for (let k = 0; k < 4; k++) loadNext();
  const nearest = (i: number) => {
    for (let d = 0; d < count; d++) {
      const a = frames[i - d] ?? frames[i + d];
      if (a) return a;
    }
    return null;
  };

  // ---- Tamaño del lienzo
  let vw = 0, vh = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    vw = innerWidth; vh = innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    last = '';
    queue();
  };

  // ---- Dibujo según el scroll
  let last = '';
  let pending = false;
  const queue = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };
  function draw() {
    pending = false;
    const y = scrollY;
    const top = (el: Element) => el.getBoundingClientRect().top + y;
    const stageTop = top(stage);
    const heroH = hero!.offsetHeight;
    const secondTop = second ? top(second) : top(turnGap!) + turnGap!.offsetHeight;
    const zoomTop = top(zoomGap!);
    const zoomEnd = zoomTop + zoomGap!.offsetHeight - vh;

    // 1 → 2: vuelta completa
    const r0 = stageTop + heroH * 0.35;
    const r1 = secondTop - vh * 0.35;
    const turn = clamp((y - r0) / Math.max(1, r1 - r0));
    // 2 → 3: zoom hasta la ventanilla y fundido a negro
    const z0 = zoomTop - vh * 0.6;
    const zoom = clamp((y - z0) / Math.max(1, zoomEnd - z0));

    // Oscurecido: texto legible sobre el coche; coche limpio mientras gira.
    let shade: number;
    if (zoom > 0) shade = zoom < 0.25 ? lerp(0.72, 0.1, zoom / 0.25) : zoom > 0.8 ? lerp(0.1, 1, (zoom - 0.8) / 0.2) : 0.1;
    else if (y < secondTop - vh) shade = lerp(0.62, 0.05, clamp((y - stageTop) / Math.max(1, heroH * 0.5)));
    else shade = lerp(0.05, 0.72, clamp((y - (secondTop - vh)) / (vh * 0.65)));

    const index = Math.round(turn * (count - 1));
    const img = nearest(index);
    // El fotograma dibujado forma parte de la clave: al terminar de cargarse, se redibuja.
    const key = `${img ? frames.indexOf(img) : -1}|${zoom.toFixed(4)}|${shade.toFixed(3)}|${vw}x${vh}`;
    if (key === last) return;
    last = key;
    dim!.style.opacity = shade.toFixed(3);

    ctx!.fillStyle = '#000';
    ctx!.fillRect(0, 0, vw, vh);
    if (!img) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // Misma composición que la imagen fija (CSS): cubre en horizontal; en vertical, a lo ancho.
    const base = vw >= vh ? Math.max(vw / iw, vh / ih) : (vw / iw) * 1.15;
    const maxZoom = Math.max(MIN_ZOOM, 1.15 * Math.max(vw / (TARGET_W * iw * base), vh / (TARGET_H * ih * base)));
    const scale = base * lerp(1, maxZoom, easeIn(zoom));
    const k = easeInOut(zoom);
    const px = lerp((vw - iw * base) / 2 + fx * iw * base, vw / 2, k);
    const py = lerp((vh - ih * base) / 2 + fy * ih * base, vh / 2, k);
    ctx!.drawImage(img, px - fx * iw * scale, py - fy * ih * scale, iw * scale, ih * scale);
  }

  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', resize);
  addEventListener('load', queue);
  resize();
}

export function setupScrollStage() {
  if (!enabled()) return;
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(start);
}
