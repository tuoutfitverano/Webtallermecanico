# Guía del propietario

Explicada sin tecnicismos. Para los detalles técnicos, cada apartado enlaza al documento correspondiente.

> **Esto no es asesoramiento legal.** El apartado 5 es una lista de lo que suele hacer falta en España, con sus fuentes. Antes de cobrar a talleres de verdad, revísalo con una asesoría o un abogado.

## 1. Qué es cada servicio

| Servicio | Qué hace en tu plataforma | Analogía |
|---|---|---|
| **Supabase** | Guarda **los datos** (talleres, clientes, vehículos, órdenes, facturas…) en una base de datos PostgreSQL y gestiona **las cuentas** (registro, inicio de sesión, contraseñas, correos de confirmación). También aplica los permisos: cada taller solo ve lo suyo | El archivo y la cerradura |
| **Cloudflare Workers** | Sirve **la web**: la página pública de cada taller, el panel y el portal del cliente. Ejecuta el código que habla con Supabase | El mostrador |
| **GitHub** | Guarda **el código** y su historial, y **publica** la web cuando se lo pides (el botón «Publicar versión real») | El taller donde se fabrica |
| **Resend** (opcional) | Envía los **correos** a los clientes (avisos y correos de la cuenta) | El cartero |
| **Meta WhatsApp Business** (opcional) | Envía los **WhatsApp** a los clientes que lo pidan | El mensajero |

Supabase es una empresa que alquila bases de datos ya montadas. No tienes que instalar ni mantener nada:
- el plan gratuito sirve para empezar;
- el plan de pago añade copias diarias y quita la pausa por inactividad (ver apartado 4).

Tu proyecto debe crearse en la región **UE** (Frankfurt o París).

## 2. Los 5 datos de GitHub, paso a paso

Son las «llaves» con las que GitHub puede publicar en tu nombre. Se guardan como **secretos de GitHub**:
- están cifrados;
- una vez guardados, nadie puede volver a leerlos, ni siquiera tú: solo reemplazarlos;
- nunca aparecen en el registro de la publicación.

**No me los pegues nunca en el chat.**

### Antes de empezar (una vez)

1. **Supabase**:
   - entra en supabase.com, pulsa **Start your project** y regístrate (mejor con tu correo y una contraseña larga, o con GitHub);
   - pulsa **New project**, ponle un nombre (p. ej. `autovalue`) y en **Region** elige **Central EU (Frankfurt)** o **West EU (Paris)**;
   - en **Database Password** pulsa *Generate a password* y **cópiala a tu gestor de contraseñas** (apartado 3): la necesitas en el dato 3;
   - espera a que el proyecto termine de crearse (1–2 minutos).
2. **Cloudflare**:
   - entra en dash.cloudflare.com y regístrate;
   - en el menú de la izquierda pulsa **Workers & Pages**. La primera vez te pide elegir un subdominio (`algo.workers.dev`): elige uno; será parte de la dirección de tu web.

### Dónde se guardan los secretos

En GitHub, abre tu repositorio. Después:
1. **Settings** (pestaña de arriba; si no la ves, el repositorio no es tuyo o no tienes permisos);
2. menú izquierdo: **Secrets and variables → Actions**;
3. botón verde **New repository secret**;
4. en **Name**, el nombre exacto (en mayúsculas, como en la tabla); en **Secret**, el valor. Pulsa **Add secret**.

### Los cinco

| # | Nombre (Name) | Dónde lo sacas |
|---|---|---|
| 1 | `SUPABASE_PROJECT_REF` | En Supabase, con tu proyecto abierto, mira la dirección del navegador: `supabase.com/dashboard/project/`**`abcdefghijklmnop`**. Esas letras son el dato |
| 2 | `SUPABASE_ACCESS_TOKEN` | En Supabase, arriba a la derecha, tu avatar → **Account preferences** → **Access Tokens** → *Generate new token*. Ponle un nombre (`github-publicar`) y cópialo: solo se ve una vez |
| 3 | `SUPABASE_DB_URL` | En tu proyecto de Supabase, botón **Connect** (arriba) → pestaña de cadenas de conexión → **Session pooler**. Copia la línea que empieza por `postgresql://` y sustituye `[YOUR-PASSWORD]` (corchetes incluidos) por la contraseña de la base de datos. **Session pooler**, no «Direct connection» (GitHub no puede usar la directa) |
| 4 | `CLOUDFLARE_ACCOUNT_ID` | En Cloudflare, **Workers & Pages**: en la columna derecha aparece **Account ID**. Cópialo |
| 5 | `CLOUDFLARE_API_TOKEN` | En Cloudflare, arriba a la derecha tu perfil → **My Profile** → **API Tokens** → **Create Token** → plantilla **Edit Cloudflare Workers** → *Use template*. En **Permissions** pulsa *+ Add more* y añade **Account · Turnstile · Edit**. En **Account Resources** elige tu cuenta. *Continue to summary* → *Create Token* y cópialo (solo se ve una vez) |

