-- =====================================================================
-- Notificaciones en el móvil: solo direcciones de los servicios de
-- notificaciones de los navegadores (Google, Mozilla, Apple, Microsoft).
--
-- Antes valía cualquier https://… y el servidor llamaba, firmado, a la
-- dirección que el cliente hubiera guardado (un sitio ajeno). La misma regla
-- está en el servidor (isKnownPushService en lib/notifications/webpush.ts).
-- NOT VALID: no rechaza filas ya guardadas (el servidor no las llama y las
-- borra al primer intento); sí cualquier alta o cambio desde ahora.
-- En pruebas, el servicio simulado escucha en http://127.0.0.1.
-- =====================================================================

alter table public.push_subscriptions
  add constraint push_subscriptions_known_service check (
    endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)(:443)?/[^\s@]*$'
    or endpoint ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?/[^\s]*$'
  ) not valid;
