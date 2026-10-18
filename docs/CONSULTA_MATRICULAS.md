# Consulta de datos de vehículos por matrícula (Fase 6)

Estado: **integración preparada y probada con un proveedor simulado. Pendiente de contrato y credenciales** para hacer consultas reales. Sin credenciales, el botón «Consultar datos» no aparece y el alta manual funciona como siempre.

## 1. Proveedor elegido: Openapi · «Spanish Car Check»

Investigación del 18-10-2026. Desde el entorno de desarrollo no se pudieron abrir las páginas directamente, así que lo de abajo sale de los extractos de búsqueda de las páginas oficiales indicadas. **Antes de producción hay que confirmarlo** con la documentación de la consola y una consulta de prueba (ver §7).

| Pregunta | Respuesta (fuente) |
| --- | --- |
| ¿Matrículas españolas? | Sí, expresamente: consulta «de cualquier coche de España» por matrícula. Aparte hay un servicio para motos (*Spanish Bike Check*). [Ficha del producto](https://openapi.com/products/spanish-car-check) |
| API | REST/JSON. `GET https://automotive.openapi.com/ES-car/{matrícula}`. Entorno de pruebas del proveedor: `https://test.automotive.openapi.com`. [Documentación](https://console.openapi.com/apis/automotive/documentation) |
| Autenticación | Cabecera `Authorization: Bearer <token>`. El token se crea en la consola de Openapi (o con su API OAuth), con permisos y caducidad. [OAuth](https://console.openapi.com/apis/oauth/documentation) |
| Campos | Respuesta `{ success, message, error, data }`. El ejemplo publicado (5776CNS, Audi A3) incluye `CarMake`, `CarModel`, `Variation` (versión), `RegistrationDate` (dd/mm/aaaa), `Fuel`, `DynamicPower` (102 → CV), `EngineSize` (cm³), `Doors`, `VehicleIdentificationNumber` (puede venir vacío) e `IndicativePrice`. La ficha del producto y el ejemplo usan nombres distintos para algunos campos (p. ej. «Version»/«PowerCV»), así que **los nombres exactos están sin confirmar**. |
| Origen de los datos | El proveedor habla de «fuentes oficiales», sin decir cuáles. **Sin verificar.** |
| Alta y contrato | Alta autoservicio en la consola de Openapi. Uso comercial y condiciones de guardar o reutilizar datos: **sin verificar**. Hay que leer los términos antes de producción. |
| Precio | **0,40 € + IVA por consulta**; suscripciones «desde 0,18 €» por consulta. [Precios](https://openapi.com/pricing) |
| Límites | Límite técnico documentado de 10.000 peticiones por minuto. |

**Por qué este:** es el único que encontramos con todo esto a la vez: matrículas españolas, API REST documentada, entorno de pruebas, precio publicado y alta sin intermediarios.

**Descartados por ahora:**

- **DGT, Informe Telemático de Vehículos.** No hay API pública por matrícula. El servicio para empresas exige registro y certificado, y cada informe completo cuesta 8,67 € (tasa 4.1): demasiado caro para cada recepción de vehículo. ([DGT](https://sede.dgt.gob.es/es/vehiculos/tramites-para-empresas/informe-telematico-de-vehiculos/), [respuesta de la DGT en datos.gob.es](https://datos.gob.es/es/solicitud-de-datos/api-rest-para-la-obtener-los-datos-de-la-ficha-tecnica-nive-de-un-vehiculo))
- **RegCheck / CarRegistrationAPI.** Tiene `/CheckSpain` y sale más barato (unos 0,15–0,20 € por consulta). Pero es SOAP, con autenticación solo por usuario (sin clave secreta), y no está claro de dónde salen los datos. ([Documentación](https://www.regcheck.org.uk/data/doc.aspx))
- **TecAlliance (TecDoc), HaynesPro e Infopro.** Ofrecen búsqueda por matrícula dentro de sus catálogos, solo con contrato y sin documentación pública.
- **Decodificadores de VIN.** No sirven: un VIN no es una matrícula española, y dan datos genéricos del modelo, no los del vehículo concreto.

## 2. Qué hace la integración

1. En **Panel → Vehículos → Registrar vehículo**, junto a la matrícula aparece **«Consultar datos»**, solo si hay proveedor configurado.
2. El servidor normaliza y valida la matrícula con las reglas de `packages/core`. Admite formatos históricos; una matrícula no española hay que confirmarla antes.
3. `start_vehicle_lookup`, con el token de la persona, comprueba en la base de datos:
   - que es personal **activo** del taller;
   - que el taller no está suspendido;
   - los límites de uso;
   - si es un doble clic;
   - si hay una respuesta de **ese mismo taller** de menos de 24 h, que se reutiliza sin coste.
4. Solo si es una consulta nueva, el servidor llama al proveedor (tiempo máximo: 8 s).
5. La respuesta se valida y se convierte al modelo interno: solo campos reconocidos y con valores razonables. El resultado lo guarda `complete_vehicle_lookup`, que **solo** puede ejecutar el servidor con la clave secreta.
6. Se muestran los datos devueltos, con la fuente y la fecha:
   - los campos vacíos del formulario vienen **marcados**;
   - los que ya tienen otro valor escrito a mano vienen **desmarcados**, con aviso.
7. «Usar los datos marcados» solo rellena el formulario. El vehículo se crea al pulsar **«Guardar vehículo»**. Pulsar Intro guarda; nunca lanza una consulta.
8. Al guardar, un disparador comprueba que la consulta es del mismo taller y matrícula y que no ha caducado. Después anota, campo a campo:
   - `confirmado`: el dato se dejó como lo dio el proveedor;
   - `modificado`: se cambió a mano;
   - `no_usado`: no se usó.

   También pone el origen «Proveedor externo». La verificación sigue **pendiente**: un dato del proveedor no cuenta como comprobado por el taller.

## 3. Modelo de datos (`20261022090000_consultas_matricula.sql`)

- **`vehicle_lookups`** guarda, por consulta:
  - taller y matrícula normalizada;
  - proveedor y estado (`pendiente`, `encontrado`, `no_encontrado`, `respuesta_invalida`, `limite_proveedor`, `no_disponible`, `credenciales`, `error`);
  - `result`: los datos ya convertidos (`make`, `model`, `version`, `year` + `year_kind`, `fuel`, `power_cv`, `engine_cc`, `vin`);
  - quién la pidió, la clave de petición (evita duplicados) y las fechas.

  RLS: cada taller ve solo las suyas. Nadie escribe aquí salvo el servidor.
- **`vehicles.lookup_id`** indica de qué consulta salen los datos. Tiene clave foránea compuesta, así que solo admite consultas del mismo taller.
- **`vehicles.lookup_fields`** guarda, por campo, el valor del proveedor y su estado. Lo calcula la base de datos y no se puede falsear.
- **Los vehículos guardan solo los campos que ya existían**: marca, modelo, año y combustible. La versión, la potencia, la cilindrada y el VIN quedan en la consulta y se muestran en la ficha del vehículo.
- **No se comparten resultados entre talleres.**

## 4. Variables de entorno (solo servidor)

| Variable | Para qué |
| --- | --- |
| `VEHICLE_LOOKUP_PROVIDER` | `openapi` para activar. Vacía = consulta desactivada. |
| `OPENAPI_AUTOMOTIVE_TOKEN` | Token de Openapi. **Secreto.** |
| `OPENAPI_AUTOMOTIVE_URL` | Opcional. Vacía = producción (`https://automotive.openapi.com`). Para el entorno de pruebas del proveedor: `https://test.automotive.openapi.com`. |
| `VEHICLE_LOOKUP_TIMEOUT_MS` | Opcional (por defecto 8000; admite de 1000 a 30000). |

También hace falta `SUPABASE_SECRET_KEY`: sin ella no se puede guardar el resultado y el botón no aparece.

En Cloudflare, el token va en **Workers → Settings → Variables and Secrets** como *Secret*. Nunca va en el código, en Git ni en el navegador. `npm run build` lo comprueba con `scripts/check-client-bundle.mjs`.

## 5. Errores (mensajes sin detalles técnicos)

| Caso | Qué ve el usuario |
| --- | --- |
| Proveedor sin configurar | «La consulta automática por matrícula no está disponible…». El alta manual sigue funcionando. |
| Matrícula vacía, inválida o no española sin confirmar | Pide revisarla. No se llama al proveedor. |
| Sin permiso (otro taller, cliente, cuenta desactivada) | «No tienes permiso…». Lo decide la base de datos. |
| Límite propio | Por persona, 10 consultas cada 10 minutos. Por taller, 100 al día. Se cambian en `private.vehicle_lookup_limits()`. |
| No encontrada (404) | «El proveedor no tiene datos de esta matrícula…» |
| Respuesta no válida | «…datos que no podemos usar». No se rellena nada. |
| Límite o saldo del proveedor (402 o 429) | «…no acepta más consultas ahora mismo…» |
| Tiempo agotado o servicio caído (5xx) | «El proveedor de datos no responde…» |
| Credenciales (401 o 403) | «…problema de configuración del proveedor…» |
| No se pudo guardar el resultado | «No hemos podido guardar el resultado…». Nunca se muestra como éxito. |

Los registros (`console`) solo guardan códigos de evento y resultado: ni matrícula, ni datos, ni token.

## 6. Costes

- Cada consulta **nueva** cuesta lo que cobre el proveedor (0,40 € + IVA según su tarifa publicada).
- Reutilizar la consulta de menos de 24 h del mismo taller, un doble clic o pulsar Intro **no** generan otra llamada.
- El tope de 100 consultas diarias por taller limita el gasto máximo a unos 40 € + IVA al día por taller. Ajústalo cuando sepas el uso real.
- El navegador nunca llama al proveedor: todo pasa por el servidor, con sesión y permisos.

## 7. Para activarlo en producción (pendiente)

1. Crear la cuenta en Openapi y leer sus **términos de uso**: uso comercial para terceros (talleres), si se pueden guardar las respuestas y durante cuánto tiempo.
2. Firmar con Openapi un **acuerdo de encargado del tratamiento** (RGPD). Las matrículas pueden considerarse dato personal, y conviene mencionarlo en la política de privacidad del taller.
3. Activar la API «Automotive» y crear un token de **pruebas**. Hacer una consulta al entorno de pruebas con la matrícula de ejemplo (`5776CNS`) y comparar el JSON real con `mapEsCar()` en `apps/web/src/lib/vehicle-lookup/openapi.ts`. Si los nombres de campo no coinciden, ajustar la conversión y sus pruebas.
4. Crear el token de **producción**, configurarlo en Cloudflare y poner `VEHICLE_LOOKUP_PROVIDER=openapi`.
5. Aplicar la migración (`npx supabase db push`).
6. Probar en el panel con un vehículo real del taller y comprobar los datos con su permiso de circulación.

## 8. Pruebas

- **SQL** (`supabase/tests/10_consultas_matricula.test.sql`, 46 comprobaciones):
  - permisos por rol (cliente, cuenta sin taller, empleado desactivado, sin sesión, otro taller);
  - nadie escribe resultados salvo el servidor;
  - validación del resultado, reutilización solo dentro del taller y caducidad;
  - procedencia campo a campo;
  - límites;
  - los vehículos manuales que ya existían no cambian.
- **Unitarias** (`apps/web/src/lib/vehicle-lookup/vehicle-lookup.test.ts`, con proveedor y base de datos **simulados**):
  - conversión de respuestas válidas, incompletas y mal formadas;
  - cada tipo de error, tiempo agotado y proveedor no configurado;
  - validación de la matrícula, reutilización y doble clic;
  - registros sin datos;
  - revisión sin pisar lo escrito a mano.
- **Navegador** (`apps/web/e2e/matriculas.spec.ts`). Usa un **proveedor simulado** (`scripts/e2e/plate-provider-mock.mjs`) que imita la forma de la API. Comprueba:
  - el flujo completo consultar → revisar → usar → guardar;
  - que consultar no crea nada y que lo escrito a mano no se pisa;
  - la reutilización sin nueva llamada;
  - cada error;
  - el alta manual;
  - que Intro no consulta;
  - los permisos por API.

  **No son consultas a Openapi**: demuestran que nuestro código funciona, no que el proveedor responda así.
- **Secretos**: `npm run build` revisa que el código del navegador no contenga nombres de secretos, claves ni el cliente del proveedor.
