# Gestión del taller: roles, órdenes, planificación, recordatorios y estadísticas

Cómo funciona el día a día del panel (`/panel`). La facturación tiene su propia guía: `docs/FACTURACION.md`. Los avisos a clientes: `docs/NOTIFICACIONES.md`.

## Roles

| Rol | Puede | No puede |
|---|---|---|
| **Propietario** | Todo, incluido el equipo y la configuración del taller | — |
| **Administrador** | Lo mismo que el propietario; en el equipo invita, activa y desactiva a mecánicos y recepción | Gestionar a otros administradores o al propietario |
| **Recepción** | Clientes, vehículos, órdenes (crear, asignar, planificar, entregar), presupuestos, facturas, cobros, solicitudes web, recordatorios | Equipo, datos y ajustes del taller, avisos del taller, rectificativas, anular cobros, borrar solicitudes |
| **Mecánico** | Ver y trabajar en **sus** órdenes: estado (salvo «entregado»), diagnosis, trabajo, notas internas, líneas y fichaje | Crear o reasignar órdenes, planificar, ver presupuestos, facturas o estadísticas |

Los permisos los decide la base de datos (RLS y disparadores), no la interfaz: ocultar un botón no da ni quita permisos. Funciones de apoyo: `private.staff_workshop_ids()` (todo el personal), `private.office_workshop_ids()` (propietario, administrador y recepción) y `private.manager_workshop_ids()` (propietario y administrador).

## Vehículos

- Obligatorios: matrícula, marca, modelo y año (con su tipo). Opcionales: versión, bastidor (VIN, 17 caracteres sin I, O ni Q), kilómetros, próxima revisión (fecha y/o km) y recomendación.
- Los kilómetros se actualizan solos cuando una orden entra con más kilómetros que los anotados.
- La próxima revisión y su recomendación las ve el cliente en su portal; el bastidor y las notas internas, no.
- El cliente puede **añadir** vehículos desde su portal (quedan como «aportados por el cliente», pendientes de verificar) y **quitarlos**: van a su papelera 30 días y puede recuperarlos. Nunca se borran: el taller conserva siempre el vehículo, sus órdenes, revisiones, presupuestos y facturas, y la ficha avisa de que el cliente lo quitó.
- Historial en la ficha: órdenes con kilómetros y trabajos; la oficina ve también presupuestos y facturas.

## Órdenes de reparación

- **Líneas** (mano de obra, piezas, otros) con cantidad, precio, descuento e IVA. Son lo que se ha hecho de verdad y pasan a la factura.
- **Planificación** (solo oficina): prioridad, día planificado, fecha prevista de entrega (**interna**, nunca se enseña al cliente) y tiempo estimado.
- **Fichaje real**: «Empezar» y «Parar» guardan la hora del servidor; nadie escribe horas a mano. Una persona solo tiene un trabajo en marcha; al entregar la orden se cierran los fichajes abiertos.
- Avisos internos: entrega retrasada y presupuesto aprobado. «Preparar WhatsApp» abre el mensaje en el teléfono; **no** se registra como enviado.

## Planificación (`/panel/planificacion`)

- **Tablero** por estados (mover de estado y asignar desde la tarjeta) y **semana** (lo planificado por día).
- Filtros por mecánico y prioridad; alertas de retrasos y órdenes sin asignar.

## Recordatorios (`/panel/recordatorios`)

Los genera la base de datos una vez al día en el mantenimiento programado (`/api/notificaciones/procesar` → `run_maintenance`), aunque nadie tenga el panel abierto. Cada uno tiene una clave única: **nunca se repite**.

| Tipo | A quién | Cuándo |
|---|---|---|
| Revisión del vehículo | Cliente, **solo si lo pidió** en su portal | N días antes de la fecha o N km antes |
| Presupuesto sin respuesta | Cliente | N días después de enviarlo |
| Vehículo sin recoger | Cliente | N días después de estar listo |
| Trabajo retrasado | Solo el taller | Pasada la fecha prevista |

- Los avisos al cliente nacen **desactivados**: el propietario o un administrador los activa en «Reglas del taller».
- «Aviso creado» = puesto en la cola (portal y, si el cliente lo eligió y el taller lo tiene activo, email o WhatsApp). Sin proveedor configurado, el email o el WhatsApp se quedan pendientes: nunca se dan por enviados.
- «Sin canal» = el cliente no tiene cuenta, no lo pidió o faltan sus datos.

## Estadísticas (`/panel/estadisticas`, solo oficina)

- Todo sale de `workshop_stats`, que cuenta los datos reales con los permisos de quien mira. Sin datos, se ven ceros; nunca cifras de ejemplo.
- Ahora mismo: órdenes abiertas, retrasadas, listas para recoger y presupuestos sin respuesta.
- Por periodo: vehículos recibidos y entregados, aceptación de presupuestos, facturación y cobros, tiempo estimado frente a fichado, carga del equipo y evolución semanal (con tabla).
- El inicio del panel muestra «Requiere atención»: retrasos, órdenes sin asignar, presupuestos sin respuesta, facturas vencidas y recordatorios por revisar.

## Pruebas

- Base de datos: `supabase/tests/15_gestion_taller.test.sql` y `16_facturacion_recordatorios.test.sql`.
- Navegador: `apps/web/e2e/gestion.spec.ts` (incluye la cuenta de recepción `recepcion@e2e.test`).
