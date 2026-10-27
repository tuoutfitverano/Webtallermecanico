# Gestión del taller: roles, órdenes, planificación, recordatorios y estadísticas

Cómo funciona el día a día del panel (`/panel`). La facturación tiene su propia guía: `docs/FACTURACION.md`. Los avisos a clientes: `docs/NOTIFICACIONES.md`.

## Roles

| Rol | Puede | No puede |
|---|---|---|
| **Propietario** | Todo, incluido el equipo y la configuración del taller | — |
| **Administrador** | Lo mismo que el propietario; en el equipo invita, activa y desactiva a mecánicos y recepción | Gestionar a otros administradores o al propietario |
| **Recepción** | Clientes, vehículos, órdenes (crear, asignar, planificar y entregar las ya confirmadas), presupuestos, facturas, cobros, solicitudes web, recordatorios | Confirmar trabajos («Listo para recoger»), equipo, datos y ajustes del taller, avisos del taller, rectificativas, anular cobros, borrar solicitudes |
| **Mecánico** | Ver y trabajar en **sus** órdenes: estado (salvo «Listo para recoger» y «entregado»), diagnosis, trabajo, notas internas, líneas y fichaje. **Quedarse** una orden libre y **darla por terminada** | Crear órdenes, quitarle una orden a un compañero, confirmar su propio trabajo, planificar, ver presupuestos, facturas o estadísticas |

### Órdenes libres y revisión del trabajo

1. **Órdenes libres:** una orden abierta sin nadie asignado aparece al mecánico en «Órdenes → Órdenes libres» (solo número, vehículo, problema y prioridad). Con **«Me la quedo»** pasa a ser suya (`claim_repair_order`). Si otra persona se adelanta, se le dice; nunca se quita una orden a un compañero.
2. **Dar por terminada:** quien tiene la orden pulsa **«Dar por terminada»** (`mark_order_done`). Queda **pendiente de revisión**, se para su tiempo en marcha y el historial lo guarda. El estado no cambia: **el cliente no ve nada ni recibe avisos** todavía.
3. **Revisión (solo propietario o administrador):** en el inicio aparece «trabajos terminados pendientes de tu revisión» y en Órdenes el filtro «Pendientes de revisión». En la orden:
   - **«Confirmar: listo para recoger»** → la orden pasa a «Listo para recoger» y el cliente recibe el aviso de siempre;
   - **«Devolver al mecánico»** con un motivo obligatorio (interno) → el mecánico lo ve en la orden y en el historial, y la vuelve a terminar cuando esté.
   (`review_repair_order`). **Recepción no confirma.**
4. **Entregar:** recepción (o la gerencia) marca «Entregado», pero solo cuando el trabajo ya está confirmado como «Listo para recoger». El propietario y el administrador pueden poner «Listo para recoger» directamente sin pasar por la revisión.

Todo lo decide la base de datos (`repair_orders_review_guard` y las tres funciones), no los botones: un mecánico no puede poner «Listo para recoger» ni escribiendo directamente en la base de datos. Pruebas: `supabase/tests/22_revision_ordenes.test.sql` y `apps/web/e2e/revision.spec.ts`.

Los permisos los decide la base de datos (RLS y disparadores), no la interfaz: ocultar un botón no da ni quita permisos. Funciones de apoyo: `private.staff_workshop_ids()` (todo el personal), `private.office_workshop_ids()` (propietario, administrador y recepción) y `private.manager_workshop_ids()` (propietario y administrador).

## Vehículos

- Obligatorios: matrícula, marca, modelo y año (con su tipo). Opcionales: versión, bastidor (VIN, 17 caracteres sin I, O ni Q), kilómetros, próxima revisión (fecha y/o km) y recomendación.
- Los kilómetros se actualizan solos cuando una orden entra con más kilómetros que los anotados.
- La próxima revisión y su recomendación las ve el cliente en su portal; el bastidor y las notas internas, no.
- El cliente puede **añadir** vehículos desde su portal (quedan como «aportados por el cliente», pendientes de verificar) y **quitarlos**: van a su papelera 30 días y puede recuperarlos. Nunca se borran: el taller conserva siempre el vehículo, sus órdenes, revisiones, presupuestos y facturas, y la ficha avisa de que el cliente lo quitó.
- Historial en la ficha: órdenes con kilómetros y trabajos; la oficina ve también presupuestos y facturas.

### Cambio de titular (el coche se vende)

Migración `20261109090100_cambio_titular.sql`, pruebas `31_cambio_titular.test.sql` y `e2e/titular.spec.ts`.

- **Saber la matrícula no basta.** El comprador lo pide desde su portal (Añadir vehículo → «Este coche ahora es mío: pedir el cambio») o el taller lo hace en el mostrador. Hasta que se confirma, el coche sigue siendo del titular anterior.
- **Se confirma de dos formas:**
  1. El titular anterior contesta en su portal «Sí, lo he vendido» (no se le dice quién lo pide). El cambio se hace al momento.
  2. La **oficina** (propietario, administración y recepción; los mecánicos no) ve el **permiso de circulación a nombre del comprador** o la **app miDGT** y marca cuál vio. No se guarda copia del documento.
- Si el titular anterior dice «No lo he vendido», no se hace sola: la oficina lo revisa con los papeles. Puede rechazar la petición (se avisa al comprador).
- Al confirmarse, el vehículo pasa a la ficha del comprador. El anterior deja de verlo, pero conserva sus reparaciones, presupuestos y facturas, que van a su nombre; el nuevo solo ve las suyas. Se cancelan los recordatorios pendientes del anterior sobre ese coche y se avisa a los dos.
- No se puede cambiar con una reparación en curso.
- Queda registrado en `vehicle_transfers` quién lo pidió, cómo se comprobó, quién lo confirmó y cuándo. La ficha del vehículo enseña el historial de titulares.
- El cliente de un vehículo que ya tiene titular no se cambia al editar sus datos. Lo impide el disparador `vehicles_owner_guard`; hay que usar «Cambiar de titular». «Corrección» sirve para un vehículo registrado en la ficha equivocada, sin venta.
- La petición está limitada a 3 al día por ficha.

