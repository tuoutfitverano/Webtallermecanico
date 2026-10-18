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
| **Configuración** | `.dev.vars` (local), panel de Cloudflare y de Supabase (producción) | Claves y secretos. **Nunca en Git.** |

## 3. Tecnologías elegidas (comprobadas el 18-10-2026)

| Tecnología | Versión | Por qué |
| --- | --- | --- |
| Astro | 7.4 | Webs muy rápidas y buenas para SEO; solo envía JavaScript donde hace falta. |
| Tailwind CSS | 4.3 | Estilos consistentes y fáciles de adaptar a la marca de cada taller. |
| TypeScript | **6.0** | Detecta errores antes de ejecutar. Se usa la 6 y no la 7 porque la herramienta de comprobación de Astro (`@astrojs/check`) todavía no admite la 7. |
| React | *aún no* | Solo se añadirá cuando una pantalla lo necesite de verdad (panel interactivo). Hoy no aporta nada. |
| Supabase | CLI 2.121, PostgreSQL 17 | Base de datos, usuarios, 2FA y reglas de acceso en un solo servicio. |
| Cloudflare Workers | adaptador `@astrojs/cloudflare` 14.4 | Elegido por ti. Plan gratuito con uso comercial, rápido en España y con soporte de dominios de clientes ("Cloudflare for SaaS"). |
| Zod | 4.6 | Valida los datos de los formularios con mensajes en español. |
| Vitest | 5.0 | Pruebas automáticas de la lógica compartida. |

## 4. Cómo se separan los datos de cada taller (multiempresa)

1. **Todas las tablas con datos de un taller llevan `workshop_id`.**
2. **RLS (Row Level Security)**: PostgreSQL revisa cada consulta y solo devuelve las filas permitidas. Aunque alguien manipule la web o llame a la API a mano, **la base de datos no le entrega datos ajenos**. Ocultar un botón no es seguridad; esto sí.
3. **Un dato no puede "mudarse" de taller**: un disparador lo impide.
4. **Las relaciones también se protegen**: un vehículo solo puede tener como propietario a un cliente *del mismo taller* (clave foránea doble `customer_id + workshop_id`).

### Roles

| Rol | Cómo se reconoce | Puede |
| --- | --- | --- |
| Administrador de plataforma | Tabla `platform_admins` **y** sesión con 2FA (`aal2`) | Todo. Sin 2FA no tiene ningún privilegio. |
| Propietario / administrador del taller | `workshop_members.role` | Gestionar su taller, clientes, vehículos, solicitudes web y verificar datos. |
| Mecánico | `workshop_members.role = 'mecanico'` | Ver y editar vehículos y clientes de su taller. No borra, no verifica datos, no ve las solicitudes web ni gestiona el equipo. |
| Cliente | `customers.user_id` | **No accede a las tablas.** Solo a funciones `portal_*` que devuelven sus propios datos, sin notas internas. |

Una misma persona puede ser mecánico en un taller y cliente en otro: los permisos se calculan por taller.

### Decisiones de seguridad importantes

- **Permisos leídos de la base de datos, no del "token".** Se podrían guardar los roles dentro del token de sesión (más rápido), pero si a un empleado se le quita el acceso, seguiría teniéndolo hasta que caduque el token. Consultar la tabla `workshop_members` (con funciones optimizadas) aplica el cambio al instante.
- **El cliente usa funciones en vez de tablas.** Si mañana se añade una columna privada a `vehicles`, no se filtra al portal por accidente: el portal solo devuelve las columnas que se eligieron a mano.
- **Nadie se sube de nivel.** Los empleados no pueden darse de alta, cambiar su rol, nombrarse administradores, cambiar el estado comercial del taller, enlazar cuentas de clientes a mano ni fingir que unos datos vienen de un proveedor externo.
- **Los formularios públicos no escriben directamente.** El navegador envía al servidor; el servidor comprueba el antispam y llama a `submit_web_request` con la clave secreta. Una cita entra siempre como `nueva` (**no confirmada**).
- **La web pública solo se muestra si está publicada y su dominio verificado.** Nada se publica sin autorización del taller.
- **Funciones cerradas por defecto.** PostgreSQL permite ejecutar cualquier función a todo el mundo; las migraciones lo revocan y abren solo lo necesario.
- **Registro cerrado.** Empleados y clientes entrarán por invitación (`enable_signup = false`). 2FA con app autenticadora activado.

### Claves de Supabase

| Clave | ¿Dónde se puede usar? |
| --- | --- |
| Publicable (`sb_publishable_…`) | En el navegador. Es segura **porque** existe RLS. |
| Secreta (`sb_secret_…`) | **Solo en el servidor.** Se salta RLS. Si se filtra, se rota inmediatamente. |

## 5. Webs de los talleres

Una única aplicación Astro decide qué taller mostrar según el **dominio** de la visita (`get_public_site(hostname)`). El contenido y la marca de cada taller (nombre, logotipo, colores, servicios, contacto…) se guardan en `workshop_sites`. El campo `is_demo_content` obliga a la web a avisar cuando los datos son de demostración.

Para probar en local se usa `demo.localhost`, que siempre apunta a tu propio ordenador.

## 6. Vehículos

- La matrícula se guarda **normalizada** (`1950 bxf` → `1950BXF`) y es única dentro de cada taller.
- Se reconocen los formatos españoles: actual, provincial antiguo (con su provincia), ciclomotor, remolque, especial e histórico. Una matrícula con otro formato (extranjera, diplomática…) solo se acepta si el usuario lo confirma.
- No se corrigen letras automáticamente (por ejemplo, O por 0): podría convertir una matrícula en otra distinta.
- El año es opcional y, si se indica, hay que decir si es de **fabricación** o de **primera matriculación**. No se inventa.
- `data_source` (de dónde salen los datos) y `verification_status` (si se han comprobado) **no los decide el formulario**: por defecto son "manual" y "pendiente". Solo el sistema puede marcar "proveedor externo" y solo un gestor puede verificar (queda registrado quién y cuándo).

## 7. Pruebas

| Comando | Qué comprueba |
| --- | --- |
| `npm test` | Lógica compartida (matrículas y validación de vehículos). |
| `npm run check` | Tipos de TypeScript y de Astro. |
| `npm run build` | Que la web compila para Cloudflare. |
| `npm run test:db` | Migraciones y **permisos RLS** con usuarios reales de cada rol, sobre un PostgreSQL local. |

`npm run test:db` usa una imitación mínima de Supabase (`supabase/tests/_harness`), porque en este entorno no hay Docker. En tu ordenador, con Docker, también puedes levantar Supabase completo con `npx supabase start`.

Las pruebas de permisos se han validado "rompiendo" una regla a propósito: las pruebas fallaron como debían.
