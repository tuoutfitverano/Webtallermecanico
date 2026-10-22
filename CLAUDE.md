# CLAUDE.md — Plataforma para talleres mecánicos

Instrucciones para Claude Code (y para cualquier persona que trabaje en el proyecto). Léelas antes de cambiar nada.

## Qué es

Plataforma multiempresa para talleres mecánicos multimarca en España: una sola aplicación sirve la web pública de cada taller (según el dominio) y, en fases posteriores, el panel privado y el portal del cliente. El propietario del proyecto no es programador: **explica las decisiones en lenguaje claro** y no afirmes que algo funciona sin haberlo comprobado.

- Arquitectura y decisiones: `docs/ARQUITECTURA.md`
- Plan por fases y estado: `docs/ROADMAP.md`
- Navegador para Claude (Playwright MCP): `docs/PLAYWRIGHT_MCP.md`
- Consulta por matrícula (proveedor, costes, activación): `docs/CONSULTA_MATRICULAS.md`
- Notificaciones (portal, email, reintentos, consentimiento): `docs/NOTIFICACIONES.md`
- Integración de pantallas (inventario y flujos verificados): `docs/INTEGRACION.md`
- Plantilla de webs de taller (configuración por taller, AutoValue): `docs/PLANTILLA_TALLERES.md`, `talleres/`, `docs/AUDITORIA_PLANTILLA.md`
- Gestión del taller (roles, planificación, recordatorios, estadísticas): `docs/GESTION_TALLER.md`
- Presupuestos, facturas y cobros (operativa, NO VERI*FACTU): `docs/FACTURACION.md`
- Auditoría, despliegue y lanzamiento: `docs/AUDITORIA_FASE8.md`, `docs/DESPLIEGUE.md`, `docs/CHECKLIST_LANZAMIENTO.md`, `docs/DATOS_PERSONALES.md`
- Versión real sin coste (Cloudflare Workers + Supabase gratis, flujo «Publicar versión real»): `docs/PUBLICAR.md`, `scripts/publicar/`
- Guía del propietario (pasos de GitHub, legal, contraseñas, copias, correo y WhatsApp): `docs/GUIA_PROPIETARIO.md`
- Cuentas de cliente multitaller (una cuenta, varios talleres, entrada desde la web del taller, soporte de la plataforma): `docs/MULTITALLER.md`

## Estructura

```
apps/web/                 Astro 7 + Cloudflare Workers (web pública; luego panel y portal)
  src/pages/              index (web del taller: diseño según theme.design), clasico (diseño anterior, solo demo), privacidad, aviso-legal, api/solicitudes.ts
                          acceso, registro, recuperar, salir, auth/confirmar, cuenta/, invitacion (área privada)
                          panel/ (inicio, ordenes/, vehiculos/, clientes/, equipo) — panel del taller
                          portal/ (inicio, vehiculos/, reparaciones/, avisos, datos, talleres, entrar/[slug], invitacion) — portal del cliente; area-cliente (desde la web del taller)
                          panel/avisos (avisos a clientes), panel/solicitudes (solicitudes de la web), panel/taller (datos, servicios y ajustes de facturación)
                          panel/planificacion, panel/mantenimientos, panel/copia (copia del taller), panel/presupuestos/, panel/facturas/ (+ [id]/imprimir), panel/recordatorios, panel/estadisticas
                          presupuesto/[token] (respuesta del cliente sin cuenta); portal/presupuestos/, portal/facturas/
                          api/notificaciones/ (procesar = cron: avisos + mantenimiento; webhook = Resend; whatsapp = Meta)
                          cookies, condiciones, privacidad-cuenta, 404 (páginas legales: texto pendiente)
                          mi-area (reparto tras iniciar sesión), acceso-denegado (403)
  src/middleware.ts       Cabeceras de seguridad en todo (CSP frame-ancestors, nosniff, HSTS…); área privada: APP_URL y anti-caché
  src/components/         Secciones de la web y formularios (RequestForm.astro); ClassicHome (diseño clásico)
  src/components/premium/ Diseño premium por secciones (PremiumHome + Pm*.astro), styles/premium.css, scripts/premium.ts
  src/scripts/            JavaScript del navegador (request-forms.ts)
  src/lib/site/           Contenido del taller (content.ts), archivo de taller (workshop-config.ts), software (software.ts), dominio, demo local
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
  src/lib/notifications/  Avisos: canales email (Resend) y WhatsApp (Meta), plantilla, despachador, webhooks firmados — solo servidor
  src/components/panel/   Piezas del panel (estado, avisos, campos de cliente y vehículo)
  src/styles/panel.css    Estilos del panel (más denso y opaco que la web pública)
  src/styles/app.css      Diseño premium del área privada (acceso, cuenta, panel, portal): Archivo, etiquetas con raya, botones en píldora
  src/styles/site.css     Diseño "cristal líquido" de la web pública (CSS propio, sin Tailwind)
  e2e/                    Pruebas de navegador (Playwright Test)
packages/core/            Reglas compartidas navegador/servidor: matrículas, vehículos, solicitudes, clientes y órdenes (workshop.ts), dinero (money.ts), documentos (documents.ts)
talleres/                 Un .json por taller (identidad, textos, tema, secciones). autovalue.json = demo; plantilla.json = taller nuevo
apps/web/public/plataforma/capturas/  Capturas REALES del software (compartidas por todos los talleres)
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
npm run taller:sql -- talleres/x.json   # comprueba el archivo de un taller y escribe su SQL (no lo ejecuta)
```

