-- =====================================================================
-- Recepción del vehículo: lo que se anota al recibirlo, para evitar
-- discusiones al entregarlo.
--
--  · Nivel de combustible, daños que ya traía (texto) y una lista de
--    comprobación (documentación, rueda de repuesto, objetos de valor…).
--  · Solo la oficina (propiedad, administración y recepción) lo anota o lo
--    cambia; el mecánico lo ve. Lo impone la base de datos.
--  · Sale en el resguardo de depósito (papel que firma el cliente).
--  · Sin fotos por ahora: necesitan almacenamiento de archivos (pendiente de
--    decidir cuota y coste).
-- =====================================================================

alter table public.repair_orders
  add column fuel_level text check (fuel_level is null or fuel_level in ('reserva', '1/4', '1/2', '3/4', 'lleno')),
  add column existing_damage text check (existing_damage is null or length(existing_damage) <= 1000),
  add column reception_checks text[] not null default '{}' check (
    reception_checks <@ array['documentacion', 'rueda_repuesto', 'herramientas', 'llave_antirrobo', 'objetos_valor', 'testigos_encendidos']::text[]
  );
comment on column public.repair_orders.fuel_level is 'Combustible al recibir el vehículo (reserva, 1/4, 1/2, 3/4, lleno).';
comment on column public.repair_orders.existing_damage is 'Daños o desperfectos que ya traía el vehículo al recibirlo.';
comment on column public.repair_orders.reception_checks is 'Comprobaciones de la recepción marcadas (lista cerrada).';

grant insert (fuel_level, existing_damage, reception_checks) on public.repair_orders to authenticated;
grant update (fuel_level, existing_damage, reception_checks) on public.repair_orders to authenticated;

-- Solo la oficina anota o cambia la recepción.
create function private.repair_orders_reception_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.existing_damage := nullif(btrim(new.existing_damage), '');
  new.reception_checks := coalesce((select array_agg(distinct c order by c) from unnest(new.reception_checks) c), '{}');
  if current_user in ('authenticated', 'anon') and not private.can_manage(new.workshop_id)
     and (tg_op = 'INSERT' and (new.fuel_level is not null or new.existing_damage is not null or new.reception_checks <> '{}')
          or tg_op = 'UPDATE' and (new.fuel_level, new.existing_damage, new.reception_checks)
                                  is distinct from (old.fuel_level, old.existing_damage, old.reception_checks)) then
    raise exception 'Solo la oficina del taller anota la recepción del vehículo.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.repair_orders_reception_guard() from public, anon, authenticated;
create trigger repair_orders_reception_guard before insert or update on public.repair_orders
  for each row execute function private.repair_orders_reception_guard();
