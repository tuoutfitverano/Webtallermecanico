-- =====================================================================
-- Facturación y cobros (operativa).
--
-- ⚠ NO es un sistema VERI*FACTU ni está certificado. Cubre lo operativo
-- (documento, numeración, impuestos, cobros, rectificativas, trazabilidad)
-- siguiendo el Reglamento de facturación (RD 1619/2012): número y serie
-- correlativos, fecha, datos del emisor y del destinatario, descripción,
-- base, tipo y cuota por tipo, total; rectificativas con su propia serie.
-- Para facturar legalmente con este software antes de las fechas de
-- VERI*FACTU (RD 1007/2023 y sus aplazamientos) hace falta revisarlo con un
-- asesor y, para el envío a la AEAT, un proveedor o desarrollo certificado.
-- Ver docs/FACTURACION.md.
--
--  · Borrador editable → EMITIR: se asigna número (serie-año-correlativo,
--    sin huecos), se fijan emisor, destinatario, líneas e importes, y se
--    añade un registro encadenado con huella (SHA-256) que no se puede
--    modificar ni borrar.
--  · Una factura emitida NO se modifica ni se borra: se corrige con una
--    factura RECTIFICATIVA (serie propia) que la referencia.
--  · Cobros completos o parciales; un cobro erróneo se ANULA con motivo (no
--    se borra).
--
-- Importes en céntimos. No borra ni modifica datos existentes.
-- =====================================================================

create type public.invoice_status as enum ('borrador', 'emitida');
create type public.invoice_kind as enum ('ordinaria', 'rectificativa');
create type public.payment_method as enum ('efectivo', 'tarjeta', 'transferencia', 'bizum', 'domiciliacion', 'otro');

create table public.invoice_counters (
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  series       text not null,
  year         integer not null,
  last_number  integer not null default 0 check (last_number >= 0),
  last_date    date,
  primary key (workshop_id, series, year)
);
revoke all on public.invoice_counters from anon, authenticated;
grant all on public.invoice_counters to service_role;
alter table public.invoice_counters enable row level security;

create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  workshop_id           uuid not null references public.workshops (id) on delete cascade,
  kind                  public.invoice_kind not null default 'ordinaria',
  status                public.invoice_status not null default 'borrador',
  series                text,
  year                  integer,
  number                integer,
  full_number           text,
  issue_date            date,
  due_date              date,
  customer_id           uuid not null,
  vehicle_id            uuid,
  order_id              uuid,
  quote_id              uuid references public.quotes (id) on delete set null,
  rectifies_id          uuid references public.invoices (id),
  rectification_reason  text check (length(rectification_reason) <= 500),
  notes                 text check (length(notes) <= 2000),
  -- Datos fijados al emitir (no cambian aunque cambie la ficha).
  issuer                jsonb,
  recipient             jsonb,
  subtotal_cents        bigint,
  tax_cents             bigint,
  total_cents           bigint,
  taxes                 jsonb,
  issued_at             timestamptz,
  issued_by             uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at            timestamptz not null default now(),
  unique (id, workshop_id),
  unique (workshop_id, series, year, number),
  check ((status = 'emitida') = (number is not null)),
  check ((kind = 'rectificativa') = (rectifies_id is not null)),
  foreign key (customer_id, workshop_id) references public.customers (id, workshop_id),
  foreign key (vehicle_id, workshop_id) references public.vehicles (id, workshop_id),
  foreign key (order_id, workshop_id) references public.repair_orders (id, workshop_id)
);
comment on table public.invoices is 'Facturas (operativas, NO certificadas VERI*FACTU). Emitida = inmutable; se corrige con rectificativa.';
create index invoices_workshop_idx on public.invoices (workshop_id, created_at desc);
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_order_idx on public.invoices (order_id) where order_id is not null;

