/*
 * Notificaciones en el móvil del portal del cliente (Web Push).
 *
 * El aviso que llega del servicio del navegador viene VACÍO (sin datos del
 * cliente). Al recibirlo, este archivo pide a la web el último aviso de la
 * persona, con su sesión, y lo enseña. Al tocarlo, abre esa página del portal.
 * No guarda nada en el dispositivo ni hace de caché de la web.
 */
const GENERIC = { title: 'Tienes un aviso nuevo', body: 'Abre tu portal para verlo.', url: '/portal/avisos' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let notice = GENERIC;
    try {
      const res = await fetch('/api/notificaciones/movil', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) notice = { ...GENERIC, ...(await res.json()) };
    } catch {
      // Sin conexión con la web: el texto general.
    }
    const url = typeof notice.url === 'string' && notice.url.startsWith('/portal/') ? notice.url : GENERIC.url;
    await self.registration.showNotification(String(notice.title).slice(0, 120), {
      body: String(notice.body).slice(0, 300),
      icon: '/portal-app/icono-192.png',
      badge: '/portal-app/icono-192.png',
      tag: 'aviso-portal',
      renotify: true,
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || GENERIC.url;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      if (new URL(tab.url).origin === self.location.origin && 'focus' in tab) {
        await tab.navigate(url).catch(() => undefined);
        return tab.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
