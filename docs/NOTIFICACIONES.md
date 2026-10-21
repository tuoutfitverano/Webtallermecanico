# Notificaciones y automatizaciones (Fase 7)

Estado:

- **Avisos dentro del portal:** funcionan.
- **Email:** implementado y probado con un proveedor **simulado**. Hacen falta cuenta y credenciales de Resend para enviar correos reales.
- **WhatsApp:** implementado y probado con un proveedor **simulado** (API oficial de WhatsApp Business de Meta). Hacen falta cuenta de empresa verificada, número dedicado y plantilla aprobada para enviar mensajes reales (ver §8).
- **SMS:** no implementado.

**Qué elige el cliente** (portal → «Mis datos»): los avisos de sus reparaciones le llegan **siempre en el portal** y, si quiere, **también por email, por WhatsApp o por los dos**. Cada canal externo es una casilla independiente.

## 1. Cómo funciona

```
Cambio real de estado (panel) ─► repair_order_events (historial, Fase 4)
                                     │  disparador, MISMA transacción
                                     ▼
                               notifications
                     ┌───────────────┴────────────────┐
              canal "app"                       canal "email" (pendiente)
        visible al momento en               ┌──────────┴──────────────┐
        /portal/avisos                envío inmediato al        proceso programado
                                      guardar la orden          (cada minuto, cron)
                                            └──────────┬──────────────┘
                                   claim_email_notifications → Resend → record_email_result
                                                       │
                                webhook firmado ◄── Resend confirma la entrega / rebote / queja
```

Es un patrón **outbox**: el aviso se crea en la misma transacción que el cambio de estado. Si el proveedor falla, el aviso no se pierde: queda en cola y se reintenta.

## 2. Qué genera avisos

| Evento | Cuándo | Portal (por defecto) | Email (por defecto) |
| --- | --- | --- | --- |
| `vehiculo_recibido` | Se crea la orden | Sí | Sí |
| `diagnosis` | Cambio a «En diagnosis» | Sí | No |
| `esperando_recambios` | Cambio a «Esperando recambios» | Sí | Sí |
| `en_reparacion` | Cambio a «En reparación» | Sí | No |
| `listo` | Cambio a «Listo para recoger» | Sí | Sí |
| `entregado` | Cambio a «Entregado» | Sí | Sí |

Cada taller lo cambia en **Panel → Avisos → Qué se avisa** (solo propietario o administradores).

**Reglas:**

- **Guardar sin cambiar el estado, o volver a poner el mismo estado, no genera nada.** El historial solo registra cambios reales, y los avisos salen del historial.
- Hay un aviso por cambio y canal: restricción única `(source_event_id, channel)`.
- Solo cuenta el **último estado**. Si hay un email de la misma orden aún sin enviar, se cancela (`sustituida`).
- **Vuelta atrás** desde «Listo» o «Entregado» (corrección o trabajo extra):
  - el aviso se titula «Actualización del estado de tu reparación»;
  - se cancela el email pendiente que ya no es cierto (`estado_corregido`);
  - no se borra nada del historial.
- Los avisos del portal solo se crean si el cliente tiene **cuenta vinculada**.
- El email solo se crea si se cumplen todas estas condiciones:
  - el taller lo tiene activado;
  - la ficha tiene un correo válido;
  - el cliente no lo ha desactivado;
  - el taller no está suspendido.
- **Contenido:** vehículo, número de orden, explicación del estado y el «mensaje para el cliente» si lo hay. Nunca notas internas, diagnosis no autorizada ni datos del personal.

## 3. Base de datos (`20261023090000_notificaciones.sql`)

| Tabla | Qué guarda | Quién la lee |
| --- | --- | --- |
| `notifications` | Ver detalle debajo | Propietario y administradores (RLS). El cliente, solo por funciones `portal_*` |
| `workshop_notification_settings` | Email activado, eventos por canal y dirección de respuesta (`reply_to`) | Personal del taller. Solo editan los gestores |
| `customer_contact_preferences` | Avisos operativos por email (sí por defecto) y promociones por email (**no** por defecto) | Personal del taller |
| `communication_consent_log` | Cada cambio de preferencia: qué, sí o no, origen (`portal`, `panel` o `queja_proveedor`) y fecha. Nadie lo modifica | Gestores |

