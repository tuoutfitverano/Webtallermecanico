-- =====================================================================
-- Fase 5 · Portal privado de clientes
--
-- Se apoya en lo existente (customers.user_id, portal_my_workshops,
-- portal_my_vehicles, repair_orders, repair_order_events) y SOLO añade:
--
--   · Vinculación segura cuenta ↔ ficha de cliente mediante INVITACIÓN del
--     taller (propietario o administrador). Nada de reclamar fichas con una
--     matrícula, un nombre, un teléfono o un correo.
--   · Información de la orden autorizada para el cliente:
--       - customer_notes: mensaje escrito PARA el cliente.
--       - show_details_to_customer: si el cliente ve la diagnosis y el
--         trabajo realizado (por defecto NO).
--     Las notas internas nunca salen hacia el portal.
--   · Historial visible para el cliente: solo cambios de estado y mensajes
--     (repair_order_events.customer_message), nunca asignaciones ni
--     cambios internos.
--   · Funciones portal_* con salida elegida campo a campo. El cliente sigue
--     SIN acceso a las tablas.
--
-- No borra ni modifica datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Órdenes: información autorizada para el cliente
-- ---------------------------------------------------------------------
alter table public.repair_orders
  add column customer_notes text check (length(customer_notes) <= 2000),
  add column show_details_to_customer boolean not null default false;
comment on column public.repair_orders.customer_notes is 'Mensaje para el cliente. Se muestra en su portal.';
comment on column public.repair_orders.show_details_to_customer is 'Si el cliente ve la diagnosis y el trabajo realizado. Por defecto no.';

-- Ojo: un valor nuevo de un tipo no se puede usar en la misma transacción en la que
-- se añade; por eso las funciones de abajo comparan kind::text.
alter type public.repair_event_kind add value if not exists 'mensaje';
alter table public.repair_order_events
  add column customer_message text check (length(customer_message) <= 2000);
comment on column public.repair_order_events.customer_message is 'Mensaje visible para el cliente asociado a este momento del historial.';

grant insert (customer_notes, show_details_to_customer) on public.repair_orders to authenticated;
grant update (customer_notes, show_details_to_customer) on public.repair_orders to authenticated;

-- El disparador de reglas incorpora los campos nuevos: solo gestores los cambian.
create or replace function private.repair_orders_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_manager boolean := private.can_manage(new.workshop_id);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_order_number(new.workshop_id);
    new.created_by := auth.uid();
    new.created_at := now();
    new.status_changed_at := now();
    new.delivered_at := case when new.status = 'entregado' then now() end;
  else
    -- Campos de sistema: no se tocan.
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;

    if not v_manager then
      if new.vehicle_id is distinct from old.vehicle_id or new.customer_id is distinct from old.customer_id
         or new.assigned_to is distinct from old.assigned_to or new.received_at is distinct from old.received_at
         or new.problem_description is distinct from old.problem_description then
        raise exception 'Solo el propietario o un administrador puede cambiar el vehículo, el cliente, la asignación o la descripción.'
          using errcode = '42501';
      end if;
      if new.customer_notes is distinct from old.customer_notes
         or new.show_details_to_customer is distinct from old.show_details_to_customer then
        raise exception 'Solo el propietario o un administrador decide qué ve el cliente.' using errcode = '42501';
      end if;
      if new.status = 'entregado' and old.status is distinct from 'entregado' then
        raise exception 'Solo el propietario o un administrador puede marcar una orden como entregada.' using errcode = '42501';
      end if;
    end if;

    if new.status is distinct from old.status then
      new.status_changed_at := now();
      new.delivered_at := case when new.status = 'entregado' then now() end;
    else
      new.status_changed_at := old.status_changed_at;
      new.delivered_at := old.delivered_at;
    end if;
  end if;

  new.updated_by := auth.uid();
  new.problem_description := btrim(new.problem_description);
  new.diagnosis := nullif(btrim(new.diagnosis), '');
  new.work_done := nullif(btrim(new.work_done), '');
  new.internal_notes := nullif(btrim(new.internal_notes), '');
  new.customer_notes := nullif(btrim(new.customer_notes), '');

  -- Solo se asigna a personas ACTIVAS del taller (la clave foránea ya exige que sean del taller).
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not private.is_active_member(new.workshop_id, new.assigned_to) then
    raise exception 'La persona asignada no pertenece al equipo activo de este taller.' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- El historial guarda además los mensajes para el cliente.
