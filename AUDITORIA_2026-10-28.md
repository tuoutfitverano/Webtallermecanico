# Auditoría y mejoras (28-10-2026)

**Alcance:** lo añadido después de la auditoría del 24-10 (`AUDITORIA_FINAL.md`): copia de la web, recuperar la cuenta sin el móvil, notificaciones en el móvil, planes y consumo, cambio de titular, agenda y resúmenes de servicios. Se revisó también el conjunto: seguridad, fiabilidad, rendimiento, pantallas y textos.

**Entorno:** local, con PostgreSQL 16, Supabase Auth y PostgREST reales y proveedores externos **simulados**. No hay producción: nada se ha probado contra Supabase o Cloudflare reales.

**Punto de partida:** commit `c75ec6d`, con la etiqueta local `antes-auditoria-2026-10-28`. Todo se puede deshacer volviendo a ese commit.

## A. Problemas encontrados

| # | Gravedad | Problema | Archivos | Estado |
|---|---|---|---|---|
| A1 | **Medio** (seguridad) | Notificaciones en el móvil: un cliente podía guardar como «dispositivo» cualquier dirección `https://…`, y el servidor la llamaba con la firma de la plataforma (SSRF limitado: llamar a sitios ajenos). | `lib/notifications/webpush.ts`, `20261107090000_notificaciones_movil.sql` | **Corregido** |
| A2 | **Medio** (fiabilidad) | La tarea programada lanzaba email, WhatsApp, móvil y mantenimiento juntos con `Promise.all`. Si una parte fallaba, la respuesta entera era un error y no se sabía cuál. | `api/notificaciones/procesar.ts` | **Corregido** |
| A3 | **Medio** (observabilidad) | Los registros no tenían hora, nivel ni identificador de petición. No había señal de salud para un monitor externo. Un fallo no previsto devolvía la página de error por defecto, sin un código de referencia. | `lib/server/config.ts`, `auth.ts`, `middleware.ts` | **Corregido** |
| A4 | **Medio** (rendimiento) | Los móviles descargaban los mismos fotogramas del coche que un PC: 5286 KB. | `scripts/scroll-stage.ts`, `talleres/autovalue.json` | **Corregido** (−34 % en móvil) |
| A5 | **Medio** (función) | La recepción solo guardaba los kilómetros. No había nivel de combustible, daños previos ni lista de comprobación: es lo que evita discusiones al entregar el coche. | `repair_orders`, ficha y alta de orden, resguardo | **Corregido** (sin fotos; ver G) |
| A6 | **Bajo** (coherencia legal) | En el portal, el enlace de un aviso decía «Ver la factura», y el aviso del cambio de titular hablaba de «facturas». El programa no emite facturas. | `portal/avisos.astro`, `private.do_vehicle_transfer` | **Corregido** |
| A7 | **Bajo** (UX) | El inicio no mostraba las entregas previstas ni las retrasadas, solo un recuento. | `panel/index.astro` | **Corregido** |
| A8 | Informativo | Los fotogramas 4K del giro antiguo (`giro-4k/`, 16 MB, y `giro/`, 7,4 MB) siguen en `public/`. **No se descargan nunca**: el taller usa `maletero/`. Se guardan por si se vuelve al giro. | `apps/web/public/demo/autovalue/` | Sin cambios (decisión del propietario) |

**Revisado y correcto:**
- **Aislamiento entre talleres:** la prueba 26 recorre automáticamente **todas** las funciones de la API, también las nuevas, con datos de otro taller.
- **Funciones nuevas expuestas:** comprueban el rol dentro (consumo, titular, agenda, recuperación de la verificación en dos pasos).
- **XSS:** todo el HTML que se inyecta es fijo (iconos y scripts conocidos con huella CSP).
- **Secretos:** no hay ninguno en el repositorio.
- **Dependencias:** `npm audit` da 0 vulnerabilidades.
- **Sesiones:** caducan a la hora, el token de refresco rota y la contraseña es de mínimo 10 caracteres. Cambiar la contraseña exige verificación.
- **Endpoints protegidos:** la tarea programada y los webhooks exigen su secreto y lo comparan de forma segura.
- **Listas grandes:** tienen límite en el servidor (máximo 200 resultados).

## B. Cambios realizados

| Cambio | Por qué | Qué aporta |
|---|---|---|
| `isKnownPushService` + restricción `push_subscriptions_known_service` (migración nueva, `NOT VALID`) | Corrige A1 | Solo se llama a Google, Mozilla, Apple y Microsoft. Una dirección ajena no se llama y se borra. |
| `lib/server/log.ts` (`logEvent`, `safePath`, `requestId`) | Corrige A3 | Una línea JSON por evento con `ts`, `level` y evento. Las rutas van sin identificadores ni códigos secretos y nunca llevan datos personales. |
| Middleware: `x-request-id` y página 500 sin detalles con el código | Corrige A3 | Si algo falla, la persona da un código y se encuentra en los registros. |
| `Promise.allSettled` en la tarea programada y 500 si falla alguna parte | Corrige A2 | Las demás partes se hacen igual. El fallo se ve y queda registrado (`cron_part_error`). |
| `GET /api/salud` | Corrige A3 | Público: solo `{ok}`. Con el secreto: base de datos y avisos atascados de canales configurados (solo recuentos). |
| `scrollFrames.srcSm` + `maletero-sm/` (1280 px) | Corrige A4 | Móvil: de 5286 a 3509 KB. PC sin cambios. Comprobado a ojo que en el móvil se ve igual. |
| Recepción del vehículo (migración `20261113090000`, guardia, core `parseReception`, pantallas, resguardo) | Corrige A5 | Anota combustible, daños y comprobaciones. Solo la oficina la cambia, y sale en el papel que firma el cliente. |
| «Próximas entregas» en el inicio | Corrige A7 | Muestra lo que vence en 2 días y lo retrasado, con las urgentes marcadas. El mecánico ve las suyas. |
| Textos «resumen de servicios» (migración que solo cambia ese texto) | Corrige A6 | Lo que se ve en pantalla coincide con lo que el sistema genera de verdad. |
| Documentación: `DESPLIEGUE.md` §8 (vigilancia gratis), `GESTION_TALLER.md` (recepción e inicio), `CLAUDE.md` | Mantenimiento | Explica cómo montar alertas sin coste y las reglas nuevas. |

