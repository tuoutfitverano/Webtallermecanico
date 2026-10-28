"""
Versión ligera de los fotogramas del coche para móviles (1280 px de ancho en
lugar de 1920 px). Los móviles la eligen solos (scroll-stage.ts: pantallas de
hasta 1100 px reales de ancho) y descargan un tercio menos sin diferencia
visible a su tamaño de pantalla.

Uso (desde la raíz del repositorio):
  python3 scripts/demo-autovalue/frames-sm.py apps/web/public/demo/autovalue/maletero apps/web/public/demo/autovalue/maletero-sm
"""
import os
import sys

from PIL import Image

WIDTH = 1280


def main(src: str, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    total_in = total_out = 0
    for name in sorted(f for f in os.listdir(src) if f.endswith('.webp')):
        image = Image.open(os.path.join(src, name))
        w, h = image.size
        small = image.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
        target = os.path.join(out, name)
        small.save(target, 'WEBP', quality=82, method=6)
        total_in += os.path.getsize(os.path.join(src, name))
        total_out += os.path.getsize(target)
    print(f'{total_in / 1e6:.2f} MB -> {total_out / 1e6:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