### Publicar

1. GitHub → pestaña **Actions** → a la izquierda **Publicar versión real** → botón **Run workflow**:
   - en `paso`, elige `1-publicar`;
   - en `confirmar`, escribe `PUBLICAR`;
   - pulsa *Run workflow*.

   Tarda unos 5 minutos. Al terminar (círculo verde), abre la ejecución: en el resumen verás la dirección de tu web.
2. Entra en `https://…workers.dev/registro` y crea tu cuenta con el **mismo correo de tu cuenta de Supabase**. Sin el correo propio del apartado 6, Supabase solo envía a su equipo.
3. Vuelve a **Run workflow**:
   - en `paso`, elige `2-crear-taller`;
   - en `correo_propietario`, pon tu correo;
   - en `confirmar`, escribe `PUBLICAR`.

   Confirma tu cuenta, crea el taller y te hace propietario.
4. Entra en `https://…workers.dev/acceso`.

Para publicar cambios del código más adelante, repite solo el paso 1: no borra datos. Detalle técnico: [`PUBLICAR.md`](PUBLICAR.md).

**Si algo sale en rojo**, el mensaje dice qué falta (normalmente un secreto mal copiado). Corrige el secreto (*Update*) y vuelve a lanzar.

## 3. Dónde se guardan las cuentas y las contraseñas

| Qué | Dónde | Quién puede verlo |
|---|---|---|
| Cuentas de propietarios, empleados y clientes | Supabase Auth (tabla `auth.users` de tu proyecto) | Nadie ve las contraseñas: se guardan **cifradas de forma irreversible** (huella bcrypt). Ni tú ni yo podemos leerlas; quien la olvida la cambia con «¿Has olvidado la contraseña?» |
| Datos de los talleres | Base de datos de Supabase (región UE) | Cada taller, solo lo suyo (reglas de la propia base de datos) |
| Claves del sistema (Supabase, Turnstile, Resend, WhatsApp) | Secretos de GitHub y secretos del Worker en Cloudflare | Nadie las puede volver a leer. Las claves internas (`REQUEST_HASH_SECRET`, `NOTIFICATIONS_CRON_SECRET`) las genera la publicación sola |
| **Tus** contraseñas (GitHub, Supabase, Cloudflare, contraseña de la base de datos, clave de las copias, Resend, Meta) | **Tu gestor de contraseñas** (Bitwarden, 1Password, el de Apple o Google…) | Solo tú |

Recomendaciones:
- activa la **verificación en dos pasos** en GitHub, Supabase, Cloudflare, Resend y Meta;
- no reutilices contraseñas;
- guarda la clave privada de las copias también **fuera de línea** (papel o USB en un sitio seguro);
- nunca guardes contraseñas en el código, en un documento compartido ni en el chat.

## 4. Copias de seguridad

Hay dos, y se complementan.

1. **La de cada taller** (nuevo): en **Panel → Taller → Copia de seguridad**, el propietario o un administrador descarga cuando quiera:
   - todos los datos de su taller en un archivo;
   - o tablas sueltas para Excel.

   Solo los suyos, sin claves internas, y cada descarga queda anotada. Recomiéndales hacerlo una vez al mes y guardarla en un sitio seguro, porque lleva datos personales.
2. **La de toda la plataforma** (la tuya): una copia diaria **cifrada** que hace GitHub (`.github/workflows/copias.yml`). Se restaura en una base nueva y se prueba sola en cada cambio. Para activarla hacen falta:
   - una clave de cifrado;
   - el secreto `BACKUP_DATABASE_URL` (la misma cadena del dato 3);
   - mejor, un almacenamiento externo en la UE.

   Pasos en [`COPIAS_SEGURIDAD.md`](COPIAS_SEGURIDAD.md).

Ojo con el plan gratuito de Supabase:
- **no** hace copias;
- **pausa** el proyecto tras 7 días sin uso.

Con talleres reales, conviene el plan de pago, que da una copia diaria guardada 7 días dentro de Supabase. Aun así, mantén la copia cifrada propia: es la que está fuera de Supabase.

## 5. Qué falta para hacerlo todo legal (España)

### Tú, como empresa que vende el servicio

- [ ] **Darte de alta** como autónomo o crear una sociedad (alta censal en Hacienda y, si eres autónomo, en la Seguridad Social) antes de cobrar.
- [ ] **Contrato con cada taller** (condiciones del servicio): precio, qué incluye, disponibilidad, soporte, baja y devolución de datos (la copia del apartado 4 sirve para eso).
- [ ] **Contrato de encargado del tratamiento** con cada taller (RGPD art. 28):
  - el **taller es el responsable** de los datos de sus clientes y **tú eres el encargado**;
  - el contrato dice qué haces con los datos, con qué medidas y con qué subencargados: Supabase, Cloudflare y, si los activas, Resend y Meta.
