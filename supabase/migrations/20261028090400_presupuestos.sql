-- =====================================================================
-- Presupuestos y aprobación digital.
--
--  · Ajustes económicos del taller (IVA por defecto, validez, condiciones,
--    series de factura…): workshop_billing_settings.
--  · Presupuesto P-n con versiones (v1, v2…): mientras es BORRADOR se edita;
--    al ENVIARLO queda fijo (importes calculados por la base de datos). Para
--    cambiarlo se crea una versión nueva y la anterior queda «sustituida».
--  · El cliente responde desde su portal o con un ENLACE SEGURO: código
--    aleatorio de 256 bits del que solo se guarda la huella (SHA-256), que
--    caduca con la validez del presupuesto y sirve una sola vez. La recepción
--    también puede anotar una respuesta dada en el taller.
--  · Al responder se guarda una instantánea (líneas, importes, condiciones,
--    fecha) y su huella, como evidencia. NO es una firma electrónica
--    cualificada.
--  · Al aceptar: la orden queda marcada como aprobada y las líneas pasan al
--    trabajo de la orden.
--
-- Importes en céntimos; reglas de cálculo iguales a packages/core/src/money.ts.
-- No borra ni modifica datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cálculo de importes (misma regla que money.ts)
-- ---------------------------------------------------------------------
create function private.line_base_cents(p_quantity numeric, p_unit_price_cents bigint, p_discount_pct numeric)
returns bigint language sql immutable set search_path = ''
as $$ select round(p_quantity * p_unit_price_cents * (100 - p_discount_pct) / 100)::bigint; $$;

-- p_lines: [{quantity, unit_price_cents, discount_pct, tax_rate}, …]
create function private.lines_totals(p_lines jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  with l as (
    select (x ->> 'tax_rate')::numeric as rate,
           private.line_base_cents((x ->> 'quantity')::numeric, (x ->> 'unit_price_cents')::bigint, coalesce((x ->> 'discount_pct')::numeric, 0)) as base
      from jsonb_array_elements(coalesce(p_lines, '[]')) x
  ), g as (
    select rate, sum(base)::bigint as base, round(sum(base) * rate / 100)::bigint as tax from l group by rate
  )
  select jsonb_build_object(
    'subtotal_cents', coalesce(sum(base), 0),
    'tax_cents', coalesce(sum(tax), 0),
    'total_cents', coalesce(sum(base) + sum(tax), 0),
    'taxes', coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'base_cents', base, 'tax_cents', tax) order by rate desc), '[]'))
  from g;
