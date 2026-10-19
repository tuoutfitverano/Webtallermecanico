# CLAUDE.md — Plataforma para talleres mecánicos

Instrucciones para Claude Code (y para cualquier persona que trabaje en el proyecto). Léelas antes de cambiar nada.

## Qué es

Plataforma multiempresa para talleres mecánicos multimarca en España: una sola aplicación sirve la web pública de cada taller (según el dominio) y, en fases posteriores, el panel privado y el portal del cliente. El propietario del proyecto no es programador: **explica las decisiones en lenguaje claro** y no afirmes que algo funciona sin haberlo comprobado.

- Arquitectura y decisiones: `docs/ARQUITECTURA.md`
- Plan por fases y estado: `docs/ROADMAP.md`
- Navegador para Claude (Playwright MCP): `docs/PLAYWRIGHT_MCP.md`
- Consulta por matrícula (proveedor, costes, activación): `docs/CONSULTA_MATRICULAS.md`
- Notificaciones (portal, email, reintentos, consentimiento): `docs/NOTIFICACIONES.md`

## Estructura

```
apps/web/                 Astro 7 + Cloudflare Workers (web pública; luego panel y portal)
  src/pages/              index (web del taller), privacidad, aviso-legal, api/solicitudes.ts
                          acceso, registro, recuperar, salir, auth/confirmar, cuenta/, invitacion (área privada)
                          panel/ (inicio, ordenes/, vehiculos/, clientes/, equipo) — panel del taller
                          portal/ (inicio, vehiculos/, reparaciones/, avisos, datos, invitacion) — portal del cliente
                          panel/avisos (avisos a clientes), api/notificaciones/ (procesar = cron, webhook = Resend)
                          mi-area (reparto tras iniciar sesión), acceso-denegado (403)
  src/middleware.ts       Área privada: dominio APP_URL y cabeceras anti-caché
  src/components/         Secciones de la web y formularios (RequestForm.astro)
  src/scripts/            JavaScript del navegador (request-forms.ts)
  src/lib/site/           Contenido del taller, resolución por dominio, demo local
  src/lib/requests/       Endpoint de solicitudes: handler (lógica pura), store, antispam
  src/lib/server/         Configuración del servidor (lee astro:env), sesión (auth.ts, auth-page.ts) — solo servidor
  src/lib/auth/           Redirección segura (?next=), mensajes de error, validación de acceso
  src/layouts/AuthLayout  Plantilla del área privada
  src/layouts/PanelLayout Plantilla del panel (barra lateral / pestañas en móvil, ClientRouter)
  src/lib/server/panel.ts Contexto del panel: sesión, talleres, taller activo validado, equipo
  src/lib/server/portal.ts Contexto del portal: sesión y fichas vinculadas (portal_profile)
  src/layouts/PortalLayout, src/components/portal/  Plantilla y piezas del portal del cliente
  src/lib/panel/          Formatos de fecha (Europe/Madrid) y lectura del formulario de vehículos
  src/lib/vehicle-lookup/ Consulta por matrícula: tipos, cliente de Openapi, lógica (service) y revisión — solo servidor
  src/lib/notifications/  Avisos: canal email (Resend), plantilla, despachador, webhook firmado — solo servidor
  src/components/panel/   Piezas del panel (estado, avisos, campos de cliente y vehículo)
  src/styles/panel.css    Estilos del panel (más denso y opaco que la web pública)
  src/styles/site.css     Diseño "cristal líquido" de la web pública (CSS propio, sin Tailwind)
  e2e/                    Pruebas de navegador (Playwright Test)
packages/core/            Reglas compartidas navegador/servidor: matrículas, vehículos, solicitudes, clientes y órdenes (workshop.ts)
supabase/migrations/      Esquema + permisos (RLS). Nunca edites una migración ya aplicada: crea otra.
supabase/tests/           Pruebas SQL de permisos por rol (con el esquema auth REAL de Supabase Auth)
supabase/templates/       Plantillas de correo de Supabase Auth (confirmación, recuperación)
supabase/seed.sql         Datos de DEMOSTRACIÓN (taller demo en demo.localhost)
scripts/                  test-db.sh, test-e2e.sh, lib/supabase-auth.sh, e2e/ (pasarela, buzón SMTP, JWT), Playwright MCP
demo/                     Prototipo comercial estático antiguo (no tocar salvo petición)
atrium-mtl/               Proyecto independiente (portada ATRIUM MTL)
```