## C. Seguridad

- **Corregido:** A1 (SSRF limitado en el móvil), con pruebas unitarias (lista de servicios, dominios que imitan, puertos, usuario en la dirección) y SQL (2 comprobaciones).
- **Reforzado:**
  - La recepción la impone la base de datos; el mecánico no puede cambiarla ni manipulando la petición (`33_recepcion.test.sql`).
  - La salud no expone nada sin el secreto.
- **Riesgos pendientes:**
  - Sin producción no se ha comprobado la configuración real de Supabase Auth (caducidades, límites, correo) ni de Cloudflare (cabeceras en el borde, registros).
  - Una suscripción al móvil puede pasar de una cuenta a otra si se envía la misma dirección del dispositivo. Pasa a propósito, para el caso de dos cuentas en el mismo navegador. Esa dirección es secreta y no se puede adivinar; queda como riesgo bajo aceptado.

## D. Rendimiento

| Medida (`rendimiento.spec.ts`, local) | Antes | Después |
|---|---|---|
| Portada sin bajar (todo lo descargado) | 905 KB, 30 peticiones, 0 fotogramas | igual |
| LCP local (ordenador / móvil Pixel 7) | 300 / 180 ms | 196 / 288 ms (variación entre ejecuciones; local, sin red real) |
| Fotogramas del coche al bajar, ordenador | 5286 KB | 5286 KB |
| Fotogramas del coche al bajar, móvil | 5286 KB | **3509 KB (−34 %)** |

INP y CLS no se han medido con usuarios reales. Las cifras son de un navegador local, sin red de móvil.

## E. Pantallas

- **Orden (ficha):**
  - La tarjeta «Kilómetros a la entrada» pasa a «Recepción del vehículo»: kilómetros, combustible, daños y comprobaciones.
  - La oficina la edita; el resto la ve como lista.
- **Orden nueva:** desplegable opcional «Estado del vehículo al recibirlo». No recarga el formulario a quien no lo necesita.
- **Resguardo de depósito:** muestra combustible, daños y comprobaciones.
- **Inicio:** tarjeta «Próximas entregas» con etiquetas «Retrasada» y «Urgente».
- **Portal:** «Ver el resumen de servicios».
- **Errores:** página 500 con código de referencia.

## F. Pruebas

| Prueba | Resultado |
|---|---|
| `npm run lint` | 0 errores |
| `npm run check` (tipos) | 0 errores, 0 avisos |
| `npm test` (unitarias) | 165 (web) + 81 (core) pasan |
| `npm run build` | Correcto; el navegador no recibe secretos (40 archivos revisados) |
| `npm run test:db` (permisos, aislamiento, reglas) | **1075** comprobaciones pasan. Antes de esta auditoría eran 1064: hay 11 nuevas. |
| `npm run test:concurrencia` | 8 sesiones simultáneas: pasan |
| `npm audit` | 0 vulnerabilidades |
| `npm run test:e2e` (navegador completo, ordenador y móvil) | **215 pasan, 1 falló, 76 omitidas** (flujos que solo se prueban en ordenador o necesitan otro entorno). La que falló esperaba que el móvil usara `maletero/`, y ahora usa a propósito `maletero-sm/`. Se adaptó para comprobar la carpeta de cada dispositivo (sigue exigiendo los 62 fotogramas) y se volvió a ejecutar: **2 de 2 pasan**. |

**Problemas abiertos:** los de `PENDIENTE_ANTES_DE_VENDER.md` que dependen del propietario siguen igual:
- Datos legales del titular de la plataforma.
- Revisión jurídica.
- Asesor fiscal sobre los resúmenes de servicios.
- Quién paga el alojamiento.
- Producción sin crear.

## G. Próximos pasos (por impacto y esfuerzo)

1. **Fotos de daños en la recepción.**
   - Impacto alto; esfuerzo medio.
   - Usaría Supabase Storage con políticas por taller, fotos comprimidas en el navegador (unos 200 KB cada una), límite por orden y borrado con la orden.
   - Antes hay que decidir: el plan gratuito da 1 GB, unas 5000 fotos.
2. **Firma del cliente en pantalla (tableta) en el resguardo.**
   - Impacto medio-alto; esfuerzo medio.
   - Hoy se firma en papel.
   - Sería un trazo guardado con su huella, como la respuesta a presupuestos.
   - No sería firma electrónica cualificada, y así debe decirse.
3. **Recambios e inventario con alerta de stock bajo.**
   - Impacto alto para talleres medianos; esfuerzo alto.
   - Es un módulo nuevo: tablas por taller con RLS, movimientos al añadir piezas a una orden y aviso de mínimo.
4. **Vigilancia real en producción.**
   - Impacto alto; esfuerzo bajo cuando exista producción.
   - Comprobador gratuito sobre `/api/salud`, filtro `level=error` en los registros de Cloudflare y alerta por correo.
5. **Quitar `giro/` y `giro-4k/` del despliegue si no se va a volver al giro.**
   - Impacto bajo (no los descarga nadie); esfuerzo mínimo.
   - Reduce el tamaño del despliegue en 23 MB. Necesita la decisión del propietario.
