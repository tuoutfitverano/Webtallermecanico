#!/usr/bin/env bash
# PASO 1 de la versión real (lo lanza .github/workflows/publicar.yml; ver docs/PUBLICAR.md):
#   1. Aplica las migraciones a la base de datos de Supabase (sin datos de demostración).
#   2. Configura el inicio de sesión de Supabase (dirección de la web, contraseñas, correos).
#   3. Crea (una vez) el antispam de los formularios (Cloudflare Turnstile).
#   4. Compila y publica la web en Cloudflare Workers con sus secretos.
#      Correo (Resend) y WhatsApp (Meta) solo si sus claves están en GitHub: si no, siguen apagados.
#   5. Comprueba que responde.
# Se puede repetir: cada vez publica la versión actual del código y las migraciones nuevas.
source "$(dirname "$0")/comun.sh"
cd "$(dirname "$0")/../.."

requiere CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_URL
ocultar "$SUPABASE_DB_URL"

paso "Dirección de la web"
HOST=$(app_host)
APP_URL="https://$HOST"
echo "  $APP_URL"

paso "Claves del proyecto de Supabase"
supabase_keys
SUPABASE_URL="https://$SUPABASE_PROJECT_REF.supabase.co"

paso "Base de datos: migraciones pendientes"
npx supabase db push --db-url "$SUPABASE_DB_URL" --yes

