-- =====================================================================
-- Fase 6 · Consulta de datos de vehículos por matrícula (proveedor externo)
--
-- Cambios NO destructivos: un tipo y una tabla nuevos, dos columnas nuevas
-- en vehicles (vacías en los vehículos existentes) y funciones nuevas.
--
-- Reparto de responsabilidades:
--   · start_vehicle_lookup (con el token de la persona): comprueba que es
--     personal ACTIVO del taller, aplica límites, evita duplicados y deja la
--     consulta "pendiente". Si ya hay una respuesta reciente de ese mismo
--     taller para esa matrícula, la reutiliza (sin coste).
--   · El servidor llama al proveedor (clave solo en el servidor).
--   · complete_vehicle_lookup (SOLO con la clave secreta del servidor):
--     guarda el resultado. Nadie más puede escribir resultados, así que un
--     usuario no puede fabricar datos "del proveedor".
--   · Al guardar el vehículo con lookup_id, un disparador comprueba que la
--     consulta es de ese taller y matrícula, y anota campo a campo si el dato
--     del proveedor se ha confirmado o se ha cambiado a mano.
--
-- Los resultados NO se comparten entre talleres: cada taller solo ve y
-- reutiliza sus propias consultas.
-- =====================================================================

create type public.vehicle_lookup_status as enum (
  'pendiente',          -- se está consultando
  'encontrado',         -- el proveedor devolvió datos válidos
  'no_encontrado',      -- el proveedor no conoce esa matrícula
  'respuesta_invalida', -- la respuesta no tenía el formato esperado
  'limite_proveedor',   -- el proveedor rechazó por cuota o límite
  'no_disponible',      -- tiempo agotado o servicio caído
  'credenciales',       -- clave del proveedor incorrecta o caducada
  'error'               -- cualquier otro fallo
);

create table public.vehicle_lookups (
  id            uuid primary key default gen_random_uuid(),
  workshop_id   uuid not null references public.workshops (id) on delete cascade,
  plate         text not null check (plate ~ '^[A-Z0-9]{2,12}$'),
  provider      text not null check (provider ~ '^[a-z0-9_-]{1,40}$'),
  status        public.vehicle_lookup_status not null default 'pendiente',
  -- Datos ya convertidos al modelo interno y validados por el servidor (nunca la respuesta en bruto).
  result        jsonb check (result is null or jsonb_typeof(result) = 'object'),
  request_key   uuid not null,
  requested_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  unique (id, workshop_id),
  -- Un doble clic o un reintento con la misma clave no genera otra consulta.
  unique (workshop_id, request_key),
  check ((status = 'encontrado') = (result is not null))
);
comment on table public.vehicle_lookups is 'Consultas de matrícula a un proveedor externo. Las escribe solo el servidor; cada taller ve las suyas.';
create index vehicle_lookups_plate_idx on public.vehicle_lookups (workshop_id, plate, created_at desc);
create index vehicle_lookups_user_idx on public.vehicle_lookups (requested_by, created_at desc);

revoke all on public.vehicle_lookups from anon, authenticated;
grant all on public.vehicle_lookups to service_role;
grant select (id, workshop_id, plate, provider, status, result, created_at, completed_at) on public.vehicle_lookups to authenticated;
alter table public.vehicle_lookups enable row level security;
create policy "vehicle lookups: lectura personal" on public.vehicle_lookups for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- Vehículos: de qué consulta salen los datos y qué se hizo con cada uno
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column lookup_id uuid,
  add column lookup_fields jsonb check (lookup_fields is null or jsonb_typeof(lookup_fields) = 'object'),
  add foreign key (lookup_id, workshop_id) references public.vehicle_lookups (id, workshop_id) on delete set null (lookup_id);
comment on column public.vehicles.lookup_id is 'Consulta al proveedor de la que salen los datos (null = datos manuales).';
comment on column public.vehicles.lookup_fields is 'Por campo: valor del proveedor y si se confirmó o se cambió a mano. Lo calcula la base de datos.';
create index vehicles_lookup_idx on public.vehicles (lookup_id) where lookup_id is not null;

-- Límites de uso (cambiar aquí si el contrato con el proveedor lo pide).
create function private.vehicle_lookup_limits()
returns table (user_window interval, user_max integer, workshop_daily_max integer, reuse_window interval)
language sql immutable set search_path = ''
as $$ select interval '10 minutes', 10, 100, interval '24 hours'; $$;