- [ ] **Registro de actividades de tratamiento** (RGPD art. 30): el tuyo como encargado y, si vendes también al público, como responsable.
- [ ] Revisar los **contratos de tratamiento (DPA)** de Supabase, Cloudflare, Resend y Meta, y las **transferencias internacionales**. Son empresas de EE. UU.: hay que comprobar el Marco de Privacidad de Datos UE-EE. UU. o cláusulas tipo.
- [ ] **Brechas de seguridad**: si hubiera una, se notifica a la AEPD en 72 horas (RGPD art. 33). Ten escrito a quién avisar y cómo.
- [ ] **Dominio propio** para la plataforma y el correo. Hace falta para enviar correos con Resend. Es un gasto pequeño: no se ha comprado nada.

### Las webs y el área privada

- [ ] **Aviso legal** (LSSI art. 10): nombre o razón social, NIF, domicilio, correo y, si es sociedad, datos del Registro Mercantil. Uno para la plataforma y uno por cada taller con sus datos. Las páginas existen, pero **el texto está pendiente**: no se ha inventado.
- [ ] **Política de privacidad** (RGPD art. 13): quién trata los datos, para qué, con qué base, cuánto tiempo, a quién se ceden, derechos y AEPD. Debe incluir los avisos por correo y WhatsApp y sus proveedores.
- [ ] **Política de cookies**: el aviso ya da «Aceptar» y «Rechazar» con el mismo peso y solo usa cookies técnicas y de preferencias. Falta revisar el texto de `/cookies`.
- [ ] **Condiciones de uso** del área de clientes (`/condiciones`): texto pendiente.

### Los talleres (lo que exige su actividad)

- [ ] **Facturación VERI*FACTU**:
  - las facturas de la plataforma son **operativas y NO están certificadas**;
  - según el RDL 15/2025, el sistema será obligatorio el **1 de enero de 2027** para sociedades y el **1 de julio de 2027** para el resto;
  - en octubre de 2026 se publicó que podría retrasarse a 2028, pero **no consta confirmado oficialmente**.

  Antes de esas fechas, o se adapta y certifica el programa (declaración responsable del fabricante), o los talleres deben emitir sus facturas legales con un programa certificado. Hay que decidirlo antes de vender la facturación como «legal».
- [ ] **Reglamento de talleres** (RD 1457/1986, modificado por el RD 455/2010, más los decretos de cada comunidad):
  - **presupuesto por escrito** si el cliente lo pide; el programa ya lo hace;
  - **garantía mínima** de 3 meses o 2.000 km (15 días en vehículos industriales);
  - **hojas de reclamaciones** y **cartel informativo** en el taller;
  - **resguardo de depósito** del vehículo.

  El programa ayuda con presupuestos, historial y facturas, pero los carteles y las hojas son del taller.
- [ ] Cada taller rellena sus datos legales en **Panel → Taller** (razón social, NIF, dirección, correo legal): su aviso legal y su privacidad se rellenan solos. La propietaria acepta allí las condiciones y el contrato de encargo. Detalle en `docs/LEGAL.md`.

## 6. Enviar correos y WhatsApp (además de los avisos en el portal)

Hoy los clientes ven los avisos **en su portal**. Correo y WhatsApp están programados y probados con proveedores **simulados**, y se activan poniendo las claves reales.

**Ninguno se ha contratado.**

### Correo (Resend)

1. Necesitas un **dominio propio** (p. ej. `tudominio.es`).
2. Crea una cuenta en resend.com → **Domains** → *Add domain* y añade en tu proveedor del dominio los registros que te indica (SPF y DKIM).
3. **API Keys** → *Create API key* con permiso de envío («Sending access»).
4. En GitHub:
   - secreto `RESEND_API_KEY`;
   - en la pestaña **Variables** (al lado de *Secrets*), la variable `EMAIL_FROM` con el remitente, p. ej. `avisos@tudominio.es`.
5. Opcional, para saber si el correo se entregó:
   - en Resend, **Webhooks** → *Add endpoint* `https://<tu web>/api/notificaciones/webhook`, con los eventos de entrega;
   - copia el *signing secret* al secreto `RESEND_WEBHOOK_SECRET`.
6. Vuelve a lanzar el **paso 1**. Al hacerlo:
   - los correos de la cuenta (confirmar el correo, cambiar la contraseña) salen también por Resend y ya llegan a **cualquier** persona, no solo a tu equipo de Supabase;
   - el resumen dirá «Correo a clientes: activo».
