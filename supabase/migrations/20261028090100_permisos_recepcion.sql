-- =====================================================================
-- Rol «recepcionista» (recepción / atención al cliente).
--
--  · Personal del taller: ve y edita clientes y vehículos (como todos).
--  · Órdenes: las ve todas, las crea, asigna mecánico, cambia estado (también
--    «entregado») y escribe el mensaje para el cliente. Igual que un gestor.
--  · Invita a clientes al portal y atiende las solicitudes de la web.
--  · NO gestiona el equipo, ni la configuración del taller o de su web, ni los
--    ajustes de avisos, ni anula facturas (eso, propietario y administrador).
--
-- El «responsable de taller» es el rol administrador (mismo permiso).
-- No borra ni modifica datos existentes.
-- =====================================================================

-- Personal: ahora también recepción.
create or replace function private.staff_workshop_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select private.workshops_with_role('{propietario,administrador,mecanico,recepcionista}'); $$;

-- Oficina: quien gestiona el día a día con clientes (órdenes, presupuestos, facturas, cobros).
create function private.office_workshop_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$ select private.workshops_with_role('{propietario,administrador,recepcionista}'); $$;
revoke all on function private.office_workshop_ids() from public, anon;
grant execute on function private.office_workshop_ids() to authenticated, service_role;

-- can_manage (lo usan los disparadores de órdenes): oficina completa.
-- OJO: SECURITY INVOKER a propósito (ver 08_ordenes_reparacion.test.sql).
create or replace function private.can_manage(p_workshop_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select private.is_privileged() or p_workshop_id in (select private.office_workshop_ids());
$$;

-- Órdenes: lectura, alta y edición para la oficina; el mecánico, solo las suyas.
drop policy "orders: lectura" on public.repair_orders;
drop policy "orders: alta gestores" on public.repair_orders;
drop policy "orders: edición" on public.repair_orders;
create policy "orders: lectura" on public.repair_orders for select to authenticated
  using (
    workshop_id in (select private.office_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  );
create policy "orders: alta oficina" on public.repair_orders for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "orders: edición" on public.repair_orders for update to authenticated
  using (
    workshop_id in (select private.office_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  )
  with check (
    workshop_id in (select private.office_workshop_ids())
    or (assigned_to = (select auth.uid()) and workshop_id in (select private.staff_workshop_ids()))
    or (select private.is_platform_admin())
  );

-- Invitaciones de clientes al portal: también recepción.
drop policy "customer invitations: lectura gestores" on public.customer_invitations;
create policy "customer invitations: lectura oficina" on public.customer_invitations for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create or replace function private.managed_customer_workshop(p_customer_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select c.workshop_id from public.customers c
  where c.id = p_customer_id
    and (c.workshop_id in (select private.office_workshop_ids()) or private.is_platform_admin());
$$;

-- Solicitudes de la web: también recepción (es quien las atiende).
drop policy "requests: lectura gestores" on public.web_requests;
drop policy "requests: estado gestores" on public.web_requests;
create policy "requests: lectura oficina" on public.web_requests for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "requests: estado oficina" on public.web_requests for update to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));

-- Equipo: el propietario invita y cambia a cualquier rol (menos propietario); el
-- administrador invita, revoca y activa/desactiva mecánicos y recepcionistas.
create or replace function public.create_workshop_invitation(p_workshop_id uuid, p_email text, p_role public.member_role)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role  public.member_role := private.my_role_in(p_workshop_id);
  v_admin boolean := private.is_platform_admin();
  v_token text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if not (v_admin or v_role is not distinct from 'propietario'
          or (v_role is not distinct from 'administrador' and p_role::text in ('mecanico', 'recepcionista'))) then
    raise exception 'No tienes permiso para invitar con ese rol en este taller.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'propietario' then
    raise exception 'Solo la plataforma puede asignar propietarios.' using errcode = '42501';
  end if;
  if length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo electrónico no es válido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.workshops w where w.id = p_workshop_id and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.workshop_members m join auth.users u on u.id = m.user_id
    where m.workshop_id = p_workshop_id and m.active and lower(u.email) = v_email
  ) then
    raise exception 'Esa persona ya forma parte del equipo.' using errcode = '23505';
  end if;
  if (select count(*) from public.workshop_invitations i
      where i.workshop_id = p_workshop_id and i.created_at > now() - interval '1 day') >= 50 then
    raise exception 'Demasiadas invitaciones hoy. Inténtalo mañana.' using errcode = 'PT429';
  end if;
  update public.workshop_invitations i
     set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where i.workshop_id = p_workshop_id and i.email = v_email and i.status = 'pendiente';
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.workshop_invitations (workshop_id, email, role, token_hash, invited_by)
  values (p_workshop_id, v_email, p_role, private.invitation_token_hash(v_token), v_uid)
  returning id, workshop_invitations.expires_at into v_id, v_exp;
  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.revoke_workshop_invitation(p_invitation_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_inv  public.workshop_invitations;
  v_role public.member_role;
begin
  select * into v_inv from public.workshop_invitations i where i.id = p_invitation_id for update;
  v_role := private.my_role_in(v_inv.workshop_id);
  if v_inv.id is null
     or not (private.is_platform_admin() or v_role is not distinct from 'propietario'
             or (v_role is not distinct from 'administrador' and v_inv.role::text in ('mecanico', 'recepcionista'))) then
    raise exception 'Invitación no encontrada.' using errcode = '42501';
  end if;
  if v_inv.status <> 'pendiente' then
    raise exception 'La invitación ya no está pendiente.' using errcode = '22023';
  end if;
  update public.workshop_invitations
     set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where id = v_inv.id;
end;
$$;

-- Activar/desactivar: SOLO propietario y administrador (antes bastaba con «no ser
-- mecánico»; con el rol nuevo eso dejaría pasar a recepción).
create or replace function public.set_member_active(p_workshop_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_role   public.member_role := private.my_role_in(p_workshop_id);
  v_admin  boolean := private.is_platform_admin();
  v_target public.workshop_members;
begin
  if not (v_admin or v_role is not distinct from 'propietario' or v_role is not distinct from 'administrador') then
    raise exception 'No tienes permiso para gestionar el equipo de este taller.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'No puedes desactivarte ni reactivarte a ti mismo.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Falta indicar si la persona queda activa.' using errcode = '22023';
  end if;
  select * into v_target from public.workshop_members m
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id for update;
  if v_target.user_id is null then
    raise exception 'Esa persona no pertenece al taller.' using errcode = '22023';
  end if;
  if not v_admin and (v_target.role = 'propietario'
                      or (v_role = 'administrador' and v_target.role::text not in ('mecanico', 'recepcionista'))) then
    raise exception 'No tienes permiso para gestionar a esta persona.' using errcode = '42501';
  end if;
  update public.workshop_members m set active = p_active
   where m.workshop_id = p_workshop_id and m.user_id = p_user_id;
end;
$$;