$$;
revoke all on function private.line_base_cents(numeric, bigint, numeric) from public, anon;
revoke all on function private.lines_totals(jsonb) from public, anon;
grant execute on function private.line_base_cents(numeric, bigint, numeric) to authenticated, service_role;
grant execute on function private.lines_totals(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Ajustes económicos del taller
-- ---------------------------------------------------------------------
create table public.workshop_billing_settings (
  workshop_id          uuid primary key references public.workshops (id) on delete cascade,
  default_tax_rate     numeric(5, 2) not null default 21 check (default_tax_rate between 0 and 100),
  quote_validity_days  integer not null default 30 check (quote_validity_days between 1 and 365),
  labour_rate_cents    bigint check (labour_rate_cents is null or labour_rate_cents between 0 and 100000000),
  invoice_series       text not null default 'F' check (invoice_series ~ '^[A-Z0-9]{1,6}$'),
  rectifying_series    text not null default 'R' check (rectifying_series ~ '^[A-Z0-9]{1,6}$'),
  payment_terms_days   integer not null default 0 check (payment_terms_days between 0 and 365),
  quote_conditions     text check (length(quote_conditions) <= 2000),
  invoice_footer       text check (length(invoice_footer) <= 1000),
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid(),
  check (invoice_series <> rectifying_series)
);
comment on table public.workshop_billing_settings is 'IVA por defecto, validez de presupuestos, series y textos de facturas de cada taller.';
insert into public.workshop_billing_settings (workshop_id) select id from public.workshops on conflict do nothing;

create function private.workshops_billing_defaults()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.workshop_billing_settings (workshop_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.workshops_billing_defaults() from public, anon, authenticated;
create trigger workshops_billing_defaults after insert on public.workshops
  for each row execute function private.workshops_billing_defaults();

revoke all on public.workshop_billing_settings from anon, authenticated;
grant all on public.workshop_billing_settings to service_role;
grant select on public.workshop_billing_settings to authenticated;
grant update (default_tax_rate, quote_validity_days, labour_rate_cents, invoice_series, rectifying_series,
              payment_terms_days, quote_conditions, invoice_footer) on public.workshop_billing_settings to authenticated;
alter table public.workshop_billing_settings enable row level security;
create policy "billing settings: lectura personal" on public.workshop_billing_settings for select to authenticated
  using (workshop_id in (select private.staff_workshop_ids()) or (select private.is_platform_admin()));
create policy "billing settings: edición gestores" on public.workshop_billing_settings for update to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create trigger workshop_billing_settings_updated_at before update on public.workshop_billing_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Presupuestos y sus líneas
-- ---------------------------------------------------------------------
create type public.quote_status as enum ('borrador', 'enviado', 'aceptado', 'rechazado', 'caducado', 'sustituido', 'anulado');

alter table public.workshop_counters add column last_quote_number integer not null default 0 check (last_quote_number >= 0);

create table public.quotes (
  id                  uuid primary key default gen_random_uuid(),
  workshop_id         uuid not null references public.workshops (id) on delete cascade,
  number              integer not null check (number > 0),
  version             integer not null default 1 check (version between 1 and 99),
  customer_id         uuid not null,
  vehicle_id          uuid,
  order_id            uuid,
  status              public.quote_status not null default 'borrador',
  valid_until         date,
  title               text check (length(btrim(title)) between 1 and 160),
  notes               text check (length(notes) <= 2000),
  internal_notes      text check (length(internal_notes) <= 2000),
  conditions          text check (length(conditions) <= 2000),
  subtotal_cents      bigint,
  tax_cents           bigint,
  total_cents         bigint,
  taxes               jsonb,
  token_hash          text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at    timestamptz,
  sent_at             timestamptz,
  responded_at        timestamptz,
  response_source     text check (response_source is null or response_source in ('portal', 'enlace', 'taller')),
  response_name       text check (length(response_name) <= 120),
  response_comment    text check (length(response_comment) <= 1000),
  response_ip_hash    text check (response_ip_hash is null or response_ip_hash ~ '^[0-9a-f]{16,64}$'),
  response_snapshot   jsonb,
  snapshot_hash       text check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  unique (workshop_id, number, version),
  unique (id, workshop_id),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id),
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id),
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id)
);
comment on table public.quotes is 'Presupuestos (P-n, con versiones). Enviado = fijo. Respuesta con instantánea como evidencia.';
comment on column public.quotes.token_hash is 'Huella SHA-256 del enlace para responder. El código solo se muestra una vez.';
create index quotes_workshop_idx on public.quotes (workshop_id, created_at desc);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_order_idx on public.quotes (order_id) where order_id is not null;
create index quotes_pending_idx on public.quotes (workshop_id, valid_until) where status = 'enviado';

create table public.quote_items (
  id                uuid primary key default gen_random_uuid(),
  workshop_id       uuid not null references public.workshops (id) on delete cascade,
  quote_id          uuid not null,
  position          integer not null default 0,
  kind              public.line_kind not null,
  description       text not null check (length(btrim(description)) between 1 and 300),
  part_number       text check (length(part_number) <= 60),
  quantity          numeric(10, 2) not null check (quantity > 0 and quantity <= 100000),
  unit_price_cents  bigint not null check (unit_price_cents between 0 and 100000000),
  discount_pct      numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate          numeric(5, 2) not null check (tax_rate between 0 and 100),
  created_at        timestamptz not null default now(),
  foreign key (quote_id, workshop_id) references public.quotes (id, workshop_id) on delete cascade
);
create index quote_items_quote_idx on public.quote_items (quote_id, position);

