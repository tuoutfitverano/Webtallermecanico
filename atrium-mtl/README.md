# ATRIUM MTL — página de portada

Página independiente (no forma parte de la plataforma de talleres): un único `index.html` con CSS, SVG y JavaScript en línea, sin dependencias ni compilación.

```
atrium-mtl/
  index.html
  assets/fonts/archivo.woff2   Archivo variable (peso 100–900, anchura 62–125 %)
  assets/fonts/inter.woff2     Inter variable (peso 100–900)
  assets/fonts/LICENSE-*.txt   Licencias SIL Open Font License 1.1
```

Las fotos y la textura de grano se cargan desde las URL de CloudFront indicadas en `:root`.

## Verla en local

Ábrela con un servidor local (los navegadores pueden bloquear las fuentes si se abre el archivo directamente):

```bash
cd atrium-mtl
python3 -m http.server 8000
# http://localhost:8000
```

## Modos adaptables

| Modo | Cuándo | Composición |
| --- | --- | --- |
| `desk` | ≥ 1097 px de ancho y proporción ≥ 27/25 | Lienzo 1280×800 escalado para cubrir; columnas extra en pantallas muy anchas |
| `tab-l` | ≥ 900×540 y proporción ≥ 21/20 | Texto a la izquierda, mosaico a la derecha, tamaños nativos |
| `tab-p` | ≥ 600×820 y proporción ≤ 21/20 | Cabecera / texto / banda de mosaico |
| `mob-l` | ≥ 560 px y apaisado | Teléfono horizontal: texto a la izquierda, mosaico a la derecha |
| `mob` | resto | Teléfono vertical: cabecera, texto y mosaico en columna |

Respeta `prefers-reduced-motion`: sin animación de entrada ni movimiento del mosaico.