Lo que guarda `notifications`:

- taller, cliente, orden y evento de origen;
- canal (`app` o `email`), tipo de evento y finalidad (`operativa` o `comercial`);
- plantilla, título y texto;
- destinatario (solo en email);
- estado e intentos;
- fechas de creación, último intento, envío, entrega, lectura y cancelación;
- id del mensaje en el proveedor y código de error general.

Estados de un aviso:

| Estado | Significado |
| --- | --- |
| `pendiente` | En cola |
| `procesando` | Se está enviando |
| `enviado` | **Aceptado por el proveedor** (todavía no confirmado) |
| `entregado` | Solo cuando el proveedor lo confirma por webhook. En el portal, al estar disponible |
| `fallido` | No se pudo enviar |
| `cancelado` | No se envía (con su motivo) |

Funciones:

| Función | Quién | Para qué |
| --- | --- | --- |
| `claim_email_notifications` | Solo servidor (clave secreta) | Coge un lote (máximo 50) con `skip locked`, vuelve a comprobar preferencias y ajustes, y caduca avisos de más de 2 días |
| `record_email_result` | Solo servidor | Anota el resultado de un envío |
| `record_email_delivery` | Solo servidor (webhook) | Anota entrega, rebote o queja. No rebaja estados |
| `retry_notification` | Propietario o administrador | Reintento manual |
| `set_contact_preferences` | El propio cliente, o el taller para retirar | Cambia preferencias |
| `portal_notifications`, `portal_unread_notifications`, `portal_mark_notifications_read`, `portal_contact_preferences` | Cliente | Sus avisos y preferencias |

No se guardan contraseñas, tokens ni claves en los avisos. El código de error es general (`no_disponible`, `rechazado`…), sin texto del proveedor.

## 4. Canales

| Canal | Estado |
| --- | --- |
| **Portal** (`/portal/avisos`) | Implementado: lista, indicador de no leídos, marcar como leído (uno o todos) y enlace a la reparación |
| **Email (Resend)** | Implementado: plantilla HTML sencilla + texto plano, asunto «Taller X: …», nombre del taller como remitente, `reply_to` del taller, idempotencia y webhook firmado. **Pendiente de credenciales** |
| **WhatsApp (API oficial de Meta)** | Implementado (`src/lib/notifications/whatsapp.ts`): mensaje de **plantilla aprobada** `reparacion_estado_v1` con 3 huecos (taller, título, detalle), webhook firmado (`/api/notificaciones/whatsapp`). Solo a clientes que lo han pedido desde su portal y con móvil en la ficha. **Pendiente de cuenta y credenciales** |
| SMS | No implementado (ver §8) |

## 5. Reintentos

- **Automáticos:** como máximo 5 intentos. Las esperas son de 1 min, 5 min, 30 min y 2 h; después queda `fallido` (`reintentos_agotados`).
- **Sin reintento automático:** un rechazo definitivo (400/422, dirección no válida) o un conflicto de idempotencia (409) quedan `fallido` directamente.
- **Se reintentan con espera:** los 401/403 (clave o dominio mal configurados), por si se corrige la configuración.
- **Manual** (Panel → Avisos → Reintentar, solo gestores):
  - máximo 3, con un único intento cada vez;
  - nunca sobre un email `enviado` o `entregado`, para no duplicar;
  - no se permite tras un rebote o una queja.
- **Sin duplicados:**
  - un aviso reclamado no se vuelve a reclamar (`for update skip locked`);
  - el id del aviso viaja como `Idempotency-Key`, así que Resend descarta el duplicado durante 24 h;
  - un envío que quedó a medias vuelve a la cola a los 10 minutos.
- **Sin bucles:** cada llamada procesa un lote limitado.

## 6. Configuración (pendiente para producción)

### 6.1 Variables de entorno (solo servidor, como *Secret* en Cloudflare)