alter table public.repair_order_items add column source_quote_id uuid references public.quotes (id) on delete set null;
alter table public.repair_orders
  add column approved_quote_id uuid references public.quotes (id) on delete set null,
  add column approved_at timestamptz;

-- Operaciones de sistema (envío, respuesta, versión): marcan la transacción para pasar el control.
-- Además del indicador, exige estar dentro de una función del sistema (SECURITY DEFINER: el
-- usuario actual es el dueño de la base de datos, no el de la petición).
create function private.quote_system_op()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(current_setting('app.quote_op', true), '') = 'on' and current_user not in ('authenticated', 'anon'); $$;
revoke all on function private.quote_system_op() from public, anon;
grant execute on function private.quote_system_op() to authenticated, service_role;

create function private.next_quote_number(p_workshop_id uuid)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare v integer;
begin
  insert into public.workshop_counters (workshop_id, last_quote_number) values (p_workshop_id, 1)
  on conflict (workshop_id) do update set last_quote_number = public.workshop_counters.last_quote_number + 1
  returning last_quote_number into v;
  return v;
end;
$$;
revoke all on function private.next_quote_number(uuid) from public, anon;
grant execute on function private.next_quote_number(uuid) to authenticated, service_role;

create function private.quotes_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_vehicle_customer uuid;
  v_order_customer   uuid;
begin
  if tg_op = 'INSERT' then
    if not private.quote_system_op() then
      new.number := private.next_quote_number(new.workshop_id);
      new.version := 1;
      new.status := 'borrador';
      new.subtotal_cents := null; new.tax_cents := null; new.total_cents := null; new.taxes := null;
      new.token_hash := null; new.token_expires_at := null; new.sent_at := null;
      new.responded_at := null; new.response_source := null; new.response_name := null; new.response_comment := null;
      new.response_ip_hash := null; new.response_snapshot := null; new.snapshot_hash := null; new.conditions := null;
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  elsif not private.quote_system_op() then
    if old.status <> 'borrador' then
      raise exception 'Un presupuesto enviado no se modifica: crea una versión nueva.' using errcode = '42501';
    end if;
    new.number := old.number; new.version := old.version; new.status := old.status;
    new.subtotal_cents := old.subtotal_cents; new.tax_cents := old.tax_cents; new.total_cents := old.total_cents; new.taxes := old.taxes;
    new.token_hash := old.token_hash; new.token_expires_at := old.token_expires_at; new.sent_at := old.sent_at;
    new.responded_at := old.responded_at; new.response_source := old.response_source; new.response_name := old.response_name;
    new.response_comment := old.response_comment; new.response_ip_hash := old.response_ip_hash;
    new.response_snapshot := old.response_snapshot; new.snapshot_hash := old.snapshot_hash; new.conditions := old.conditions;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.title := nullif(btrim(new.title), '');
  new.notes := nullif(btrim(new.notes), '');
  new.internal_notes := nullif(btrim(new.internal_notes), '');
  -- Vehículo y orden: del mismo cliente.
  if new.vehicle_id is not null then
    select v.customer_id into v_vehicle_customer from public.vehicles v where v.id = new.vehicle_id;
    if v_vehicle_customer is distinct from new.customer_id then
      raise exception 'El vehículo no es de este cliente.' using errcode = '23514';
    end if;
  end if;
  if new.order_id is not null then
    select o.customer_id into v_order_customer from public.repair_orders o where o.id = new.order_id;
    if v_order_customer is distinct from new.customer_id then
      raise exception 'La orden no es de este cliente.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.quotes_guard() from public, anon, authenticated;
create trigger quotes_guard before insert or update on public.quotes
  for each row execute function private.quotes_guard();
create trigger quotes_keep_workshop before update on public.quotes
  for each row execute function private.keep_workshop_id();

