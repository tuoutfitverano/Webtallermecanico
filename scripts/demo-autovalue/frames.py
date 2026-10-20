#!/usr/bin/env python3
"""
Prepara las imágenes del coche que gira (taller demo AutoValue).

  python3 scripts/demo-autovalue/frames.py <vídeo.mp4 | carpeta de PNG> <garaje.png> <carpeta salida> [garaje-4k.png]

  1. Fotogramas: del vídeo (1920×1080) o de una carpeta de PNG ya reescalados a
     4K con Real-ESRGAN (scripts/demo-autovalue/upscale.py).
  2. Recorta el coche: el negro conectado con los bordes pasa a transparente; los
     huecos pequeños (pasos de rueda, bajos) se rellenan para que no se vea el
     garaje a través del coche. Ventanillas y neumáticos se conservan.
  3. Quita la marca de agua del vídeo de origen (esquina inferior derecha, fuera
     del coche), oscurece las lunas (tintado) y enfoca ligeramente cada fotograma.
  4. Añade sombra de contacto y reflejo suave en el suelo pulido.
  5. Guarda giro/000.webp… (1920 px, con transparencia) y, si los fotogramas son
     4K, giro-4k/000.webp… (3840 px); garaje.webp (+ garaje-4k.webp) y
     portada.webp (garaje + primer fotograma: la imagen fija sin JavaScript).

El garaje sale de render-garage.mjs. Los fotogramas se colocan en la franja
y = FRAME_TOP·alto del garaje (mismo valor que theme.scrollFrames.frameTop).
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, GARAGE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
GARAGE_4K = sys.argv[4] if len(sys.argv) > 4 else None
MW, MH = 1280, 720          # el recorte se calcula a esta resolución (rápido) y se escala
FRAME_TOP = 920 / 2560
# Marca de agua «KlingAI 4.0» del vídeo de origen (fracciones del fotograma); el coche nunca llega ahí.
WATERMARK = (0.86, 0.92, 0.99, 0.985)


def tint_windows(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Lunas más tintadas: oscurece los grises poco saturados del coche (cristales,
    gomas), no la carrocería blanca ni los pilotos (saturados)."""
    lum = rgb.max(axis=2)
    sat = lum - rgb.min(axis=2)
    gray = np.clip((40 - sat) / 20, 0, 1)                 # 1 = gris
    f = np.clip(lum / 140, 0, 1)
    factor = 0.4 + 0.6 * f ** 2                             # 60 → ~31, 100 → ~71, ≥140 igual
    k = 1 - (1 - factor) * gray * (alpha > 0.9)
    return rgb * k[..., None]


def matte(rgb: np.ndarray) -> np.ndarray:
    """Transparencia del coche (0–1) a 1280×720."""
    dark = rgb.max(axis=2) < 22
    m = Image.fromarray(np.where(dark, 0, 255).astype('uint8')).copy()
    for seed in [(0, 0), (MW - 1, 0), (0, MH - 1), (MW - 1, MH - 1)]:
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


def frame(img: Image.Image) -> Image.Image:
    W, H = img.size
    k = W / MW
    sharp = img.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6 * k, percent=55, threshold=2))
    rgb = np.asarray(sharp).astype(np.float32)
    small = np.asarray(img.convert('RGB').resize((MW, MH), Image.LANCZOS))
    a_small = matte(small)
    x0, y0, x1, y1 = (round(v * d) for v, d in zip(WATERMARK, (MW, MH, MW, MH)))
    a_small[y0:y1, x0:x1] = 0
    a = np.asarray(Image.fromarray((a_small * 255).astype('uint8')).resize((W, H), Image.BICUBIC)).astype(np.float32) / 255
    rgb = tint_windows(rgb, a)
    rows = np.where(a_small[: int(MH * 0.9)].max(axis=1) > 0.5)[0]
    cols = np.where(a_small[: int(MH * 0.9)].max(axis=0) > 0.5)[0]
    bottom, left, right = int(rows.max() * k), int(cols.min() * k), int(cols.max() * k)
    out = np.zeros((H, W, 4), np.float32)
    # Sombra de contacto
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).ellipse([left + 10 * k, bottom - 18 * k, right - 10 * k, bottom + 14 * k], fill=200)
    sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(16 * k))).astype(np.float32) / 255
    out[..., 3] = sh * 0.85
    # Reflejo (el coche volteado bajo la línea del suelo, desvaneciéndose)
    span = min(H - bottom - 1, int(140 * k))
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


def sources():
    if os.path.isdir(SRC):
        for name in sorted(n for n in os.listdir(SRC) if n.endswith('.png')):
            yield Image.open(f'{SRC}/{name}')
        return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['ffmpeg', '-v', 'error', '-i', SRC, '-vsync', '0', f'{tmp}/f%03d.png'], check=True)
        for name in sorted(n for n in os.listdir(tmp) if n.endswith('.png')):
            yield Image.open(f'{tmp}/{name}')


os.makedirs(f'{OUT}/giro', exist_ok=True)
first = None
count = 0
for i, src in enumerate(sources()):
    img = frame(src)
    if img.width >= 3840:
        os.makedirs(f'{OUT}/giro-4k', exist_ok=True)
        img.save(f'{OUT}/giro-4k/{i:03d}.webp', quality=82, method=5)
    std = img.resize((1920, round(img.height * 1920 / img.width)), Image.LANCZOS) if img.width != 1920 else img
    std.save(f'{OUT}/giro/{i:03d}.webp', quality=80, method=5)
    if first is None:
        first = std
    count += 1
print(f'{count} fotogramas')

garage = Image.open(GARAGE).convert('RGB')
garage = garage.resize((1920, round(garage.height * 1920 / garage.width)), Image.LANCZOS) if garage.width != 1920 else garage
garage.save(f'{OUT}/garaje.webp', quality=82, method=5)
if GARAGE_4K:
    Image.open(GARAGE_4K).convert('RGB').save(f'{OUT}/garaje-4k.webp', quality=82, method=5)
poster = garage.copy()
poster.paste(first, (0, round(FRAME_TOP * poster.height)), first)
poster.save(f'{OUT}/portada.webp', quality=80, method=5)
print('garaje y portada listos')