7. En el panel de cada taller: **Avisos → «Enviar avisos por email»**.

Coste (según su web y guías, consultado en octubre de 2026):
- plan gratuito de unos **3.000 correos al mes, con 100 al día**;
- plan de pago desde unos **20 $ al mes** (50.000 correos).

Compruébalo en su página antes de contratar.

### WhatsApp (API oficial de Meta)

1. Cuenta de **Meta Business** verificada y una app en developers.facebook.com con el producto **WhatsApp**.
2. Un **número de teléfono dedicado**: no puede estar en uso en la app normal de WhatsApp.
3. Pide a Meta que apruebe la plantilla **`reparacion_estado_v1`**:
   - categoría «Utilidad», idioma español;
   - con 3 variables: nombre del taller, título del aviso y detalle;
   - texto propuesto en [`NOTIFICACIONES.md`](NOTIFICACIONES.md#8-whatsapp-implementado-pendiente-de-cuenta-y-sms-no-implementado).
4. En GitHub, **secretos**:
   - `WHATSAPP_TOKEN` (token permanente de un «usuario del sistema»);
   - `WHATSAPP_APP_SECRET` (secreto de la app);
   - `WHATSAPP_VERIFY_TOKEN` (una frase larga que inventes).
5. En GitHub, **variables**:
   - `WHATSAPP_PHONE_NUMBER_ID` (el identificador del número, solo cifras);
   - opcional, `WHATSAPP_TEMPLATE` si la plantilla se llama distinto.
6. En Meta, webhook: URL `https://<tu web>/api/notificaciones/whatsapp`, token de verificación = tu `WHATSAPP_VERIFY_TOKEN`, suscripción a «messages».
7. Vuelve a lanzar el **paso 1** (resumen: «WhatsApp: activo»). En el panel de cada taller: **Avisos → «Enviar avisos por WhatsApp»**.
8. El **cliente** lo activa en su portal (**Mis datos**). WhatsApp exige su permiso expreso, así que el taller no puede activarlo por él.

Coste:
- Meta cobra **por mensaje** desde julio de 2025;
- los de «utilidad» son gratis si el cliente te escribió en las últimas 24 horas;
- fuera de ese plazo, en España rondan **0,02 € por mensaje**, según guías de terceros (**sin confirmar** en la tabla oficial).

Compruébalo antes de activarlo.

Si más adelante quitas una clave de GitHub, el Worker conserva la última que se publicó. Para apagar un canal, desactívalo en **Avisos** de cada taller o borra el secreto en Cloudflare (Workers → `autovalue-web` → Settings → Variables).

## 7. Si un taller deja el programa: se queda su web

Un taller que ha pagado su web se la queda aunque deje de pagar el programa. Se la das así:

1. GitHub → **Actions** → **«Exportar la web de un taller»** → *Run workflow*.
2. Escribe el identificador del taller (p. ej. `taller-garcia`) y pulsa el botón verde.
3. A los 5 minutos, abre la ejecución y descarga **`web-<taller>`**. Ese .zip es su web: se lo mandas y lo sube a cualquier alojamiento. Dentro va un `LEEME.txt` con las instrucciones.

- Solo **lee** la base de datos: no cambia nada y no cuesta nada.
- Antes de dártela, comprueba que la web funciona sola, sin tu plataforma.
- La copia no lleva formularios (pasan a ser botones de llamar, WhatsApp y correo) ni el área de clientes.
- Si al taller le faltan sus datos legales, no se genera: primero tiene que completarlos en Panel → Taller.

Detalles y el texto para el contrato: [`EXPORTAR_WEB.md`](EXPORTAR_WEB.md).

## Fuentes (consultadas en octubre de 2026)

- Supabase: correo propio (SMTP) por la API de gestión, `supabase/supabase` → `apps/docs/content/guides/auth/auth-smtp.mdx`.
- Resend SMTP (`smtp.resend.com`, puerto 465, usuario `resend`, contraseña = clave de la API): https://resend.com/docs/send-with-smtp · https://resend.com/docs/send-with-supabase-smtp
- Precios de Resend: https://automationatlas.io/answers/resend-pricing-explained-2026/ · https://usecarly.com/blog/resend-pricing/
- Precios de WhatsApp: https://developers.facebook.com/docs/whatsapp/pricing · https://support.kommo.com
- VERI*FACTU: https://infoautonomos.com/blog/verifactu-cuando-es-obligatorio-a-quien-afecta/ · https://www.holded.com/es/blog/hacienda-retrasa-entrada-vigor-verifactu · https://www.infocop.es/?p=76103
- Talleres (RD 1457/1986): https://www.consumoresponde.es · https://documentacion.fundacionmapfre.org · https://www.consumer.es
