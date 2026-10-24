-- =====================================================================
-- Hora de Madrid DENTRO de cada función que trabaja con fechas
--
-- 20261031090100_zona_horaria.sql puso la base de datos en Europe/Madrid,
-- pero solo como valor POR DEFECTO de la sesión: la API (PostgREST) deja que
-- cualquier petición lo cambie con la cabecera «Prefer: timezone=…». Con
-- «Pacific/Kiritimati» (UTC+14) current_date pasa a ser «mañana»:
--   · una factura se emitía con fecha de mañana (y el 31 de diciembre, con el
--     año y la serie siguientes) y bloqueaba las de hoy («fecha anterior»);
--   · vencimientos, validez de presupuestos, recordatorios y estadísticas
--     cambiaban de día.
-- Reproducido en la auditoría del 24/10/2026 (PostgREST v13).
--
-- Arreglo: cada función de public/private que usa fechas lleva
-- «set timezone = 'Europe/Madrid'», que manda sobre la sesión mientras se
-- ejecuta. No cambia ningún dato.
--
-- OJO: «create or replace function» borra este ajuste. Una función nueva o
-- reescrita que use fechas debe llevar «set timezone to 'Europe/Madrid'» en su
-- definición; lo vigila supabase/tests/25_zona_horaria.test.sql.
-- =====================================================================
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prokind = 'f'
       -- Solo las nuestras (no las de extensiones ni las de otros propietarios).
       and p.proowner = (select r.oid from pg_roles r where r.rolname = current_user)
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and p.prosrc ~* '(current_date|current_time|localtime|::date|to_char\s*\(|date_trunc|extract\s*\(|valid_until|due_date|issue_date|paid_on|next_due_on|next_service_date|preferred_date)'
  loop
    execute format('alter function %s set timezone to %L', f, 'Europe/Madrid');
  end loop;
end;
$$;
