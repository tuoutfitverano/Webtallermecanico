-- =====================================================================
-- Agenda: quién hizo el último cambio en un apunte.
--
--  · updated_by lo pone la base de datos en cada cambio (como created_by);
--    nadie lo escribe a mano (no tiene permiso de columna).
--  · Así la persona ve «Modificado por …» cuando su jefe (propiedad o
--    administración) le cambia, mueve o da por hecho un apunte.
-- =====================================================================

alter table public.staff_agenda
  add column updated_by uuid references auth.users (id) on delete set null;
comment on column public.staff_agenda.updated_by is 'Quién hizo el último cambio (lo pone staff_agenda_guard). Nulo si nadie lo ha cambiado desde que se apuntó.';

create or replace function private.staff_agenda_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Solo cuenta como cambio si algo cambia de verdad.
    if (new.user_id, new.kind, new.title, new.notes, new.starts_at, new.ends_at, new.order_id, new.done_at)
       is distinct from (old.user_id, old.kind, old.title, old.notes, old.starts_at, old.ends_at, old.order_id, old.done_at) then
      new.updated_by := auth.uid();
    else
      new.updated_by := old.updated_by;
    end if;
  end if;
  new.updated_at := now();
  new.title := btrim(new.title);
  if current_user in ('authenticated', 'anon') and new.order_id is not null
     and new.order_id is distinct from (case when tg_op = 'UPDATE' then old.order_id end)
     and not private.can_work_on_order(new.order_id) then
    raise exception 'Esa orden no está a tu alcance.' using errcode = '42501';
  end if;
  -- Solo quien se ocupa de ella (o la gerencia) la da por hecha; la fecha la pone el servidor.
  if new.done_at is not null and (tg_op = 'INSERT' or old.done_at is null) then
    new.done_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.staff_agenda_guard() from public, anon, authenticated;
