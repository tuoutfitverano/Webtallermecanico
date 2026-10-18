# Arquitectura

Este documento explica **cómo está construida la plataforma y por qué**. Está escrito para que se entienda sin ser programador profesional. Si cambias algo importante, actualízalo.

## 1. La idea en una frase

**Una sola plataforma sirve a muchos talleres.** No se copia el proyecto para cada cliente. Cada taller es un "inquilino" con sus datos separados, su web y su dominio, y todo vive en la misma aplicación y la misma base de datos.

```
 Visitante  ──► garcia-motor.es ─┐
 Visitante  ──► talleresruiz.com ┼─► Cloudflare Workers ──► Supabase (PostgreSQL + usuarios)
 Mecánico   ──► panel            ┘     (aplicación Astro)        └─ reglas RLS: cada fila
 Cliente    ──► portal                                              solo la ve quien debe
```

## 2. Piezas y responsabilidades

| Capa | Dónde está | Qué hace |
| --- | --- | --- |
| **Frontend** | `apps/web` (Astro + Tailwind) | Lo que se ve: webs de los talleres y, más adelante, el panel y el portal del cliente. |
| **Lógica compartida** | `packages/core` (TypeScript) | Reglas que no dependen de la pantalla: matrículas, validación de vehículos… Se usa en el navegador y en el servidor. |
| **Backend** | Código de servidor de Astro en Cloudflare + funciones de PostgreSQL | Operaciones que necesitan secretos o comprobaciones (formularios, antispam, integraciones). |
| **Base de datos** | `supabase/migrations` | Tablas, relaciones y, sobre todo, **los permisos**. |
| **Integraciones** | Fases posteriores (Edge Functions o servidor) | Email, WhatsApp, proveedores de datos de vehículos. Nunca desde el navegador. |
| **Configuración** | `apps/web/.env` (local, plantilla en `.env.example`), secretos de Cloudflare y panel de Supabase (producción) | Claves y secretos. **Nunca en Git.** Se leen con `astro:env/server` solo en el servidor. |

## 3. Tecnologías elegidas (comprobadas el 18-10-2026)

| Tecnología | Versión | Por qué |
| --- | --- | --- |
| Astro | 7.4 | Webs muy rápidas y buenas para SEO; solo envía JavaScript donde hace falta. |
| Tailwind CSS | 4.3 | Disponible para el futuro panel. La web pública usa `site.css` (estética "cristal líquido") con CSS propio. |
| TypeScript | **6.0** | Detecta errores antes de ejecutar. Se usa la 6 y no la 7 porque la herramienta de comprobación de Astro (`@astrojs/check`) todavía no admite la 7. |
| React | *aún no* | Solo se añadirá cuando una pantalla lo necesite de verdad (panel interactivo). Hoy no aporta nada. |
| Supabase | CLI 2.121, PostgreSQL 17 | Base de datos, usuarios, 2FA y reglas de acceso en un solo servicio. |
| `@supabase/ssr` | 0.12.7 | Paquete oficial para guardar la sesión en cookies y leerla en el servidor (flujo PKCE). |
| Supabase Auth (GoTrue) | 2.190.0 (solo pruebas) | El servidor de inicio de sesión oficial, descargado en `.cache/` para probar sin Docker con las mismas tablas y funciones que Supabase. |
| Cloudflare Workers | adaptador `@astrojs/cloudflare` 14.4 | Elegido por ti. Plan gratuito con uso comercial, rápido en España y con soporte de dominios de clientes ("Cloudflare for SaaS"). |
| Zod | 4.6 | Valida los datos de los formularios con mensajes en español. |
| Vitest | 5.0 | Pruebas automáticas de la lógica compartida. |
| Playwright | 1.64.1 (fijada) | Navegador real para Claude Code vía MCP y, más adelante, pruebas de extremo a extremo. Ver [PLAYWRIGHT_MCP.md](PLAYWRIGHT_MCP.md). |

## 4. Cómo se separan los datos de cada taller (multiempresa)

1. **Todas las tablas con datos de un taller llevan `workshop_id`.**
2. **RLS (Row Level Security)**: PostgreSQL revisa cada consulta y solo devuelve las filas permitidas. Aunque alguien manipule la web o llame a la API a mano, **la base de datos no le entrega datos ajenos**. Ocultar un botón no es seguridad; esto sí.
3. **Un dato no puede "mudarse" de taller**: un disparador lo impide.
4. **Las relaciones también se protegen**: un vehículo solo puede tener como propietario a un cliente *del mismo taller* (clave foránea doble `customer_id + workshop_id`).

### Roles

