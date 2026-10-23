-- =====================================================================
-- Órdenes: el mecánico se queda trabajos libres y los da por terminados;
-- el propietario o un administrador los revisa.
--
--  · «Me la quedo» (claim_repair_order): cualquier persona activa del taller
--    puede quedarse una orden abierta SIN nadie asignado. No puede quitársela
--    a un compañero. Antes de quedársela solo ve lo imprescindible
--    (unassigned_repair_orders): número, vehículo, problema y prioridad.
--  · «Dar por terminada» (mark_order_done): quien tiene la orden la deja
--    pendiente de revisión. Se para su tiempo en marcha. El cliente no ve
--    nada de esto (no cambia el estado ni crea avisos).
--  · Revisión (review_repair_order): SOLO propietario o administrador.
--    Confirmar = «Listo para recoger» (y el aviso al cliente de siempre);
--    devolver = vuelve al mecánico con un motivo obligatorio.
--  · «Listo para recoger» solo lo pone el propietario o un administrador.
--    Recepción entrega el vehículo, pero solo si ya está «Listo para recoger».
--
-- No borra ni modifica datos existentes.
-- =====================================================================

alter table public.repair_orders
  add column review_requested_at timestamptz,
  add column review_requested_by uuid,
  add column review_note text check (review_note is null or length(review_note) between 1 and 500),
  add foreign key (workshop_id, review_requested_by) references public.workshop_members (workshop_id, user_id)
    on delete set null (review_requested_by);
comment on column public.repair_orders.review_requested_at is 'Cuándo se dio por terminada (pendiente de revisión del propietario o un administrador). Solo lo cambian mark_order_done y review_repair_order.';
comment on column public.repair_orders.review_note is 'Último motivo por el que el responsable devolvió el trabajo. Interno: nunca al cliente.';
create index repair_orders_review_idx on public.repair_orders (workshop_id) where review_requested_at is not null;
-- Sin permisos de escritura directa en estas columnas: solo las funciones de abajo.

alter table public.repair_order_events
  add column note text check (note is null or length(note) <= 500);
comment on column public.repair_order_events.note is 'Motivo de una devolución (kind = devuelta). Interno: nunca al cliente.';

-- ---------------------------------------------------------------------
-- Reglas (en la base de datos, no en la interfaz)
-- ---------------------------------------------------------------------
create function private.repair_orders_review_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  -- Propietario o administrador (o una operación del sistema).
  v_boss boolean := private.is_privileged() or new.workshop_id in (select private.manager_workshop_ids());
begin
  if tg_op = 'INSERT' then
    if not private.is_privileged() then
      new.review_requested_at := null;
      new.review_requested_by := null;
      new.review_note := null;
    end if;
    if not v_boss and new.status in ('listo', 'entregado') then
      raise exception 'Solo el propietario o un administrador confirma que un trabajo está terminado.' using errcode = '42501';
    end if;
    return new;
  end if;

  if not private.is_privileged()
     and (new.review_requested_at is distinct from old.review_requested_at
          or new.review_requested_by is distinct from old.review_requested_by
          or new.review_note is distinct from old.review_note) then
    raise exception 'La revisión solo cambia con «Dar por terminada» o con la revisión del responsable.' using errcode = '42501';
  end if;

  if not v_boss then
    if new.status = 'listo' and old.status is distinct from 'listo' then
      raise exception 'Solo el propietario o un administrador confirma que un trabajo está terminado. Usa «Dar por terminada».' using errcode = '42501';
    end if;
    if new.status = 'entregado' and old.status not in ('listo', 'entregado') then
      raise exception 'Para entregar el vehículo, el propietario o un administrador tiene que confirmar antes el trabajo («Listo para recoger»).' using errcode = '42501';
    end if;
  end if;

  -- Confirmado, entregado o cambiado de persona: ya no queda nada pendiente de revisión.
  if new.status in ('listo', 'entregado') or new.assigned_to is distinct from old.assigned_to then
    new.review_requested_at := null;
    new.review_requested_by := null;
  end if;
  if new.status in ('listo', 'entregado') then
    new.review_note := null;
  end if;
  return new;
end;
$$;
revoke all on function private.repair_orders_review_guard() from public, anon, authenticated;
create trigger repair_orders_review_guard before insert or update on public.repair_orders
  for each row execute function private.repair_orders_review_guard();

