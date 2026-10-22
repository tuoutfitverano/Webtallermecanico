-- =====================================================================
-- Hora de España en la base de datos
--
-- Las pantallas trabajan con la fecha de Madrid (lib/panel/format.ts), pero la
-- base de datos usaba UTC: entre las 00:00 y las 02:00 (las 01:00 en invierno)
-- current_date todavía era «ayer». Consecuencias que se corrigen:
--   · un cobro de hoy se rechazaba como «fecha futura»;
--   · una factura emitida a esa hora llevaba la fecha (y, en Nochevieja, el
--     año y la serie) del día anterior;
--   · vencimientos, recordatorios y anotaciones de mantenimiento se calculaban
--     con el día equivocado.
-- Con la zona horaria de la base de datos en Europe/Madrid, current_date y los
-- agrupados por día son los de España. Los instantes guardados (timestamptz)
-- NO cambian: solo cómo se leen y qué día es «hoy». No toca ningún dato.
-- =====================================================================
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'Europe/Madrid');
end;
$$;
-- Esta misma sesión (el resto de migraciones de este despliegue) también.
set timezone to 'Europe/Madrid';