Vista previa navegable para el propietario (panel y portal con datos de demostración, sin servidor): `VISTA_PREVIA_DIR=<carpeta> bash scripts/test-e2e.sh e2e/vista-previa.spec.ts --project escritorio` y después `scripts/vista-previa/build.py` (instrucciones en ese archivo). **Tras CADA petición del propietario, vuelve a publicar la vista previa completa (web + panel + portal) en el mismo artifact; nunca le mandes capturas en su lugar.**

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
- Área privada (acceso, cuenta, panel y portal) con el diseño premium de la web, el que eligió el propietario: `<html data-area="app">` + `styles/app.css` (titulares Archivo ancho en mayúsculas, etiquetas `.label` con raya —sin «//»—, botones en píldora, sin cristal ni luces). Color de superficies por defecto «grafito» (`DEFAULT_PANEL_COLOR`); verde y pastel a elegir.
- Paleta de la plataforma (web clásica y tonos verdes): fondo negro (`#000`), `#1F4536` superficies, `#0F2A22` verde muy oscuro (texto sobre crema, `--ink`), `#8A9A7B` salvia (acento; para texto secundario sobre tarjetas, aclarada con crema por contraste), `#EFE8DA` crema (texto). Variables en `site.css` (`--bg`, `--surface`, `--sage`, `--fg`, `--ink`) y `panel.css` (`--p-*`). El acento de cada taller sigue viniendo de `theme.accent`.
- Modo claro u oscuro a elegir por cada persona (botón sol/luna: `ThemeToggle.astro`; `lib/theme.ts`, cookie `tema` + localStorage, solo en ese dispositivo; sin JavaScript, formulario a `/api/preferencias`). `<html data-theme>` lo pinta el servidor y `ThemeScript.astro` (en la cabecera de cada plantilla) lo corrige antes de pintar. Sin elección: **claro en el área privada** (acceso, panel y portal), oscuro en la web pública (`DEFAULT_THEME`). Sin aceptar las cookies de preferencias se mantiene durante la visita (cookie de sesión); aceptadas, 1 año. En claro cambian los tokens (`:root[data-theme='claro']` en `site.css` y `panel.css`, `.pm` en `premium.css`): nunca negro fijo para velos o sombras (`var(--veil)`, `color-mix` con el fondo). Los colores propios del taller (`theme.colors`) solo se aplican en oscuro. Con «grafito» o «verde», en claro la barra lateral sigue oscura y las tarjetas pasan a blanco roto.
- Tamaños: móvil primero, luego tablet y PC. `calidad.spec.ts` comprueba 9 tamaños (de 320 px a 1920 px, en vertical y en horizontal) en los dos modos, y axe en los dos modos. En pantallas táctiles todo lo que se pulsa mide al menos 44 px (`@media (pointer: coarse)` en `site.css`); en móvil en horizontal los titulares y las pestañas se ajustan a la altura.
- Aviso de cookies (`CookieBanner.astro` en las cuatro plantillas, `lib/consent.ts`, `scripts/consent.ts`): «Aceptar» y «Rechazar» con el mismo peso; cookie técnica `consentimiento`. Las de preferencias (`tema`, `color_panel`) solo existen si la persona cambia el modo o el color: sin aceptar, cookie de sesión + sessionStorage (la elección vale en TODAS las secciones hasta cerrar el navegador); con «aceptadas», 1 año + localStorage (`rememberPreference()` y `/api/preferencias`). Al rechazar se borra lo del dispositivo. `ThemeScript` solo lee localStorage si se aceptaron (un valor viejo no se impone). Una cookie nueva = fila en `/cookies` con su tipo; si no es técnica, va en `PREFERENCE_COOKIES`. Las pruebas e2e entran con el aviso respondido (`e2e/consent.ts`); las del aviso empiezan sin él.
- Vista previa: la elección (modo, color, cookies) pasa de página en página en el enlace (`?vp=`), en `window.name` y, con cookies aceptadas, en localStorage (`scripts/vista-previa/state.ts` + `state-inline.js`), porque en la app de Claude la vista previa puede no tener almacenamiento entre páginas.
- Color del panel y del portal a elegir por cada persona (botón «Color»; `lib/panel/colors.ts`, cookie `color_panel` + localStorage, solo en ese dispositivo). En `panel.css` las «superficies» (`.pnl-side`, `.card`, `.kpi`…) recalculan los tokens con su tono: un componente nuevo con fondo propio se añade a esa lista y usa `var(--tone-*)` para estados, nunca colores fijos. `calidad.spec.ts` pasa axe en cada color.
- La web pública usa `src/styles/site.css` (estética "cristal líquido", Instrument Serif cursiva para titulares, Barlow para texto) y fuentes alojadas en la propia web (`@fontsource/*`), sin Google Fonts. Tailwind queda disponible para el futuro panel.
- Animaciones sin librerías: `BlurText.astro` (palabra a palabra) y la clase `.reveal` + `data-reveal`. El estado oculto inicial solo se aplica con la clase `anim` en `<html>` (la pone un script en línea): sin JavaScript o con "reducir movimiento" todo se ve. Nunca ocultes contenido con CSS sin esa condición.
- **CSP de scripts** (`lib/server/csp.ts`, en el middleware): solo se ejecutan los archivos de la web, Turnstile y los scripts en línea de `lib/inline-scripts.ts` (por su huella SHA-256). Un script en línea nuevo va en ese archivo y se pinta con `<script is:inline set:html={…}>`; nada de `define:vars`, `onclick=` ni datos por petición dentro. `vite.build.assetsInlineLimit: 0` evita que Astro meta en línea los scripts propios. `calidad.spec.ts` comprueba que uno inyectado no se ejecuta.
- Efectos de «pasar el ratón»: todo `:hover` va dentro de `@media (hover: hover)` (en pantallas táctiles se quedarían marcados tras tocar). Los botones ceden al pulsar (`:active`, `scale(.97)`, `var(--ease-out)`). En móvil/táctil (`max-width: 760px` o `pointer: coarse`) los desenfoques son menores y las entradas no animan `filter`.
- `[hidden]` siempre oculta (`display:none !important`). No lo quites: el panel de "Solicitud recibida" depende de ello.
- Vídeos de fondo opcionales por taller en `workshop_sites.theme` (`heroVideo`, `servicesVideo`, solo `https`). `FadingVideo.astro` no los descarga sin JavaScript, con "reducir movimiento" o con ahorro de datos; entonces se ve el fondo animado. Una web real debe usar vídeos propios o con licencia.
- Coche que gira con el scroll: `theme.scrollFrames` (`src` con `{n}`, `count`, `poster`, `focusX/focusY` = punto del zoom final; `backdrop` + `frameTop` = fondo opcional, p. ej. el garaje, con los fotogramas transparentes encima; `turn` = parte del giro que se reproduce, 0.5 = media vuelta, y solo se descargan esos fotogramas; `endFrame` = último fotograma (manda sobre `turn`) y `reverse` = girar hacia el otro lado (000 → último → … → `endFrame`); `openFrom` = desde ese fotograma la secuencia (p. ej. el maletero que se abre) se reproduce al empezar la última transición, antes del zoom. AutoValue usa el vídeo del maletero (`maletero/`, 62 fotogramas, `scripts/demo-autovalue/frames-maletero.py`: recorte con IA, rembg + BiRefNet): de lateral a trasera (0–29), maletero que se abre (`openFrom: 29`) y zoom al interior del maletero; el giro anterior (`giro/`, media vuelta con zoom a la ventanilla) sigue en `public/` por si se vuelve a él; `turnGap`/`zoomGap` = espacio propio de cada transición en alturas de pantalla: cuanto menor, más se funde con las secciones). `ScrollStage.astro` + `scripts/scroll-stage.ts` dibujan fotogramas en un canvas: portada → giro → servicios → zoom hasta la ventanilla tintada → el software entra encima mientras el cristal se oscurece. Al abrir la página solo se descarga la imagen fija: el fondo y los fotogramas llegan al empezar a bajar (`rendimiento.spec.ts` lo mide). Sin JavaScript, con «reducir movimiento» o ahorro de datos: solo la imagen fija y sin huecos. Fotogramas del taller demo (AutoValue) en `public/demo/autovalue/`: `giro/` (1920 px) y `giro-4k/` + `garaje-4k.webp` (3840 px, solo en pantallas de más de 2000 px reales), reescalados con Real-ESRGAN (`scripts/demo-autovalue/upscale.py`). Vídeo aportado por el propietario (KlingAI; marca de agua retirada a petición suya). Se regeneran con `scripts/demo-autovalue/` (`render-garage.mjs` dibuja el garaje de `garage.html`; `frames.py` recorta el coche, añade sombra y reflejo y compone la portada).
- React solo cuando una pantalla lo necesite de verdad (todavía no se usa).
- Variables de entorno: `apps/web/.env` en local (plantilla en `.env.example`); en producción, secretos de Cloudflare.

## Plantilla de webs de taller

- Lo propio de cada taller va en `talleres/<taller>.json` (→ `workshop_sites.content/theme` con `npm run taller:sql`); los componentes son compartidos. Nunca copies componentes por taller: añade una opción al esquema (`content.ts`) con valor por defecto que no cambie a los talleres existentes.
- `talleres/autovalue.json` es la fuente de AutoValue: `demo.ts` lo lee y `seed.sql` lleva una copia (lo comprueba `demo.test.ts`). Si cambias uno, regenera el otro.
- `configProblems` es más estricto que la web: una clave desconocida o un valor que la web descartaría hace fallar `npm test`.
- Sección comercial («Quiero digitalizar mi taller», tipo `digitalizacion`): solo con `sections.comercial` + `isDemoContent`; la base de datos solo la acepta si `workshops.status = 'demo'`. Sin datos comerciales inventados ni promesas de resultados.
- El software se enseña con capturas REALES (`public/plataforma/capturas`, recorrido en `lib/site/software.ts`). Matrícula y email muestran su estado real (`vehicleLookupAvailable()`, `emailAvailable()`); no hay agenda de citas y no se dice que la haya.
- Las fases 1–8 son etapas internas: no se presentan como módulos en la web.

## Acceso, cuentas y equipos (Fase 3)

- **Supabase Auth** con `@supabase/ssr`: sesión en cookies, un cliente NUEVO por petición (`createAuthClient`), usuario validado con `getClaims()`. **Nunca** `getSession()` en el servidor.
- El área privada usa la **clave publicable + el token del usuario**: RLS decide. No uses la clave secreta para leer o escribir datos de usuarios.
- Páginas con POST: `authPage(Astro)`; si `isPost && !form` → 403 (origen distinto). Redirecciones solo con `safeNext()`.
- Roles del taller: `propietario` (owner), `administrador` (manager), `recepcionista` (oficina: órdenes, presupuestos, facturas y cobros; no equipo ni configuración), `mecanico` (mechanic). En SQL: `staff_workshop_ids` (todos), `office_workshop_ids` (propietario, administrador, recepción; `can_manage()` = oficina), `manager_workshop_ids` (propietario y administrador: equipo, ajustes, rectificativas, anular cobros). En la web: `panel.isOffice` / `panel.isManager`. Los privilegios **nunca** se leen de `user_metadata` ni del perfil.
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
- Navegación: barra lateral en escritorio; en móvil 4 pestañas + «Más» (`<details>`, sin JavaScript). Las secciones de gestores (Avisos, Solicitudes web, Taller) solo aparecen a gestores y la página vuelve a comprobarlo. Invitaciones del equipo en `/panel/equipo` (no en `/cuenta`).
- Formularios sin JavaScript (POST al servidor y aviso integrado); acciones destructivas en dos pasos (`pedir-borrar` → `borrar`). Nada de `alert()`/`confirm()`.
- Fechas: se muestran en hora de Madrid (`lib/panel/format.ts`); un `datetime-local` se guarda con `localInputToDb()`.
- En pruebas e2e la barra de desarrollo de Astro está desactivada (`E2E=1`) porque tapa las pestañas del móvil.

## Portal del cliente (Fase 5)

- La cuenta se vincula a una ficha **solo** con `create_customer_invitation` (gestor) + `accept_customer_invitation` (el cliente, con ese correo confirmado). Nunca por matrícula, nombre, correo o teléfono. `unlink_customer_account` retira el acceso sin borrar nada.
- El cliente **no lee tablas**: solo funciones `portal_*` (`security definer`, columnas elegidas a mano, filtradas con `private.portal_customer_ids()`). Si añades un dato al portal, añádelo a esas funciones y a `09_portal_clientes.test.sql`; nunca des `select` en tablas a clientes.
- Nunca al cliente: `internal_notes`, personal asignado, autores de cambios, otros clientes. Diagnosis y trabajo solo con `show_details_to_customer`. Sin fechas prometidas.
- Solo gestores cambian `customer_notes` y `show_details_to_customer` (lo impone `repair_orders_guard`).
- El cliente añade vehículos a SU ficha (`portal_add_vehicle`: dato «cliente», pendiente de verificar; 10/día) y los quita a una **papelera de 30 días** (`portal_remove_vehicle` / `portal_restore_vehicle` / `portal_vehicle_trash`). Quitar NUNCA borra: `vehicles.portal_hidden_at` solo lo oculta en el portal; el taller conserva siempre el vehículo y su historial. No se quita con una reparación en curso; una orden nueva lo devuelve al portal. Solo esas funciones cambian `portal_hidden_at`/`added_by_customer` (`vehicles_portal_guard`).
- **Multitaller:** una cuenta, varios talleres (una ficha por taller). El portal trabaja con UN taller cada vez: `portalPage` valida `?taller=`/cookie `portal_taller` contra `portal_profile` y envía la cabecera `x-portal-taller` (`authPage().extraHeaders`); `private.portal_scope()` hace que TODAS las `portal_*` devuelvan solo ese taller (solo estrecha). `portal.records` = la ficha del taller elegido; `portal.allRecords` = todas. «Mis talleres» (`/portal/talleres`, `portal_workshops`). La web del taller enlaza a `/area-cliente` → `/portal/entrar/<slug>` (`workshop_entry`: nunca crea vínculos). Historial de vínculos en `customer_account_links` y registro en `access_events` (solo disparadores). Formularios que llevan a otra plantilla (p. ej. a `/portal/invitacion`) con `data-astro-reload`.
- Administración global: 2FA **y** sesión de soporte con motivo (`admin_open_support_session`) para ver datos; sin ella solo `admin_workshops_overview` (sin datos personales). Nunca devuelvas a `is_platform_admin()` el acceso permanente.
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
- WhatsApp (`lib/notifications/whatsapp.ts`, API oficial de Meta, plantilla aprobada `reparacion_estado_v1`): el cliente elige en «Mis datos» portal (siempre) + email y/o WhatsApp. WhatsApp solo lo PIDE el propio cliente (`set_contact_preferences` de 4 argumentos desde el portal) y necesita móvil (`private.whatsapp_number`); el taller solo lo retira. Nunca comercial por WhatsApp. En e2e es SIMULADO (`scripts/e2e/whatsapp-provider-mock.mjs`).

## Auditoría y producción (Fase 8)

- `supabase/tests/12_auditoria.test.sql` vigila reglas del esquema (RLS en todas las tablas, nada para `anon` salvo `get_public_site`, `search_path` fijado, sin escrituras directas en avisos/historial/consentimientos). Si una migración nueva lo rompe, corrige la migración, no la prueba.
- `e2e/calidad.spec.ts` pasa axe (WCAG A/AA, fallos graves/críticos), consola, red, enlaces y móvil por las pantallas principales: añade ahí las pantallas nuevas.
- Mantenimiento periódico en `public.run_maintenance()` (lo llama `/api/notificaciones/procesar`). Derechos RGPD: `private.export_customer_data` y `private.anonymize_customer` (solo SQL Editor). Ver `docs/DATOS_PERSONALES.md`.
- Los nombres accesibles de botones y enlaces deben contener el texto visible (WCAG 2.5.3).
- Nada de desplegar, aplicar migraciones en producción ni contratar servicios sin confirmación expresa (`docs/DESPLIEGUE.md`).

## Gestión: presupuestos, facturas, planificación, recordatorios

- Dinero en **céntimos enteros**; cantidades con 2 decimales. Línea = round(q × precio × (100 − dto)/100); IVA por tipo, redondeado una vez por tipo. La misma regla en `packages/core/src/money.ts` y en SQL (`private.line_base_cents`, `private.lines_totals`): si cambias una, cambia la otra (hay prueba de paridad).
- Presupuestos: borrador editable; enviado = inmutable (cambios → `revise_quote`, versión nueva). Estados solo por funciones (`send_quote`, `record_quote_decision`, `respond_quote_portal`, `respond_quote_by_token`…). Enlace público: 256 bits, solo se guarda la huella, un uso, caduca; `quote_by_token`/`respond_quote_by_token` solo con la clave secreta desde el servidor. La respuesta guarda una copia y su huella: **no** es firma electrónica.
- Facturas: **operativas, NO certificadas VERI*FACTU**; nunca digas lo contrario. Numeración sin huecos por serie y año (`issue_invoice`), datos congelados al emitir, `invoice_records` encadenado e inmutable. Emitida = no se cambia ni se borra (rectificativa). Cobros: nunca más del total; se anulan con motivo, no se borran. Sin pagos en línea ni datos de tarjeta.
- Las operaciones de sistema usan la marca `app.quote_op` / `app.invoice_op` dentro de funciones `security definer`, comprobada con `private.quote_system_op()` / `private.invoice_system_op()` (que además exigen que el usuario actual no sea `authenticated` ni `anon`).
- Fecha prevista de entrega (`due_at`) es interna: nunca al cliente. El fichaje (`start_work`/`stop_work`) usa la hora del servidor.
- Mantenimientos periódicos (`/panel/mantenimientos`): lista por taller (`service_intervals`, meses y/o km; gerencia edita, no se borran: se desactivan), marcados en la orden (`order_services`), próximo calculado SOLO por la base de datos al entregar (`vehicle_services`, `private.refresh_vehicle_service`); anotación manual de la oficina con `set_vehicle_service`; portal con `portal_vehicle_services`; recordatorios en `private.generate_service_reminders()` (regla «revisión», opt-in del cliente). Reglas en `packages/core/src/maintenance.ts`. La lista de partida es orientativa.
- Copia del taller (`/panel/copia`, gerencia): `export_workshop_data` (security definer, filtra por `workshop_id`, quita huellas/tokens, anota en `workshop_data_exports`). Una tabla nueva con `workshop_id` se añade a `private.export_tables()` (lo exige `19_copia_taller.test.sql`). Los formularios de descarga llevan `data-astro-reload`.
- Avisos nuevos con `private.enqueue_notice(...)` (plantilla `aviso_v1`, `link_path` solo `/portal/…`, `dedupe_key`). Recordatorios en `private.generate_reminders()` dentro de `run_maintenance`; los de revisión solo si el cliente lo pidió (`set_service_reminders` desde el portal).
- Estadísticas solo con datos reales (`workshop_stats`, `security invoker`). Nunca números de ejemplo en producción.
- Enlaces `wa.me` (`whatsappLink`) solo PREPARAN el mensaje: nunca se registran como enviados.

## Formularios y solicitudes (Fase 2)

Flujo: `RequestForm.astro` → `src/scripts/request-forms.ts` (pestañas; ligero) → `request-forms-submit.ts`, que se descarga al usar el formulario (valida, bloquea doble envío, clave de idempotencia) → `POST /api/solicitudes` → `handleSubmission` (origen, campo trampa, validación, Turnstile) → `submit_web_request` en Postgres (clave secreta; idempotencia, límite de envíos, validación final) → tabla `web_requests`.

Códigos de respuesta: 201 guardada · 200 duplicado ya guardado · 422 validación · 400 petición/antispam · 403 otro origen · 404 web inexistente · 429 demasiados envíos · 503 almacenamiento o antispam no disponibles.