create or replace function private.repair_orders_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_fields text[] := '{}';
  v_message_changed boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.repair_order_events (order_id, workshop_id, kind, to_status, to_assignee, customer_message, actor)
    values (new.id, new.workshop_id, 'creada', new.status, new.assigned_to, new.customer_notes, auth.uid());
    return null;
  end if;

  v_message_changed := new.customer_notes is distinct from old.customer_notes and new.customer_notes is not null;

  if new.status is distinct from old.status then
    insert into public.repair_order_events (order_id, workshop_id, kind, from_status, to_status, customer_message, actor)
    values (new.id, new.workshop_id, 'estado', old.status, new.status,
            case when v_message_changed then new.customer_notes end, auth.uid());
  elsif v_message_changed then
    insert into public.repair_order_events (order_id, workshop_id, kind, customer_message, actor)
    values (new.id, new.workshop_id, 'mensaje', new.customer_notes, auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.repair_order_events (order_id, workshop_id, kind, from_assignee, to_assignee, actor)
    values (new.id, new.workshop_id, 'asignacion', old.assigned_to, new.assigned_to, auth.uid());
  end if;
  if new.problem_description is distinct from old.problem_description then v_fields := array_append(v_fields, 'problem_description'); end if;
  if new.diagnosis is distinct from old.diagnosis then v_fields := array_append(v_fields, 'diagnosis'); end if;
  if new.work_done is distinct from old.work_done then v_fields := array_append(v_fields, 'work_done'); end if;
  if new.internal_notes is distinct from old.internal_notes then v_fields := array_append(v_fields, 'internal_notes'); end if;
  if new.vehicle_id is distinct from old.vehicle_id then v_fields := array_append(v_fields, 'vehicle_id'); end if;
  if new.customer_id is distinct from old.customer_id then v_fields := array_append(v_fields, 'customer_id'); end if;
  if new.received_at is distinct from old.received_at then v_fields := array_append(v_fields, 'received_at'); end if;
  if new.show_details_to_customer is distinct from old.show_details_to_customer then
    v_fields := array_append(v_fields, 'show_details_to_customer');
  end if;
  if new.customer_notes is distinct from old.customer_notes and new.customer_notes is null then
    v_fields := array_append(v_fields, 'customer_notes');
  end if;
  if cardinality(v_fields) > 0 then
    insert into public.repair_order_events (order_id, workshop_id, kind, changed_fields, actor)
    values (new.id, new.workshop_id, 'datos', v_fields, auth.uid());
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Fichas de cliente: fecha de vinculación (la calcula la base de datos)
-- ---------------------------------------------------------------------
alter table public.customers add column portal_linked_at timestamptz;
comment on column public.customers.portal_linked_at is 'Cuándo se vinculó la cuenta del portal (null = sin vincular). Lo calcula la base de datos.';
-- Las fichas que ya tuvieran cuenta enlazada conservan el enlace (sin fecha conocida).

create function private.customers_portal_link()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.user_id is null then
    new.portal_linked_at := null;
  elsif tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
    new.portal_linked_at := now();
  else
    new.portal_linked_at := old.portal_linked_at;
  end if;
  return new;
end;
$$;
revoke all on function private.customers_portal_link() from public, anon, authenticated;
create trigger customers_portal_link before insert or update on public.customers
  for each row execute function private.customers_portal_link();

-- ---------------------------------------------------------------------
-- 3. Invitaciones de clientes
-- ---------------------------------------------------------------------
create table public.customer_invitations (
  id           uuid primary key default gen_random_uuid(),
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  customer_id  uuid not null,
  email        text not null check (email = lower(btrim(email)) and length(email) <= 254
                                    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Solo la huella SHA-256 del código; el código en claro se muestra una vez.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status       public.invitation_status not null default 'pendiente',
  expires_at   timestamptz not null default now() + interval '7 days',
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_by  uuid references auth.users (id) on delete set null,
  accepted_at  timestamptz,
  revoked_by   uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  -- La ficha tiene que ser DEL MISMO taller que la invitación.
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade
);
comment on table public.customer_invitations is 'Invitaciones para que un cliente acceda a su portal. Se crean y aceptan solo mediante funciones.';
create unique index customer_invitations_one_pending on public.customer_invitations (customer_id) where status = 'pendiente';
create index customer_invitations_workshop_idx on public.customer_invitations (workshop_id, created_at desc);

revoke all on public.customer_invitations from anon, authenticated;
grant all on public.customer_invitations to service_role;
grant select (id, workshop_id, customer_id, email, status, expires_at, invited_by, created_at, accepted_at, revoked_at)
  on public.customer_invitations to authenticated;
alter table public.customer_invitations enable row level security;
create policy "customer invitations: lectura gestores" on public.customer_invitations for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));

