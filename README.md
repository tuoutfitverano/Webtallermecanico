# Plataforma digital para talleres mecánicos

Webs comerciales y herramientas de gestión (vehículos, clientes, empleados y reparaciones) para talleres multimarca. Es una sola plataforma multiempresa: cada taller tiene su marca, su dominio y sus datos, siempre separados de los demás.

- **Instrucciones para Claude y convenciones:** [CLAUDE.md](CLAUDE.md)
- **Arquitectura y decisiones:** [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)
- **Plan por fases:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Navegador para Claude (Playwright MCP):** [docs/PLAYWRIGHT_MCP.md](docs/PLAYWRIGHT_MCP.md)
- **Plantilla de webs de taller y demo comercial AutoValue:** [docs/PLANTILLA_TALLERES.md](docs/PLANTILLA_TALLERES.md) · archivos de cada taller en [talleres/](talleres/README.md)
- **Demo comercial antigua (HTML estático):** [demo/](demo/README.md)

## Estructura

```
apps/web/          Aplicación Astro (webs de talleres; luego panel y portal)
packages/core/     Lógica compartida: matrículas, validación de vehículos
talleres/          Un archivo por taller: identidad, textos, colores y secciones de su web
supabase/
  migrations/      Base de datos y permisos (RLS)
  tests/           Pruebas de permisos por rol
  seed.sql         Datos de DEMOSTRACIÓN para desarrollo local
  config.toml      Configuración de Supabase en local
scripts/           Utilidades (p. ej. pruebas de base de datos)
demo/              Prototipo comercial anterior
```

## Requisitos

- Node.js 22.22.3 o superior en la rama 22 (o 24.16+ ; `.nvmrc` fija 22.22.3). Lo exigen Astro 7 y las herramientas de revisión de código.
- Para la base de datos local completa: Docker y `npx supabase start`.
- Para las pruebas de permisos sin Docker: PostgreSQL 16 o 17.

## Comandos

```bash
npm install          # instalar dependencias
npm run dev          # web en http://localhost:4321
npm test             # pruebas de la lógica compartida
npm run check        # comprobación de tipos
npm run build        # compilar para Cloudflare
npm run lint         # revisión de estilo y errores (ESLint)
npm run test:db      # pruebas de base de datos y permisos
npm run taller:sql -- talleres/x.json  # comprueba el archivo de un taller y genera su SQL
npm run web:exportar -- talleres/x.json  # copia de la web de un taller que funciona sin la plataforma (docs/EXPORTAR_WEB.md)
npm run test:e2e     # formularios en navegador contra una base de datos real
npm run test:mcp     # comprueba que el navegador de Claude (Playwright MCP) funciona
```

## Secretos

Copia `apps/web/.env.example` como `apps/web/.env` y rellénalo. Ese archivo no se sube a Git. La clave secreta de Supabase **nunca** debe llegar al navegador. Pasos para ponerlo en marcha: [docs/PUESTA_EN_MARCHA.md](docs/PUESTA_EN_MARCHA.md).
