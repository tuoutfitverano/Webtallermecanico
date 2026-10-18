# Plataforma digital para talleres mecánicos

Webs comerciales y herramientas de gestión (vehículos, clientes, empleados y reparaciones) para talleres multimarca. Es una sola plataforma multiempresa: cada taller tiene su marca, su dominio y sus datos, siempre separados de los demás.

- **Arquitectura y decisiones:** [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)
- **Plan por fases:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Demo comercial antigua (HTML estático):** [demo/](demo/README.md)

## Estructura

```
apps/web/          Aplicación Astro (webs de talleres; luego panel y portal)
packages/core/     Lógica compartida: matrículas, validación de vehículos
supabase/
  migrations/      Base de datos y permisos (RLS)
  tests/           Pruebas de permisos por rol
  seed.sql         Datos de DEMOSTRACIÓN para desarrollo local
  config.toml      Configuración de Supabase en local
scripts/           Utilidades (p. ej. pruebas de base de datos)
demo/              Prototipo comercial anterior
```

## Requisitos

- Node.js 22.12 o superior (`.nvmrc`).
- Para la base de datos local completa: Docker y `npx supabase start`.
- Para las pruebas de permisos sin Docker: PostgreSQL 16 o 17.

## Comandos

```bash
npm install          # instalar dependencias
npm run dev          # web en http://localhost:4321
npm test             # pruebas de la lógica compartida
npm run check        # comprobación de tipos
npm run build        # compilar para Cloudflare
npm run test:db      # pruebas de base de datos y permisos
```

## Secretos

Copia `apps/web/.dev.vars.example` como `apps/web/.dev.vars` y rellénalo. Ese archivo no se sube a Git. La clave secreta de Supabase **nunca** debe llegar al navegador.