## Comandos

```bash
npm install
npm run dev          # web en http://localhost:4321 (sin .env usa la demo local)
npm run lint         # ESLint
npm run check        # tipos (tsc + astro check)
npm test             # pruebas unitarias (Vitest) de core y web
npm run build        # compilación para Cloudflare + comprobación de que el navegador no recibe secretos
npm run test:db      # migraciones + permisos RLS en PostgreSQL local
npm run test:e2e     # navegador → web → Supabase Auth real + PostgREST → PostgreSQL con RLS
npm run test:mcp     # comprueba el servidor Playwright MCP
```

En la nube de Claude Code, PostgreSQL puede estar parado: `pg_ctlcluster 16 main start`. Astro 7 arranca `astro dev` en segundo plano en este entorno: páralo con `npx astro dev stop` (desde `apps/web`).

Antes de dar por terminado un cambio: `npm run lint && npm run check && npm test && npm run build && npm run test:db` y, si toca formularios o base de datos, `npm run test:e2e`.

## Reglas que no se negocian

1. **Seguridad en la base de datos, no en la interfaz.** Todo dato de un taller lleva `workshop_id` y está protegido por RLS. Ocultar un botón no es seguridad.
2. **Secretos solo en el servidor.** `SUPABASE_SECRET_KEY`, `TURNSTILE_SECRET_KEY` y `REQUEST_HASH_SECRET` se leen con `astro:env/server` en `src/lib/server/config.ts`. Nunca los importes desde `src/scripts/` ni desde código que llegue al navegador. Nunca los escribas en el código ni en el chat.
3. **Validación doble.** Las reglas viven en `packages/core` y se usan en el navegador (avisar) y en el servidor (decidir). La base de datos vuelve a comprobar lo esencial.
4. **Éxito solo si se ha guardado.** Un formulario solo muestra "recibido" cuando el servidor responde `ok` tras guardar. Sin almacenamiento configurado, responde error 503: nunca se simula un envío.
5. **Una cita solicitada no es una cita confirmada.** Las solicitudes nacen con `status = 'nueva'` (pendiente) y los textos lo dicen.
6. **No inventar datos.** Ni reseñas, precios, años de experiencia, certificaciones, textos legales ni datos de vehículos. Las matrículas solo se consultan en el proveedor contratado, desde el servidor y cuando la persona pulsa «Consultar datos» (ver Fase 6); nunca se rellena un dato que el proveedor no haya devuelto. El contenido de demostración se marca como tal (`is_demo_content`).
7. **Datos personales mínimos.** No se guarda el IP (solo una huella HMAC diaria que se borra a los 2 días). Los registros (`console.*`) llevan solo códigos de evento, nunca datos del formulario.
8. **Migraciones.** Cambios de esquema = nueva migración en `supabase/migrations/` + pruebas en `supabase/tests/`. Revoca `execute` de `public` en cada función nueva y concede solo lo necesario. Las funciones `security definer` llevan `set search_path = ''`.
9. **Acciones con consecuencias** (borrar datos, migraciones en producción, despliegues, rotar claves): explica el riesgo y pide confirmación antes.

## Convenciones

- Código en TypeScript estricto; identificadores en inglés, textos visibles y comentarios en español.
- Valores de dominio en español (`'cita'`, `'nueva'`, `'gasolina'`) y sincronizados entre `packages/core` y los tipos de la base de datos.
- La web pública usa `src/styles/site.css` (estética "cristal líquido": fondo negro, Instrument Serif cursiva para titulares, Barlow para texto) y fuentes alojadas en la propia web (`@fontsource/*`), sin Google Fonts. Tailwind queda disponible para el futuro panel.
- Animaciones sin librerías: `BlurText.astro` (palabra a palabra) y la clase `.reveal` + `data-reveal`. El estado oculto inicial solo se aplica con la clase `anim` en `<html>` (la pone un script en línea): sin JavaScript o con "reducir movimiento" todo se ve. Nunca ocultes contenido con CSS sin esa condición.
- `[hidden]` siempre oculta (`display:none !important`). No lo quites: el panel de "Solicitud recibida" depende de ello.
- Vídeos de fondo opcionales por taller en `workshop_sites.theme` (`heroVideo`, `servicesVideo`, solo `https`). `FadingVideo.astro` no los descarga sin JavaScript, con "reducir movimiento" o con ahorro de datos; entonces se ve el fondo animado. Una web real debe usar vídeos propios o con licencia.
- React solo cuando una pantalla lo necesite de verdad (todavía no se usa).
- Variables de entorno: `apps/web/.env` en local (plantilla en `.env.example`); en producción, secretos de Cloudflare.