# Opcionales: correo a clientes (Resend) y WhatsApp (Meta). Sin sus claves, quedan apagados.
EMAIL_ON=false
if [ -n "${RESEND_API_KEY:-}" ]; then
  ocultar "$RESEND_API_KEY"
  [[ "${EMAIL_FROM:-}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] \
    || fallo "Con RESEND_API_KEY hace falta la variable EMAIL_FROM (p. ej. avisos@tudominio.es, en un dominio verificado en Resend)."
  EMAIL_ON=true
fi
WHATSAPP_ON=false
if [ -n "${WHATSAPP_TOKEN:-}" ]; then
  ocultar "$WHATSAPP_TOKEN"
  [[ "${WHATSAPP_PHONE_NUMBER_ID:-}" =~ ^[0-9]{5,30}$ ]] || fallo "Con WHATSAPP_TOKEN hace falta la variable WHATSAPP_PHONE_NUMBER_ID (solo números)."
  [ -n "${WHATSAPP_APP_SECRET:-}" ] || fallo "Con WHATSAPP_TOKEN hace falta el secreto WHATSAPP_APP_SECRET (para comprobar las confirmaciones de Meta)."
  ocultar "$WHATSAPP_APP_SECRET"
  WHATSAPP_ON=true
fi
[ -n "${RESEND_WEBHOOK_SECRET:-}" ] && ocultar "$RESEND_WEBHOOK_SECRET"
[ -n "${WHATSAPP_VERIFY_TOKEN:-}" ] && ocultar "$WHATSAPP_VERIFY_TOKEN"

paso "Inicio de sesión de Supabase (dirección, contraseñas y correos)"
auth=$(jq -n \
  --arg site "$APP_URL" \
  --arg allow "$APP_URL/**" \
  --rawfile conf supabase/templates/confirmation.html \
  --rawfile rec supabase/templates/recovery.html \
  --rawfile magic supabase/templates/magic_link.html \
  '{site_url: $site, uri_allow_list: $allow, mailer_autoconfirm: false,
    password_min_length: 10,
    password_required_characters: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    mailer_subjects_confirmation: "Confirma tu correo · Área de talleres", mailer_templates_confirmation_content: $conf,
    mailer_subjects_recovery: "Cambiar la contraseña · Área de talleres", mailer_templates_recovery_content: $rec,
    mailer_subjects_magic_link: "Tu código de acceso · Área de talleres", mailer_templates_magic_link_content: $magic}')
# Con Resend, los correos de la cuenta (confirmar, cambiar contraseña) salen por su SMTP:
# así llegan a cualquier persona, no solo al equipo de Supabase.
if $EMAIL_ON; then
  auth=$(jq --arg from "$EMAIL_FROM" --arg pass "$RESEND_API_KEY" \
    '. + {smtp_host: "smtp.resend.com", smtp_port: 465, smtp_user: "resend", smtp_pass: $pass,
          smtp_admin_email: $from, smtp_sender_name: "Área de talleres"}' <<<"$auth")
fi
sb PATCH "/projects/$SUPABASE_PROJECT_REF/config/auth" "$auth" > /dev/null
echo "  ✔ configurado$($EMAIL_ON && echo ' (correos de la cuenta por Resend)')"

paso "Antispam de los formularios (Turnstile)"
SITEKEY=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/challenges/widgets?per_page=50" | jq -r --arg n "$WORKER" '[.result[] | select(.name == $n)][0].sitekey // empty')
if [ -z "$SITEKEY" ]; then
  SITEKEY=$(cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/challenges/widgets" \
    "$(jq -n --arg n "$WORKER" --arg h "$HOST" '{name: $n, domains: [$h], mode: "managed"}')" | jq -r '.result.sitekey')
  echo "  ✔ creado"
else
  echo "  ✔ ya existía"
fi
TURNSTILE_SECRET=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/challenges/widgets/$SITEKEY" | jq -r '.result.secret')
ocultar "$TURNSTILE_SECRET"

paso "Compilación"
npm run build

paso "Publicación en Cloudflare Workers"
existing=$( (cd apps/web && npx wrangler secret list --name "$WORKER" --format json 2>/dev/null) || echo '[]')
has() { jq -e --arg n "$1" 'any(.[]?; .name == $n)' <<<"$existing" > /dev/null; }
(cd apps/web && npx wrangler deploy -c dist/server/wrangler.json)

secrets="$RUNNER_TEMP/secretos.json"
umask 077
jq -n \
  --arg url "$SUPABASE_URL" --arg pub "$SB_PUBLISHABLE" --arg sec "$SB_SECRET" \
  --arg tsk "$SITEKEY" --arg tss "$TURNSTILE_SECRET" --arg app "$APP_URL" \
  '{SUPABASE_URL: $url, SUPABASE_PUBLISHABLE_KEY: $pub, SUPABASE_SECRET_KEY: $sec,
    TURNSTILE_SITE_KEY: $tsk, TURNSTILE_SECRET_KEY: $tss, APP_URL: $app}' > "$secrets"
if $EMAIL_ON; then
  jq --arg from "$EMAIL_FROM" --arg key "$RESEND_API_KEY" --arg wh "${RESEND_WEBHOOK_SECRET:-}" \
    '. + {EMAIL_PROVIDER: "resend", EMAIL_FROM: $from, RESEND_API_KEY: $key} + (if $wh != "" then {RESEND_WEBHOOK_SECRET: $wh} else {} end)' \
    "$secrets" > "$secrets.tmp" && mv "$secrets.tmp" "$secrets"
fi
if $WHATSAPP_ON; then
  jq --arg tok "$WHATSAPP_TOKEN" --arg id "$WHATSAPP_PHONE_NUMBER_ID" --arg app "$WHATSAPP_APP_SECRET" \
    --arg tpl "${WHATSAPP_TEMPLATE:-}" --arg ver "${WHATSAPP_VERIFY_TOKEN:-}" \
    '. + {WHATSAPP_PROVIDER: "meta", WHATSAPP_TOKEN: $tok, WHATSAPP_PHONE_NUMBER_ID: $id, WHATSAPP_APP_SECRET: $app}
       + (if $tpl != "" then {WHATSAPP_TEMPLATE: $tpl} else {} end) + (if $ver != "" then {WHATSAPP_VERIFY_TOKEN: $ver} else {} end)' \
    "$secrets" > "$secrets.tmp" && mv "$secrets.tmp" "$secrets"
fi
# Las claves propias se crean solo la primera vez (cambiarlas invalidaría lo anterior).
for name in REQUEST_HASH_SECRET NOTIFICATIONS_CRON_SECRET; do
  if ! has "$name"; then
    value=$(openssl rand -hex 32)
    jq --arg k "$name" --arg v "$value" '. + {($k): $v}' "$secrets" > "$secrets.tmp" && mv "$secrets.tmp" "$secrets"
  fi
done
# Notificaciones en el móvil (Web Push, gratis): claves VAPID propias, también solo la primera vez
# (si cambian, cada cliente tendría que volver a activarlas en su móvil).
if ! has VAPID_PRIVATE_KEY; then
  vapid=$(node scripts/push/claves.mjs --json)
  jq --argjson v "$vapid" --arg sub "$APP_URL" '. + $v + {VAPID_SUBJECT: $sub}' "$secrets" > "$secrets.tmp" && mv "$secrets.tmp" "$secrets"
fi
(cd apps/web && npx wrangler secret bulk "$secrets" --name "$WORKER")
rm -f "$secrets"

paso "Comprobación"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/acceso" || true)
  [ "$code" = 200 ] && break
  sleep 3
done
[ "$code" = 200 ] || fallo "La web no responde bien en $APP_URL/acceso (HTTP $code)."
cron=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$APP_URL/api/notificaciones/procesar")
[ "$cron" = 401 ] || fallo "El mantenimiento programado debería pedir su clave (HTTP $cron)."
echo "  ✔ $APP_URL/acceso responde y el mantenimiento está protegido"

{
  echo "### Web publicada"
  echo
  echo "- Dirección: $APP_URL"
  echo "- Correo a clientes (Resend): $($EMAIL_ON && echo activo || echo 'apagado (faltan sus claves)')"
  echo "- WhatsApp (Meta): $($WHATSAPP_ON && echo activo || echo 'apagado (faltan sus claves)')"
  echo "- Siguiente paso: crea tu cuenta en $APP_URL/registro y lanza el paso 2 (crear el taller) con tu correo."
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