-- Taller de una ficha si quien llama la puede gestionar (propietario/administrador); si no, NULL.
create function private.managed_customer_workshop(p_customer_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select c.workshop_id from public.customers c
  where c.id = p_customer_id
    and (c.workshop_id in (select private.manager_workshop_ids()) or private.is_platform_admin());
$$;
revoke all on function private.managed_customer_workshop(uuid) from public, anon, authenticated;

create function public.create_customer_invitation(p_customer_id uuid, p_email text default null)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_user();
  v_workshop uuid := private.managed_customer_workshop(p_customer_id);
  v_customer public.customers;
  v_email    text;
  v_token    text;
  v_id       uuid;
  v_exp      timestamptz;
begin
  -- Mismo mensaje si la ficha no existe, es de otro taller o no tienes permiso.
  if v_workshop is null then
    raise exception 'No tienes permiso para invitar a este cliente.' using errcode = '42501';
  end if;
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if v_customer.user_id is not null then
    raise exception 'Esta ficha ya está vinculada a una cuenta. Desvincúlala antes de invitar de nuevo.' using errcode = '23505';
  end if;
  v_email := lower(btrim(coalesce(nullif(btrim(p_email), ''), v_customer.email, '')));
  if length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indica un correo electrónico válido para el cliente.' using errcode = '22023';
  end if;
  if exists (select 1 from public.workshops w where w.id = v_workshop and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '22023';
  end if;
  if (select count(*) from public.customer_invitations i
      where i.workshop_id = v_workshop and i.created_at > now() - interval '1 day') >= 200 then
    raise exception 'Demasiadas invitaciones hoy. Inténtalo mañana.' using errcode = 'PT429';
  end if;

  update public.customer_invitations i
     set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where i.customer_id = p_customer_id and i.status = 'pendiente';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.customer_invitations (workshop_id, customer_id, email, token_hash, invited_by)
  values (v_workshop, p_customer_id, v_email, private.invitation_token_hash(v_token), v_uid)
  returning id, customer_invitations.expires_at into v_id, v_exp;
  return query select v_id, v_token, v_exp;
end;
$$;

create function public.revoke_customer_invitation(p_invitation_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_inv public.customer_invitations;
begin
  select * into v_inv from public.customer_invitations i where i.id = p_invitation_id for update;
  if v_inv.id is null or private.managed_customer_workshop(v_inv.customer_id) is null then
    raise exception 'Invitación no encontrada.' using errcode = '42501';
  end if;
  if v_inv.status <> 'pendiente' then
    raise exception 'La invitación ya no está pendiente.' using errcode = '22023';
  end if;
  update public.customer_invitations set status = 'revocada', revoked_at = now(), revoked_by = v_uid where id = v_inv.id;
end;
$$;

-- Datos mínimos de una invitación para la pantalla de aceptar (con sesión iniciada).
create function public.get_customer_invitation(p_token text)
returns table (workshop_name text, email_hint text, email_matches boolean, expires_at timestamptz, state text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  return query
    select w.name, private.mask_email(i.email), i.email = v_email, i.expires_at,
           case
             when i.status = 'aceptada' then 'aceptada'
             when i.status = 'revocada' then 'revocada'
             when i.expires_at <= now() then 'caducada'
             when w.status = 'suspendido' then 'taller_suspendido'
             when c.user_id is not null then 'ya_vinculada'
             else 'pendiente'
           end
    from public.customer_invitations i
    join public.workshops w on w.id = i.workshop_id
    join public.customers c on c.id = i.customer_id
    where i.token_hash = private.invitation_token_hash(p_token);
end;
$$;

-- Aceptar: la ficha y el taller salen del código, nunca del navegador.
create function public.accept_customer_invitation(p_token text)
returns table (workshop_id uuid, customer_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid      uuid := private.require_user();
  v_user     record;
  v_inv      public.customer_invitations;
  v_customer public.customers;
begin
  select u.email, u.email_confirmed_at, u.is_anonymous into v_user from auth.users u where u.id = v_uid;
  if v_user.email is null or coalesce(v_user.is_anonymous, false) then
    raise exception 'Necesitas una cuenta con correo electrónico.' using errcode = '42501';
  end if;
  if v_user.email_confirmed_at is null then
    raise exception 'Confirma tu correo electrónico antes de aceptar la invitación.' using errcode = '42501';
  end if;

  select * into v_inv from public.customer_invitations i
   where i.token_hash = private.invitation_token_hash(p_token) for update;
  if v_inv.id is null then
    raise exception 'La invitación no es válida.' using errcode = '22023';
  end if;
  if v_inv.status <> 'pendiente' then
    raise exception 'Esta invitación ya se ha usado o se ha anulado.' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'La invitación ha caducado. Pide una nueva al taller.' using errcode = '22023';
  end if;
  if lower(v_user.email) <> v_inv.email then
    raise exception 'Esta invitación es para otra dirección de correo.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workshops w where w.id = v_inv.workshop_id and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '22023';
  end if;

  select * into v_customer from public.customers c where c.id = v_inv.customer_id for update;
  if v_customer.user_id is not null then
    raise exception 'Esta ficha ya está vinculada a una cuenta.' using errcode = '23505';
  end if;
  if exists (select 1 from public.customers c where c.workshop_id = v_inv.workshop_id and c.user_id = v_uid) then
    raise exception 'Tu cuenta ya está vinculada a otra ficha de este taller.' using errcode = '23505';
  end if;

  -- Se ejecuta como propietario de la función: el disparador customers_guard lo permite
  -- porque es el sistema (tras todas las comprobaciones anteriores) quien enlaza.
  update public.customers c set user_id = v_uid where c.id = v_inv.customer_id;
  update public.customer_invitations set status = 'aceptada', accepted_by = v_uid, accepted_at = now() where id = v_inv.id;
  return query select v_inv.workshop_id, v_inv.customer_id;
end;
$$;

-- Desvincular: la ficha y su historial se conservan; la cuenta pierde el acceso al instante.
create function public.unlink_customer_account(p_customer_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if private.managed_customer_workshop(p_customer_id) is null then
    raise exception 'No tienes permiso para gestionar esta ficha.' using errcode = '42501';
  end if;
  update public.customers c set user_id = null where c.id = p_customer_id;
  update public.customer_invitations i set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where i.customer_id = p_customer_id and i.status = 'pendiente';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Funciones del portal (salida controlada, solo lo del propio cliente)
-- ---------------------------------------------------------------------
-- Fichas de cliente de la cuenta actual en talleres no suspendidos.
create function private.portal_customer_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select c.id from public.customers c
  join public.workshops w on w.id = c.workshop_id
  where c.user_id = (select auth.uid()) and w.status <> 'suspendido';
$$;
revoke all on function private.portal_customer_ids() from public, anon, authenticated;

-- Teléfono público del taller (el de su web publicada), si lo hay.
create function private.workshop_public_phone(p_workshop_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select nullif(btrim(s.content ->> 'phone'), '') from public.workshop_sites s
  where s.workshop_id = p_workshop_id and s.published;
$$;
revoke all on function private.workshop_public_phone(uuid) from public, anon, authenticated;

-- Momento de la última novedad visible para el cliente (no revela actividad interna).
create function private.order_last_public_update(p_order_id uuid)
returns timestamptz language sql stable security definer set search_path = ''
as $$
  select max(e.created_at) from public.repair_order_events e
  where e.order_id = p_order_id and e.kind::text in ('creada', 'estado', 'mensaje');
$$;
revoke all on function private.order_last_public_update(uuid) from public, anon, authenticated;

create function public.portal_profile()
returns table (customer_id uuid, workshop_id uuid, workshop_name text, workshop_phone text,
               full_name text, phone text, email text, linked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, w.id, w.name, private.workshop_public_phone(w.id), c.full_name, c.phone, c.email, c.portal_linked_at
  from public.customers c
  join public.workshops w on w.id = c.workshop_id
  where c.id in (select private.portal_customer_ids())
  order by w.name;
$$;

create function public.portal_vehicles()
returns table (id uuid, workshop_id uuid, workshop_name text, plate text, make text, model text,
               year smallint, year_kind public.year_kind, fuel public.fuel_type,
               active_order_id uuid, active_order_number integer, active_status public.repair_status)
language sql stable security definer set search_path = ''
as $$
  select v.id, w.id, w.name, v.plate, v.make, v.model, v.year, v.year_kind, v.fuel,
         a.id, a.number, a.status
  from public.vehicles v
  join public.workshops w on w.id = v.workshop_id
  left join lateral (
    select o.id, o.number, o.status from public.repair_orders o
    where o.vehicle_id = v.id and o.status <> 'entregado'
      and o.customer_id in (select private.portal_customer_ids())
    order by o.received_at desc limit 1
  ) a on true
  where v.customer_id in (select private.portal_customer_ids())
  order by v.plate;
$$;

-- Reparaciones del cliente. Filtro: 'todas', 'en_curso', 'listas', 'finalizadas'.
create function public.portal_orders(p_filter text default 'todas', p_vehicle_id uuid default null)
returns table (id uuid, number integer, workshop_name text, vehicle_id uuid, plate text, make text, model text,
               status public.repair_status, received_at timestamptz, last_update timestamptz,
               delivered_at timestamptz, problem_description text, customer_notes text)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.number, w.name, v.id, v.plate, v.make, v.model, o.status, o.received_at,
         coalesce(private.order_last_public_update(o.id), o.received_at), o.delivered_at,
         o.problem_description, o.customer_notes
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.workshops w on w.id = o.workshop_id
  where o.customer_id in (select private.portal_customer_ids())
    and (p_vehicle_id is null or o.vehicle_id = p_vehicle_id)
    and case coalesce(p_filter, 'todas')
          when 'en_curso' then o.status in ('recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion')
          when 'listas' then o.status = 'listo'
          when 'finalizadas' then o.status = 'entregado'
          else true
        end
  order by o.received_at desc;
$$;

-- Detalle de una reparación del cliente. Diagnosis y trabajo solo si el taller lo autorizó.
create function public.portal_order(p_order_id uuid)
returns table (id uuid, number integer, workshop_name text, workshop_phone text, vehicle_id uuid, plate text, make text, model text,
               status public.repair_status, received_at timestamptz, last_update timestamptz, delivered_at timestamptz,
               problem_description text, customer_notes text, diagnosis text, work_done text)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.number, w.name, private.workshop_public_phone(w.id), v.id, v.plate, v.make, v.model,
         o.status, o.received_at, coalesce(private.order_last_public_update(o.id), o.received_at), o.delivered_at,
         o.problem_description, o.customer_notes,
         case when o.show_details_to_customer then o.diagnosis end,
         case when o.show_details_to_customer then o.work_done end
  from public.repair_orders o
  join public.vehicles v on v.id = o.vehicle_id
  join public.workshops w on w.id = o.workshop_id
  where o.id = p_order_id and o.customer_id in (select private.portal_customer_ids());
$$;

-- Línea temporal visible: creación, cambios de estado y mensajes. Sin nombres ni datos internos.
create function public.portal_order_timeline(p_order_id uuid)
returns table (happened_at timestamptz, kind public.repair_event_kind, status public.repair_status, message text)
language sql stable security definer set search_path = ''
as $$
  select e.created_at, e.kind, e.to_status, e.customer_message
  from public.repair_order_events e
  join public.repair_orders o on o.id = e.order_id
  where e.order_id = p_order_id
    and o.customer_id in (select private.portal_customer_ids())
    and e.kind::text in ('creada', 'estado', 'mensaje')
  order by e.id;
$$;

-- ---------------------------------------------------------------------
-- 5. Permisos de las funciones
-- ---------------------------------------------------------------------
revoke all on function public.create_customer_invitation(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_customer_invitation(uuid) from public, anon, authenticated;
revoke all on function public.get_customer_invitation(text) from public, anon, authenticated;
revoke all on function public.accept_customer_invitation(text) from public, anon, authenticated;
revoke all on function public.unlink_customer_account(uuid) from public, anon, authenticated;
revoke all on function public.portal_profile() from public, anon, authenticated;
revoke all on function public.portal_vehicles() from public, anon, authenticated;
revoke all on function public.portal_orders(text, uuid) from public, anon, authenticated;
revoke all on function public.portal_order(uuid) from public, anon, authenticated;
revoke all on function public.portal_order_timeline(uuid) from public, anon, authenticated;

grant execute on function public.create_customer_invitation(uuid, text) to authenticated, service_role;
grant execute on function public.revoke_customer_invitation(uuid) to authenticated, service_role;
grant execute on function public.get_customer_invitation(text) to authenticated, service_role;
grant execute on function public.accept_customer_invitation(text) to authenticated, service_role;
grant execute on function public.unlink_customer_account(uuid) to authenticated, service_role;
grant execute on function public.portal_profile() to authenticated, service_role;
grant execute on function public.portal_vehicles() to authenticated, service_role;
grant execute on function public.portal_orders(text, uuid) to authenticated, service_role;
grant execute on function public.portal_order(uuid) to authenticated, service_role;
grant execute on function public.portal_order_timeline(uuid) to authenticated, service_role;
