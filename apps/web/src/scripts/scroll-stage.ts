/**
 * Coche que gira con el scroll y zoom final hacia la ventanilla tintada
 * (ver components/ScrollStage.astro). Dibuja fotogramas en un <canvas>.
 *
 *  · Solo se activa con JavaScript, sin «reducir movimiento» y sin ahorro de
 *    datos. Si no, se queda la imagen fija (nada depende de esto).
 *  · Los fotogramas se cargan en orden; mientras falta alguno se dibuja el
 *    cargado más cercano. Solo se descargan los que se usan (data-turn).
 *  · Las transiciones se funden con las secciones: el giro empieza en cuanto se
 *    baja y acaba con la sección siguiente ya entrando; el zoom empieza mientras
 *    salen los servicios. Arranque y parada suaves, sin «número aparte».
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
  // Pantallas grandes (más de 2000 px reales de ancho): versión 4K si el taller la tiene.
  const big = innerWidth * Math.min(devicePixelRatio || 1, 2) > 2000;
  const src = (big && stage.dataset.srcHd) || stage.dataset.src || '';
  const count = Number(stage.dataset.count);
  const fx = Number(stage.dataset.focusX ?? 0.5);
  const fy = Number(stage.dataset.focusY ?? 0.5);
  const frameTop = Number(stage.dataset.frameTop ?? 0);
  // Parte de la vuelta que se reproduce (1 = completa) y último fotograma usado.
  const turnPart = Math.min(1, Math.max(0.1, Number(stage.dataset.turn ?? 1) || 1));
  const lastFrame = Math.max(1, Math.round(turnPart * (count - 1)));
  if (!canvas || !ctx || !dim || !hero || !turnGap || !zoomGap || !src.includes('{n}') || !(count >= 2)) return;
  const second = turnGap.nextElementSibling as HTMLElement | null;
  // Color de fondo de la web (el diseño premium y el modo claro lo cambian): el fundido final acaba en él.
  const readBg = () => getComputedStyle(stage).getPropertyValue('--bg').trim() || '#000';
  let bg = readBg();

  document.documentElement.classList.add('stage-on');

  // ---- Fondo opcional (garaje): los fotogramas, con transparencia, van encima
  let backdrop: HTMLImageElement | null = null;
  const backdropUrl = (big && stage.dataset.backdropHd) || stage.dataset.backdrop || '';
  const wantsBackdrop = Boolean(backdropUrl);
  const ready = () => frames[0] && (!wantsBackdrop || backdrop);
  if (wantsBackdrop) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { backdrop = img; if (ready()) stage.classList.add('is-live'); queue(); };
    img.src = backdropUrl;
  }

  // ---- Fotogramas (en orden: el primero, el que se ve al cargar)
  const frames: Array<HTMLImageElement | null> = Array.from({ length: count }, () => null);
  const url = (i: number) => src.replace('{n}', String(i).padStart(3, '0'));
  let next = 0;
  const loadNext = () => {
    if (next > lastFrame) return;
    const i = next++;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { frames[i] = img; if (ready()) stage.classList.add('is-live'); queue(); loadNext(); };
    img.onerror = loadNext;
    img.src = url(i);
  };
  for (let k = 0; k < 4; k++) loadNext();

  // ---- Cristal de la ventanilla: colores medios de su mitad de arriba y de abajo
  // (del fotograma en el que acaba el giro). Al acercarse, la foto se sustituye por este cristal
  // dibujado, que no se pixela a ningún tamaño.
  let glass: [string, string] | null = null;
  const sampleGlass = (img: HTMLImageElement) => {
    const probe = document.createElement('canvas');
    probe.width = 1; probe.height = 2;
    const p = probe.getContext('2d', { willReadFrequently: true });
    if (!p) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const w = TARGET_W * iw * 0.6, h = TARGET_H * ih * 0.6;
    p.drawImage(img, fx * iw - w / 2, fy * ih - h / 2, w, h, 0, 0, 1, 2);
    const d = p.getImageData(0, 0, 1, 2).data;
    glass = [`rgb(${d[0]},${d[1]},${d[2]})`, `rgb(${d[4]},${d[5]},${d[6]})`];
  };
  const nearest = (i: number) => {
    for (let d = 0; d < count; d++) {
      const a = frames[i - d] ?? frames[i + d];
      if (a) return a;
    }
    return null;
  };

  // ---- Tamaño del lienzo
  let vw = 0, vh = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    vw = innerWidth; vh = innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
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

    // 1 → 2: giro. Empieza en cuanto se baja y dura al menos 0,8 pantallas,
    // aunque la sección siguiente ya esté entrando (así no queda como un número aparte).
    const r0 = stageTop + heroH * 0.2;
    const r1 = Math.max(secondTop - vh * 0.35, r0 + vh * 0.8);
    const turn = easeInOut(clamp((y - r0) / Math.max(1, r1 - r0)));
    // 2 → 3: zoom hasta la ventanilla y fundido al fondo; empieza mientras salen los servicios.
    const z0 = zoomTop - vh * 0.9;
    const zoom = clamp((y - z0) / Math.max(1, zoomEnd - z0));

    // Oscurecido continuo: el coche se aclara al empezar a bajar y se vuelve a
    // oscurecer, sin saltos, cuando el texto de la siguiente sección llega al centro.
    let shade: number;
    if (zoom > 0) shade = zoom < 0.4 ? lerp(0.72, 0.12, zoom / 0.4) : zoom > 0.65 ? lerp(0.12, 1, (zoom - 0.65) / 0.35) : 0.12;
    else {
      const down = lerp(0.62, 0.12, clamp((y - stageTop) / Math.max(1, heroH * 0.45)));
      const up = lerp(0.12, 0.72, clamp((y - (secondTop - vh * 0.8)) / (vh * 0.55)));
      shade = Math.max(down, up);
    }

    const index = Math.round(turn * lastFrame);
    const img = nearest(index);
    // El fotograma dibujado forma parte de la clave: al terminar de cargarse, se redibuja.
    const key = `${img ? frames.indexOf(img) : -1}|${backdrop ? 1 : 0}|${zoom.toFixed(4)}|${shade.toFixed(3)}|${vw}x${vh}`;
    if (key === last) return;
    last = key;
    dim!.style.opacity = shade.toFixed(3);

    ctx!.fillStyle = bg;
    ctx!.fillRect(0, 0, vw, vh);
    if (!img || (wantsBackdrop && !backdrop)) return;
    // Espacio de dibujo: el fondo (si lo hay) o el propio fotograma. El fotograma
    // ocupa todo el ancho y empieza en frameTop (fracción del alto del fondo).
    const sw = backdrop ? backdrop.naturalWidth : img.naturalWidth;
    const sh = backdrop ? backdrop.naturalHeight : img.naturalHeight;
    const fTop = backdrop ? frameTop * sh : 0;
    const fH = (sw * img.naturalHeight) / img.naturalWidth;
    // Misma composición que la imagen fija (CSS): con fondo, cubre siempre; sin él, en vertical va a lo ancho.
    const base = backdrop || vw >= vh ? Math.max(vw / sw, vh / sh) : (vw / sw) * 1.15;
    const maxZoom = Math.max(MIN_ZOOM, 1.15 * Math.max(vw / (TARGET_W * sw * base), vh / (TARGET_H * fH * base)));
    const scale = base * lerp(1, maxZoom, easeIn(zoom));
    // Punto del zoom (la ventanilla) en el espacio de dibujo; se lleva al centro de la pantalla.
    const focusX = fx * sw, focusY = fTop + fy * fH;
    const k = easeInOut(zoom);
    const px = lerp((vw - sw * base) / 2 + focusX * base, vw / 2, k);
    const py = lerp((vh - sh * base) / 2 + focusY * base, vh / 2, k);
    const ox = px - focusX * scale, oy = py - focusY * scale;
    if (backdrop) ctx!.drawImage(backdrop, ox, oy, sw * scale, sh * scale);
    ctx!.drawImage(img, ox, oy + fTop * scale, sw * scale, fH * scale);

    // Cuando cada píxel de la foto ya ocupa más de ~1,5 píxeles de pantalla, el cristal
    // dibujado la va tapando (a los ~3 px la cubre del todo): sin granulado.
    const pixel = (dpr * fH * scale) / img.naturalHeight;
    const cover = zoom > 0 ? clamp((pixel - 1.5) / 1.5) : 0;
    if (cover > 0) {
      if (!glass) sampleGlass(img);
      if (glass) {
        ctx!.globalAlpha = cover;
        const tint = ctx!.createLinearGradient(0, 0, 0, vh);
        tint.addColorStop(0, glass[0]);
        tint.addColorStop(1, glass[1]);
        ctx!.fillStyle = tint;
        ctx!.fillRect(0, 0, vw, vh);
        // Reflejo suave en diagonal, como el de un cristal tintado
        const shine = ctx!.createLinearGradient(0, 0, vw, vh);
        shine.addColorStop(0.25, 'rgba(255,255,255,0)');
        shine.addColorStop(0.42, 'rgba(255,255,255,.07)');
        shine.addColorStop(0.5, 'rgba(255,255,255,.02)');
        shine.addColorStop(0.62, 'rgba(255,255,255,0)');
        ctx!.fillStyle = shine;
        ctx!.fillRect(0, 0, vw, vh);
        ctx!.globalAlpha = 1;
      }
    }
  }

  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', resize);
  // Al cambiar a modo claro u oscuro: nuevo fondo y se vuelve a pintar.
  addEventListener('tema', () => { bg = readBg(); last = ''; queue(); });
  addEventListener('load', queue);
  resize();
}

export function setupScrollStage() {
  if (!enabled()) return;
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(start);
}