-- Las líneas solo cambian mientras el presupuesto es borrador.
create function private.quote_items_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_status public.quote_status;
begin
  if private.quote_system_op() then return coalesce(new, old); end if;
  select q.status into v_status from public.quotes q where q.id = coalesce(new.quote_id, old.quote_id);
  if v_status is distinct from 'borrador' then
    raise exception 'Un presupuesto enviado no se modifica: crea una versión nueva.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.quote_id is distinct from old.quote_id then
    raise exception 'Una línea no cambia de presupuesto.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    new.description := btrim(new.description);
    new.part_number := nullif(btrim(new.part_number), '');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.quote_items_guard() from public, anon, authenticated;
create trigger quote_items_guard before insert or update or delete on public.quote_items
  for each row execute function private.quote_items_guard();
create trigger quote_items_keep_workshop before update on public.quote_items
  for each row execute function private.keep_workshop_id();

revoke all on public.quotes, public.quote_items from anon, authenticated;
grant all on public.quotes, public.quote_items to service_role;
grant select (id, workshop_id, number, version, customer_id, vehicle_id, order_id, status, valid_until, title, notes,
              internal_notes, conditions, subtotal_cents, tax_cents, total_cents, taxes, token_expires_at, sent_at,
              responded_at, response_source, response_name, response_comment, response_snapshot, snapshot_hash,
              created_at, created_by, updated_at)
  on public.quotes to authenticated;
grant insert (workshop_id, customer_id, vehicle_id, order_id, valid_until, title, notes, internal_notes) on public.quotes to authenticated;
grant update (vehicle_id, order_id, valid_until, title, notes, internal_notes) on public.quotes to authenticated;
grant delete on public.quotes to authenticated;
grant select, delete on public.quote_items to authenticated;
grant insert (workshop_id, quote_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  on public.quote_items to authenticated;
grant update (position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  on public.quote_items to authenticated;

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
create policy "quotes: lectura oficina" on public.quotes for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quotes: alta oficina" on public.quotes for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quotes: edición oficina" on public.quotes for update to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quotes: borrar borradores" on public.quotes for delete to authenticated
  using (status = 'borrador' and (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin())));
create policy "quote items: lectura oficina" on public.quote_items for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quote items: alta oficina" on public.quote_items for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quote items: edición oficina" on public.quote_items for update to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "quote items: borrado oficina" on public.quote_items for delete to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- 4. Funciones del flujo
-- ---------------------------------------------------------------------
create function private.quote_lines_json(p_quote_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', i.kind, 'description', i.description, 'part_number', i.part_number, 'quantity', i.quantity,
           'unit_price_cents', i.unit_price_cents, 'discount_pct', i.discount_pct, 'tax_rate', i.tax_rate,
           'base_cents', private.line_base_cents(i.quantity, i.unit_price_cents, i.discount_pct))
         order by i.position, i.created_at), '[]')
    from public.quote_items i where i.quote_id = p_quote_id;
$$;
revoke all on function private.quote_lines_json(uuid) from public, anon, authenticated;

-- Caducan los presupuestos enviados cuya validez ha pasado (lo llama el mantenimiento y cada respuesta).
create function private.expire_quotes()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v integer;
begin
  perform set_config('app.quote_op', 'on', true);
  update public.quotes set status = 'caducado', token_hash = null, token_expires_at = null
   where status = 'enviado' and valid_until < current_date;
  get diagnostics v = row_count;
  perform set_config('app.quote_op', '', true);
  return v;
end;
$$;
revoke all on function private.expire_quotes() from public, anon, authenticated;

