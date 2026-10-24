# Copia de la web de un taller («se queda su web»)

Un taller que ha pagado su web se la queda aunque deje de pagar el programa. Para que eso sea verdad, la plataforma genera una **copia de su web en archivos** (HTML, CSS, JavaScript, tipos de letra e imágenes) que funciona en **cualquier alojamiento web, sin la plataforma**.

## Qué lleva la copia y qué no

| Lleva | No lleva (depende de la plataforma) |
|---|---|
| Portada con su diseño, colores, textos, fotos y el coche que gira al bajar | Formularios de cita y presupuesto: pasan a ser **botones de Llamar, WhatsApp y Correo** |
| Servicios, cómo trabajamos, contacto y mapa | «Área de clientes» y el programa de gestión |
| Aviso legal, privacidad y cookies adaptados a la copia | La parte que presenta el programa y la sección comercial |
| Página 404 propia | Aviso de cookies: la copia **no usa ninguna** (ni guarda nada en el navegador) |
| `LEEME.txt` con instrucciones para el taller, `_headers` y `.htaccess` (cabeceras de seguridad y 404) | Ninguna clave ni dirección de la plataforma |

Los textos legales cambian para la copia: el responsable es el taller, la web «solo muestra información», el alojamiento que elija puede registrar datos técnicos (como la IP) y WhatsApp y el correo se rigen por sus propias condiciones.

Los tipos de letra (Barlow, Instrument Serif y Archivo) tienen licencia SIL Open Font License, que permite incluirlos en la web.

## Cómo se genera

### Lo normal: botón en GitHub (datos reales del taller)

1. GitHub → **Actions** → **«Exportar la web de un taller»** → *Run workflow*.
2. Escribe el **identificador del taller** (el `slug`, p. ej. `taller-garcia`).
3. Al terminar (círculo verde, unos 5 minutos), abre la ejecución y descarga **`web-<taller>`**: es un .zip con la web, listo para entregar al taller. GitHub lo guarda 7 días.

- Usa el secreto `SUPABASE_DB_URL`, que ya existe para «Publicar versión real».
- Lee la base de datos en **solo lectura**: la conexión se abre con `default_transaction_read_only`, así que no puede cambiar nada.
- Usa la función `private.exported_site(slug)`, que da lo mismo que la web pública (`get_public_site`) pero **aunque la web esté sin publicar o el taller suspendido**, que es justo cuando se la lleva. Nadie de la API puede ejecutarla.
- La migración `20261105090000_web_exportada.sql` tiene que estar aplicada; se aplica con «Publicar versión real».
- Gasta minutos gratuitos de GitHub Actions, como las pruebas. No cuesta nada.

### En tu ordenador

```bash
npm run web:exportar -- talleres/<taller>.json      # desde el archivo del taller
npm run web:exportar -- datos-del-taller.json       # desde la salida de private.exported_site
```

Opciones: `--salida <carpeta>` (por defecto `web-exportada/<taller>`) y `--sin-zip`. La carpeta `web-exportada/` no se sube a Git.

## Qué comprueba antes de dar la copia por buena

`scripts/exportar-web/exportar.mjs`:

1. Compila la web en modo copia (`WEB_EXPORT=1`, `lib/site/export.ts`) **sin ninguna variable de entorno de la plataforma**, para que no pueda colarse ningún secreto.
2. Recoge **solo** los archivos que usa: páginas, estilos, scripts, letras, imágenes y todos los fotogramas del coche. Si la web pide uno que no existe, se para.
3. Busca en la copia nombres de claves y piezas de la plataforma (Supabase, antispam, `/api/…`). Si encuentra alguno, no la entrega.
4. **Taller real sin datos legales completos** (razón social, NIF, domicilio): no la genera. Hay que completarlos antes en Panel → Taller. La demo sí se genera, con su aviso de «web de demostración».
5. La prueba con un navegador real (`comprobar.mjs`) en móvil, ordenador y pantalla grande 4K, sirviéndola con un servidor de archivos mínimo (como un alojamiento cualquiera) y con **todo lo de fuera bloqueado**, como si la plataforma ya no existiera. Comprueba que:
   - las 4 páginas responden y una dirección inexistente da la 404;
   - no falta ningún archivo y no hay errores en la consola;
   - no hay formularios, ni «Área de clientes», ni nada de la plataforma;
   - no guarda cookies ni datos en el navegador;
   - están los botones de llamar, WhatsApp y correo;
   - el coche se mueve al bajar.