| Rol | Cómo se reconoce | Puede |
| --- | --- | --- |
| Administrador de plataforma | Tabla `platform_admins` **y** sesión con 2FA (`aal2`) | Todo. Sin 2FA no tiene ningún privilegio. |
| Propietario (`propietario` = owner) | `workshop_members.role` | Gestionar su taller, clientes, vehículos, solicitudes web y verificar datos. Invitar administradores y mecánicos, cambiar sus roles y desactivarlos. |
| Administrador del taller (`administrador` = manager) | `workshop_members.role` | Lo mismo que el propietario sobre los datos; en el equipo solo invita y desactiva **mecánicos**. |
| Mecánico (`mecanico` = mechanic) | `workshop_members.role = 'mecanico'` | Ver y editar vehículos y clientes de su taller. No borra, no verifica datos, no ve las solicitudes web ni gestiona el equipo. |
| Cliente | `customers.user_id` | **No accede a las tablas.** Solo a funciones `portal_*` que devuelven sus propios datos, sin notas internas. |

Una misma persona puede ser mecánico en un taller y cliente en otro: los permisos se calculan por taller.

### Decisiones de seguridad importantes

- **Permisos leídos de la base de datos, no del "token".** Se podrían guardar los roles dentro del token de sesión (más rápido), pero si a un empleado se le quita el acceso, seguiría teniéndolo hasta que caduque el token. Consultar la tabla `workshop_members` (con funciones optimizadas) aplica el cambio al instante.
- **El cliente usa funciones en vez de tablas.** Si mañana se añade una columna privada a `vehicles`, no se filtra al portal por accidente: el portal solo devuelve las columnas que se eligieron a mano.
- **Nadie se sube de nivel.** Los empleados no pueden darse de alta, cambiar su rol, nombrarse administradores, cambiar el estado comercial del taller, enlazar cuentas de clientes a mano ni fingir que unos datos vienen de un proveedor externo.
- **Los formularios públicos no escriben directamente.** El navegador envía al servidor; el servidor comprueba el antispam y llama a `submit_web_request` con la clave secreta. Una cita entra siempre como `nueva` (**no confirmada**).
- **La web pública solo se muestra si está publicada y su dominio verificado.** Nada se publica sin autorización del taller.
- **Funciones cerradas por defecto.** PostgreSQL permite ejecutar cualquier función a todo el mundo; las migraciones lo revocan y abren solo lo necesario.
- **Registro abierto, pero sin privilegios.** Cualquiera puede crear una cuenta (con correo confirmado), pero una cuenta sola no ve nada: para entrar en un taller hace falta una **invitación** o el **alta controlada** de la plataforma. 2FA con app autenticadora activado (obligatorio para la administración de la plataforma).
- **Los privilegios nunca salen de datos que el usuario controla.** Ni del perfil ni de `user_metadata` (que cualquiera puede cambiar): los roles están en `workshop_members` y `platform_admins`, que solo cambian funciones con comprobaciones o la plataforma.
- **Comparaciones a prueba de NULL.** En las funciones, el rol de quien no es miembro es `NULL`; las condiciones usan `IS NOT DISTINCT FROM` porque `NOT (NULL = …)` no es verdadero y dejaría pasar a cualquiera (fallo detectado y cubierto por pruebas en la Fase 3).

### Claves de Supabase

| Clave | ¿Dónde se puede usar? |
| --- | --- |
| Publicable (`sb_publishable_…`) | En el navegador. Es segura **porque** existe RLS. |
| Secreta (`sb_secret_…`) | **Solo en el servidor.** Se salta RLS. Si se filtra, se rota inmediatamente. |

## 5. Acceso (autenticación) y equipos

```
/registro ─► Supabase Auth (signUp) ─► correo ─► /auth/confirmar (botón) ─► sesión en cookies
/acceso   ─► signInWithPassword ─────────────────────────────────────────► /cuenta (o ?next= seguro)
/recuperar ─► correo ─► /auth/confirmar ─► /cuenta/contrasena ─► updateUser
/cuenta (propietario/administrador) ─► create_workshop_invitation ─► enlace /invitacion?token=…
/invitacion ─► accept_workshop_invitation (la BD decide taller y rol; correo confirmado y coincidente)
```

- **Sesión en el servidor**: `@supabase/ssr` guarda los tokens en cookies; cada petición crea su propio cliente y valida al usuario con `getClaims()` (verifica la firma). Nunca `getSession()` en el servidor.
- **La web usa la clave publicable + el token del usuario**: la base de datos aplica RLS como a ese usuario. La clave secreta no interviene en el acceso.
- **Redirecciones seguras**: `?next=` solo acepta rutas del propio sitio (`src/lib/auth/redirect.ts`).
- **CSRF**: Astro rechaza formularios de otro origen (`security.checkOrigin`) y cada página lo vuelve a comprobar (Origin = Host).
- **Enlaces de correo con botón**: `/auth/confirmar` no gasta el código al abrirse (algunos antivirus de correo "visitan" los enlaces); lo gasta al pulsar.
- **Sin pistas para atacantes**: los mensajes de "recuperar contraseña" y "registro" no revelan si un correo existe.
- **Dominio del área privada (`APP_URL`)**: en producción, el acceso solo se sirve ahí; las webs de los talleres no guardan sesiones.
- **Invitaciones**: código aleatorio de 64 caracteres; en la base de datos solo se guarda su huella SHA-256. Un solo uso, ligado al correo invitado, caduca a los 7 días. Nadie invita como propietario.
- **Alta de talleres**: `private.create_workshop(slug, nombre, correo_propietario)`, solo ejecutable desde el SQL Editor (superusuario); la API no la ve.