## Acceso, cuentas y equipos (Fase 3)

- **Supabase Auth** con `@supabase/ssr`: sesión en cookies, un cliente NUEVO por petición (`createAuthClient`), usuario validado con `getClaims()`. **Nunca** `getSession()` en el servidor.
- El área privada usa la **clave publicable + el token del usuario**: RLS decide. No uses la clave secreta para leer o escribir datos de usuarios.
- Páginas con POST: `authPage(Astro)`; si `isPost && !form` → 403 (origen distinto). Redirecciones solo con `safeNext()`.
- Roles del taller: `propietario` (owner), `administrador` (manager), `mecanico` (mechanic). Los privilegios **nunca** se leen de `user_metadata` ni del perfil.
- Equipo e invitaciones solo mediante funciones (`create_workshop_invitation`, `accept_workshop_invitation`, `set_member_role`, `set_member_active`, `workshop_team`, `my_workshops`). En SQL, compara roles con `IS NOT DISTINCT FROM` (con `=` un rol NULL deja pasar a cualquiera).
- Alta de talleres: `private.create_workshop(...)` desde el SQL Editor; la API no la ve. Ver `docs/PUESTA_EN_MARCHA.md`.
- Contraseñas: mínimo 10 con mayúsculas, minúsculas y números (igual en `validate.ts` y `supabase/config.toml`).
- En pruebas e2e los correos llegan a `scripts/e2e/mail-sink.mjs`; `test-e2e.sh` usa `exec` para que la limpieza mate los servidores (si un puerto está ocupado, aborta).
- `Referrer-Policy: same-origin` en el área privada (con `no-referrer` el navegador envía `Origin: null` y los formularios se rechazan).

## Panel del taller (Fase 4)

- Todas las páginas empiezan con `panelPage(Astro)`: exige sesión, carga `my_workshops()` y elige el taller activo. La cookie `panel_taller` y `?taller=` son **solo preferencias** validadas contra las membresías; nunca dan acceso.
- Lecturas y escrituras con el token del usuario (RLS). Filtra siempre también por `workshop_id` del taller activo, pero la seguridad la pone la base de datos.
- Órdenes (`repair_orders`): vehículo, cliente y mecánico del MISMO taller por claves foráneas compuestas; número `OR-n` correlativo por taller; `internal_notes` nunca se mostrará al cliente.
- Mecánico: solo ve las órdenes asignadas a él; puede cambiar estado (no "entregado"), diagnosis, trabajo y notas internas. No crea, no reasigna. Lo impone el disparador `repair_orders_guard`, no la interfaz.
- Historial (`repair_order_events`): lo escriben los disparadores; nadie (ni la clave secreta) lo modifica. Desactivar a un empleado no borra sus órdenes.
- Búsquedas y resumen: funciones `search_*` y `workshop_dashboard` con `security invoker` (RLS igual que una consulta). Para comodines usa `private.like_pattern()`.
- **Nunca** pongas `security definer` a una función que llame a `private.is_privileged()`: dentro, el usuario actual sería `postgres` y daría permisos a todo el mundo (lo cubren las pruebas de `08_ordenes_reparacion.test.sql`).
- Formularios sin JavaScript (POST al servidor y aviso integrado); acciones destructivas en dos pasos (`pedir-borrar` → `borrar`). Nada de `alert()`/`confirm()`.
- Fechas: se muestran en hora de Madrid (`lib/panel/format.ts`); un `datetime-local` se guarda con `localInputToDb()`.
- En pruebas e2e la barra de desarrollo de Astro está desactivada (`E2E=1`) porque tapa las pestañas del móvil.

## Portal del cliente (Fase 5)

