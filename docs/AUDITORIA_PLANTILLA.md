# Auditoría antes de convertir AutoValue en plantilla (20-10-2026)

Revisión del código real (no de la documentación) antes de rediseñar la web y prepararla para otros talleres. Resultado: **no hace falta empezar de cero**. La arquitectura ya es multiempresa y casi todo se reutiliza.

## Tecnología

| Pieza | Qué hay |
| --- | --- |
| Web | Astro 7 en Cloudflare Workers, TypeScript estricto, CSS propio (sin Tailwind en la web pública), sin React |
| Reglas compartidas | `packages/core` (zod): matrículas, vehículos, solicitudes, clientes, órdenes, taller |
| Base de datos | Supabase (PostgreSQL + Auth). 8 migraciones, RLS en todas las tablas, 12 archivos de pruebas SQL |
| Pruebas | Vitest (unitarias), pruebas SQL de permisos, Playwright (e2e con Supabase Auth real y PostgREST) |
| Recursos | Fuentes locales (`@fontsource`: Barlow, Instrument Serif, Archivo). Fotogramas del coche y garaje (`public/demo/autovalue/`). Capturas reales del software (`public/demo/autovalue/software/`). No hay logotipo de AutoValue ni fotos propias de un taller real |

## Cómo se configura hoy cada taller

- Un taller es una fila de `workshops`. Su web es una fila de `workshop_sites` con dos JSON: `content` (textos, servicios, contacto) y `theme` (color, vídeos, coche que gira). Los dominios están en `workshop_domains`.
- La web se elige por el dominio de la visita (`get_public_site`). Una sola aplicación sirve a todos los talleres.
- El JSON se valida en `apps/web/src/lib/site/content.ts`; lo que falte o esté mal se sustituye por valores neutros sin romper la página.
- AutoValue estaba escrito **dos veces**, en `lib/site/demo.ts` (desarrollo sin base de datos) y en `supabase/seed.sql`, y una prueba comprobaba que coincidieran.
- **Faltaba**: elegir diseño, textos de portada, secciones visibles, logotipo, colores además del acento y tipografía. Tampoco había una forma documentada de dar de alta la web de un taller nuevo, salvo escribir el JSON a mano en el SQL Editor.

## Funcionalidades: comprobado en el código y en las pruebas

| Funcionalidad | Estado |
| --- | --- |
| Web pública por dominio, con formularios de cita, presupuesto y contacto | **Operativa**. Guarda en `web_requests` con antispam e idempotencia; sin almacenamiento responde 503 |
| Acceso, registro, recuperación de contraseña, roles e invitaciones | **Operativa** (Supabase Auth) |
| Panel: inicio, clientes, vehículos, órdenes de reparación (6 estados, historial), equipo, solicitudes web, avisos y datos del taller | **Operativa** y probada por roles |
| Portal del cliente: vehículos, reparaciones, avisos, datos y preferencias | **Operativa**. Solo por invitación del taller |
| Avisos en el portal por cada cambio de estado | **Operativa** |
| Avisos por email | **Preparada, pero no activa**: falta contratar y configurar Resend. En las pruebas se usa un simulador |
| Datos del vehículo por matrícula | **Preparada, pero no activa**: falta contratar Openapi. En las pruebas se usa un simulador |
| Antispam real (Turnstile) | **Preparada**: faltan las claves de Cloudflare |
| **Agenda de citas** | **No existe.** Hay *solicitudes* de cita que el taller confirma por teléfono o correo. No hay calendario |
| Facturación, presupuestos con importes, inventario de recambios, pagos | **No existen** |
| Editar la web pública desde el panel | **No existe**: se hace con SQL |
| Coche que gira con el scroll (portada) | Operativo: canvas con 73 fotogramas, con versión fija sin JavaScript |
| Diseño «premium» (`/premium`) | Solo visual. Era una página aparte para comparar |
| Textos legales | **Pendientes** de un asesor. Las páginas lo dicen |

## Separación de datos entre talleres

Ya existe y está en la base de datos, no en la interfaz:

- Todas las tablas llevan `workshop_id` y RLS.
- Las claves foráneas compuestas impiden mezclar vehículos o clientes de talleres distintos.
- Las pruebas SQL `01_aislamiento_talleres` y `12_auditoria` lo vigilan.

La web pública solo lee lo que devuelve `get_public_site`. El taller demo (`status = 'demo'`) solo tiene datos ficticios y en local nunca toca producción.

## Qué se reutiliza y qué cambia

**Se conserva:**

- base de datos y permisos;
- panel, portal y formularios;
- coche con scroll y validaciones;
- todas las pruebas.

**Se añade o cambia:**

1. La configuración de AutoValue pasa a un único archivo, `talleres/autovalue.json`, del que leen la demo local, `seed.sql` (lo comprueba una prueba) y un script que genera el SQL para dar de alta la web de un taller nuevo.
2. Nuevos campos en esa configuración:
   - `theme.design` (`premium` o `clasico`);
   - `theme.sections` (qué secciones se ven);
   - `theme.colors`, `theme.headingFont` y `theme.logo`;
   - `content.hero` y `content.about`;
   - `theme.software` (qué funciones del software se enseñan).
3. El diseño premium se divide en secciones reutilizables (`components/premium/`). La portada `/` elige el diseño según la configuración. El diseño anterior sigue disponible, para comparar, en `/clasico` (solo en webs de demostración).
4. Sección comercial «Tu taller también puede trabajar así» con un formulario **real** (nuevo tipo de solicitud `digitalizacion`). La base de datos solo lo acepta en un taller de demostración (`status = 'demo'`) con la sección comercial activada. Las solicitudes llegan a la bandeja «Solicitudes web» del taller demo.
5. El software se enseña solo con capturas reales y un recorrido por pantallas. Lo que no está activo se dice. Las ocho fases desaparecen de la web: eran etapas internas de construcción, no módulos que se vendan.