create table public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  workshop_id       uuid not null references public.workshops (id) on delete cascade,
  invoice_id        uuid not null,
  position          integer not null default 0,
  kind              public.line_kind not null,
  description       text not null check (length(btrim(description)) between 1 and 300),
  part_number       text check (length(part_number) <= 60),
  -- Negativa solo en rectificativas (anula o reduce lo facturado).
  quantity          numeric(10, 2) not null check (quantity <> 0 and abs(quantity) <= 100000),
  unit_price_cents  bigint not null check (unit_price_cents between 0 and 100000000),
  discount_pct      numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate          numeric(5, 2) not null check (tax_rate between 0 and 100),
  created_at        timestamptz not null default now(),
  foreign key (invoice_id, workshop_id) references public.invoices (id, workshop_id) on delete cascade
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- Registro encadenado: cada emisión añade una fila cuya huella incluye la anterior.
create table public.invoice_records (
  id           bigint generated always as identity primary key,
  workshop_id  uuid not null references public.workshops (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id),
  kind         text not null check (kind in ('alta')),
  payload      jsonb not null,
  prev_hash    text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  hash         text not null check (hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);
comment on table public.invoice_records is 'Registro de facturas emitidas con huella encadenada (SHA-256). Inmutable. No es el registro VERI*FACTU.';
create index invoice_records_ws_idx on public.invoice_records (workshop_id, id);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  workshop_id   uuid not null references public.workshops (id) on delete cascade,
  invoice_id    uuid not null,
  amount_cents  bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000000),
  method        public.payment_method not null,
  paid_on       date not null default current_date,
  reference     text check (length(reference) <= 120),
  note          text check (length(note) <= 500),
  voided_at     timestamptz,
  voided_by     uuid references auth.users (id) on delete set null,
  void_reason   text check (length(void_reason) <= 300),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  foreign key (invoice_id, workshop_id) references public.invoices (id, workshop_id),
  check ((voided_at is null) = (void_reason is null))
);
comment on table public.payments is 'Cobros (fuera de la plataforma: efectivo, tarjeta en el TPV, transferencia…). No se guardan datos de tarjetas. Un cobro erróneo se anula con motivo.';
create index payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
create function private.invoice_system_op()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(current_setting('app.invoice_op', true), '') = 'on' and current_user not in ('authenticated', 'anon'); $$;
revoke all on function private.invoice_system_op() from public, anon;
grant execute on function private.invoice_system_op() to authenticated, service_role;

create function private.invoices_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare v_customer uuid;
begin
  if private.invoice_system_op() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Los borradores los crean create_invoice_* (kind, rectificación…); a mano, solo ordinarias en borrador.
    new.status := 'borrador'; new.kind := 'ordinaria'; new.rectifies_id := null; new.rectification_reason := null;
    new.series := null; new.year := null; new.number := null; new.full_number := null; new.issue_date := null; new.due_date := null;
    new.issuer := null; new.recipient := null; new.subtotal_cents := null; new.tax_cents := null; new.total_cents := null;
    new.taxes := null; new.issued_at := null; new.issued_by := null;
    new.created_by := auth.uid(); new.created_at := now();
  else
    if old.status = 'emitida' then
      raise exception 'Una factura emitida no se modifica: corrígela con una factura rectificativa.' using errcode = '42501';
    end if;
    new.status := old.status; new.kind := old.kind; new.rectifies_id := old.rectifies_id;
    new.series := old.series; new.year := old.year; new.number := old.number; new.full_number := old.full_number;
    new.issue_date := old.issue_date; new.due_date := old.due_date; new.issuer := old.issuer; new.recipient := old.recipient;
    new.subtotal_cents := old.subtotal_cents; new.tax_cents := old.tax_cents; new.total_cents := old.total_cents;
    new.taxes := old.taxes; new.issued_at := old.issued_at; new.issued_by := old.issued_by;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  if new.vehicle_id is not null and (select v.customer_id from public.vehicles v where v.id = new.vehicle_id) is distinct from new.customer_id then
    raise exception 'El vehículo no es de este cliente.' using errcode = '23514';
  end if;
  if new.order_id is not null then
    select o.customer_id into v_customer from public.repair_orders o where o.id = new.order_id;
    if v_customer is distinct from new.customer_id then
      raise exception 'La orden no es de este cliente.' using errcode = '23514';
    end if;
  end if;
  new.notes := nullif(btrim(new.notes), '');
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.invoices_guard() from public, anon, authenticated;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function private.invoices_guard();
create trigger invoices_keep_workshop before update on public.invoices
  for each row execute function private.keep_workshop_id();

-- Una factura emitida no se borra nunca (tampoco con la clave secreta).
create function private.invoices_no_delete()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status = 'emitida' then
    raise exception 'Una factura emitida no se borra.' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function private.invoices_no_delete() from public, anon, authenticated;
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function private.invoices_no_delete();

