#!/usr/bin/env python3
"""
Prepara las imágenes del coche que gira (taller demo AutoValue).

  python3 scripts/demo-autovalue/frames.py <vídeo.mp4> <garaje.png> <carpeta salida>

  1. Saca los fotogramas del vídeo (fondo negro) a 1280×720.
  2. Recorta el coche: el negro conectado con los bordes pasa a transparente; los
     huecos pequeños (pasos de rueda, bajos) se rellenan para que no se vea el
     garaje a través del coche. Ventanillas y neumáticos se conservan.
  3. Añade sombra de contacto y reflejo suave en el suelo pulido.
  4. Guarda giro/000.webp… (con transparencia), garaje.webp y portada.webp
     (garaje + primer fotograma, para la imagen fija sin JavaScript).

El garaje (garaje.png) sale de render-garage.mjs. Los fotogramas se colocan en
la franja y = FRAME_TOP·alto del garaje (mismo valor que theme.scrollFrames.frameTop).
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

VIDEO, GARAGE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 1280, 720
FRAME_TOP = 920 / 2560
os.makedirs(f'{OUT}/giro', exist_ok=True)


def matte(rgb: np.ndarray) -> np.ndarray:
    dark = rgb.max(axis=2) < 22
    m = Image.fromarray(np.where(dark, 0, 255).astype('uint8')).copy()
    for seed in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
        if m.getpixel(seed) == 0:
            ImageDraw.floodfill(m, seed, 128, thresh=0)
    car = Image.fromarray(np.where(np.array(m) == 128, 0, 255).astype('uint8'))
    # Cierre morfológico (radio ~12 px): rellena pasos de rueda y bajos.
    closed = car
    for _ in range(6):
        closed = closed.filter(ImageFilter.MaxFilter(5))
    for _ in range(6):
        closed = closed.filter(ImageFilter.MinFilter(5))
    alpha = np.maximum(np.array(car), np.array(closed)).astype(np.float32) / 255
    # Borde suave: los píxeles del contorno, según su brillo (antes mezclados con negro).
    edge = (np.array(car.filter(ImageFilter.MinFilter(3))) == 0) & (np.array(car) == 255)
    lum = rgb.max(axis=2).astype(np.float32)
    alpha[edge] = np.clip(lum[edge] / 90, 0.25, 1)
    return alpha


def frame(path: str) -> Image.Image:
    rgb = np.asarray(Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32)
    a = matte(rgb.astype(np.uint8))
    rows = np.where(a[: int(H * 0.9)].max(axis=1) > 0.5)[0]
    cols = np.where(a[: int(H * 0.9)].max(axis=0) > 0.5)[0]
    bottom, left, right = rows.max(), cols.min(), cols.max()
    out = np.zeros((H, W, 4), np.float32)
    # Sombra de contacto
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).ellipse([left + 10, bottom - 18, right - 10, bottom + 14], fill=200)
    sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(16))).astype(np.float32) / 255
    out[..., 3] = sh * 0.85
    # Reflejo (el coche volteado bajo la línea del suelo, desvaneciéndose)
    span = min(H - bottom - 1, 140)
    if span > 4:
        refl_rgb = rgb[bottom - span:bottom][::-1]
        refl_a = a[bottom - span:bottom][::-1] * np.linspace(0.2, 0, span)[:, None]
        dst = out[bottom + 1:bottom + 1 + span]
        blend = refl_a + dst[..., 3] * (1 - refl_a)
        dst[..., :3] = refl_rgb * refl_a[..., None] / np.maximum(blend[..., None], 1e-6)
        dst[..., 3] = blend
    # Coche encima
    ca = a[..., None]
    out_a = ca[..., 0] + out[..., 3] * (1 - ca[..., 0])
    out[..., :3] = (rgb * ca + out[..., :3] * out[..., 3:4] * (1 - ca)) / np.maximum(out_a[..., None], 1e-6)
    out[..., 3] = out_a
    return Image.fromarray(np.clip(np.round(out * [1, 1, 1, 255]), 0, 255).astype('uint8'), 'RGBA')


with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['ffmpeg', '-v', 'error', '-i', VIDEO, '-vsync', '0', f'{tmp}/f%03d.png'], check=True)
    names = sorted(n for n in os.listdir(tmp) if n.endswith('.png'))
    first = None
    for i, name in enumerate(names):
        img = frame(f'{tmp}/{name}')
        img.save(f'{OUT}/giro/{i:03d}.webp', quality=72, method=5)
        if first is None:
            first = img
    print(f'{len(names)} fotogramas')

garage = Image.open(GARAGE).convert('RGB')
garage.save(f'{OUT}/garaje.webp', quality=80, method=5)
poster = garage.resize((W, int(garage.height * W / garage.width)), Image.LANCZOS)
poster.paste(first, (0, round(FRAME_TOP * poster.height)), first)
poster.save(f'{OUT}/portada.webp', quality=80, method=5)
print('garaje y portada listos')
