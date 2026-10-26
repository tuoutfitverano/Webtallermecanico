/**
 * «Notificaciones en este móvil» (portal → Mis datos): pide permiso al
 * navegador, se suscribe con la clave pública de la plataforma y guarda el
 * dispositivo en el servidor (/api/notificaciones/movil). Ver public/sw.js.
 */

const SW_URL = '/sw.js';
const API = '/api/notificaciones/movil';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function tellServer(action: 'activar' | 'quitar', endpoint: string): Promise<boolean> {
  const res = await fetch(API, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ accion: action, endpoint }),
  });
  return res.ok;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function init() {
  const card = document.querySelector<HTMLElement>('[data-push]');
  const key = card?.dataset.key;
  if (!card || !key) return;
  const on = card.querySelector<HTMLButtonElement>('[data-push-on]')!;
  const off = card.querySelector<HTMLButtonElement>('[data-push-off]')!;
  const show = (state: string) => {
    for (const el of card.querySelectorAll<HTMLElement>('[data-push-state]')) el.hidden = el.dataset.pushState !== state;
    on.hidden = !['off', 'error'].includes(state);
    off.hidden = state !== 'on';
  };
  const busy = (button: HTMLButtonElement, value: boolean) => {
    button.disabled = value;
    button.classList.toggle('is-busy', value);
  };

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return show(isIos() && !isStandalone() ? 'ios' : 'unsupported');
  if (Notification.permission === 'denied') return show('denied');

  void (async () => {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const current = await registration?.pushManager.getSubscription();
    // Si el móvil la tiene, se vuelve a apuntar en el servidor (por si cambió de cuenta).
    if (current && (await tellServer('activar', current.endpoint).catch(() => false))) show('on');
    else show('off');
  })();

  on.onclick = async () => {
    busy(on, true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return show(permission === 'denied' ? 'denied' : 'off');
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription())
        ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      show((await tellServer('activar', subscription.endpoint)) ? 'on' : 'error');
    } catch {
      show('error');
    } finally {
      busy(on, false);
    }
  };

  off.onclick = async () => {
    busy(off, true);
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await tellServer('quitar', subscription.endpoint).catch(() => false);
        await subscription.unsubscribe();
      }
      show('off');
    } catch {
      show('error');
    } finally {
      busy(off, false);
    }
  };
}

export function setupPush() {
  document.addEventListener('astro:page-load', init);
}