create function private.invoice_items_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v public.invoices;
begin
  select * into v from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v.status = 'emitida' then
    raise exception 'Una factura emitida no se modifica: corrígela con una factura rectificativa.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
      raise exception 'Una línea no cambia de factura.' using errcode = '42501';
    end if;
    if new.quantity < 0 and v.kind <> 'rectificativa' then
      raise exception 'Solo una factura rectificativa lleva cantidades negativas.' using errcode = '23514';
    end if;
    new.description := btrim(new.description);
    new.part_number := nullif(btrim(new.part_number), '');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.invoice_items_guard() from public, anon, authenticated;
create trigger invoice_items_guard before insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_guard();
create trigger invoice_items_keep_workshop before update on public.invoice_items
  for each row execute function private.keep_workshop_id();

create function private.invoice_records_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'El registro de facturas no se modifica ni se borra.' using errcode = '42501';
end;
$$;
revoke all on function private.invoice_records_immutable() from public, anon, authenticated;
create trigger invoice_records_immutable before update or delete on public.invoice_records
  for each row execute function private.invoice_records_immutable();

-- Cobros: solo sobre facturas emitidas, sin pasarse del total; no se modifican (se anulan).
create function private.payments_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v       public.invoices;
  v_paid  bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un cobro no se borra: anúlalo indicando el motivo.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if not private.invoice_system_op() then
      raise exception 'Un cobro no se modifica: anúlalo indicando el motivo.' using errcode = '42501';
    end if;
    return new;
  end if;
  select * into v from public.invoices i where i.id = new.invoice_id for update;
  if v.status <> 'emitida' then
    raise exception 'Solo se registran cobros de facturas emitidas.' using errcode = '22023';
  end if;
  if sign(new.amount_cents) <> sign(v.total_cents) then
    raise exception 'El importe del cobro debe tener el mismo signo que la factura.' using errcode = '23514';
  end if;
  select coalesce(sum(p.amount_cents), 0) into v_paid from public.payments p where p.invoice_id = v.id and p.voided_at is null;
  if abs(v_paid + new.amount_cents) > abs(v.total_cents) then
    raise exception 'El cobro supera lo que queda pendiente de la factura.' using errcode = '23514';
  end if;
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  new.created_by := auth.uid(); new.created_at := now();
  new.reference := nullif(btrim(new.reference), '');
  new.note := nullif(btrim(new.note), '');
  if new.paid_on > current_date then
    raise exception 'La fecha del cobro no puede ser futura.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.payments_guard() from public, anon, authenticated;
create trigger payments_guard before insert or update or delete on public.payments
  for each row execute function private.payments_guard();

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke all on public.invoices, public.invoice_items, public.invoice_records, public.payments from anon, authenticated;
grant all on public.invoices, public.invoice_items, public.invoice_records, public.payments to service_role;
grant select on public.invoices, public.invoice_items, public.invoice_records, public.payments to authenticated;
grant insert (workshop_id, customer_id, vehicle_id, order_id, quote_id, notes) on public.invoices to authenticated;
grant update (vehicle_id, order_id, notes) on public.invoices to authenticated;
grant delete on public.invoices to authenticated;
grant insert (workshop_id, invoice_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  on public.invoice_items to authenticated;
grant update (position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate) on public.invoice_items to authenticated;
grant delete on public.invoice_items to authenticated;
grant insert (workshop_id, invoice_id, amount_cents, method, paid_on, reference, note) on public.payments to authenticated;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_records enable row level security;
alter table public.payments enable row level security;
create policy "invoices: lectura oficina" on public.invoices for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoices: alta oficina" on public.invoices for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoices: edición oficina" on public.invoices for update to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoices: borrar borradores" on public.invoices for delete to authenticated
  using (status = 'borrador' and (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin())));
create policy "invoice items: lectura oficina" on public.invoice_items for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoice items: alta oficina" on public.invoice_items for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoice items: edición oficina" on public.invoice_items for update to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()))
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoice items: borrado oficina" on public.invoice_items for delete to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "invoice records: lectura gestores" on public.invoice_records for select to authenticated
  using (workshop_id in (select private.manager_workshop_ids()) or (select private.is_platform_admin()));
create policy "payments: lectura oficina" on public.payments for select to authenticated
  using (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));
create policy "payments: alta oficina" on public.payments for insert to authenticated
  with check (workshop_id in (select private.office_workshop_ids()) or (select private.is_platform_admin()));