## Órdenes de reparación

- **Líneas** (mano de obra, piezas, otros) con cantidad, precio, descuento e IVA. Son lo que se ha hecho de verdad y pasan a la factura.
- **Planificación** (solo oficina): prioridad, día planificado, fecha prevista de entrega (**interna**, nunca se enseña al cliente) y tiempo estimado.
- **Fichaje real**: «Empezar» y «Parar» guardan la hora del servidor; nadie escribe horas a mano. Una persona solo tiene un trabajo en marcha; al entregar la orden se cierran los fichajes abiertos.
- Avisos internos: entrega retrasada y presupuesto aprobado. «Preparar WhatsApp» abre el mensaje en el teléfono; **no** se registra como enviado.

## Agenda de cada persona (`/panel/agenda`)

Migraciones `20261110090000_agenda.sql` y `20261111090000_agenda_modificado_por.sql`, pruebas `32_agenda.test.sql` y `e2e/agenda.spec.ts`; reglas en `packages/core/src/agenda.ts`.

- Cada persona del taller (mecánico, recepción, administración, propietario) tiene su agenda, con vistas de **día** (por horas), **semana** (rejilla de lunes a domingo con las horas: cada apunte ocupa su hora y lo que dura; en el móvil, lista de días) y **mes**.
- **Apuntes:** tarea, cita, reunión, ausencia u otro, con día, hora de inicio y de fin, notas y, si se quiere, la orden de reparación relacionada. Se marcan como **hechos** (la hora la pone el servidor), se editan y se borran en dos pasos.
- **Lo que ha hecho:** los apuntes hechos y el **tiempo fichado** en las órdenes (`repair_order_work_logs`) salen en su día y hora. Las órdenes planificadas para ese día (`scheduled_on`) también aparecen.
- **Quién ve qué** (en la base de datos, RLS):
  - Cada persona ve y organiza **la suya**.
  - **Propietario y administración** ven y organizan la de **cualquiera** o la de **todo el equipo** a la vez, y le pueden apuntar cosas a otra persona; queda quién lo apuntó.
  - Recepción y mecánicos no ven la de los demás, ni cambiando el enlace.
- Propiedad y administración entran en la agenda de cualquier persona (fila «Agenda» o Equipo) y la cambian. `updated_by` lo pone la base de datos en cada cambio real; la persona ve «Modificado por …» (y «Lo apuntó …») cuando no fue ella.
- Un apunte solo se une a una orden en la que esa persona pueda trabajar. Quien deja el equipo deja de ver su agenda, pero el taller la conserva (y va en la copia del taller).

## Planificación (`/panel/planificacion`)

- **Tablero** por estados (mover de estado y asignar desde la tarjeta) y **semana** (lo planificado por día).
- Filtros por mecánico y prioridad; alertas de retrasos y órdenes sin asignar.

## Mantenimientos periódicos (`/panel/mantenimientos`)

Cada taller tiene **su** lista: nombre y cada cuántos **meses** y/o **kilómetros** (cuenta lo primero que llegue).

- Nace con una lista de partida **orientativa** que el taller ajusta a su criterio y a lo que diga cada fabricante: cambio de aceite y filtro (12 meses / 15.000 km), revisión general (12 / 15.000), pre-ITV (12 meses), filtros de aire y habitáculo (24 / 30.000), líquido de frenos (24 meses) y correa de distribución (60 / 100.000).
- La cambian el propietario y los administradores; el resto del equipo la ve. No se borran: se **desactivan** (dejan de ofrecerse y de avisar, pero se conserva el historial).
- En cada orden se marcan los «Mantenimientos hechos» (también el mecánico, en sus órdenes). Al **entregar** el vehículo, la base de datos calcula el próximo: fecha de entrega + meses y kilómetros de entrada + km. Si el taller cambia la periodicidad, se recalculan los próximos de todos los vehículos.
- La oficina puede anotar en la ficha del vehículo uno hecho **fuera del taller** (o antes de usar el panel). Cuenta el más reciente entre lo anotado y las órdenes.
- «Vencen pronto»: vencidos o en los próximos 60 días / 2.000 km (con el último kilometraje conocido).
- El cliente ve en su portal los mantenimientos de sus vehículos (`portal_vehicle_services`). Los recordatorios usan la regla «Revisión» (abajo): solo le llegan si él lo pidió.
- Base de datos: `service_intervals`, `order_services`, `vehicle_services` (solo la escribe la base de datos), `set_vehicle_service`. Reglas compartidas: `packages/core/src/maintenance.ts`.

## Recordatorios (`/panel/recordatorios`)

Los genera la base de datos una vez al día en el mantenimiento programado (`/api/notificaciones/procesar` → `run_maintenance`), aunque nadie tenga el panel abierto. Cada uno tiene una clave única: **nunca se repite**.

| Tipo | A quién | Cuándo |
|---|---|---|
| Revisión y mantenimientos del vehículo | Cliente, **solo si lo pidió** en su portal | N días antes de la fecha o N km antes (próxima revisión de la ficha y cada mantenimiento periódico) |
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

- Base de datos: `supabase/tests/15_gestion_taller.test.sql`, `16_facturacion_recordatorios.test.sql` y `18_mantenimientos.test.sql`.
- Navegador: `apps/web/e2e/gestion.spec.ts` (incluye la cuenta de recepción `recepcion@e2e.test`).
