/**
 * Vídeos de fondo con fundido de entrada y salida.
 *  · Empiezan invisibles; al tener el primer fotograma, aparecen en 500 ms.
 *  · Cuando quedan 0,55 s, se desvanecen en 550 ms.
 *  · Al terminar: con un solo vídeo vuelve a empezar; con varios, pasa al siguiente.
 */
const FADE_IN_MS = 500;
const FADE_OUT_MS = 550;
const FADE_OUT_AT_S = 0.55;

const frames = new WeakMap<HTMLVideoElement, number>();

function fade(video: HTMLVideoElement, to: number, ms: number) {
  cancelAnimationFrame(frames.get(video) ?? 0);
  const from = Number(video.style.opacity || 0);
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    video.style.opacity = String(from + (to - from) * k);
    if (k < 1) frames.set(video, requestAnimationFrame(step));
  };
  frames.set(video, requestAnimationFrame(step));
}

function shouldSkip(): boolean {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return reduce || saveData;
}

function setup(video: HTMLVideoElement) {
  if (video.dataset.ready) return;
  video.dataset.ready = '1';
  const sources = JSON.parse(video.dataset.fadingVideo ?? '[]') as string[];
  if (sources.length === 0 || shouldSkip()) return;

  let index = 0;
  let fadingOut = false;
  video.style.opacity = '0';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const play = () => void video.play().catch(() => { /* reproducción automática bloqueada: queda el fondo */ });

  video.addEventListener('loadeddata', () => {
    fadingOut = false;
    fade(video, 1, FADE_IN_MS);
  });
  video.addEventListener('timeupdate', () => {
    if (!fadingOut && video.duration && video.duration - video.currentTime <= FADE_OUT_AT_S) {
      fadingOut = true;
      fade(video, 0, FADE_OUT_MS);
    }
  });
  video.addEventListener('ended', () => {
    if (sources.length === 1) {
      video.currentTime = 0;
      fadingOut = false;
      play();
      fade(video, 1, FADE_IN_MS);
    } else {
      index = (index + 1) % sources.length;
      video.src = sources[index]!;
      play();
    }
  });
  video.addEventListener('error', () => { video.style.opacity = '0'; });

  video.src = sources[index]!;
  play();
}

export function setupFadingVideos() {
  document.querySelectorAll<HTMLVideoElement>('video[data-fading-video]').forEach(setup);
}
