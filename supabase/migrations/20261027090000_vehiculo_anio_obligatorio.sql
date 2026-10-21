-- =====================================================================
-- Vehículos: el año pasa a ser obligatorio (matrícula, marca y modelo ya lo
-- eran). Lo comprueban el navegador y el servidor (packages/core) y, aquí,
-- la base de datos.
--
-- Se usa un disparador y no «not null»: los vehículos que ya existan sin año
-- no se rompen (se pueden seguir leyendo, borrar su cliente, etc.); solo se
-- impide CREAR un vehículo sin año o QUITAR el año a uno que lo tenía. Al
-- editar uno antiguo, el formulario pide el año.
-- =====================================================================

create function private.vehicles_require_year()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.year is null and (tg_op = 'INSERT' or old.year is not null) then
    raise exception 'Indica el año del vehículo.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.vehicles_require_year() from public, anon, authenticated;

create trigger vehicles_require_year
  before insert or update of year on public.vehicles
  for each row execute function private.vehicles_require_year();
