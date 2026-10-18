# CLAUDE.md — Plataforma para talleres mecánicos

Instrucciones para Claude Code (y para cualquier persona que trabaje en el proyecto). Léelas antes de cambiar nada.

## Qué es

Plataforma multiempresa para talleres mecánicos multimarca en España: una sola aplicación sirve la web pública de cada taller (según el dominio) y, en fases posteriores, el panel privado y el portal del cliente. El propietario del proyecto no es programador: **explica las decisiones en lenguaje claro** y no afirmes que algo funciona sin haberlo comprobado.

- Arquitectura y decisiones: `docs/ARQUITECTURA.md`
- Plan por fases y estado: `docs/ROADMAP.md`
- Navegador para Claude (Playwright MCP): `docs/PLAYWRIGHT_MCP.md`

## Estructura

```
apps/web/                 Astro 7 + Cloudflare Workers (web pública; luego panel y portal)
  src/pages/              index (web del taller), privacidad, aviso-legal, api/solicitudes.ts
  src/components/         Secciones de la web y formularios (RequestForm.astro)
  src/scripts/            JavaScript del navegador (request-forms.ts)
  src/lib/site/           Contenido del taller, resolución por dominio, demo local
  src/lib/requests/       Endpoint de solicitudes: handler (lógica pura), store, antispam
  src/lib/server/         Configuración del servidor (lee astro:env) — solo servidor
  src/styles/site.css     Diseño "cristal líquido" de la web pública (CSS propio, sin Tailwind)
  e2e/                    Pruebas de navegador (Playwright Test)
packages/core/            Reglas compartidas navegador/servidor: matrículas, vehículos, solicitudes
supabase/migrations/      Esquema + permisos (RLS). Nunca edites una migración ya aplicada: crea otra.
supabase/tests/           Pruebas SQL de permisos por rol
supabase/seed.sql         Datos de DEMOSTRACIÓN (taller demo en demo.localhost)
scripts/                  test-db.sh, test-e2e.sh, lanzador de Playwright MCP
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
npm run build        # compilación para Cloudflare
npm run test:db      # migraciones + permisos RLS en PostgreSQL local
npm run test:e2e     # navegador → web → API REST (PostgREST) → PostgreSQL con RLS
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
6. **No inventar datos.** Ni reseñas, precios, años de experiencia, certificaciones, textos legales ni datos de vehículos. Las matrículas no se consultan en servicios externos. El contenido de demostración se marca como tal (`is_demo_content`).
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

## Formularios y solicitudes (Fase 2)

Flujo: `RequestForm.astro` → `src/scripts/request-forms.ts` (valida, bloquea doble envío, clave de idempotencia) → `POST /api/solicitudes` → `handleSubmission` (origen, campo trampa, validación, Turnstile) → `submit_web_request` en Postgres (clave secreta; idempotencia, límite de envíos, validación final) → tabla `web_requests`.

Códigos de respuesta: 201 guardada · 200 duplicado ya guardado · 422 validación · 400 petición/antispam · 403 otro origen · 404 web inexistente · 429 demasiados envíos · 503 almacenamiento o antispam no disponibles.