-- ---------------------------------------------------------------------
-- Funciones
-- ---------------------------------------------------------------------
create function private.invoice_lines_json(p_invoice_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', i.kind, 'description', i.description, 'part_number', i.part_number, 'quantity', i.quantity,
           'unit_price_cents', i.unit_price_cents, 'discount_pct', i.discount_pct, 'tax_rate', i.tax_rate,
           'base_cents', private.line_base_cents(i.quantity, i.unit_price_cents, i.discount_pct))
         order by i.position, i.created_at), '[]')
    from public.invoice_items i where i.invoice_id = p_invoice_id;
$$;
revoke all on function private.invoice_lines_json(uuid) from public, anon, authenticated;

create function private.require_office_invoice(p_invoice_id uuid)
returns public.invoices language plpgsql stable security definer set search_path = ''
as $$
declare v public.invoices;
begin
  perform private.require_user();
  select * into v from public.invoices i where i.id = p_invoice_id;
  if v.id is null or not (v.workshop_id in (select private.office_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'Factura no encontrada.' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function private.require_office_invoice(uuid) from public, anon, authenticated;

-- Borrador a partir de una orden (sus líneas) o de un presupuesto aceptado.
create function public.create_invoice_draft(p_order_id uuid default null, p_quote_id uuid default null, p_customer_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ws       uuid;
  v_customer uuid;
  v_vehicle  uuid;
  v_order    uuid := p_order_id;
  v_id       uuid;
begin
  perform private.require_user();
  if p_order_id is not null then
    select o.workshop_id, o.customer_id, o.vehicle_id into v_ws, v_customer, v_vehicle from public.repair_orders o where o.id = p_order_id;
  elsif p_quote_id is not null then
    select q.workshop_id, q.customer_id, q.vehicle_id, q.order_id into v_ws, v_customer, v_vehicle, v_order
      from public.quotes q where q.id = p_quote_id and q.status = 'aceptado';
  else
    select c.workshop_id, c.id into v_ws, v_customer from public.customers c where c.id = p_customer_id;
  end if;
  if v_ws is null or not (v_ws in (select private.office_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'No se ha encontrado la orden, el presupuesto aceptado o el cliente.' using errcode = '42501';
  end if;
  perform set_config('app.invoice_op', 'on', true);
  insert into public.invoices (workshop_id, customer_id, vehicle_id, order_id, quote_id, created_by)
  values (v_ws, v_customer, v_vehicle, v_order, p_quote_id, auth.uid()) returning id into v_id;
  if p_order_id is not null then
    insert into public.invoice_items (workshop_id, invoice_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
    select i.workshop_id, v_id, i.position, i.kind, i.description, i.part_number, i.quantity, i.unit_price_cents, i.discount_pct, i.tax_rate
      from public.repair_order_items i where i.order_id = p_order_id;
  elsif p_quote_id is not null then
    insert into public.invoice_items (workshop_id, invoice_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
    select i.workshop_id, v_id, i.position, i.kind, i.description, i.part_number, i.quantity, i.unit_price_cents, i.discount_pct, i.tax_rate
      from public.quote_items i where i.quote_id = p_quote_id;
  end if;
  perform set_config('app.invoice_op', '', true);
  return v_id;
end;
$$;

-- Emitir: número correlativo sin huecos, datos fijados, importes y registro encadenado.
create function public.issue_invoice(p_invoice_id uuid)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v        public.invoices := private.require_office_invoice(p_invoice_id);
  v_w      public.workshops;
  v_c      public.customers;
  v_set    public.workshop_billing_settings;
  v_series text;
  v_year   integer := extract(year from current_date)::integer;
  v_num    integer;
  v_last   date;
  v_tot    jsonb;
  v_full   text;
  v_prev   text;
  v_pay    jsonb;
begin
  if v.status <> 'borrador' then
    raise exception 'La factura ya está emitida.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items i where i.invoice_id = v.id) then
    raise exception 'Añade al menos una línea antes de emitir la factura.' using errcode = '22023';
  end if;
  select * into v_w from public.workshops w where w.id = v.workshop_id;
  select * into v_c from public.customers c where c.id = v.customer_id;
  select * into v_set from public.workshop_billing_settings s where s.workshop_id = v.workshop_id;
  if coalesce(btrim(v_w.legal_name), '') = '' or coalesce(btrim(v_w.tax_id), '') = '' then
    raise exception 'Faltan la razón social y el NIF del taller (Panel → Taller).' using errcode = '22023';
  end if;
  v_series := case when v.kind = 'rectificativa' then v_set.rectifying_series else v_set.invoice_series end;
  v_tot := private.lines_totals(private.invoice_lines_json(v.id));
  if v.kind = 'ordinaria' and (v_tot ->> 'total_cents')::bigint < 0 then
    raise exception 'Una factura ordinaria no puede tener total negativo.' using errcode = '23514';
  end if;

  -- Número: correlativo por serie y año; fecha nunca anterior a la última emitida en la serie.
  insert into public.invoice_counters (workshop_id, series, year, last_number, last_date)
  values (v.workshop_id, v_series, v_year, 0, null) on conflict do nothing;
  select c.last_number + 1, c.last_date into v_num, v_last from public.invoice_counters c
   where c.workshop_id = v.workshop_id and c.series = v_series and c.year = v_year for update;
  if v_last is not null and v_last > current_date then
    raise exception 'La fecha de emisión no puede ser anterior a la de la última factura de la serie.' using errcode = '23514';
  end if;
  update public.invoice_counters c set last_number = v_num, last_date = current_date
   where c.workshop_id = v.workshop_id and c.series = v_series and c.year = v_year;
  v_full := format('%s%s-%s', v_series, v_year, lpad(v_num::text, 4, '0'));

  perform set_config('app.invoice_op', 'on', true);
  update public.invoices i
     set status = 'emitida', series = v_series, year = v_year, number = v_num, full_number = v_full,
         issue_date = current_date, due_date = current_date + coalesce(v_set.payment_terms_days, 0),
         issuer = jsonb_build_object('name', v_w.name, 'legal_name', v_w.legal_name, 'tax_id', v_w.tax_id,
                                     'address', v_w.address_line, 'postal_code', v_w.postal_code, 'city', v_w.city, 'province', v_w.province,
                                     'footer', v_set.invoice_footer),
         recipient = jsonb_build_object('name', v_c.full_name, 'tax_id', v_c.tax_id, 'address', v_c.address_line,
                                        'postal_code', v_c.postal_code, 'city', v_c.city, 'province', v_c.province),
         subtotal_cents = (v_tot ->> 'subtotal_cents')::bigint, tax_cents = (v_tot ->> 'tax_cents')::bigint,
         total_cents = (v_tot ->> 'total_cents')::bigint, taxes = v_tot -> 'taxes',
         issued_at = now(), issued_by = auth.uid()
   where i.id = v.id;
  perform set_config('app.invoice_op', '', true);

  -- Registro encadenado (huella de la factura + huella anterior del taller).
  select r.hash into v_prev from public.invoice_records r where r.workshop_id = v.workshop_id order by r.id desc limit 1;
  v_pay := jsonb_build_object('factura', v_full, 'tipo', v.kind, 'fecha', current_date, 'emisor_nif', v_w.tax_id,
                              'destinatario_nif', v_c.tax_id, 'total_cents', (v_tot ->> 'total_cents')::bigint,
                              'impuestos', v_tot -> 'taxes', 'rectifica', (select r.full_number from public.invoices r where r.id = v.rectifies_id),
                              'momento', now());
  insert into public.invoice_records (workshop_id, invoice_id, kind, payload, prev_hash, hash)
  values (v.workshop_id, v.id, 'alta', v_pay, v_prev,
          encode(sha256(convert_to(coalesce(v_prev, '') || v_pay::text, 'UTF8')), 'hex'));
  return v_full;
end;
$$;

-- Rectificativa: borrador que anula (en negativo) las líneas de la factura original; se puede ajustar antes de emitir.
create function public.create_rectifying_invoice(p_invoice_id uuid, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    public.invoices := private.require_office_invoice(p_invoice_id);
  v_id uuid;
begin
  if not (v.workshop_id in (select private.manager_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'Solo el propietario o un administrador hace facturas rectificativas.' using errcode = '42501';
  end if;
  if v.status <> 'emitida' or v.kind <> 'ordinaria' then
    raise exception 'Solo se rectifica una factura ordinaria emitida.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Explica el motivo de la rectificación.' using errcode = '22023';
  end if;
  perform set_config('app.invoice_op', 'on', true);
  insert into public.invoices (workshop_id, kind, customer_id, vehicle_id, order_id, rectifies_id, rectification_reason, created_by)
  values (v.workshop_id, 'rectificativa', v.customer_id, v.vehicle_id, v.order_id, v.id, btrim(p_reason), auth.uid())
  returning id into v_id;
  insert into public.invoice_items (workshop_id, invoice_id, position, kind, description, part_number, quantity, unit_price_cents, discount_pct, tax_rate)
  select i.workshop_id, v_id, i.position, i.kind, i.description, i.part_number, -i.quantity, i.unit_price_cents, i.discount_pct, i.tax_rate
    from public.invoice_items i where i.invoice_id = v.id;
  perform set_config('app.invoice_op', '', true);
  return v_id;
end;
$$;

-- Anular un cobro erróneo (queda registrado quién y por qué).
create function public.void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v public.payments;
begin
  perform private.require_user();
  select * into v from public.payments p where p.id = p_payment_id;
  if v.id is null or not (v.workshop_id in (select private.manager_workshop_ids()) or private.is_platform_admin()) then
    raise exception 'Solo el propietario o un administrador anula cobros.' using errcode = '42501';
  end if;
  if v.voided_at is not null then
    raise exception 'El cobro ya está anulado.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Explica por qué se anula el cobro.' using errcode = '22023';
  end if;
  perform set_config('app.invoice_op', 'on', true);
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = v.id;
  perform set_config('app.invoice_op', '', true);
end;
$$;

-- Estado de cobro calculado (nunca se guarda: no se desactualiza).
create function public.invoice_balances(p_workshop_id uuid)
returns table (invoice_id uuid, paid_cents bigint, pending_cents bigint, payment_status text, overdue boolean)
language sql stable security invoker set search_path = ''
as $$
  select i.id,
         coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0)::bigint,
         (i.total_cents - coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0))::bigint,
         case when i.total_cents - coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) = 0 then 'cobrada'
              when coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) = 0 then 'pendiente'
              else 'parcial' end,
         (i.due_date < current_date and i.total_cents - coalesce(sum(p.amount_cents) filter (where p.voided_at is null), 0) <> 0)
    from public.invoices i
    left join public.payments p on p.invoice_id = i.id
   where i.workshop_id = p_workshop_id and i.status = 'emitida'
   group by i.id;
$$;

-- Portal: facturas emitidas del propio cliente y su estado de cobro.
create function public.portal_invoices()
returns table (id uuid, workshop_name text, full_number text, kind public.invoice_kind, issue_date date, due_date date,
               total_cents bigint, paid_cents bigint, pending_cents bigint, vehicle text)
language sql stable security definer set search_path = ''
as $$
  select i.id, w.name, i.full_number, i.kind, i.issue_date, i.due_date, i.total_cents,
         coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id and p.voided_at is null), 0)::bigint,
         (i.total_cents - coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id and p.voided_at is null), 0))::bigint,
         (select concat_ws(' ', v.make, v.model, v.plate) from public.vehicles v where v.id = i.vehicle_id)
    from public.invoices i join public.workshops w on w.id = i.workshop_id
   where i.customer_id in (select private.portal_customer_ids()) and i.status = 'emitida'
   order by i.issue_date desc, i.number desc;
$$;

create function public.portal_invoice(p_invoice_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'full_number', i.full_number, 'kind', i.kind, 'issue_date', i.issue_date, 'due_date', i.due_date,
    'issuer', i.issuer, 'recipient', i.recipient, 'lines', private.invoice_lines_json(i.id),
    'subtotal_cents', i.subtotal_cents, 'tax_cents', i.tax_cents, 'total_cents', i.total_cents, 'taxes', i.taxes,
    'rectifies', (select r.full_number from public.invoices r where r.id = i.rectifies_id), 'reason', i.rectification_reason,
    'paid_cents', coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id and p.voided_at is null), 0))
    from public.invoices i
   where i.id = p_invoice_id and i.status = 'emitida' and i.customer_id in (select private.portal_customer_ids());
$$;

revoke all on function public.create_invoice_draft(uuid, uuid, uuid) from public, anon;
revoke all on function public.issue_invoice(uuid) from public, anon;
revoke all on function public.create_rectifying_invoice(uuid, text) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.invoice_balances(uuid) from public, anon;
revoke all on function public.portal_invoices() from public, anon;
revoke all on function public.portal_invoice(uuid) from public, anon;
grant execute on function public.create_invoice_draft(uuid, uuid, uuid) to authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.create_rectifying_invoice(uuid, text) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.invoice_balances(uuid) to authenticated;
grant execute on function public.portal_invoices() to authenticated;
grant execute on function public.portal_invoice(uuid) to authenticated;
