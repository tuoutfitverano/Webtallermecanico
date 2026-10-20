-- =====================================================================
-- Plantilla · Solicitudes de digitalización desde la web de demostración
--
-- La web del taller demo (AutoValue) incluye una sección comercial dirigida
-- a propietarios de otros talleres: «Quiero digitalizar mi taller». Esas
-- solicitudes se guardan en web_requests con el tipo nuevo 'digitalizacion'
-- y llegan a la bandeja «Solicitudes web» del taller demo.
--
-- · Solo se aceptan en un taller de DEMOSTRACIÓN (workshops.status = 'demo')
--   con la sección comercial activada en su web
--   (workshop_sites.theme → sections → comercial = true). La web de un taller
--   real nunca recibe este tipo, aunque alguien lo envíe a mano.
-- · Campos propios: nombre del taller (business_name) e interés (topic:
--   web, software, web_y_software, informacion). No guardan vehículo, servicio
--   ni fechas.
-- · Valor nuevo de un enum: no se puede usar en la misma transacción que lo
--   crea, por eso se compara siempre kind::text.
-- =====================================================================

alter type public.request_kind add value if not exists 'digitalizacion';

alter table public.web_requests
  add column business_name text check (length(btrim(business_name)) between 2 and 120);

alter table public.web_requests
  add constraint web_requests_business_name_kind
    check ((kind::text = 'digitalizacion') = (business_name is not null));

comment on column public.web_requests.business_name is 'Solo en solicitudes de digitalización: nombre del taller que pide la demostración.';

-- El personal gestor lee la columna nueva (los permisos de lectura van columna a columna).
grant select (business_name) on public.web_requests to authenticated;

/*
  Igual que la versión anterior (Fase 2) más el tipo 'digitalizacion'.
  Errores:
    22023 → datos no válidos           (HTTP 400 vía PostgREST)
    PT404 → el taller no publica web   (HTTP 404)
    PT429 → demasiados envíos          (HTTP 429)
*/
create or replace function public.submit_web_request(
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
  v_kind_text text;
  v_name text := btrim(coalesce(p_request ->> 'name', ''));
  v_phone text := nullif(btrim(coalesce(p_request ->> 'phone', '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_request ->> 'email', ''))), '');
  v_message text := nullif(btrim(coalesce(p_request ->> 'message', '')), '');
  v_plate text := nullif(private.normalize_plate(coalesce(p_request ->> 'plate', '')), '');
  v_business text := nullif(btrim(coalesce(p_request ->> 'businessName', '')), '');
  v_topic text := nullif(btrim(coalesce(p_request ->> 'topic', '')), '');
  v_vehicle_kind boolean;
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
  v_kind_text := v_kind::text;
  v_vehicle_kind := v_kind_text in ('cita', 'presupuesto');

  -- Digitalización: solo en un taller de demostración con la sección comercial activada.
  if v_kind_text = 'digitalizacion' and not exists (
    select 1 from public.workshop_sites s join public.workshops w on w.id = s.workshop_id
    where s.workshop_id = p_workshop_id and w.status = 'demo'
      and s.theme -> 'sections' -> 'comercial' = 'true'::jsonb
  ) then
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
  if v_kind_text = 'contacto' and v_topic is null then
    raise exception 'Falta el motivo del contacto.' using errcode = '22023';
  end if;
  if v_kind_text = 'digitalizacion' then
    if v_business is null or length(v_business) not between 2 and 120 then
      raise exception 'Falta el nombre del taller.' using errcode = '22023';
    end if;
    if v_topic is null or v_topic not in ('web', 'software', 'web_y_software', 'informacion') then
      raise exception 'Interés no válido.' using errcode = '22023';
    end if;
  end if;
  if v_vehicle_kind and nullif(btrim(coalesce(p_request ->> 'service', '')), '') is null then
    raise exception 'Falta el servicio.' using errcode = '22023';
  end if;
  begin
    v_date := nullif(p_request ->> 'preferredDate', '')::date;
  exception when others then
    raise exception 'Fecha no válida.' using errcode = '22023';
  end;
  if v_date is not null and (v_kind_text <> 'cita' or v_date < v_today or v_date > v_today + 365) then
    raise exception 'Fecha no válida.' using errcode = '22023';
  end if;

  -- 5. Guardar. Estado inicial: 'nueva' (pendiente de revisar).
  begin
    insert into public.web_requests (
      workshop_id, kind, status, name, phone, email, preferred_contact, topic, business_name,
      plate, vehicle_make, vehicle_model, service, preferred_date, preferred_time,
      message, privacy_accepted_at, source_path, idempotency_key, client_hash
    ) values (
      p_workshop_id, v_kind, 'nueva', v_name, v_phone, v_email,
      nullif(p_request ->> 'preferredContact', '')::public.contact_channel,
      case when v_kind_text in ('contacto', 'digitalizacion') then v_topic end,
      case when v_kind_text = 'digitalizacion' then v_business end,
      case when v_vehicle_kind then v_plate end,
      case when v_vehicle_kind then nullif(btrim(coalesce(p_request ->> 'make', '')), '') end,
      case when v_vehicle_kind then nullif(btrim(coalesce(p_request ->> 'model', '')), '') end,
      case when v_vehicle_kind then nullif(btrim(coalesce(p_request ->> 'service', '')), '') end,
      case when v_kind_text = 'cita' then v_date end,
      case when v_kind_text = 'cita' then nullif(p_request ->> 'preferredTime', '')::public.time_slot end,
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

-- «create or replace» conserva los permisos, pero se repiten por claridad.
revoke all on function public.submit_web_request(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_web_request(uuid, jsonb, uuid, text) to service_role;