-- Compara el vehículo con lo que devolvió el proveedor, campo a campo.
create function private.lookup_field_states(v public.vehicles, r jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  out jsonb := '{}'::jsonb;
  state text;
begin
  if r ? 'make' then
    state := case when v.make is null or btrim(v.make) = '' then 'no_usado'
                  when lower(btrim(v.make)) = lower(btrim(r ->> 'make')) then 'confirmado' else 'modificado' end;
    out := out || jsonb_build_object('make', jsonb_build_object('value', r -> 'make', 'state', state));
  end if;
  if r ? 'model' then
    state := case when v.model is null or btrim(v.model) = '' then 'no_usado'
                  when lower(btrim(v.model)) = lower(btrim(r ->> 'model')) then 'confirmado' else 'modificado' end;
    out := out || jsonb_build_object('model', jsonb_build_object('value', r -> 'model', 'state', state));
  end if;
  if r ? 'year' then
    state := case when v.year is null then 'no_usado'
                  when v.year = (r ->> 'year')::int and v.year_kind::text is not distinct from (r ->> 'year_kind') then 'confirmado'
                  else 'modificado' end;
    out := out || jsonb_build_object('year', jsonb_build_object('value', r -> 'year', 'kind', r -> 'year_kind', 'state', state));
  end if;
  if r ? 'fuel' then
    state := case when v.fuel is null then 'no_usado' when v.fuel::text = r ->> 'fuel' then 'confirmado' else 'modificado' end;
    out := out || jsonb_build_object('fuel', jsonb_build_object('value', r -> 'fuel', 'state', state));
  end if;
  return out;
end;
$$;

create function private.vehicles_lookup()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_lookup public.vehicle_lookups;
  v_states jsonb;
begin
  -- Si cambia la matrícula, la consulta ya no corresponde a este vehículo.
  if tg_op = 'UPDATE' and new.plate is distinct from old.plate then
    new.lookup_id := null;
  end if;

  if new.lookup_id is null then
    new.lookup_fields := null;
    if tg_op = 'UPDATE' and old.lookup_id is not null then
      new.data_source := 'manual';
    end if;
    return new;
  end if;

  select * into v_lookup from public.vehicle_lookups l where l.id = new.lookup_id and l.workshop_id = new.workshop_id;
  if tg_op = 'INSERT' or new.lookup_id is distinct from old.lookup_id then
    if v_lookup.id is null or v_lookup.status <> 'encontrado' or v_lookup.plate <> new.plate
       or v_lookup.completed_at < now() - (select reuse_window from private.vehicle_lookup_limits()) then
      raise exception 'La consulta no corresponde a esta matrícula o ha caducado. Vuelve a consultar.' using errcode = '22023';
    end if;
  end if;

  v_states := private.lookup_field_states(new, v_lookup.result);
  new.lookup_fields := v_states;
  -- "Proveedor externo" solo si al menos un dato del proveedor se ha conservado tal cual.
  new.data_source := case when exists (select 1 from jsonb_each(v_states) e where e.value ->> 'state' = 'confirmado')
                          then 'proveedor_externo' else 'manual' end;
  return new;
end;
$$;
revoke all on function private.lookup_field_states(public.vehicles, jsonb) from public, anon, authenticated;
revoke all on function private.vehicles_lookup() from public, anon, authenticated;
revoke all on function private.vehicle_lookup_limits() from public, anon, authenticated;
-- Se ejecuta después de vehicles_guard (orden alfabético): la matrícula ya está normalizada.
create trigger vehicles_lookup before insert or update on public.vehicles
  for each row execute function private.vehicles_lookup();

-- ---------------------------------------------------------------------
-- Funciones
-- ---------------------------------------------------------------------

-- Empieza una consulta (con el token del usuario). state:
--   'nueva'       → el servidor debe llamar al proveedor y completar la consulta.
--   'reutilizada' → ya hay una respuesta reciente de este taller: no se llama al proveedor.
--   'en_curso'    → la misma consulta se está haciendo ahora mismo (doble clic).
create function public.start_vehicle_lookup(p_workshop_id uuid, p_plate text, p_provider text, p_request_key uuid)
returns table (lookup_id uuid, state text, status public.vehicle_lookup_status, result jsonb, completed_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_plate text := private.normalize_plate(coalesce(p_plate, ''));
  v_lim   record;
  v_row   public.vehicle_lookups;
begin
  if private.my_role_in(p_workshop_id) is null then
    raise exception 'No tienes permiso para consultar matrículas en este taller.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workshops w where w.id = p_workshop_id and w.status = 'suspendido') then
    raise exception 'El taller está suspendido.' using errcode = '42501';
  end if;
  if v_plate !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'La matrícula no es válida.' using errcode = '22023';
  end if;
  if p_provider is null or p_provider !~ '^[a-z0-9_-]{1,40}$' or p_request_key is null then
    raise exception 'Petición no válida.' using errcode = '22023';
  end if;
  select * into v_lim from private.vehicle_lookup_limits();

  -- Misma clave de petición (reintento o doble envío): se devuelve lo que haya.
  select * into v_row from public.vehicle_lookups l where l.workshop_id = p_workshop_id and l.request_key = p_request_key;
  if v_row.id is not null then
    return query select v_row.id, case when v_row.status = 'pendiente' then 'en_curso' else 'reutilizada' end,
                        v_row.status, v_row.result, v_row.completed_at;
    return;
  end if;

  -- Respuesta reciente de ESTE taller para la misma matrícula y proveedor: se reutiliza.
  select * into v_row from public.vehicle_lookups l
   where l.workshop_id = p_workshop_id and l.plate = v_plate and l.provider = p_provider
     and l.status = 'encontrado' and l.completed_at > now() - v_lim.reuse_window
   order by l.completed_at desc limit 1;
  if v_row.id is not null then
    return query select v_row.id, 'reutilizada', v_row.status, v_row.result, v_row.completed_at;
    return;
  end if;

  -- La misma matrícula se está consultando ahora mismo en este taller.
  select * into v_row from public.vehicle_lookups l
   where l.workshop_id = p_workshop_id and l.plate = v_plate and l.status = 'pendiente'
     and l.created_at > now() - interval '1 minute'
   order by l.created_at desc limit 1;
  if v_row.id is not null then
    return query select v_row.id, 'en_curso', v_row.status, v_row.result, v_row.completed_at;
    return;
  end if;

  -- Límites: por persona (ráfagas) y por taller (coste diario).
  perform pg_advisory_xact_lock(hashtextextended('vehicle_lookups:' || p_workshop_id::text, 0));
  if (select count(*) from public.vehicle_lookups l
       where l.requested_by = v_uid and l.created_at > now() - v_lim.user_window) >= v_lim.user_max then
    raise exception 'Has hecho muchas consultas seguidas. Espera unos minutos.' using errcode = 'PT429';
  end if;
  if (select count(*) from public.vehicle_lookups l
       where l.workshop_id = p_workshop_id and l.created_at > now() - interval '1 day') >= v_lim.workshop_daily_max then
    raise exception 'El taller ha alcanzado el límite diario de consultas. Introduce los datos a mano.' using errcode = 'PT429';
  end if;

  insert into public.vehicle_lookups (workshop_id, plate, provider, request_key, requested_by)
  values (p_workshop_id, v_plate, p_provider, p_request_key, v_uid)
  returning * into v_row;
  return query select v_row.id, 'nueva', v_row.status, v_row.result, v_row.completed_at;
end;
$$;

-- Guarda el resultado. SOLO el servidor (clave secreta). Una consulta se completa una vez.
create function public.complete_vehicle_lookup(p_lookup_id uuid, p_status public.vehicle_lookup_status, p_result jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_allowed text[] := array['make', 'model', 'version', 'year', 'year_kind', 'fuel', 'power_cv', 'engine_cc', 'vin'];
begin
  if p_status = 'pendiente' then
    raise exception 'Estado no válido.' using errcode = '22023';
  end if;
  if (p_status = 'encontrado') <> (p_result is not null) then
    raise exception 'Solo una consulta con datos lleva resultado.' using errcode = '22023';
  end if;
  if p_result is not null then
    if jsonb_typeof(p_result) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_result) k where k <> all (v_allowed))
       or not (p_result ? 'make' or p_result ? 'model')
       or exists (select 1 from jsonb_each(p_result) e
                   where e.key in ('make', 'model', 'version', 'year_kind', 'fuel', 'vin') and jsonb_typeof(e.value) <> 'string'
                      or e.key in ('year', 'power_cv', 'engine_cc') and jsonb_typeof(e.value) <> 'number')
       or (p_result ? 'year') <> (p_result ? 'year_kind')
       or (p_result ? 'year_kind' and (p_result ->> 'year_kind') not in ('fabricacion', 'primera_matriculacion'))
       or (p_result ? 'fuel' and not ((p_result ->> 'fuel') = any (enum_range(null::public.fuel_type)::text[])))
       or length(p_result::text) > 4000 then
      raise exception 'Resultado con formato no válido.' using errcode = '22023';
    end if;
  end if;
  update public.vehicle_lookups
     set status = p_status, result = p_result, completed_at = now()
   where id = p_lookup_id and status = 'pendiente';
  if not found then
    raise exception 'La consulta no existe o ya está completada.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.start_vehicle_lookup(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_vehicle_lookup(uuid, public.vehicle_lookup_status, jsonb) from public, anon, authenticated;
grant execute on function public.start_vehicle_lookup(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.complete_vehicle_lookup(uuid, public.vehicle_lookup_status, jsonb) to service_role;