| Variable | Para qué |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` para activar. Vacía = sin email: los avisos se quedan `pendiente` y caducan, nunca se dan por enviados |
| `EMAIL_FROM` | Remitente en un **dominio verificado** en Resend, p. ej. `avisos@tudominio.es`. El nombre visible es el del taller |
| `RESEND_API_KEY` | Clave de la API de Resend. **Secreta** |
| `RESEND_API_URL` | Opcional (solo pruebas locales) |
| `RESEND_WEBHOOK_SECRET` | Secreto de firma del webhook (`whsec_…`) |
| `NOTIFICATIONS_CRON_SECRET` | Secreto largo (mínimo 24 caracteres) del proceso programado. Vacío = el endpoint responde 404 |

**WhatsApp** (todas opcionales; sin ellas, los WhatsApp se quedan `pendiente` y caducan, nunca se dan por enviados):

| Variable | Para qué |
| --- | --- |
| `WHATSAPP_PROVIDER` | `meta` para activar |
| `WHATSAPP_TOKEN` | Token de acceso permanente (usuario del sistema de Meta Business). **Secreto** |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador del número de empresa (solo cifras, lo da Meta) |
| `WHATSAPP_TEMPLATE` | Nombre de la plantilla aprobada. Vacía = `reparacion_estado_v1` |
| `WHATSAPP_API_URL` | Opcional (solo pruebas locales). Vacía = `https://graph.facebook.com/v21.0` (**comprobar la versión vigente de la API antes de lanzar**) |
| `WHATSAPP_APP_SECRET` | Secreto de la app de Meta: firma del webhook (`X-Hub-Signature-256`). **Secreto** |
| `WHATSAPP_VERIFY_TOKEN` | Texto que eliges tú para dar de alta el webhook en Meta. **Secreto** |

`APP_URL` sirve para los enlaces al portal en los emails; sin ella, el email no lleva enlace. También hace falta `SUPABASE_SECRET_KEY`.

### 6.2 Resend

1. Crear la cuenta y **verificar el dominio** (registros SPF y DKIM en el DNS; DMARC recomendado).
2. Crear una API key con permiso solo de envío y guardarla como secreto.
3. Ir a **Webhooks** y añadir `https://APP_URL/api/notificaciones/webhook` con los eventos `email.delivered`, `email.bounced`, `email.complained`, `email.failed` y `email.delivery_delayed`. Copiar el *signing secret* a `RESEND_WEBHOOK_SECRET`.
4. El webhook se verifica con la firma Svix (HMAC-SHA256 de `id.timestamp.cuerpo`). Se rechaza lo que no esté firmado o tenga más de 5 minutos. Los duplicados no cambian nada.

**Pendiente de verificar en la documentación oficial de Resend.** No pude abrir sus páginas desde aquí; los datos salen de su blog y de guías de terceros:

- precio: plan gratuito de unos 3.000 emails al mes con 100 al día;
- límite de unas 10 peticiones por segundo;
- región de los datos (posible transferencia a EE. UU.).

### 6.3 Proceso programado (reintentos y cola)

Cloudflare Workers no mantiene procesos en marcha, así que la cola se procesa:

1. **al guardar la orden:** en Cloudflare, después de responder (`waitUntil`);
2. **cada minuto**, con un aviso programado que llama a `POST /api/notificaciones/procesar`.

Recomendado: **Supabase Cron**. En Database → Extensions, activar `pg_cron` y `pg_net`, y después ejecutar en el SQL Editor (con tus valores):

