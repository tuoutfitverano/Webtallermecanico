-- Auditoría H03: NIF/NIE/CIF con letra o dígito de control.
--
-- Hasta ahora solo se comprobaba la forma (8 a 12 letras y números): un NIF
-- como 12345678A (la letra correcta es Z) se guardaba y acababa en facturas.
-- Misma regla que checkTaxId() en packages/core/src/documents.ts (hay prueba de
-- paridad en supabase/tests/24_nif_control.test.sql).
--
-- · Clientes: identificador español válido o extranjero con el prefijo del país.
-- · Taller (emisor de las facturas): solo español válido.
-- Las restricciones nuevas son NOT VALID: no se rechazan datos ya guardados
-- (no se pierde nada), pero cualquier alta o cambio a partir de ahora se comprueba.

-- Devuelve 'nif', 'nie', 'cif' o 'extranjero'; NULL si no es válido.
create function private.tax_id_kind(p_value text, p_allow_foreign boolean)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p_value, ''), '[\s.-]', '', 'g'));
  letters constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  digits text;
  s int := 0;
  d int;
  control int;
  last text;
  first text;
  must_digit boolean;
  must_letter boolean;
begin
  if v ~ '^ES[A-Z0-9]{9}$' then
    v := substr(v, 3);
  end if;
  if v ~ '^[0-9]{8}[A-Z]$' then
    return case when substr(letters, (substr(v, 1, 8)::bigint % 23)::int + 1, 1) = substr(v, 9, 1) then 'nif' end;
  end if;
  if v ~ '^[KLM][0-9]{7}[A-Z]$' then
    return case when substr(letters, (substr(v, 2, 7)::bigint % 23)::int + 1, 1) = substr(v, 9, 1) then 'nif' end;
  end if;
  if v ~ '^[XYZ][0-9]{7}[A-Z]$' then
    return case when substr(letters, (((position(substr(v, 1, 1) in 'XYZ') - 1)::text || substr(v, 2, 7))::bigint % 23)::int + 1, 1) = substr(v, 9, 1)
                then 'nie' end;
  end if;
  if v ~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' then
    digits := substr(v, 2, 7);
    for i in 1..7 loop
      d := substr(digits, i, 1)::int;
      if i % 2 = 1 then
        s := s + (d * 2) / 10 + (d * 2) % 10;
      else
        s := s + d;
      end if;
    end loop;
    control := (10 - (s % 10)) % 10;
    last := substr(v, 9, 1);
    first := substr(v, 1, 1);
    must_digit := position(first in 'ABEH') > 0;
    must_letter := not must_digit and (position(first in 'PQRSNW') > 0 or digits like '00%');
    if must_letter then
      return case when last = substr('JABCDEFGHI', control + 1, 1) then 'cif' end;
    elsif must_digit then
      return case when last = control::text then 'cif' end;
    end if;
    return case when last = control::text or last = substr('JABCDEFGHI', control + 1, 1) then 'cif' end;
  end if;
  if p_allow_foreign and v ~ '^[A-Z]{2}[A-Z0-9]{2,14}$' and substr(v, 1, 2) = any (array[
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
    'XI', 'GB', 'CH', 'NO', 'IS', 'LI', 'AD', 'MC', 'SM', 'GI', 'MA', 'US']) then
    return 'extranjero';
  end if;
  return null;
end;
$$;

revoke all on function private.tax_id_kind(text, boolean) from public, anon;
-- Las restricciones CHECK la ejecutan con el usuario que escribe.
grant execute on function private.tax_id_kind(text, boolean) to authenticated, service_role;

-- Clientes: la forma antigua (8 a 12) no admitía NIF-IVA extranjeros largos; la sustituye la nueva.
alter table public.customers drop constraint if exists customers_tax_id_check;
alter table public.customers
  add constraint customers_tax_id_valid
  check (tax_id is null or (tax_id ~ '^[A-Z0-9]{8,16}$' and private.tax_id_kind(tax_id, true) is not null)) not valid;

alter table public.workshops
  add constraint workshops_tax_id_valid
  check (tax_id is null or private.tax_id_kind(tax_id, false) is not null) not valid;
