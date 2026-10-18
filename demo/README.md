# Web + gestión para talleres mecánicos · Demo

> **Prototipo comercial anterior.** Funciona solo en el navegador con datos de ejemplo. La plataforma real se está construyendo en la raíz del repositorio (ver [README principal](../README.md)).

Demo interactiva para enseñar a talleres mecánicos. Incluye tres piezas conectadas entre sí:

| Página | Para quién | Qué hace |
| --- | --- | --- |
| `index.html` | Clientes del taller | Web pública: servicios, opiniones, **cita online** con horas libres reales y **consulta del estado del vehículo**. |
| `cliente.html` | Clientes del taller | **Portal privado**: estado del coche en tiempo real, **aprobación del presupuesto**, historial de reparaciones con facturas, avisos de ITV y de la próxima revisión. |
| `taller.html` | Personal del taller | **Panel de gestión**: tablero de trabajos con arrastrar y soltar, presupuestos con catálogo en un clic, agenda de citas, recepción de vehículos, fichas de cliente y avisos por WhatsApp. |
| `presentacion.html` | Tú (para vender) | Resumen de ventajas, guion de la demo y formulario para **personalizarla con el nombre y el color de cada taller**. |

Todo es HTML, CSS y JavaScript sin dependencias ni servidor. Los datos de ejemplo se guardan en el navegador (`localStorage`), así que **lo que haces en el panel aparece al instante en el portal del cliente** si los tienes abiertos en dos pestañas o ventanas.

## Probarla en local

```bash
cd demo
python3 -m http.server 8000
# y abre http://localhost:8000/presentacion.html
```

También funciona abriendo `index.html` directamente, pero con un servidor local la sincronización entre pestañas es más fiable.

## Guion de la demo (3 minutos)

1. Abre **Panel del taller** y enseña el tablero: cada coche, su estado, el mecánico y la hora de entrega.
2. En otra ventana, al lado, abre **Portal cliente** → “Laura · presupuesto pendiente”.
3. Laura pulsa **Aprobar**: en el panel salta el aviso y el coche pasa solo a “En reparación”.
4. En el panel, arrastra el coche a **Listo para recoger**: el portal de Laura cambia al momento.
5. En la **Web del taller**, pide una cita: aparece en **Agenda**. Pulsa **Recepcionar** y la orden se crea con los datos ya rellenados.

Accesos de prueba al portal:

| Cliente | Matrícula | Código |
| --- | --- | --- |
| Laura · presupuesto pendiente | 1234 KLM | 2580 |
| Carlos · en reparación | 5678 BCD | 1111 |
| Lucía · listo para recoger | 7788 LCV | 7272 |

El botón ⟳ de la barra superior devuelve la demo a los datos iniciales.

## Personalizarla para cada taller

Desde `presentacion.html` (formulario “Personaliza la demo”) o con un enlace:

```
presentacion.html?taller=Talleres%20Pepe&tel=912000000&wa=600000000&color=%230a7cff
```

Parámetros: `taller`, `eslogan`, `tel`, `wa`, `email`, `dir`, `horario`, `color`. Se recuerdan en ese navegador hasta que pulses “Restaurar valores de ejemplo”.

## Publicarla gratis con GitHub Pages

1. En GitHub: **Settings → Pages**.
2. En *Source* elige **Deploy from a branch**, la rama y la carpeta `/ (root)`.
3. En un minuto estará en `https://<usuario>.github.io/<repositorio>/demo/presentacion.html`.

## Estructura

```
index.html          Web pública del taller
cliente.html        Portal del cliente
taller.html         Panel del taller
presentacion.html   Página de venta y personalización
css/styles.css      Estilos compartidos (adaptado a móvil)
js/core.js          Configuración, datos de ejemplo, almacén y utilidades
js/public.js        Lógica de la web pública
js/cliente.js       Lógica del portal del cliente
js/taller.js        Lógica del panel del taller
```

## Para pasar de demo a producto real

Esta versión es para enseñar: los datos viven en el navegador. Para un taller de verdad haría falta:

- **Base de datos y usuarios** (por ejemplo Supabase o Firebase) para que taller y clientes compartan los datos de verdad, con inicio de sesión para el personal.
- **Avisos automáticos** por WhatsApp Business API, SMS o email cuando cambia el estado (ahora se abre WhatsApp con el mensaje ya escrito).
- **Facturación** conforme a la normativa (en España, VeriFactu/TicketBAI) o integración con el programa que ya use el taller.
- Fotos del vehículo en la recepción, firma del cliente y aviso legal y de privacidad (RGPD).
