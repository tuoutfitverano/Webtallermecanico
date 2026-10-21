-- =====================================================================
-- Avisos por WhatsApp · 1/2: el canal nuevo.
--
-- Va solo en su archivo: un valor nuevo de un enum no se puede usar en la
-- misma transacción que lo crea (Supabase aplica cada migración en una).
-- Cambio NO destructivo.
-- =====================================================================
alter type public.notification_channel add value if not exists 'whatsapp';
