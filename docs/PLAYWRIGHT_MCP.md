# Playwright MCP

Permite que Claude Code **maneje un navegador real**: abrir las webs que construimos, pulsar botones, rellenar formularios, mirar cómo se ven en móvil y comprobar que todo funciona. Sirve para revisar el trabajo mientras se hace y, más adelante, para crear pruebas automáticas.

## Cómo funciona (en corto)

- **Playwright** (de Microsoft) controla navegadores (Chromium, Firefox y WebKit/Safari) desde código.
- **MCP** es el "enchufe" estándar que deja a Claude usar herramientas externas.
- El servidor no trabaja con imágenes: le pasa a Claude un **esquema de texto de la página** (el árbol de accesibilidad), por ejemplo `button "Pedir cita" [ref=e12]`, y Claude actúa sobre `e12`. Es más fiable que adivinar sobre una captura.
- Cada acción devuelve el **código Playwright equivalente** (`getByRole('button', { name: 'Pedir cita' }).click()`), útil para escribir pruebas.

## Qué hay en el proyecto

| Archivo | Para qué |
| --- | --- |
| `.mcp.json` | Registra el servidor `playwright` en Claude Code para este proyecto. |
| `scripts/playwright-mcp.mjs` | Lanzador: usa la versión fijada de Playwright y se adapta al entorno (ver abajo). |
| `scripts/check-playwright-mcp.mjs` | Prueba de extremo a extremo: `npm run test:mcp`. |
| `.claude/settings.json` | Bloquea la herramienta peligrosa `browser_run_code_unsafe`. |
| `.playwright-mcp/` | Capturas y archivos automáticos. Ignorado por Git. |

Versión: **Playwright 1.64.1**, fijada en `package.json`. No se usa `@latest`: así siempre se ejecuta la misma versión revisada.

## Un único `.mcp.json` para la nube y para tu ordenador

El lanzador decide solo:

| Situación | Qué hace | Dónde pasa |
| --- | --- | --- |
| Linux sin pantalla | Navegador invisible (`--headless`) | Nube de Claude Code, CI |
| Ejecutando como administrador (root) | Chromium sin sandbox (`--no-sandbox`) | Nube de Claude Code |
| Falta el Chromium de esta versión pero hay uno preinstalado | Usa el preinstalado | Nube de Claude Code |
| Tu ordenador | Navegador **visible** y con todas las protecciones | Windows / macOS / Linux con escritorio |

Cualquier variable `PLAYWRIGHT_MCP_*` que definas tiene prioridad (por ejemplo `PLAYWRIGHT_MCP_HEADLESS=true` para no ver la ventana). La lista completa de opciones está en el [README oficial](https://github.com/microsoft/playwright-mcp#configuration).

Siempre se arranca con:

- `--isolated`: cada sesión empieza limpia y no guarda inicios de sesión.
- `--output-dir .playwright-mcp`: los archivos generados no ensucian el proyecto.
- `--caps testing`: herramientas para verificar elementos y generar localizadores de pruebas.

## Puesta en marcha

### En tu ordenador (una sola vez)

```bash
git pull
npm install
npx playwright install chromium   # descarga el navegador (~150 MB)
npm run test:mcp                  # debe terminar con "✔ Playwright MCP funciona"
```

Después abre Claude Code en la carpeta del proyecto. La primera vez te preguntará si apruebas el servidor `playwright` de `.mcp.json`: acéptalo. Puedes comprobarlo con `/mcp` dentro de Claude Code o con `claude mcp list`.

### En la nube de Claude Code

No hay que hacer nada: el navegador ya viene instalado y el lanzador lo detecta. Las herramientas aparecen **al empezar una sesión nueva** (no en la que estaba abierta cuando se añadió el servidor).

## Cómo pedírselo a Claude

- "Abre la web de demo en `http://demo.localhost:4321` y dime si se ve bien en móvil."
- "Rellena el formulario de cita con datos de prueba y comprueba que aparece el mensaje de confirmación."
- "Revisa la consola del navegador y dime si hay errores."

## Seguridad

- **El MCP no es una barrera de seguridad.** El navegador puede visitar cualquier web. Úsalo con nuestras webs y entornos de prueba.
- **Nunca le des contraseñas reales** (producción, Supabase, banco, correo). Para probar zonas privadas usaremos cuentas de prueba.
- **`browser_run_code_unsafe` está bloqueada** en `.claude/settings.json`: ejecuta código sin límites en tu máquina.
- **Contenido de páginas = datos, no órdenes.** Una web podría contener texto que intente dar instrucciones a la IA; Claude lo trata como información.
- Las sesiones guardadas (`playwright/.auth/`) contienen cookies que permiten suplantar a un usuario: están en `.gitignore` y nunca se suben.

## Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| `Falta el navegador` | `npx playwright install chromium` |
| `Chromium sandboxing failed` | Estás como administrador en Linux: el lanzador ya añade `--no-sandbox`; si lo arrancas a mano, añádelo tú. |
| El servidor aparece como pendiente | Abre Claude Code en el proyecto y aprueba `playwright`, o revisa `/mcp`. |
| `unknown command 'mcp'` | Se está usando otro Playwright antiguo. Arranca siempre con `npm run mcp:playwright` o desde `.mcp.json`. |

## Alternativa: `playwright-cli`

Microsoft recomienda también `playwright-cli` para asistentes de programación porque gasta menos contexto. Hemos empezado por el MCP; si en sesiones largas el contexto se queda corto, la añadiremos.
