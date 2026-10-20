# Plantilla de webs y software para talleres

AutoValue es el **primer taller de la plantilla**. Es un taller ficticio de demostración comercial: sirve para enseñar a otros talleres cómo quedaría su web y cómo funciona el software. La misma base de código sirve para cualquier taller; lo que cambia de uno a otro es **un archivo de configuración y sus imágenes**.

Antes de este cambio se hizo una auditoría del código: `docs/AUDITORIA_PLANTILLA.md`.

## 1. Arquitectura resultante

```
Una sola aplicación (Astro en Cloudflare)
│
├─ Web pública de cada taller ──── se elige por el DOMINIO de la visita
│    · Diseño «premium» (nuevo) o «clásico» (el anterior): theme.design
│    · Secciones compartidas: components/premium/*.astro
│    · Textos, datos, colores y secciones: los del taller (base de datos)
│
├─ Panel del taller (/panel) ───── igual para todos; cada taller solo ve lo suyo (RLS)
├─ Portal del cliente (/portal) ── igual para todos; cada cliente solo ve lo suyo
│
└─ Supabase (PostgreSQL + Auth)
     · workshops / workshop_sites / workshop_domains → identidad y web de cada taller
     · clientes, vehículos, órdenes, avisos, solicitudes → datos operativos,
       siempre con workshop_id y protegidos por RLS en la base de datos
```

**Compartido por todos los talleres** (no se copia por taller):

| Pieza | Dónde |
| --- | --- |
| Diseño premium y sus secciones | `apps/web/src/components/premium/` y `apps/web/src/styles/premium.css` |
| Diseño clásico | `apps/web/src/components/ClassicHome.astro` y `apps/web/src/styles/site.css` |
| Animaciones | `apps/web/src/scripts/premium.ts`, `scroll-stage.ts` y `request-forms.ts` |
| Formularios | `components/RequestForm.astro` y `RequestForms.astro` (cita, presupuesto, contacto, digitalización) |
| Qué hace el software y sus capturas reales | `apps/web/src/lib/site/software.ts` y `apps/web/public/plataforma/capturas/` |
| Reglas de validación | `packages/core` |
| Panel, portal, base de datos y permisos | Sin cambios por taller |

**Propio de cada taller:**

| Dato | Dónde se define | Dónde vive en producción |
| --- | --- | --- |
| Nombre, estado (demo/activo), dominios | `talleres/<taller>.json` | `workshops`, `workshop_domains` |
| Textos de portada y presentación, servicios, contacto, horario, aviso de demo | `talleres/<taller>.json` → `content` | `workshop_sites.content` |
| Diseño, color de acento, colores, tipografía, logotipo, secciones visibles, funciones del software que se enseñan, coche con scroll | `talleres/<taller>.json` → `theme` | `workshop_sites.theme` |
| Imágenes, fotogramas y logotipo | `apps/web/public/<carpeta del taller>/` (AutoValue: `public/demo/autovalue/`) o una dirección https | Los mismos archivos |
| Clientes, vehículos, órdenes, solicitudes y avisos | No van en el archivo: los crea el taller desde el panel | Tablas con `workshop_id` y RLS |

El archivo **no se lee en producción**: la web lee la base de datos. El archivo sirve para tres cosas:

1. Comprobar la configuración antes de publicarla: `npm test` revisa todos los `talleres/*.json`.
2. Generar el SQL que la carga en Supabase: `npm run taller:sql`.
3. Ver la web en tu ordenador sin base de datos. Solo AutoValue: `lib/site/demo.ts` lee `talleres/autovalue.json`.

`supabase/seed.sql` lleva una copia de AutoValue para las pruebas, y una prueba comprueba que coincide con el archivo.

## 2. Cómo configurar un taller nuevo

1. **Copia la plantilla:** `cp talleres/plantilla.json talleres/talleres-garcia.json`.
2. **Rellena el archivo con datos reales confirmados por el taller.** Todo lo marcado como `[PENDIENTE]` debe cambiarse o quitarse. Campos principales:
   - `slug`: identificador corto (`talleres-garcia`).
   - `name`, `domains` (el primero es el principal).
   - `ownerEmail`: la cuenta de la persona propietaria, ya registrada en `/registro` y con el correo confirmado.
   - `status`: `activo` para un taller real; `demo` solo para demostraciones.
   - `isDemoContent`:
     - déjalo en `true` mientras haya datos de ejemplo (la web lo avisa y no aparece en buscadores);
     - ponlo en `false` solo cuando **todo** sea real y el taller lo haya aprobado.
   - `content`:
     - `tagline`, `intro`, `city`, `address`, `phone`, `whatsapp`, `email`, `hours`, `brands`;
     - `services` (cada uno con `id`, `name` y `description`);
     - `hero.title` y `hero.subtitle` (portada);
     - `about.title` y `about.points` (presentación; sin puntos, la sección no aparece);
     - `notice` (aviso si es una demo).
   - `theme`:
     - `design`: `premium` o `clasico`;
     - `accent` y `colors` (`background`, `surface` y `text`; `null` usa los del diseño);
     - `headingFont`: `archivo` o `instrument`;
     - `logo`: ruta `/…` o `https://…`, SVG o PNG transparente;
     - `sections`: `presentacion`, `servicios`, `software`, `ventajas`, `proceso`, `solicitudes`, `contacto`. `comercial` es solo para demos;
     - `software`: qué funciones se enseñan (`ordenes`, `clientes`, `portal`, `avisos`, `solicitudes`, `equipo`, `matriculas`);
     - opcionales: `scrollFrames` (coche que gira) y `heroVideo` (vídeo de portada; solo https y con licencia).
