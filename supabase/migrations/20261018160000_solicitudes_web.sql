-- =====================================================================
-- Fase 2 · Solicitudes desde la web pública (contacto, cita, presupuesto)
--
-- · Nuevos campos: motivo del contacto, marca y modelo por separado.
-- · Envíos duplicados: cada formulario manda una "clave de idempotencia";
--   si llega dos veces (doble clic, red lenta, reintento) se guarda una sola vez.
-- · Antispam en la base de datos: límite de envíos por visitante y por taller.
--   El visitante se identifica con una huella anónima (HMAC del IP calculado
--   en el servidor con un secreto): no se guarda el IP.
-- · El estado inicial sigue siendo 'nueva' (= pendiente de revisar por el
--   taller). Una cita 'nueva' NO está confirmada.
-- =====================================================================

alter table public.web_requests
  drop column vehicle,
  add column topic text check (length(topic) <= 60),
  add column vehicle_make text check (length(vehicle_make) <= 60),
  add column vehicle_model text check (length(vehicle_model) <= 80),
  add column idempotency_key uuid,
  add column client_hash text check (length(client_hash) <= 128);

alter table public.web_requests
  add constraint web_requests_idempotency_unique unique (workshop_id, idempotency_key),
  add constraint web_requests_service_len check (length(service) <= 60),
  add constraint web_requests_email_len check (length(email) <= 254),
  add constraint web_requests_preferred_date_range
    check (preferred_date is null or preferred_date <= (created_at at time zone 'Europe/Madrid')::date + 366);

create index web_requests_client_recent_idx on public.web_requests (client_hash, created_at desc) where client_hash is not null;
create index web_requests_workshop_recent_idx on public.web_requests (workshop_id, created_at desc);

