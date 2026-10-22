-- =====================================================================
-- Cuentas de cliente multitaller
--
-- Ya existía (y se conserva tal cual):
--  · Una cuenta global por persona (Supabase Auth, auth.users + profiles).
--  · Personal: workshop_members (rol por taller). Clientes: una ficha por
--    taller (customers) enlazada a la cuenta con customers.user_id, SOLO
--    mediante invitación (código de un uso, huella, caducidad, mismo correo
--    confirmado). Una cuenta puede estar en varios talleres; nunca en dos
--    fichas del mismo taller (unique (workshop_id, user_id)).
--
-- Esta migración AÑADE (no borra ni cambia datos):
--  1. Historial de vinculaciones cliente ↔ taller (customer_account_links):
--     activa / revocada, origen y fechas. Desvincular ya no borra el rastro.
--  2. Registro de accesos (access_events): altas, roles y bajas del equipo,
--     invitaciones y vinculaciones. Sin tokens, contraseñas ni correos.
--  3. Administración de la plataforma con mínimo privilegio: el administrador
--     global (2FA) ya no ve datos de los talleres por defecto. Para ayudar en
--     una incidencia abre una SESIÓN DE SOPORTE con motivo, que caduca sola y
--     queda registrada. Sin sesión solo ve un resumen sin datos personales.
--  4. Portal por taller: el servidor indica el taller elegido (cabecera
--     x-portal-taller, validada) y TODAS las funciones portal_* devuelven solo
--     lo de ese taller. La cabecera solo puede ESTRECHAR lo que la cuenta ya
--     puede ver, nunca ampliarlo.
--  5. «Mis talleres» (portal_workshops) y entrada desde la web de un taller
--     (workshop_entry): dice si la cuenta está vinculada, sin crear nada.
--  6. Estado de la cuenta de cada cliente para el panel (customer_link_overview).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Registro de accesos
-- ---------------------------------------------------------------------
create table public.access_events (
  id            bigint generated always as identity primary key,
  -- Nulo en los eventos de la plataforma (sesiones de soporte sin taller).
  workshop_id   uuid references public.workshops (id) on delete cascade,
  kind          text not null check (kind in (
                  'miembro_alta', 'miembro_rol', 'miembro_activo', 'miembro_inactivo',
                  'invitacion_equipo_creada', 'invitacion_equipo_revocada', 'invitacion_equipo_aceptada',
                  'invitacion_cliente_creada', 'invitacion_cliente_revocada', 'invitacion_cliente_aceptada',
                  'cliente_vinculado', 'cliente_desvinculado',
                  'soporte_abierto', 'soporte_cerrado', 'soporte_consulta')),
  actor         uuid references auth.users (id) on delete set null,
  subject_user  uuid references auth.users (id) on delete set null,
  -- Sin clave foránea: el registro se conserva aunque la ficha se borre o anonimice.
  customer_id   uuid,
  detail        jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2000),
  created_at    timestamptz not null default now()
);
comment on table public.access_events is 'Cambios de permisos y vinculaciones (quién, qué, cuándo). Solo lo escribe la base de datos; sin tokens, contraseñas ni correos.';
create index access_events_ws_idx on public.access_events (workshop_id, created_at desc);
create index access_events_customer_idx on public.access_events (customer_id) where customer_id is not null;