- La cuenta se vincula a una ficha **solo** con `create_customer_invitation` (gestor) + `accept_customer_invitation` (el cliente, con ese correo confirmado). Nunca por matrícula, nombre, correo o teléfono. `unlink_customer_account` retira el acceso sin borrar nada.
- El cliente **no lee tablas**: solo funciones `portal_*` (`security definer`, columnas elegidas a mano, filtradas con `private.portal_customer_ids()`). Si añades un dato al portal, añádelo a esas funciones y a `09_portal_clientes.test.sql`; nunca des `select` en tablas a clientes.
- Nunca al cliente: `internal_notes`, personal asignado, autores de cambios, otros clientes. Diagnosis y trabajo solo con `show_details_to_customer`. Sin fechas prometidas.
- Solo gestores cambian `customer_notes` y `show_details_to_customer` (lo impone `repair_orders_guard`).
- Tras iniciar sesión se va a `/mi-area` (personal → `/panel`, cliente → `/portal`, resto → `/cuenta`). Un cliente en `/panel` ve `acceso-denegado` (403).
- Los valores nuevos de un enum no se pueden usar en la misma transacción que los crea: compara `kind::text`.

## Consulta por matrícula (Fase 6)

- Proveedor detrás de la interfaz `VehicleLookupProvider` (`src/lib/vehicle-lookup/types.ts`); hoy, Openapi «Spanish Car Check» (`openapi.ts`). Cambiar de proveedor = otro archivo como ese + `vehicleLookupProvider()` en `config.ts`.
- Sin `VEHICLE_LOOKUP_PROVIDER` + token + `SUPABASE_SECRET_KEY` el botón no aparece y todo es manual. El token solo se lee en `config.ts`.
- Permisos y límites en la base de datos (`start_vehicle_lookup`, token del usuario). El resultado lo guarda SOLO el servidor (`complete_vehicle_lookup`, clave secreta): nadie puede fabricar datos "del proveedor".
- La consulta no crea el vehículo. Lo escrito a mano no se sustituye sin marcarlo. Al guardar con `lookup_id`, la base de datos calcula `lookup_fields` (confirmado/modificado/no_usado) y el origen.
- Respuestas reutilizables solo dentro del mismo taller (24 h). Nunca compartas resultados entre talleres.
- En pruebas e2e el proveedor es SIMULADO (`scripts/e2e/plate-provider-mock.mjs`); no presentes esas pruebas como consultas reales.

## Notificaciones (Fase 7)

- Los avisos los crea la BASE DE DATOS a partir de `repair_order_events` (disparador `repair_order_events_notify`, misma transacción). No crees avisos desde la interfaz ni desde el servidor.
- `enviado` = aceptado por el proveedor; `entregado` = confirmado por webhook firmado. Nunca marques un email como enviado sin respuesta real del proveedor; sin proveedor, quedan `pendiente`.
- El envío es del servidor con la clave secreta (`claim_email_notifications` → proveedor con `Idempotency-Key` = id del aviso → `record_email_result`). Reintentos: 5 automáticos con espera, 3 manuales (solo gestores), nunca sobre lo ya enviado.
- Avisos operativos ≠ comerciales. Lo comercial exige consentimiento del PROPIO cliente (`set_contact_preferences` desde el portal); el taller solo puede retirarlo. Lo impone `notifications_guard`.
- El contenido del aviso solo lleva lo que el cliente ya ve en su portal. Los textos de estado de `private.status_customer_text` deben coincidir con `REPAIR_STATUS_CUSTOMER_TEXT` (lo comprueba una prueba).
- En e2e el email es SIMULADO (`scripts/e2e/email-provider-mock.mjs`): no lo presentes como envío real.

## Formularios y solicitudes (Fase 2)

Flujo: `RequestForm.astro` → `src/scripts/request-forms.ts` (valida, bloquea doble envío, clave de idempotencia) → `POST /api/solicitudes` → `handleSubmission` (origen, campo trampa, validación, Turnstile) → `submit_web_request` en Postgres (clave secreta; idempotencia, límite de envíos, validación final) → tabla `web_requests`.

Códigos de respuesta: 201 guardada · 200 duplicado ya guardado · 422 validación · 400 petición/antispam · 403 otro origen · 404 web inexistente · 429 demasiados envíos · 503 almacenamiento o antispam no disponibles.