comment on column public.web_requests.status is '''nueva'' = pendiente de revisar por el taller. Una cita nueva no está confirmada.';
comment on column public.web_requests.client_hash is 'Huella anónima del visitante (HMAC del IP con secreto del servidor, rota cada día). Solo para limitar abusos; se borra a los 2 días.';
comment on column public.web_requests.idempotency_key is 'Generada por el formulario: evita guardar dos veces el mismo envío.';

-- La función anterior tenía otra firma: se sustituye.
drop function if exists public.submit_web_request(
  uuid, public.request_kind, text, text, text, public.contact_channel, text, text, text, date, public.time_slot, text, boolean, text
);

-- Límites antispam (ajustables).
create function private.web_request_limits()
returns table (per_client integer, client_window interval, per_workshop integer, workshop_window interval)
language sql immutable set search_path = ''
as $$ select 5, interval '10 minutes', 60, interval '1 hour'; $$;

/*
  Registra una solicitud. SOLO la llama el servidor (clave secreta), después de
  validar los datos y el antispam. Devuelve {"id": ..., "duplicate": bool}.

  Errores:
    22023 → datos no válidos           (HTTP 400 vía PostgREST)
    PT404 → el taller no publica web   (HTTP 404)
    PT429 → demasiados envíos          (HTTP 429)
*/
create function public.submit_web_request(
  p_workshop_id uuid,
  p_request jsonb,
  p_idempotency_key uuid,
  p_client_hash text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind public.request_kind;
  v_name text := btrim(coalesce(p_request ->> 'name', ''));
  v_phone text := nullif(btrim(coalesce(p_request ->> 'phone', '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_request ->> 'email', ''))), '');
  v_message text := nullif(btrim(coalesce(p_request ->> 'message', '')), '');
  v_plate text := nullif(private.normalize_plate(coalesce(p_request ->> 'plate', '')), '');
  v_date date;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_limits record;
  v_id uuid;
begin
  -- 1. Idempotencia: si este envío ya se guardó, se devuelve el mismo id.
  if p_idempotency_key is not null then
    select r.id into v_id from public.web_requests r
    where r.workshop_id = p_workshop_id and r.idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_id, 'duplicate', true);
    end if;
  end if;

  -- 2. El taller existe, está activo y tiene la web publicada.
  if not exists (
    select 1 from public.workshop_sites s join public.workshops w on w.id = s.workshop_id
    where s.workshop_id = p_workshop_id and s.published and w.status <> 'suspendido'
  ) then
    raise exception 'Taller no disponible.' using errcode = 'PT404';
  end if;

  -- 3. Antispam.
  select * into v_limits from private.web_request_limits();
  if p_client_hash is not null and (
    select count(*) from public.web_requests r
    where r.client_hash = p_client_hash and r.created_at > now() - v_limits.client_window
  ) >= v_limits.per_client then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  if (
    select count(*) from public.web_requests r
    where r.workshop_id = p_workshop_id and r.created_at > now() - v_limits.workshop_window
  ) >= v_limits.per_workshop then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;

  -- 4. Validación esencial (el servidor ya validó; esto es la última barrera).
  begin
    v_kind := (p_request ->> 'kind')::public.request_kind;
  exception when others then
    raise exception 'Tipo de solicitud no válido.' using errcode = '22023';
  end;
  if v_kind is null then
    raise exception 'Tipo de solicitud no válido.' using errcode = '22023';
  end if;
  if coalesce((p_request ->> 'privacyAccepted')::boolean, false) is not true then
    raise exception 'Es necesario aceptar la política de privacidad.' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 120 then
    raise exception 'Nombre no válido.' using errcode = '22023';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Hace falta un teléfono o un correo.' using errcode = '22023';
  end if;
  if v_plate is not null and length(v_plate) not between 2 and 12 then
    raise exception 'Matrícula no válida.' using errcode = '22023';
  end if;
  if v_kind = 'contacto' and (p_request ->> 'topic') is null then
    raise exception 'Falta el motivo del contacto.' using errcode = '22023';
  end if;
  if v_kind <> 'contacto' and nullif(btrim(coalesce(p_request ->> 'service', '')), '') is null then
    raise exception 'Falta el servicio.' using errcode = '22023';
  end if;
  begin
    v_date := nullif(p_request ->> 'preferredDate', '')::date;
  exception when others then
    raise exception 'Fecha no válida.' using errcode = '22023';
  end;
  if v_date is not null and (v_kind <> 'cita' or v_date < v_today or v_date > v_today + 365) then
    raise exception 'Fecha no válida.' using errcode = '22023';
  end if;

  -- 5. Guardar. Estado inicial: 'nueva' (pendiente de revisar).
  begin
    insert into public.web_requests (
      workshop_id, kind, status, name, phone, email, preferred_contact, topic,
      plate, vehicle_make, vehicle_model, service, preferred_date, preferred_time,
      message, privacy_accepted_at, source_path, idempotency_key, client_hash
    ) values (
      p_workshop_id, v_kind, 'nueva', v_name, v_phone, v_email,
      nullif(p_request ->> 'preferredContact', '')::public.contact_channel,
      case when v_kind = 'contacto' then nullif(btrim(p_request ->> 'topic'), '') end,
      case when v_kind <> 'contacto' then v_plate end,
      case when v_kind <> 'contacto' then nullif(btrim(coalesce(p_request ->> 'make', '')), '') end,
      case when v_kind <> 'contacto' then nullif(btrim(coalesce(p_request ->> 'model', '')), '') end,
      case when v_kind <> 'contacto' then nullif(btrim(coalesce(p_request ->> 'service', '')), '') end,
      case when v_kind = 'cita' then v_date end,
      case when v_kind = 'cita' then nullif(p_request ->> 'preferredTime', '')::public.time_slot end,
      v_message, now(), left(p_request ->> 'sourcePath', 300), p_idempotency_key, p_client_hash
    ) returning id into v_id;
  exception
    when unique_violation then
      -- Dos envíos idénticos a la vez: el otro ya lo guardó.
      select r.id into v_id from public.web_requests r
      where r.workshop_id = p_workshop_id and r.idempotency_key = p_idempotency_key;
      return jsonb_build_object('id', v_id, 'duplicate', true);
    when invalid_text_representation or check_violation or not_null_violation then
      raise exception 'Datos no válidos.' using errcode = '22023';
  end;

  -- 6. Minimización: las huellas antispam no se conservan más de 2 días.
  update public.web_requests set client_hash = null
  where id in (
    select r.id from public.web_requests r
    where r.client_hash is not null and r.created_at < now() - interval '2 days'
    limit 200
  );

  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

revoke all on function private.web_request_limits() from public, anon, authenticated;
grant execute on function private.web_request_limits() to service_role;
revoke all on function public.submit_web_request(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_web_request(uuid, jsonb, uuid, text) to service_role;

-- El personal gestor solo puede cambiar el estado (ver migración anterior) y
-- NO puede leer la huella antispam ni la clave de idempotencia: se concede la
-- lectura columna a columna. (Quitar permiso a una columna no basta si se ha
-- concedido sobre la tabla entera.) Las pantallas del panel deben pedir
-- columnas concretas, no "select *".
revoke select on public.web_requests from authenticated;
grant select (
  id, workshop_id, kind, status, name, phone, email, preferred_contact, topic,
  plate, vehicle_make, vehicle_model, service, preferred_date, preferred_time,
  message, privacy_accepted_at, source_path, created_at, handled_by, handled_at
) on public.web_requests to authenticated;