6. Solo si todo pasa escribe `LEEME.txt` y crea el .zip. En el `LEEME.txt` apunta:
   - lo que la copia cargue de otra web (p. ej. un vídeo alojado fuera): funcionará mientras esa web lo tenga;
   - las frases del propio taller que hablan de lo que la copia ya no tiene («te avisamos en tu portal», «pide cita desde la web»…), para que las cambie. No se cambian solas porque son sus textos.

Las pruebas se ejecutan en cada cambio (CI, trabajo «Copia de la web de un taller»): `npm run test:exportar` genera la copia de AutoValue desde su archivo y desde una base de datos local con el esquema real (`scripts/exportar-web/test-local.sh`), también con el diseño clásico y con el taller suspendido. También se ha comprobado a mano que la prueba **detecta** los fallos (quitando un fotograma y añadiendo un formulario y un enlace al área de clientes).

## Texto para el contrato de web (sustituye a la cláusula 4)

> Redacción técnica, sin validación jurídica: que la revise un abogado antes de usarla. Lo que va entre corchetes lo decides tú.

**4. La web es del Cliente cuando la paga**

**4.1. Qué paga el Cliente.** El precio de este contrato paga el diseño, la configuración personalizada, la preparación de contenidos y la puesta en marcha de la web pública del taller: las páginas que ven sus clientes (portada, servicios, contacto y textos legales).

**4.2. Lo que siempre es del Cliente.** Su nombre comercial, logotipo, marcas, fotografías, textos y demás materiales que aporte siguen siendo suyos. También le corresponden las solicitudes que reciba a través de la web, de cuyos datos personales es responsable.

**4.3. Lo que adquiere al pagar el precio completo.** Una vez pagado el precio íntegro:

- **(a)** El Prestador cede al Cliente, en exclusiva, para todo el mundo y por el plazo máximo que permita la ley, los derechos de reproducción, distribución, comunicación pública y transformación de los textos e imágenes creados expresamente para él, para usarlos en cualquier medio, también fuera de la plataforma.
- **(b)** El Prestador concede al Cliente una licencia no exclusiva, indefinida, para todo el mundo y ya pagada con el precio, para usar, reproducir, alojar donde quiera y modificar la copia de su web descrita en la cláusula 4.4, incluidos el diseño y el código que contiene. La licencia sirve para publicar la web de su propio taller. El Cliente puede encargar cambios a quien quiera, pero no puede vender ni ceder la copia por separado ni usarla como plantilla para webs de terceros. Puede transmitirla junto con su negocio.

**4.4. Copia de la web.** El Cliente puede pedir, en cualquier momento una vez pagado el precio completo, una copia de su web pública en archivos (HTML, CSS, JavaScript, tipos de letra e imágenes) que funciona en cualquier alojamiento web sin la plataforma, con instrucciones. El Prestador se la entregará sin coste en un plazo máximo de [15] días naturales. El derecho a la copia no depende de que el Cliente esté al corriente de las cuotas del servicio mensual, que se reclaman por su vía.

La copia reproduce la web tal como esté publicada en ese momento, con tres diferencias, porque esas partes dependen de la plataforma:

- los formularios de cita y presupuesto se sustituyen por botones de llamada, WhatsApp y correo electrónico;
- no incluye el área de clientes, el programa de gestión ni otros servicios de la plataforma;
- no incluye las secciones que presentan la plataforma.

Antes de entregarla, el Prestador comprueba que funciona sin la plataforma. Para que el aviso legal y la privacidad de la copia sean válidos, el Cliente debe tener completos sus datos de titular (nombre o razón social, NIF y domicilio).