```sql
select vault.create_secret('PEGA_AQUI_NOTIFICATIONS_CRON_SECRET', 'notifications_cron_secret');
select cron.schedule('enviar-avisos', '* * * * *', $$
  select net.http_post(
    url := 'https://app.tudominio.es/api/notificaciones/procesar',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_cron_secret'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

### 6.4 Activarlo en un taller

**Panel → Avisos → Qué se avisa → «Enviar avisos por email»** y/o **«Enviar avisos por WhatsApp»**. Hasta que la plataforma tenga el proveedor de ese canal, la casilla no se puede activar. Cada canal tiene su lista de momentos que se avisan (por defecto, en email y WhatsApp: vehículo recibido, esperando recambios, listo y entregado).

Aunque el taller no lo tenga activado, el cliente ya puede pedir WhatsApp desde su portal: su elección se guarda y los mensajes empiezan a salir cuando el taller lo active.

## 7. Preferencias y consentimiento (España)

- **Avisos operativos** (estado de la reparación del propio cliente): se envían para ejecutar el servicio contratado (RGPD art. 6.1.b). El cliente puede desactivarlos en «Mis datos» y cada email explica cómo.
- **Comunicaciones comerciales:**
  - Están separadas y **desactivadas por defecto**.
  - Solo las activa **el propio cliente** desde su portal, con una casilla sin marcar. El taller puede **retirarlas**, nunca darlas.
  - La base de datos impide crear un aviso comercial sin ese consentimiento, también con la clave secreta. Los avisos comerciales dentro del portal están bloqueados.
  - Aceptar avisos operativos **no** cuenta como consentimiento comercial.
- **Registro:** cada cambio queda en `communication_consent_log`, para poder demostrar el consentimiento (RGPD art. 7.1).
- **Quejas:** si un cliente marca un email como spam, se le desactivan los emails automáticamente.
- **WhatsApp:**
  - Nace **desactivado** y solo lo puede pedir **el propio cliente** desde su portal (WhatsApp exige el consentimiento expreso del destinatario). El taller solo puede **retirarlo** (ficha del cliente → «Retirar avisos por WhatsApp»).
  - Hace falta un **móvil** en la ficha: España 6xx/7xx (con o sin +34); otros países solo escritos con `+` o `00`. Con un fijo, la casilla no se puede marcar.
  - Solo avisos **operativos**: la base de datos bloquea cualquier mensaje comercial por WhatsApp, también con la clave secreta.
  - Si cambia el teléfono de la ficha antes de enviarse, el aviso se cancela (`destinatario_cambiado`). Retirarlo cancela los pendientes.
  - Al cliente solo se le enseñan las 3 últimas cifras del número en su portal.

**Debe validarlo un asesor antes de lanzar:**

- Textos de la política de privacidad de cada taller: finalidad de los avisos, base jurídica, Resend y Meta (WhatsApp) como encargados del tratamiento y transferencias internacionales.
- Contrato de encargado del tratamiento (DPA) con Resend y las condiciones de WhatsApp Business de Meta.
- Si se usa la excepción de la LSSI (art. 21.2) para clientes con productos similares. Hoy **no** se usa: se exige consentimiento expreso.
- Cuánto tiempo se conservan los avisos y el registro de consentimientos (todavía no hay borrado automático).
- Identificación del remitente: hoy, nombre del taller y respuesta al taller.

## 8. WhatsApp (implementado, pendiente de cuenta) y SMS (no implementado)

**WhatsApp** solo mediante la **API oficial de WhatsApp Business (Cloud API de Meta)**. Nunca sesiones personales ni automatizaciones no oficiales: pueden bloquear la cuenta del taller.

Cómo funciona:

1. La base de datos crea el aviso `whatsapp` (`pendiente`) en la misma transacción que el cambio de estado, solo si el taller lo tiene activado, el cliente lo pidió y hay móvil válido. El destinatario se guarda en formato internacional sin `+` (`34600000000`).
2. El servidor lo reclama (`claim_whatsapp_notifications`), envía la plantilla y anota el resultado (`record_whatsapp_result`, mismos reintentos que el email: 5 automáticos y 3 manuales).
3. Meta confirma por webhook firmado (`record_whatsapp_delivery`): entregado o leído → «Entregado»; fallido → «Fallido».

Lo que falta para enviar mensajes reales (**no se ha contratado nada**):

- Cuenta de **Meta Business verificada** y una app con el producto WhatsApp.
- Un **número de teléfono dedicado** (no puede estar usándose en la app normal de WhatsApp).
- Crear y que Meta **apruebe la plantilla** `reparacion_estado_v1` (categoría «utilidad», idioma español), con tres variables en el cuerpo: `{{1}}` nombre del taller, `{{2}}` título del aviso, `{{3}}` detalle (vehículo, orden, estado y mensaje del taller). Texto propuesto, **pendiente de revisión**: «{{1}}: {{2}}. {{3}}. Puedes ver el estado en tu portal de cliente.»
- **Coste por mensaje** según las tarifas vigentes de Meta para España (pendiente de comprobar antes de activar; los mensajes de utilidad tienen precio propio).
- Dar de alta el webhook en Meta: URL `https://<dominio de la app>/api/notificaciones/whatsapp`, token de verificación = `WHATSAPP_VERIFY_TOKEN`, suscripción a «messages».