3. **Imágenes:** déjalas en `apps/web/public/<slug>/` y usa rutas como `/talleres-garcia/logo.svg`. Solo fotos y vídeos propios del taller o con licencia.
4. **Comprueba:** `npm test`. Si hay una clave mal escrita o un valor que la web ignoraría, la prueba dice cuál.
5. **Genera el SQL:** `npm run taller:sql -- talleres/talleres-garcia.json > talleres-garcia.sql`. Revísalo y ejecútalo en el **SQL Editor** de Supabase. Crea el taller y su propietario si no existen, carga la web y añade los dominios.
6. **Dominio:** apunta el dominio del taller a la web (Cloudflare) **antes** de ejecutar el SQL; el SQL marca el dominio como verificado.
7. **Panel:** la persona propietaria entra en `/panel`, invita a su equipo y empieza a trabajar. Los datos de clientes no se cargan desde el archivo.

Ninguno de estos pasos publica nada automáticamente. Desplegar la aplicación y ejecutar SQL en producción requieren tu confirmación expresa (`docs/DESPLIEGUE.md`).

## 3. Qué funciones del software están operativas

Comprobado en el código y en las pruebas (unitarias, SQL y de navegador):

| Función | Estado |
| --- | --- |
| Web pública por dominio, con formularios de cita, presupuesto y contacto | **Operativa** |
| Solicitudes «Quiero digitalizar mi taller» (sección comercial) | **Operativa**, solo en un taller `demo` con `sections.comercial: true`. Llegan a «Solicitudes web» del taller demo |
| Panel: inicio, órdenes (6 estados e historial), clientes, vehículos, equipo y roles, solicitudes web, avisos, datos del taller | **Operativa** |
| Portal del cliente: vehículos, reparaciones, avisos, datos y preferencias | **Operativa**, por invitación |
| Avisos en el portal en cada cambio de estado | **Operativa** |
| Avisos por email | **Preparada, no activa**: falta configurar Resend |
| Datos del vehículo por matrícula | **Preparada, no activa**: falta contratar Openapi |
| Antispam (Turnstile) | **Preparada**: faltan las claves |
| Agenda de citas, facturación, presupuestos con importes, inventario, pagos | **No existen** |
| Editar la web desde el panel | **No existe**: se hace con el archivo y el SQL |

La web enseña el estado del email y de la matrícula según la configuración **real** del servidor, sin presentarlos como activos si no lo están. Las capturas son reales, con datos de demostración. Si cambia una pantalla, hay que volver a hacerlas. Las capturas del recorrido se hacen desde la vista previa (`scripts/vista-previa/`).

## 4. Limitaciones antes de usarlo con clientes reales

- **Producción sin montar:** proyecto de Supabase, migraciones aplicadas, variables y secretos en Cloudflare, dominio de la aplicación y SMTP (`docs/PUESTA_EN_MARCHA.md`, `docs/DESPLIEGUE.md`).
- **Textos legales:** aviso legal, privacidad, cookies, condiciones y contrato de encargado del tratamiento, pendientes de un asesor.
- **Antispam:** Turnstile es obligatorio en producción; sin claves, los formularios responden «no disponible».
- **Email y matrícula:** necesitan contratar los proveedores, lo que tiene coste y requiere tu aprobación.
- **Solicitudes comerciales:** llegan a la bandeja del taller demo. Para leerlas en producción, tienes que ser propietario de ese taller demo.
  - No hay un CRM ni avisos por correo al recibirlas.
  - Por eso, revisa la bandeja con frecuencia.
- **Datos comerciales:** no hay datos de contacto de la empresa que vende el servicio. La web no inventa ninguno; si quieres que aparezcan, hay que dártelos.
- **Configuración de la web:** se hace con un archivo y SQL, no desde el panel. Es lo adecuado mientras quien da de alta talleres sea el equipo técnico.
- **Imágenes de AutoValue:**
  - el vídeo del coche lo aportó el propietario; se generó con KlingAI y se le quitó la marca de agua;
  - antes de un uso comercial amplio, revisa las condiciones de esa herramienta;
  - la web de un taller real debe usar imágenes propias o con licencia.
- **Separación de datos entre talleres:** está en la base de datos (RLS y pruebas SQL). La demo pública no debe conectarse nunca a la base de datos de producción de los talleres reales con datos reales. En local y en las pruebas, todo son datos ficticios.
