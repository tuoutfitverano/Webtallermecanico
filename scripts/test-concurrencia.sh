#!/usr/bin/env bash
# Pruebas de CONCURRENCIA reales: varias conexiones a la vez contra PostgreSQL.
#
# Las pruebas de supabase/tests/ van en una sola transacción y no pueden
# probar carreras. Aquí se lanzan N sesiones simultáneas (cada una como un
# usuario autenticado distinto, con RLS) y se comprueba el resultado final:
#   1. N facturas emitidas a la vez → números 1..N, sin huecos ni repetidos.
#   2. N cobros a la vez de la mitad del total → solo caben 2 (nunca más del total).
#   3. Aceptar el mismo presupuesto N veces a la vez → una sola respuesta registrada.
#   4. Dos mecánicos cogiendo la misma orden libre a la vez → solo uno se la queda.
#   5. N altas de la misma matrícula a la vez → un solo vehículo.
#
# Usa una base de datos temporal propia (talleres_concurrencia) que se borra al final.
# Variables opcionales: PGHOST, PGPORT, PGUSER, N (sesiones simultáneas, 8 por defecto).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB=talleres_concurrencia
N="${N:-8}"
if [ "$(id -u)" = "0" ] && [ -z "${PGUSER:-}" ]; then PSQL=(runuser -u postgres -- psql); else PSQL=(psql); fi
PSQL+=(-X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
run_file() { "${PSQL[@]}" -d "$DB" -f "$1"; }
# shellcheck source=lib/supabase-auth.sh
source "$ROOT/scripts/lib/supabase-auth.sh"
run_file "$ROOT/supabase/tests/_harness/supabase_roles.sql" >/dev/null
auth_migrate "$DB" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do run_file "$f" >/dev/null; done
(cd "$ROOT/supabase/tests" && run_file _harness/fixtures.sql >/dev/null)

sql() { "${PSQL[@]}" -d "$DB" -At -c "$1"; }
# Sesión de un usuario autenticado (RLS) que ejecuta $2.
as_user() {
  { "${PSQL[@]}" -d "$DB" -At -c "begin; select tests.login('$1'); set local role authenticated; $2; commit;" 2>&1 || true; } | { grep -v '^$' || true; } | tail -1
}

OWNER=00000000-0000-0000-0000-0000000000a1
MECH=00000000-0000-0000-0000-0000000000a2
MANAGER=00000000-0000-0000-0000-0000000000a3
CLIENT=00000000-0000-0000-0000-0000000000c1
WS=aaaaaaaa-0000-0000-0000-000000000000
failed=0
check() { if [ "$1" = "$2" ]; then echo "✔ $3"; else echo "✘ $3 (obtenido: $1, esperado: $2)"; failed=$((failed + 1)); fi; }

# Datos fiscales para poder emitir.
sql "update public.workshops set legal_name = 'Taller Alcarria S.L.', tax_id = 'B12345674' where id = '$WS';
     update public.customers set tax_id = '12345678Z', address_line = 'Calle Mayor 1', postal_code = '19001', city = 'Guadalajara' where id = 'c1000000-0000-0000-0000-00000000000a';" >/dev/null

# ---------- 1. Facturas a la vez ----------
drafts=()
for i in $(seq 1 "$N"); do
  order=$(as_user $OWNER "insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description) values ('$WS', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Concurrencia $i') returning id")
  as_user $OWNER "insert into public.repair_order_items (workshop_id, order_id, position, kind, description, quantity, unit_price_cents, tax_rate) values ('$WS', '$order', 1, 'mano_obra', 'Trabajo', 1, 10000, 21)" >/dev/null
  drafts+=("$(as_user $OWNER "select public.create_invoice_draft('$order')")")
done
pids=()
for d in "${drafts[@]}"; do as_user $OWNER "select public.issue_invoice('$d')" >/dev/null & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || true; done
check "$(sql "select count(*) from public.invoices where workshop_id = '$WS' and status = 'emitida'")" "$N" "1. $N facturas emitidas a la vez: todas emitidas"
check "$(sql "select string_agg(n::text, ',' order by n) from (select split_part(full_number, '-', 2)::int n from public.invoices where workshop_id = '$WS' and status = 'emitida') x")" \
      "$(seq -s, 1 "$N")" "   numeración correlativa 1..$N sin huecos ni repetidos"
check "$(sql "select count(*) from (select full_number from public.invoices where full_number is not null group by full_number having count(*) > 1) x")" "0" "   ningún número repetido"

# ---------- 2. Cobros a la vez ----------
inv=${drafts[0]}
total=$(sql "select total_cents from public.invoices where id = '$inv'")
half=$((total / 2))
pids=()
for i in $(seq 1 "$N"); do as_user $OWNER "insert into public.payments (workshop_id, invoice_id, amount_cents, method) values ('$WS', '$inv', $half, 'efectivo')" >/dev/null & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || true; done
check "$(sql "select count(*) from public.payments where invoice_id = '$inv' and voided_at is null")" "2" "2. $N cobros de la mitad a la vez: solo caben 2"
check "$(sql "select (sum(amount_cents) <= $total)::text from public.payments where invoice_id = '$inv' and voided_at is null")" "true" "   lo cobrado nunca supera el total"

# ---------- 3. Presupuesto aceptado a la vez ----------
qorder=$(as_user $OWNER "insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description) values ('$WS', '7e000001-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Con presupuesto') returning id")
quote=$(as_user $OWNER "insert into public.quotes (workshop_id, customer_id, vehicle_id, order_id, title) values ('$WS', 'c1000000-0000-0000-0000-00000000000a', '7e000001-0000-0000-0000-00000000000a', '$qorder', 'Concurrencia') returning id")
as_user $OWNER "insert into public.quote_items (workshop_id, quote_id, position, kind, description, quantity, unit_price_cents, tax_rate) values ('$WS', '$quote', 1, 'pieza', 'Pieza', 1, 5000, 21)" >/dev/null
as_user $OWNER "select public.send_quote('$quote', 30)" >/dev/null
pids=()
for i in $(seq 1 "$N"); do as_user $CLIENT "select public.respond_quote_portal('$quote', true, 'Acepto $i')" >/dev/null & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || true; done
check "$(sql "select status from public.quotes where id = '$quote'")" "aceptado" "3. presupuesto aceptado $N veces a la vez: queda aceptado"
check "$(sql "select count(*) from public.repair_order_items where order_id = '$qorder' and source_quote_id = '$quote'")" "1" "   y sus líneas pasan a la orden UNA sola vez (no $N)"

# ---------- 4. Dos mecánicos y una orden libre ----------
sql "insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000a5', 'mecanico2@alcarria.test', now());
     insert into public.workshop_members (workshop_id, user_id, role) values ('$WS', '00000000-0000-0000-0000-0000000000a5', 'mecanico');" >/dev/null
free=$(as_user $OWNER "insert into public.repair_orders (workshop_id, vehicle_id, customer_id, problem_description) values ('$WS', '7e000002-0000-0000-0000-00000000000a', 'c2000000-0000-0000-0000-00000000000a', 'Libre') returning id")
as_user $MECH "select public.claim_repair_order('$free')" >/dev/null &
p1=$!
as_user 00000000-0000-0000-0000-0000000000a5 "select public.claim_repair_order('$free')" >/dev/null &
p2=$!
wait $p1 || true; wait $p2 || true
check "$(sql "select (assigned_to in ('$MECH', '00000000-0000-0000-0000-0000000000a5'))::text from public.repair_orders where id = '$free'")" "true" "4. dos mecánicos cogen la misma orden a la vez: se asigna a uno"
check "$(sql "select count(*) from public.repair_order_events where order_id = '$free' and kind = 'asignacion'")" "1" "   y el historial registra una sola asignación"

# ---------- 5. Misma matrícula a la vez ----------
pids=()
for i in $(seq 1 "$N"); do as_user $MANAGER "insert into public.vehicles (workshop_id, plate, make, model, year, year_kind) values ('$WS', '9876 ZZZ', 'Kia', 'Ceed', 2020, 'fabricacion')" >/dev/null & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || true; done
check "$(sql "select count(*) from public.vehicles where workshop_id = '$WS' and plate = '9876ZZZ'")" "1" "5. $N altas de la misma matrícula a la vez: un solo vehículo"

echo
if [ "$failed" -gt 0 ]; then echo "✘ $failed comprobación(es) de concurrencia fallidas"; exit 1; fi
echo "✔ Todas las comprobaciones de concurrencia pasan ($N sesiones simultáneas)"