## 6. Webs de los talleres

Una única aplicación Astro decide qué taller mostrar según el **dominio** de la visita (`get_public_site(hostname)`, con la clave publicable). El contenido y la marca de cada taller (nombre, color, servicios, teléfono, horario, dirección…) se guardan en `workshop_sites` y se validan al leerlos (`src/lib/site/content.ts`). El campo `is_demo_content` obliga a la web a avisar de que los datos son de demostración y a no aparecer en buscadores.

Para probar en local se usa `demo.localhost`, que siempre apunta a tu propio ordenador. Sin Supabase configurado, `npm run dev` muestra una demo local (`src/lib/site/demo.ts`) cuyos formularios responden "no disponible".

### Solicitudes desde la web (contacto, cita, presupuesto)

```
navegador ──► POST /api/solicitudes ──► handleSubmission ──► submit_web_request() ──► web_requests
 valida con     (servidor Astro)          · mismo origen        (clave secreta)          estado 'nueva'
 packages/core                            · campo trampa         · idempotencia           RLS: solo gestores
 + bloquea                                · validación           · límite de envíos         del taller la ven
 doble envío                              · Turnstile            · validación final
```

- **Éxito solo si se guardó**: el navegador muestra "recibido" únicamente con una respuesta `ok` del servidor, que solo llega después de que la base de datos devuelva el id.
- **Sin duplicados**: cada formulario lleva una clave de idempotencia; el mismo envío repetido devuelve el mismo id.
- **Antispam por capas**: comprobación de origen, campo trampa invisible, Cloudflare Turnstile (obligatorio en producción) y límite de 5 envíos cada 10 minutos por visitante y 60 por hora por taller, aplicado en la base de datos.
- **Privacidad**: no se guarda el IP, solo una huella HMAC que cambia cada día y se borra a los 2 días. Los registros técnicos no contienen datos del formulario. El personal no puede leer la huella ni la clave de idempotencia.
- **Sin JavaScript** los formularios también funcionan (envío clásico y redirección con el resultado).

## 7. Vehículos

- La matrícula se guarda **normalizada** (`1950 bxf` → `1950BXF`) y es única dentro de cada taller.
- Se reconocen los formatos españoles: actual, provincial antiguo (con su provincia), ciclomotor, remolque, especial e histórico. Una matrícula con otro formato (extranjera, diplomática…) solo se acepta si el usuario lo confirma.
- No se corrigen letras automáticamente (por ejemplo, O por 0): podría convertir una matrícula en otra distinta.
- El año es opcional y, si se indica, hay que decir si es de **fabricación** o de **primera matriculación**. No se inventa.
- `data_source` (de dónde salen los datos) y `verification_status` (si se han comprobado) **no los decide el formulario**: por defecto son "manual" y "pendiente". Solo el sistema puede marcar "proveedor externo" y solo un gestor puede verificar (queda registrado quién y cuándo).

## 8. Pruebas

| Comando | Qué comprueba |
| --- | --- |
| `npm test` | Lógica compartida (matrículas, vehículos, solicitudes) y de la web (redirecciones seguras, mensajes, contenido). |
| `npm run check` | Tipos de TypeScript y de Astro. |
| `npm run build` | Que la web compila para Cloudflare. |
| `npm run test:db` | Migraciones y **permisos RLS** con usuarios de cada rol, sobre un PostgreSQL local con el esquema `auth` **real** de Supabase Auth. |
| `npm run test:e2e` | Navegador → web → Supabase Auth real + PostgREST → PostgreSQL: formularios, registro, confirmación por correo, recuperación, invitaciones y aislamiento por API con tokens reales. |
| `npm run test:mcp` | Que el servidor Playwright MCP arranca y controla el navegador. |

Sin Docker, las pruebas montan las piezas reales de Supabase por separado: PostgreSQL local, el esquema `auth` y el servidor de Supabase Auth (descargados en `.cache/`), PostgREST y una pasarela mínima (`scripts/e2e/rest-proxy.mjs`). Solo se imitan los roles de la API (`supabase/tests/_harness/supabase_roles.sql`). En tu ordenador, con Docker, también puedes levantar Supabase completo con `npx supabase start`.

Las pruebas de permisos se han validado "rompiendo" una regla a propósito: las pruebas fallaron como debían.