**4.5. Lo que no se entrega.** El código fuente de la plataforma (la aplicación que genera las webs de todos los talleres, el programa de gestión y el área de clientes), sus plantillas y componentes en formato editable, cuentas, claves y servicios de terceros. La licencia de la cláusula 4.3 (b) cubre el diseño y el código solo tal como van dentro de la copia del Cliente.

**4.6. Después de la entrega.** Cuando el Cliente publica la copia en su propio alojamiento, pasa a ser quien la publica. Corren de su cuenta:

- el alojamiento y su coste;
- el mantenimiento y los cambios;
- mantener al día el aviso legal y la privacidad;
- poner un aviso de cookies si añade herramientas que las usen.

El Prestador no responde de los cambios que haga el Cliente o terceros. Los recursos de terceros se rigen por sus propias licencias y se enumeran en el Anexo A.

**4.7. Transición.** Si el Cliente deja el servicio mensual, el Prestador mantendrá su web publicada en la plataforma durante [30] días naturales desde la baja y colaborará para apuntar el dominio al nuevo alojamiento.

**4.8. Cuándo nacen estos derechos.** Los derechos de la cláusula 4.3 y la copia de la cláusula 4.4 nacen al pagar el precio completo. Hasta entonces, el Cliente puede usar la versión de prueba solo para revisarla.

### Cambios en el resto para que cuadre

1. **Contrato de web, 5.2:** la última frase pasa a ser «Si ese servicio acaba, el Cliente conserva su web ya pagada y recibirá la copia de la cláusula 4.4 para publicarla donde elija».
2. **Contrato de web, 6.2:** se queda como está. «No retirará una web ya pagada de un servidor ajeno» ahora tiene sentido: es la copia alojada por el taller.
3. **Contrato de software, 5.1:** «… conserva lo previsto en la cláusula 4 del contrato de web, incluida la copia de su web».
4. **Anexo A del contrato de web.** Añadir:
   - qué lleva la copia (la tabla de arriba);
   - los recursos de terceros, con su licencia (tipos de letra: SIL Open Font License);
   - si se usan, las fotos o vídeos de bancos de imágenes.
5. **Guion.** En el cierre: «La web, una vez pagada, es tuya: si algún día dejas el programa, te doy una copia lista para publicarla donde quieras. Lo único que no se lleva es lo que necesita el programa: los formularios pasan a ser botones de llamar y WhatsApp». En «Reglas de negocio»: «Web pagada = licencia permanente + copia en archivos que funciona en cualquier alojamiento (sin formularios ni área de clientes); hosting y software requieren cuota activa».

## Archivos

- `apps/web/src/lib/site/export.ts`: modo copia (datos del taller fijados al compilar; en producción no hace nada) + `export.test.ts`.
- `apps/web/astro.config.mjs`: con `WEB_EXPORT=1`, las 5 páginas públicas se generan como archivos en `dist-exportar/`.
- `apps/web/src/components/ContactButtons.astro`: botones que sustituyen a los formularios.
- Páginas y piezas con `WEB_EXPORT`: `ClassicHome`, `PremiumHome`, cabeceras y pies (sin «Área de clientes»), `SiteLayout` (sin aviso de cookies), `LegalDoc`, `404`, `aviso-legal`, `privacidad`, `cookies`.
- `scripts/exportar-web/`:
  - `exportar.mjs`: genera la copia;
  - `comprobar.mjs`: la prueba sin la plataforma;
  - `servidor.mjs`: servidor de archivos mínimo;
  - `desde-bd.sh`: genera la copia desde la base de datos real, en solo lectura;
  - `test-local.sh`: prueba de lo anterior con una base local.
- `supabase/migrations/20261105090000_web_exportada.sql` + `supabase/tests/27_web_exportada.test.sql`.
- `.github/workflows/exportar-web.yml` (botón) y trabajo «Copia de la web de un taller» en `ci.yml`.