-- ---------------------------------------------------------------------
-- Órdenes libres (sin nadie asignado): lo imprescindible para elegir
-- ---------------------------------------------------------------------
create function public.unassigned_repair_orders(p_workshop_id uuid)
returns table (
  id uuid, number integer, status public.repair_status, priority public.order_priority, received_at timestamptz,
  scheduled_on date, problem_description text, plate text, make text, model text
)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.number, o.status, o.priority, o.received_at, o.scheduled_on, o.problem_description, v.plate, v.make, v.model
    from public.repair_orders o
    join public.vehicles v on v.id = o.vehicle_id and v.workshop_id = o.workshop_id
   where o.workshop_id = p_workshop_id
     and p_workshop_id in (select private.staff_workshop_ids())
     and o.assigned_to is null
     and o.status not in ('listo', 'entregado')
   order by o.priority desc, o.scheduled_on nulls last, o.received_at
   limit 100;
$$;

-- «Me la quedo»: solo si sigue libre (si otra persona se adelanta, se le dice).
create function public.claim_repair_order(p_order_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_assigned uuid;
  v_status public.repair_status;
begin
  select o.assigned_to, o.status into v_assigned, v_status
    from public.repair_orders o
   where o.id = p_order_id and o.workshop_id in (select private.staff_workshop_ids())
     for update;
  if not found then
    raise exception 'Orden no encontrada.' using errcode = '22023';
  end if;
  if v_assigned = v_uid then
    return;
  end if;
  if v_assigned is not null then
    raise exception 'Otra persona ya se ha quedado esta orden.' using errcode = '22023';
  end if;
  if v_status in ('listo', 'entregado') then
    raise exception 'Esta orden ya está terminada.' using errcode = '22023';
  end if;
  update public.repair_orders set assigned_to = v_uid where id = p_order_id;
end;
$$;

-- «Dar por terminada»: solo quien tiene la orden.
create function public.mark_order_done(p_order_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_order record;
begin
  select o.workshop_id, o.assigned_to, o.status, o.review_requested_at into v_order
    from public.repair_orders o
   where o.id = p_order_id and o.workshop_id in (select private.staff_workshop_ids())
     for update;
  if not found then
    raise exception 'Orden no encontrada.' using errcode = '22023';
  end if;
  if v_order.assigned_to is distinct from v_uid then
    raise exception 'Solo quien tiene asignada la orden puede darla por terminada.' using errcode = '22023';
  end if;
  if v_order.status in ('listo', 'entregado') then
    raise exception 'Esta orden ya está terminada.' using errcode = '22023';
  end if;
  if v_order.review_requested_at is not null then
    raise exception 'Ya está pendiente de revisión.' using errcode = '22023';
  end if;
  update public.repair_orders
     set review_requested_at = now(), review_requested_by = v_uid, review_note = null
   where id = p_order_id;
  -- Su tiempo en marcha en esta orden se para.
  update public.repair_order_work_logs set ended_at = now()
   where order_id = p_order_id and user_id = v_uid and ended_at is null;
  insert into public.repair_order_events (order_id, workshop_id, kind, actor)
  values (p_order_id, v_order.workshop_id, 'terminada', v_uid);
end;
$$;

-- Revisión: SOLO propietario o administrador (recepción no).
create function public.review_repair_order(p_order_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_order record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select o.workshop_id, o.review_requested_at into v_order
    from public.repair_orders o
   where o.id = p_order_id and o.workshop_id in (select private.manager_workshop_ids())
     for update;
  if not found then
    raise exception 'Solo el propietario o un administrador revisa los trabajos terminados.' using errcode = '42501';
  end if;
  if v_order.review_requested_at is null then
    raise exception 'Esta orden no está pendiente de revisión.' using errcode = '22023';
  end if;
  if p_approve then
    -- El disparador quita lo pendiente; el historial y el aviso al cliente son los de siempre.
    update public.repair_orders set status = 'listo' where id = p_order_id;
  else
    if v_note is null or length(v_note) > 500 then
      raise exception 'Escribe el motivo (máximo 500 caracteres) para que el mecánico sepa qué falta.' using errcode = '22023';
    end if;
    update public.repair_orders
       set review_requested_at = null, review_requested_by = null, review_note = v_note
     where id = p_order_id;
    insert into public.repair_order_events (order_id, workshop_id, kind, note, actor)
    values (p_order_id, v_order.workshop_id, 'devuelta', v_note, v_uid);
  end if;
end;
$$;

revoke all on function public.unassigned_repair_orders(uuid) from public, anon;
revoke all on function public.claim_repair_order(uuid) from public, anon;
revoke all on function public.mark_order_done(uuid) from public, anon;
revoke all on function public.review_repair_order(uuid, boolean, text) from public, anon;
grant execute on function public.unassigned_repair_orders(uuid) to authenticated;
grant execute on function public.claim_repair_order(uuid) to authenticated;
grant execute on function public.mark_order_done(uuid) to authenticated;
grant execute on function public.review_repair_order(uuid, boolean, text) to authenticated;
