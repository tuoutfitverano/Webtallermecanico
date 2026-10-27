# Resúmenes de servicios (antes «facturas»), presupuestos y cobros

> **Decisión del propietario (27-10-2026): el programa NO emite facturas.** Lo que antes se llamaba «factura» es un **resumen de servicios**: un seguimiento de lo que el taller hizo y cobró a cada cliente, para no perderlo. En pantalla, en el portal y al imprimir se lee «Servicios realizados» / «Resumen de servicios» y **«No es una factura»**. La factura, si hace falta, la emite el taller con su programa de facturación certificado. Un asesor fiscal debe confirmar que así el programa no se considera un sistema de facturación (RD 1007/2023).
>
> Por dentro (tablas `invoices`, rutas `/panel/facturas`, funciones `issue_invoice`…) siguen los nombres antiguos; los mensajes de la base de datos se traducen en pantalla con `summaryMessage()` (`packages/core/src/documents.ts`). El resto de este documento describe el funcionamiento, que no ha cambiado.


Guía de cómo funcionan los presupuestos y la facturación de la plataforma, qué garantiza y, sobre todo, **qué NO garantiza todavía**.

> ⚠️ **La facturación es operativa y NO está certificada VERI\*FACTU.** Sirve para preparar, numerar, guardar e imprimir facturas y para controlar cobros. Antes de usarla para facturar de verdad, revísala con tu asesoría fiscal. Ver «Lo que falta para la conformidad fiscal» al final.

## Dinero: cómo se calcula

- Todos los importes se guardan **en céntimos** (números enteros). Las cantidades admiten 2 decimales (p. ej. 1,5 horas).
- Importe de una línea = cantidad × precio × (100 − descuento) / 100, redondeado al céntimo (mitades hacia arriba).
- IVA: se suma la base de todas las líneas con el mismo tipo y se redondea **una vez por tipo** (no línea a línea).
- La misma regla está en `packages/core/src/money.ts` (navegador y servidor) y en la base de datos (`private.line_base_cents`, `private.lines_totals`). Una prueba compara las dos (`15_gestion_taller.test.sql`).
- Tipos de IVA sugeridos: 21 %, 10 %, 4 % y 0 %; el taller elige su IVA por defecto en **Taller → Presupuestos y facturas**.

## Presupuestos

1. **Borrador** (`/panel/presupuestos/nuevo`, o «Crear presupuesto» desde una orden): se pueden añadir y quitar líneas.
2. **Enviar al cliente**: se fijan los importes y ya no se puede cambiar. Para cambiarlo se crea una **versión nueva** (P-12 v2), que sustituye a la anterior.
   - El cliente lo ve en su portal (`/portal/presupuestos`) y recibe un aviso (portal y, si lo eligió y el taller lo tiene activo, email o WhatsApp).
   - Además se genera un **enlace para compartir** (`/presupuesto/<código>`): código aleatorio de 256 bits del que solo se guarda la huella (SHA-256). Se muestra una vez, sirve para **una sola respuesta** y caduca con la validez del presupuesto. «Crear enlace nuevo» invalida el anterior.
   - El panel prepara el mensaje de WhatsApp o email con el enlace. **Preparar el mensaje no es enviarlo**: lo envía la persona desde su teléfono o correo.
3. **Respuesta**: el cliente acepta o rechaza (portal o enlace; para aceptar debe marcar «He leído el presupuesto»). También se puede anotar una respuesta dada en el taller.
   - Se guardan nombre, fecha, origen y una copia del presupuesto con su huella como constancia. **No es una firma electrónica.**
   - Al aceptar, la orden queda marcada como aprobada y las líneas pasan a la orden.
4. **Caducidad**: el mantenimiento diario marca como caducados los presupuestos enviados que han pasado su fecha.

Quién puede: propietario, administrador y recepción. El mecánico no ve presupuestos.

## Facturas

1. **Borrador** (`/panel/facturas/nueva`, o «Crear factura» desde una orden o un presupuesto aceptado): copia las líneas y se pueden ajustar.
2. **Emitir** (en dos pasos, es irreversible). La base de datos:
   - exige razón social y NIF del taller y al menos una línea;
   - asigna el número: **serie + año + correlativo sin huecos** (p. ej. `F2026-0001`), en orden cronológico;
   - **congela** los datos del emisor y del destinatario, las líneas, los impuestos y los totales;
   - añade un **registro encadenado** (`invoice_records`): cada factura guarda la huella SHA-256 de sus datos y de la huella anterior del taller. Los registros no se pueden modificar ni borrar.
3. Una factura emitida **no se modifica ni se borra**. Para corregirla se crea una **rectificativa** (propietario o administrador), con su propia serie (`R` por defecto), que anula en negativo la original y se puede ajustar antes de emitir.
4. **Imprimir o guardar en PDF**: «Imprimir o guardar PDF» abre la factura como documento; el PDF lo genera el navegador. También el cliente puede imprimir las suyas desde el portal.

## Cobros

- Se registran en la ficha de la factura: importe, forma de pago (efectivo, tarjeta del TPV del taller, transferencia, Bizum, domiciliación u otro), fecha y referencia.
- Se admiten cobros parciales; la base de datos **impide cobrar más del total**.
- Un cobro no se borra: se **anula con motivo** (propietario o administrador) y queda registrado.
- Lo pendiente y lo vencido se calculan siempre (`invoice_balances`), nunca se guardan a mano.
- **No hay pagos en línea**: la plataforma no cobra ni guarda datos de tarjetas.

## Ajustes del taller

**Taller → Presupuestos y facturas** (propietario o administrador): IVA por defecto, precio de la hora de mano de obra, validez de los presupuestos, plazo de pago, series de facturas y rectificativas (distintas entre sí), condiciones de los presupuestos y pie de factura. Los datos fiscales y la dirección del taller están en **Datos del taller**.

## Lo que falta para la conformidad fiscal

Esto **no** está hecho y no se debe dar por hecho:

- **VERI\*FACTU** (Real Decreto 1007/2023 y Orden HAC/1177/2024): registros de facturación con el formato y la firma exigidos, envío a la AEAT (o modalidad «no verificable» con sus requisitos), código QR y la leyenda en la factura, y la **declaración responsable** del fabricante del software. El registro encadenado de esta plataforma es un primer paso técnico, **no** el formato oficial.
- Fechas: obligatorio en 2027 según la normativa publicada; el Gobierno ha anunciado un posible aplazamiento que, a fecha de esta guía, no consta publicado en el BOE. Compruébalo con tu asesoría antes de decidir.
- Revisión por una asesoría de los textos, las menciones obligatorias (RD 1619/2012, Reglamento de facturación) y los casos especiales (régimen de recargo de equivalencia, operaciones exentas, clientes extranjeros, facturas simplificadas).
- Alternativa: conectar con un proveedor de facturación ya certificado.

## Pruebas

- Base de datos: `supabase/tests/15_gestion_taller.test.sql` (presupuestos) y `16_facturacion_recordatorios.test.sql` (facturas, cobros, rectificativas, cadena de huellas, aislamiento y portal).
- Navegador: `apps/web/e2e/gestion.spec.ts` (presupuesto aceptado por enlace → factura → cobro → impresión).
- Unidad: `packages/core/src/money.test.ts`.