create function private.log_access(p_ws uuid, p_kind text, p_subject uuid, p_customer uuid, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.access_events (workshop_id, kind, actor, subject_user, customer_id, detail)
  values (p_ws, p_kind, auth.uid(), p_subject, p_customer, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function private.log_access(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Historial de vinculaciones cliente ↔ taller
-- ---------------------------------------------------------------------
create table public.customer_account_links (
  id             uuid primary key default gen_random_uuid(),
  workshop_id    uuid not null references public.workshops (id) on delete cascade,
  customer_id    uuid not null,
  user_id        uuid references auth.users (id) on delete set null,
  status         text not null check (status in ('activa', 'revocada')),
  -- invitacion = aceptó una invitación · migracion = ya estaba vinculada antes de este historial
  -- · sistema = la enlazó la plataforma (sesión de soporte o SQL).
  origin         text not null check (origin in ('invitacion', 'migracion', 'sistema')),
  invitation_id  uuid references public.customer_invitations (id) on delete set null,
  linked_at      timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users (id) on delete set null,
  check ((status = 'activa') = (revoked_at is null)),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id) on delete cascade
);
comment on table public.customer_account_links is 'Historial de vinculación de cada ficha de cliente con una cuenta. La vinculación vigente es customers.user_id; esto es su rastro. Solo lo escribe la base de datos.';
create unique index customer_account_links_one_active on public.customer_account_links (customer_id) where status = 'activa';
create index customer_account_links_ws_idx on public.customer_account_links (workshop_id, linked_at desc);
create index customer_account_links_user_idx on public.customer_account_links (user_id) where user_id is not null;

-- Las fichas ya vinculadas entran en el historial como «migración» (sin inventar fechas).
insert into public.customer_account_links (workshop_id, customer_id, user_id, status, origin, linked_at)
select c.workshop_id, c.id, c.user_id, 'activa', 'migracion', coalesce(c.portal_linked_at, c.created_at)
  from public.customers c where c.user_id is not null;

create function private.customers_link_history()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is distinct from old.user_id then
    update public.customer_account_links
       set status = 'revocada', revoked_at = now(), revoked_by = auth.uid()
     where customer_id = old.id and status = 'activa';
    perform private.log_access(old.workshop_id, 'cliente_desvinculado', old.user_id, old.id);
  end if;
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    -- El origen «invitación» lo completa el disparador de customer_invitations al marcarla aceptada.
    insert into public.customer_account_links (workshop_id, customer_id, user_id, status, origin)
    values (new.workshop_id, new.id, new.user_id, 'activa', 'sistema');
    perform private.log_access(new.workshop_id, 'cliente_vinculado', new.user_id, new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.customers_link_history() from public, anon, authenticated;
create trigger customers_link_history after insert or update of user_id on public.customers
  for each row execute function private.customers_link_history();

-- ---------------------------------------------------------------------
-- 3. Registro de equipo e invitaciones (disparadores)
-- ---------------------------------------------------------------------
create function private.members_access_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_access(new.workshop_id, 'miembro_alta', new.user_id, null, jsonb_build_object('rol', new.role));
  else
    if new.role is distinct from old.role then
      perform private.log_access(new.workshop_id, 'miembro_rol', new.user_id, null, jsonb_build_object('de', old.role, 'a', new.role));
    end if;
    if new.active is distinct from old.active then
      perform private.log_access(new.workshop_id, case when new.active then 'miembro_activo' else 'miembro_inactivo' end, new.user_id, null);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.members_access_log() from public, anon, authenticated;
create trigger members_access_log after insert or update of role, active on public.workshop_members
  for each row execute function private.members_access_log();

create function private.workshop_invitations_access_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_access(new.workshop_id, 'invitacion_equipo_creada', null, null, jsonb_build_object('rol', new.role, 'caduca', new.expires_at));
  elsif new.status is distinct from old.status and new.status::text in ('revocada', 'aceptada') then
    perform private.log_access(new.workshop_id, 'invitacion_equipo_' || new.status::text, new.accepted_by, null, jsonb_build_object('rol', new.role));
  end if;
  return null;
end;
$$;
revoke all on function private.workshop_invitations_access_log() from public, anon, authenticated;
create trigger workshop_invitations_access_log after insert or update of status on public.workshop_invitations
  for each row execute function private.workshop_invitations_access_log();

create function private.customer_invitations_access_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_access(new.workshop_id, 'invitacion_cliente_creada', null, new.customer_id, jsonb_build_object('caduca', new.expires_at));
  elsif new.status is distinct from old.status and new.status::text in ('revocada', 'aceptada') then
    perform private.log_access(new.workshop_id, 'invitacion_cliente_' || new.status::text, new.accepted_by, new.customer_id);
    if new.status::text = 'aceptada' then
      update public.customer_account_links
         set origin = 'invitacion', invitation_id = new.id
       where customer_id = new.customer_id and status = 'activa';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.customer_invitations_access_log() from public, anon, authenticated;
create trigger customer_invitations_access_log after insert or update of status on public.customer_invitations
  for each row execute function private.customer_invitations_access_log();

-- ---------------------------------------------------------------------
-- 4. Administración de la plataforma: sesiones de soporte
-- ---------------------------------------------------------------------
create table public.platform_support_sessions (
  id                  uuid primary key default gen_random_uuid(),
  admin_id            uuid not null references auth.users (id) on delete cascade,
  reason              text not null check (length(btrim(reason)) between 10 and 500),
  -- Taller de la incidencia (informativo, para el registro).
  target_workshop_id  uuid references public.workshops (id) on delete set null,
  opened_at           timestamptz not null default now(),
  expires_at          timestamptz not null,
  closed_at           timestamptz,
  check (expires_at > opened_at and expires_at <= opened_at + interval '2 hours')
);
comment on table public.platform_support_sessions is 'Accesos temporales de la administración de la plataforma a datos de talleres, con motivo. Solo mediante funciones.';
create unique index platform_support_one_open on public.platform_support_sessions (admin_id) where closed_at is null;

-- Administrador de la plataforma con 2FA (sin datos de talleres).
create function private.is_platform_operator()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
     and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;
revoke all on function private.is_platform_operator() from public, anon;
grant execute on function private.is_platform_operator() to authenticated, service_role;

-- Antes: cualquier administrador con 2FA veía TODO, siempre. Ahora, además, una sesión
-- de soporte abierta y sin caducar. Todas las políticas que ya lo usaban lo heredan.
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_platform_operator()
     and exists (select 1 from public.platform_support_sessions s
                  where s.admin_id = (select auth.uid()) and s.closed_at is null and s.expires_at > now());
$$;

create function public.admin_open_support_session(p_reason text, p_workshop_id uuid default null, p_minutes integer default 60)
returns timestamptz
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_exp timestamptz;
begin
  if not private.is_platform_operator() then
    raise exception 'Solo la administración de la plataforma, con verificación en dos pasos.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 or length(btrim(p_reason)) > 500 then
    raise exception 'Explica el motivo (entre 10 y 500 caracteres).' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 120 then
    raise exception 'La sesión dura entre 5 y 120 minutos.' using errcode = '22023';
  end if;
  update public.platform_support_sessions set closed_at = now() where admin_id = v_uid and closed_at is null;
  v_exp := now() + make_interval(mins => p_minutes);
  insert into public.platform_support_sessions (admin_id, reason, target_workshop_id, expires_at)
  values (v_uid, btrim(p_reason), p_workshop_id, v_exp);
  perform private.log_access(p_workshop_id, 'soporte_abierto', v_uid, null,
                             jsonb_build_object('motivo', left(btrim(p_reason), 500), 'hasta', v_exp));
  return v_exp;
end;
$$;

create function public.admin_close_support_session()
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  update public.platform_support_sessions set closed_at = now() where admin_id = v_uid and closed_at is null;
  if found then perform private.log_access(null, 'soporte_cerrado', v_uid, null); end if;
end;
$$;

-- Resumen de talleres SIN datos personales (no necesita sesión de soporte).
create function public.admin_workshops_overview()
returns table (workshop_id uuid, slug text, name text, status public.workshop_status, created_at timestamptz,
               staff_active integer, customers integer, customers_linked integer, pending_invitations integer, site_published boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_operator() then
    raise exception 'Solo la administración de la plataforma, con verificación en dos pasos.' using errcode = '42501';
  end if;
  return query
    select w.id, w.slug, w.name, w.status, w.created_at,
           (select count(*)::int from public.workshop_members m where m.workshop_id = w.id and m.active),
           (select count(*)::int from public.customers c where c.workshop_id = w.id),
           (select count(*)::int from public.customers c where c.workshop_id = w.id and c.user_id is not null),
           (select count(*)::int from public.customer_invitations i where i.workshop_id = w.id and i.status = 'pendiente' and i.expires_at > now()),
           coalesce((select s.published from public.workshop_sites s where s.workshop_id = w.id), false)
      from public.workshops w
     order by w.name;
end;
$$;

-- Diagnóstico de vinculación de una persona (datos personales: exige sesión de soporte y queda registrado).
create function public.admin_link_diagnosis(p_email text)
returns table (account_exists boolean, email_confirmed boolean, workshop_name text, link_status text, since timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  record;
begin
  if not private.is_platform_admin() then
    raise exception 'Abre antes una sesión de soporte con el motivo de la consulta.' using errcode = '42501';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo no válido.' using errcode = '22023';
  end if;
  perform private.log_access(null, 'soporte_consulta', null, null, jsonb_build_object('consulta', 'vinculacion', 'correo', private.mask_email(v_email)));
  select u.id, u.email_confirmed_at into v_user from auth.users u where lower(u.email) = v_email;
  if v_user.id is null then
    return query select false, false, null::text, null::text, null::timestamptz;
    return;
  end if;
  return query
    select true, v_user.email_confirmed_at is not null, w.name, 'activa'::text, l.linked_at
      from public.customer_account_links l join public.workshops w on w.id = l.workshop_id
     where l.user_id = v_user.id and l.status = 'activa'
    union all
    select true, v_user.email_confirmed_at is not null, w.name,
           case when i.expires_at <= now() then 'invitacion_caducada' else 'invitacion_pendiente' end, i.created_at
      from public.customer_invitations i join public.workshops w on w.id = i.workshop_id
     where i.email = v_email and i.status = 'pendiente'
    union all
    select true, v_user.email_confirmed_at is not null, null::text, 'sin_vinculos', null::timestamptz
     where not exists (select 1 from public.customer_account_links l where l.user_id = v_user.id and l.status = 'activa')
       and not exists (select 1 from public.customer_invitations i where i.email = v_email and i.status = 'pendiente');
end;
$$;

-- Últimos eventos de acceso de toda la plataforma (exige sesión de soporte).
create function public.admin_access_events(p_limit integer default 100)
returns table (created_at timestamptz, workshop_name text, kind text, actor uuid, subject_user uuid, customer_id uuid, detail jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Abre antes una sesión de soporte con el motivo de la consulta.' using errcode = '42501';
  end if;
  return query
    select e.created_at, w.name, e.kind, e.actor, e.subject_user, e.customer_id, e.detail
      from public.access_events e left join public.workshops w on w.id = e.workshop_id
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Portal por taller
-- ---------------------------------------------------------------------
-- Taller elegido en el portal (cabecera que envía el servidor tras validarlo). Solo ESTRECHA.
create function private.portal_scope()
returns uuid language plpgsql stable set search_path = ''
as $$
declare
  v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-portal-taller';
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.portal_scope() from public, anon, authenticated;

-- Todas las fichas de la cuenta (para «Mis talleres»), sin el filtro del taller elegido.
create function private.portal_all_customer_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select c.id from public.customers c
  join public.workshops w on w.id = c.workshop_id
  where c.user_id = (select auth.uid()) and w.status <> 'suspendido';
$$;
revoke all on function private.portal_all_customer_ids() from public, anon, authenticated;

-- Lo que usan TODAS las funciones portal_*: ahora, solo el taller elegido (si se eligió).
create or replace function private.portal_customer_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select c.id from public.customers c
  join public.workshops w on w.id = c.workshop_id
  where c.user_id = (select auth.uid()) and w.status <> 'suspendido'
    and (private.portal_scope() is null or c.workshop_id = private.portal_scope());
$$;

-- «Mis talleres»: datos públicos del taller y resumen real de lo del cliente en cada uno.
create function public.portal_workshops()
returns table (workshop_id uuid, customer_id uuid, slug text, name text, logo text, city text, address text, phone text, email text,
               public_host text, linked_at timestamptz, vehicles integer, active_orders integer, ready_orders integer, pending_quotes integer)
language sql stable security definer set search_path = ''
as $$
  select w.id, c.id, w.slug, w.name,
         case when s.published then nullif(s.theme ->> 'logo', '') end,
         case when s.published then nullif(btrim(s.content ->> 'city'), '') end,
         case when s.published then nullif(btrim(s.content ->> 'address'), '') end,
         case when s.published then nullif(btrim(s.content ->> 'phone'), '') end,
         case when s.published then nullif(btrim(s.content ->> 'email'), '') end,
         (select d.hostname from public.workshop_domains d
           where d.workshop_id = w.id and d.verified_at is not null order by d.is_primary desc, d.created_at limit 1),
         c.portal_linked_at,
         (select count(*)::int from public.vehicles v where v.customer_id = c.id and v.portal_hidden_at is null),
         (select count(*)::int from public.repair_orders o where o.customer_id = c.id and o.status not in ('listo', 'entregado')),
         (select count(*)::int from public.repair_orders o where o.customer_id = c.id and o.status = 'listo'),
         (select count(*)::int from public.quotes q where q.customer_id = c.id and q.status = 'enviado')
    from public.customers c
    join public.workshops w on w.id = c.workshop_id
    left join public.workshop_sites s on s.workshop_id = w.id
   where c.id in (select private.portal_all_customer_ids())
   order by w.name;
$$;

-- Entrar desde la web de un taller: ¿esta cuenta tiene relación activa con él? No crea nada.
create function public.workshop_entry(p_slug text)
returns table (workshop_id uuid, name text, phone text, public_host text, linked boolean, pending_invitation boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  return query
    select w.id, w.name,
           case when s.published then nullif(btrim(s.content ->> 'phone'), '') end,
           (select d.hostname from public.workshop_domains d
             where d.workshop_id = w.id and d.verified_at is not null order by d.is_primary desc, d.created_at limit 1),
           exists (select 1 from public.customers c where c.workshop_id = w.id and c.user_id = v_uid),
           exists (select 1 from public.customer_invitations i
                    where i.workshop_id = w.id and i.email = v_email and i.status = 'pendiente' and i.expires_at > now())
      from public.workshops w
      join public.workshop_sites s on s.workshop_id = w.id and s.published
     where w.slug = lower(btrim(coalesce(p_slug, ''))) and w.status <> 'suspendido';
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Panel: estado de la cuenta de cada cliente (sin correos ni tokens)
-- ---------------------------------------------------------------------
create function public.customer_link_overview(p_workshop_id uuid)
returns table (customer_id uuid, status text, since timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_workshop_id is null or p_workshop_id not in (select private.staff_workshop_ids()) then
    raise exception 'No tienes acceso a este taller.' using errcode = '42501';
  end if;
  return query
    select c.id,
           case
             when c.user_id is not null then 'activa'
             when i.id is not null and i.expires_at > now() then 'pendiente'
             when i.id is not null then 'caducada'
             when l.id is not null then 'revocada'
             else 'sin_cuenta'
           end,
           case
             when c.user_id is not null then c.portal_linked_at
             when i.id is not null then i.created_at
             else l.revoked_at
           end
      from public.customers c
      left join lateral (select x.id, x.expires_at, x.created_at from public.customer_invitations x
                          where x.customer_id = c.id and x.status = 'pendiente' order by x.created_at desc limit 1) i on true
      left join lateral (select y.id, y.revoked_at from public.customer_account_links y
                          where y.customer_id = c.id and y.status = 'revocada' order by y.revoked_at desc limit 1) l on true
     where c.workshop_id = p_workshop_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------
revoke all on public.access_events, public.customer_account_links, public.platform_support_sessions from anon, authenticated;
grant all on public.access_events, public.customer_account_links, public.platform_support_sessions to service_role;
grant select on public.access_events, public.customer_account_links to authenticated;
alter table public.access_events enable row level security;
alter table public.customer_account_links enable row level security;
alter table public.platform_support_sessions enable row level security;

create policy "registro de accesos: gerencia del taller" on public.access_events for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()));
create policy "historial de vinculaciones: oficina" on public.customer_account_links for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));

revoke all on function public.admin_open_support_session(text, uuid, integer) from public, anon;
revoke all on function public.admin_close_support_session() from public, anon;
revoke all on function public.admin_workshops_overview() from public, anon;
revoke all on function public.admin_link_diagnosis(text) from public, anon;
revoke all on function public.admin_access_events(integer) from public, anon;
revoke all on function public.portal_workshops() from public, anon;
revoke all on function public.workshop_entry(text) from public, anon;
revoke all on function public.customer_link_overview(uuid) from public, anon;
grant execute on function public.admin_open_support_session(text, uuid, integer) to authenticated;
grant execute on function public.admin_close_support_session() to authenticated;
grant execute on function public.admin_workshops_overview() to authenticated;
grant execute on function public.admin_link_diagnosis(text) to authenticated;
grant execute on function public.admin_access_events(integer) to authenticated;
grant execute on function public.portal_workshops() to authenticated;
grant execute on function public.workshop_entry(text) to authenticated;
grant execute on function public.customer_link_overview(uuid) to authenticated;

-- La copia de cada taller incluye su registro de accesos y su historial de vinculaciones.
create or replace function private.export_tables()
returns table (table_name text, drop_columns text[])
language sql immutable set search_path = ''
as $$
  values
    ('customers', '{}'::text[]), ('vehicles', '{}'), ('repair_orders', '{}'), ('repair_order_items', '{}'),
    ('repair_order_events', '{}'), ('repair_order_work_logs', '{}'), ('service_intervals', '{}'), ('order_services', '{}'),
    ('vehicle_services', '{}'), ('quotes', '{token_hash,response_ip_hash}'), ('quote_items', '{}'), ('invoices', '{}'),
    ('invoice_items', '{}'), ('invoice_records', '{}'), ('payments', '{}'), ('invoice_counters', '{}'), ('workshop_counters', '{}'),
    ('reminders', '{}'), ('reminder_settings', '{}'), ('notifications', '{}'), ('customer_contact_preferences', '{}'),
    ('communication_consent_log', '{}'), ('customer_invitations', '{token_hash}'), ('workshop_invitations', '{token_hash}'),
    ('web_requests', '{client_hash,idempotency_key}'), ('vehicle_lookups', '{request_key}'), ('workshop_billing_settings', '{}'),
    ('workshop_notification_settings', '{}'), ('workshop_sites', '{}'), ('workshop_domains', '{}'), ('workshop_data_exports', '{}'),
    ('access_events', '{}'), ('customer_account_links', '{}')
$$;
