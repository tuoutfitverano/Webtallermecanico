-- Valor nuevo para los avisos del cambio de titular de un vehículo.
-- Va aparte: un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
alter type public.notification_event add value if not exists 'cambio_titular';
