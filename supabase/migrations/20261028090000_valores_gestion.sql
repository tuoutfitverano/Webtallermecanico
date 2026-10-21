-- =====================================================================
-- Valores nuevos de tipos enumerados para la gestión completa del taller.
-- Van solos en esta migración: PostgreSQL no deja USAR un valor nuevo de un
-- enum en la misma transacción en la que se crea.
--
--  · member_role 'recepcionista': atiende a clientes, crea órdenes,
--    presupuestos y facturas y registra cobros; no gestiona el equipo ni la
--    configuración del taller (ver 20261028090100_permisos_recepcion.sql).
--  · notification_event: avisos de presupuestos y recordatorios.
-- =====================================================================
alter type public.member_role add value if not exists 'recepcionista';

alter type public.notification_event add value if not exists 'presupuesto_enviado';
alter type public.notification_event add value if not exists 'recordatorio_revision';
alter type public.notification_event add value if not exists 'recordatorio_presupuesto';
alter type public.notification_event add value if not exists 'recordatorio_recogida';