create function private.require_office_quote(p_quote_id uuid)
returns public.quotes language plpgsql stable security definer set search_path = ''
as $$
declare v public.quotes;
begin
  perform private.require_user();
  select * into v from public.quotes q where q.id = p_quote_id;
  if v.id is null or not (v.workshop_id in (select private.office_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'Presupuesto no encontrado.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function private.require_office_quote(uuid) from public, anon, authenticated;

create function private.new_quote_token(p_quote_id uuid, p_valid_until date)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform set_config('app.quote_op', 'on', true);
  update public.quotes
     set token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
         token_expires_at = (p_valid_until + 1)::timestamptz
   where id = p_quote_id;
  perform set_config('app.quote_op', '', true);
  return v_token;
end;
$$;
revoke all on function private.new_quote_token(uuid, date) from public, anon, authenticated;

-- Enviar: fija importes y condiciones, crea el enlace (se devuelve UNA vez) y avisa al cliente.
create function public.send_quote(p_quote_id uuid, p_valid_days integer default null)
returns table (token text, valid_until date)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v        public.quotes := private.require_office_quote(p_quote_id);
  v_set    public.workshop_billing_settings;
  v_tot    jsonb;
  v_until  date;
  v_token  text;
  v_vehicle text;
begin
  if v.status <> 'borrador' then
    raise exception 'Solo se envía un presupuesto en borrador.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_items i where i.quote_id = v.id) then
    raise exception 'Añade al menos una línea antes de enviar el presupuesto.' using errcode = '22023';
  end if;
  select * into v_set from public.workshop_billing_settings s where s.workshop_id = v.workshop_id;
  v_until := coalesce(v.valid_until, current_date + coalesce(p_valid_days, v_set.quote_validity_days, 30));
  if v_until < current_date then
    raise exception 'La fecha de validez no puede ser anterior a hoy.' using errcode = '22023';
  end if;
  v_tot := private.lines_totals(private.quote_lines_json(v.id));

  perform set_config('app.quote_op', 'on', true);
  update public.quotes q
     set status = 'enviado', sent_at = now(), valid_until = v_until, conditions = v_set.quote_conditions,
         subtotal_cents = (v_tot ->> 'subtotal_cents')::bigint, tax_cents = (v_tot ->> 'tax_cents')::bigint,
         total_cents = (v_tot ->> 'total_cents')::bigint, taxes = v_tot -> 'taxes'
   where q.id = v.id;
  -- Las versiones anteriores pendientes quedan sustituidas (su enlace deja de valer).
  update public.quotes q set status = 'sustituido', token_hash = null, token_expires_at = null
   where q.workshop_id = v.workshop_id and q.number = v.number and q.id <> v.id and q.status in ('enviado', 'borrador');
  perform set_config('app.quote_op', '', true);
  v_token := private.new_quote_token(v.id, v_until);

  select concat_ws(' ', ve.make, ve.model) into v_vehicle from public.vehicles ve where ve.id = v.vehicle_id;
  perform private.enqueue_notice(
    v.customer_id, 'presupuesto_enviado',
    format('Presupuesto P-%s pendiente de tu respuesta', v.number),
    concat_ws(E'\n', nullif(v_vehicle, ''), coalesce(v.title, 'Presupuesto de reparación'),
              format('Total: %s € (IVA incluido). Válido hasta el %s.',
                     replace(to_char(((v_tot ->> 'total_cents')::numeric / 100), 'FM9999999990.00'), '.', ','), to_char(v_until, 'DD/MM/YYYY')),
              'Puedes verlo y aceptarlo o rechazarlo en tu portal de cliente.'),
    '/portal/presupuestos/' || v.id, v.order_id, 'quote:' || v.id || ':sent');
  return query select v_token, v_until;
end;
$$;

-- Nuevo enlace (el anterior deja de valer).
create function public.new_quote_link(p_quote_id uuid)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare v public.quotes := private.require_office_quote(p_quote_id);
begin
  perform private.expire_quotes();
  select * into v from public.quotes q where q.id = p_quote_id;
  if v.status <> 'enviado' then
    raise exception 'Solo los presupuestos pendientes de respuesta tienen enlace.' using errcode = '22023';
  end if;
  return private.new_quote_token(v.id, v.valid_until);
end;
$$;

-- Versión nueva (borrador) a partir de un presupuesto enviado, rechazado o caducado.
create function public.revise_quote(p_quote_id uuid)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      public.quotes := private.require_office_quote(p_quote_id);
  v_new  uuid;
  v_ver  integer;
begin
  if v.status not in ('enviado', 'rechazado', 'caducado') then
    raise exception 'Solo se crea una versión nueva de un presupuesto enviado, rechazado o caducado.' using errcode = '22023';
  end if;
  select max(q.version) + 1 into v_ver from public.quotes q where q.workshop_id = v.workshop_id and q.number = v.number;
  if exists (select 1 from public.quotes q where q.workshop_id = v.workshop_id and q.number = v.number and q.status = 'borrador') then
    raise exception 'Ya hay una versión en borrador de este presupuesto.' using errcode = '22023';
  end if;
  perform set_config('app.quote_op', 'on', true);
  insert into public.quotes (workshop_id, number, version, customer_id, vehicle_id, order_id, status, title, notes, internal_notes)
  values (v.workshop_id, v.number, v_ver, v.customer_id, v.vehicle_id, v.order_id, 'borrador', v.title, v.notes, v.internal_notes)
  returning id into v_new;
  insert into public.quote_items (workshop_id, quote_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  select i.workshop_id, v_new, i.position, i.kind, i.description, i.part_number, i.quantity, i.unit_price_cents, i.discount_pct, i.tax_rate
    from public.quote_items i where i.quote_id = v.id;
  if v.status = 'enviado' then
    update public.quotes set status = 'sustituido', token_hash = null, token_expires_at = null where id = v.id;
  end if;
  perform set_config('app.quote_op', '', true);
  return v_new;
end;
$$;

create function public.cancel_quote(p_quote_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v public.quotes := private.require_office_quote(p_quote_id);
begin
  if v.status in ('aceptado', 'anulado', 'sustituido') then
    raise exception 'Este presupuesto ya no se puede anular.' using errcode = '22023';
  end if;
  perform set_config('app.quote_op', 'on', true);
  update public.quotes set status = 'anulado', token_hash = null, token_expires_at = null where id = v.id;
  perform set_config('app.quote_op', '', true);
end;
$$;

-- Aplica una respuesta (común a portal, enlace y taller).
create function private.apply_quote_decision(p_quote_id uuid, p_accept boolean, p_source text, p_name text, p_comment text, p_ip_hash text)
returns public.quote_status language plpgsql volatile security definer set search_path = ''
as $$
declare
  v        public.quotes;
  v_snap   jsonb;
  v_status public.quote_status := case when p_accept then 'aceptado' else 'rechazado' end;
begin
  perform private.expire_quotes();
  select * into v from public.quotes q where q.id = p_quote_id for update;
  if v.status = 'caducado' then
    raise exception 'El presupuesto ha caducado. Pide al taller uno nuevo.' using errcode = '22023';
  end if;
  if v.status <> 'enviado' then
    raise exception 'Este presupuesto ya no admite respuesta.' using errcode = '22023';
  end if;
  if p_accept is null then
    raise exception 'Indica si aceptas o rechazas el presupuesto.' using errcode = '22023';
  end if;
  v_snap := jsonb_build_object(
    'presupuesto', format('P-%s', v.number), 'version', v.version, 'decision', v_status, 'fecha', now(),
    'origen', p_source, 'nombre', nullif(btrim(p_name), ''),
    'lineas', private.quote_lines_json(v.id),
    'subtotal_cents', v.subtotal_cents, 'tax_cents', v.tax_cents, 'total_cents', v.total_cents, 'impuestos', v.taxes,
    'valido_hasta', v.valid_until, 'condiciones', v.conditions);
  perform set_config('app.quote_op', 'on', true);
  update public.quotes
     set status = v_status, responded_at = now(), response_source = p_source,
         response_name = left(nullif(btrim(p_name), ''), 120), response_comment = left(nullif(btrim(p_comment), ''), 1000),
         response_ip_hash = p_ip_hash, response_snapshot = v_snap,
         snapshot_hash = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex'),
         token_hash = null, token_expires_at = null
   where id = v.id;
  perform set_config('app.quote_op', '', true);

  if p_accept and v.order_id is not null then
    update public.repair_orders set approved_quote_id = v.id, approved_at = now() where id = v.order_id;
    insert into public.repair_order_items (workshop_id, order_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate, source_quote_id)
    select i.workshop_id, v.order_id, 1000 + i.position, i.kind, i.description, i.part_number, i.quantity, i.unit_price_cents, i.discount_pct, i.tax_rate, v.id
      from public.quote_items i where i.quote_id = v.id
       and not exists (select 1 from public.repair_order_items x where x.order_id = v.order_id and x.source_quote_id = v.id);
  end if;
  return v_status;
end;
$$;
revoke all on function private.apply_quote_decision(uuid, boolean, text, text, text, text) from public, anon, authenticated;

-- Respuesta dada en el taller (en persona o por teléfono), anotada por la oficina.
create function public.record_quote_decision(p_quote_id uuid, p_accept boolean, p_name text, p_comment text default null)
returns public.quote_status language plpgsql volatile security definer set search_path = ''
as $$
declare v public.quotes := private.require_office_quote(p_quote_id);
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Escribe quién ha dado la respuesta.' using errcode = '22023';
  end if;
  return private.apply_quote_decision(v.id, p_accept, 'taller', p_name, p_comment, null);
end;
$$;

-- Respuesta del cliente desde su portal.
create function public.respond_quote_portal(p_quote_id uuid, p_accept boolean, p_comment text default null)
returns public.quote_status language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_customer uuid;
  v_name     text;
begin
  perform private.require_user();
  select q.customer_id, c.full_name into v_customer, v_name
    from public.quotes q join public.customers c on c.id = q.customer_id where q.id = p_quote_id;
  if v_customer is null or v_customer not in (select private.portal_customer_ids()) then
    raise exception 'Presupuesto no encontrado.' using errcode = '42501';
  end if;
  return private.apply_quote_decision(p_quote_id, p_accept, 'portal', v_name, p_comment, null);
end;
$$;

-- Enlace público: lo usa SOLO el servidor (clave secreta) tras comprobar el código.
create function public.quote_by_token(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    public.quotes;
  v_w  public.workshops;
  v_ve public.vehicles;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  perform private.expire_quotes();
  select * into v from public.quotes q
   where q.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and q.token_expires_at > now();
  if v.id is null then return null; end if;
  select * into v_w from public.workshops w where w.id = v.workshop_id;
  if v_w.status = 'suspendido' then return null; end if;
  select * into v_ve from public.vehicles ve where ve.id = v.vehicle_id;
  -- Solo lo necesario: nada del cliente; de la matrícula, las 3 últimas cifras.
  return jsonb_build_object(
    'workshop_name', v_w.name, 'workshop_phone', private.workshop_public_phone(v_w.id),
    'number', v.number, 'version', v.version, 'status', v.status, 'title', v.title, 'notes', v.notes,
    'valid_until', v.valid_until, 'conditions', v.conditions,
    'vehicle', case when v_ve.id is null then null else concat_ws(' ', v_ve.make, v_ve.model) end,
    'plate_hint', case when v_ve.id is null then null else right(v_ve.plate, 3) end,
    'lines', private.quote_lines_json(v.id),
    'subtotal_cents', v.subtotal_cents, 'tax_cents', v.tax_cents, 'total_cents', v.total_cents, 'taxes', v.taxes);
end;
$$;

create function public.respond_quote_by_token(p_token text, p_accept boolean, p_name text, p_comment text, p_ip_hash text)
returns public.quote_status language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no válido o caducado.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Escribe tu nombre para responder.' using errcode = '22023';
  end if;
  select q.id into v_id from public.quotes q
   where q.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and q.token_expires_at > now();
  if v_id is null then
    raise exception 'Enlace no válido o caducado.' using errcode = '22023';
  end if;
  return private.apply_quote_decision(v_id, p_accept, 'enlace', p_name, p_comment, p_ip_hash);
end;
$$;

-- Portal: presupuestos del propio cliente (nunca borradores, notas internas ni otras versiones sin enviar).
create function public.portal_quotes()
returns table (id uuid, workshop_name text, number integer, version integer, status public.quote_status, title text,
               vehicle text, plate text, total_cents bigint, valid_until date, sent_at timestamptz, responded_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select q.id, w.name, q.number, q.version, q.status, q.title, concat_ws(' ', ve.make, ve.model), ve.plate,
         q.total_cents, q.valid_until, q.sent_at, q.responded_at
    from public.quotes q
    join public.workshops w on w.id = q.workshop_id
    left join public.vehicles ve on ve.id = q.vehicle_id
   where q.customer_id in (select private.portal_customer_ids())
     and q.status in ('enviado', 'aceptado', 'rechazado', 'caducado')
   order by q.sent_at desc nulls last;
$$;

create function public.portal_quote(p_quote_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    public.quotes;
  v_ve public.vehicles;
begin
  perform private.require_user();
  perform private.expire_quotes();
  select * into v from public.quotes q where q.id = p_quote_id;
  if v.id is null or v.customer_id not in (select private.portal_customer_ids())
     or v.status not in ('enviado', 'aceptado', 'rechazado', 'caducado') then
    return null;
  end if;
  select * into v_ve from public.vehicles ve where ve.id = v.vehicle_id;
  return jsonb_build_object(
    'id', v.id, 'workshop_name', (select w.name from public.workshops w where w.id = v.workshop_id),
    'number', v.number, 'version', v.version, 'status', v.status, 'title', v.title, 'notes', v.notes,
    'valid_until', v.valid_until, 'conditions', v.conditions, 'sent_at', v.sent_at,
    'responded_at', v.responded_at, 'response_source', v.response_source,
    'vehicle', case when v_ve.id is null then null else concat_ws(' ', v_ve.make, v_ve.model) end,
    'plate', v_ve.plate, 'order_id', v.order_id,
    'lines', private.quote_lines_json(v.id),
    'subtotal_cents', v.subtotal_cents, 'tax_cents', v.tax_cents, 'total_cents', v.total_cents, 'taxes', v.taxes);
end;
$$;

-- Vista previa de importes de un borrador (para el panel; la oficina del taller).
create function public.quote_totals(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v public.quotes := private.require_office_quote(p_quote_id);
begin
  return private.lines_totals(private.quote_lines_json(v.id));
end;
$$;

revoke all on function public.send_quote(uuid, integer) from public, anon;
revoke all on function public.new_quote_link(uuid) from public, anon;
revoke all on function public.revise_quote(uuid) from public, anon;
revoke all on function public.cancel_quote(uuid) from public, anon;
revoke all on function public.record_quote_decision(uuid, boolean, text, text) from public, anon;
revoke all on function public.respond_quote_portal(uuid, boolean, text) from public, anon;
revoke all on function public.quote_by_token(text) from public, anon, authenticated;
revoke all on function public.respond_quote_by_token(text, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.portal_quotes() from public, anon;
revoke all on function public.portal_quote(uuid) from public, anon;
revoke all on function public.quote_totals(uuid) from public, anon;
grant execute on function public.send_quote(uuid, integer) to authenticated;
grant execute on function public.new_quote_link(uuid) to authenticated;
grant execute on function public.revise_quote(uuid) to authenticated;
grant execute on function public.cancel_quote(uuid) to authenticated;
grant execute on function public.record_quote_decision(uuid, boolean, text, text) to authenticated;
grant execute on function public.respond_quote_portal(uuid, boolean, text) to authenticated;
grant execute on function public.quote_by_token(text) to service_role;
grant execute on function public.respond_quote_by_token(text, boolean, text, text, text) to service_role;
grant execute on function public.portal_quotes() to authenticated;
grant execute on function public.portal_quote(uuid) to authenticated;
grant execute on function public.quote_totals(uuid) to authenticated;
