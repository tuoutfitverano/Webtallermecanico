-- Valores nuevos del historial de órdenes (en su propia migración: un valor
-- nuevo de un enum no se puede usar en la misma transacción que lo crea).
--  · terminada: el mecánico da el trabajo por terminado (pendiente de revisión).
--  · devuelta: el propietario o un administrador lo devuelve con un motivo.
alter type public.repair_event_kind add value if not exists 'terminada';
alter type public.repair_event_kind add value if not exists 'devuelta';
