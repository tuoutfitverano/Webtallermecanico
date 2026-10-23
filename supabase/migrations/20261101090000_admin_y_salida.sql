-- =====================================================================
-- Pantalla de administración y «dejar un taller» desde el portal
--
--  · admin_status(): lo mínimo que necesita la pantalla /admin para saber si
--    quien la abre es de la administración de la plataforma, si ha entrado
--    con verificación en dos pasos y si tiene una sesión de soporte abierta.
--    A cualquier otra persona no le devuelve nada (ni siquiera «no eres admin»).
--  · portal_leave_workshop(): el propio cliente deja de ver un taller en su
--    portal. No borra nada: el taller conserva la ficha, los vehículos, las
--    reparaciones y las facturas; queda en el historial que lo retiró el
--    cliente; para volver hace falta una invitación nueva del taller.
-- No borra ni modifica datos existentes.
-- =====================================================================

create function public.admin_status()
returns table (mfa boolean, support_until timestamptz, support_reason text, support_workshop_id uuid)
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2', s.expires_at, s.reason, s.target_workshop_id
    from public.platform_admins pa
    left join lateral (
      select x.expires_at, x.reason, x.target_workshop_id from public.platform_support_sessions x
       where x.admin_id = pa.user_id and x.closed_at is null and x.expires_at > now()
       order by x.opened_at desc limit 1) s on true
   where pa.user_id = (select auth.uid());
$$;
revoke all on function public.admin_status() from public, anon;
grant execute on function public.admin_status() to authenticated;

create function public.portal_leave_workshop(p_workshop_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
begin
  select c.id into v_id from public.customers c
   where c.workshop_id = p_workshop_id and c.user_id = v_uid
   for update;
  if v_id is null then
    raise exception 'No estás vinculado a este taller.' using errcode = '42501';
  end if;
  -- El disparador customers_link_history anota la retirada (por el propio cliente).
  update public.customers c set user_id = null where c.id = v_id;
  update public.customer_invitations i set status = 'revocada', revoked_at = now(), revoked_by = v_uid
   where i.customer_id = v_id and i.status = 'pendiente';
end;
$$;
revoke all on function public.portal_leave_workshop(uuid) from public, anon;
grant execute on function public.portal_leave_workshop(uuid) to authenticated;