**SMS:** no implementado. Haría falta un proveedor con remitente alfanumérico registrado (en España, según la normativa vigente de identificación de remitentes), coste por mensaje, un adaptador como el de WhatsApp, un valor nuevo en `notification_channel` (migración), preferencias y pruebas.

## 9. Citas

No hay sistema de citas confirmadas: la web pública solo recoge **solicitudes** (`web_requests`, «pendiente»). Por eso no hay avisos de cita. Se añadirán con un evento nuevo cuando exista ese sistema.

## 10. Pruebas

| Tipo | Archivo | Qué comprueba |
| --- | --- | --- |
| **SQL** (81 comprobaciones) | `supabase/tests/11_notificaciones.test.sql` | Ver lista debajo |
| **Unitarias**, simuladas | `apps/web/src/lib/notifications/notifications.test.ts` | Ver lista debajo |
| **Navegador**, email **simulado** | `apps/web/e2e/avisos.spec.ts` + `scripts/e2e/email-provider-mock.mjs` | Ver lista debajo |
| **SQL** WhatsApp (46 comprobaciones) | `supabase/tests/14_avisos_whatsapp.test.sql` | Números, quién puede activarlo, generación, nada comercial, envío y entrega, cambio de teléfono, reintentos, aislamiento y supresión |
| **Unitarias** WhatsApp, simuladas | `apps/web/src/lib/notifications/whatsapp.test.ts` | Plantilla y parámetros, respuestas de Meta, despachador, firma del webhook y alta |
| **Navegador**, WhatsApp **simulado** | `apps/web/e2e/avisos.spec.ts` + `scripts/e2e/whatsapp-provider-mock.mjs` | El cliente elige los tres canales, el taller lo activa, el aviso sale por los tres, webhook firmado y el taller solo puede retirarlo |

Las pruebas SQL comprueban:

- que un cambio real genera avisos y que no hay duplicados al guardar sin cambios;
- la vuelta atrás y que el historial se conserva;
- el aislamiento entre clientes y talleres;
- que nadie salvo el servidor crea o anota envíos;
- los reintentos limitados y el reintento manual (permisos y límite);
- que no se duplica lo ya enviado;
- la entrega y la queja confirmadas por el proveedor;
- las preferencias, el consentimiento comercial y el taller suspendido.

Las pruebas unitarias comprueban:

- la plantilla (escape HTML y sin enlace inventado);
- la petición a Resend (clave, idempotencia, remitente);
- los errores temporales y los definitivos;
- que el despachador sin proveedor no da nada por enviado;
- que los registros no llevan datos personales;
- la firma del webhook (válida, falsa, alterada, antigua);
- el secreto del cron;
- que los textos coinciden entre `packages/core` y la base de datos.

Las pruebas de navegador recorren:

- activar el email en el panel;
- cambiar el estado y comprobar el aviso en el portal (no leídos, marcar como leído, ir a la reparación);
- el email simulado con asunto, remitente y respuesta del taller, sin notas internas;
- «enviado» → «entregado» por webhook firmado, y el rechazo de firmas falsas;
- las preferencias del cliente;
- un fallo temporal y uno definitivo, y el reintento manual;
- el endpoint programado con secreto;
- los permisos de mecánico, otro taller y cliente.

**No se ha enviado ningún email real.**

**Para probarlo a mano en local:** `npm run test:e2e -- e2e/avisos.spec.ts`, o, con tus credenciales de Resend en `apps/web/.env`, `npm run dev`. Después:

1. Panel → Avisos → activar el email.
2. Cambiar una orden a «Listo para recoger».
3. Entrar como cliente en `/portal/avisos`.
