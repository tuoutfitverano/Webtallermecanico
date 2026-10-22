#!/usr/bin/env python3
"""
Fotogramas del coche que gira hasta la trasera y abre el maletero (taller demo
AutoValue), a partir del vídeo aportado por el propietario (KlingAI).

  pip install rembg   # una vez (modelo BiRefNet, se descarga solo la primera vez)
  python3 -I scripts/demo-autovalue/frames-maletero.py <vídeo.mp4> <carpeta salida> [paso]

  1. Toma uno de cada «paso» fotogramas del vídeo (por defecto 2: 61 de 122).
  2. Recorta el coche con un modelo de segmentación (rembg + BiRefNet): el vídeo
     cambia de fondo (negro → sala blanca con plataforma), así que no basta con
     quitar el negro como en frames.py.
  3. Limpia el recorte (solo la pieza más grande: fuera trozos de la plataforma) y,
     donde el vídeo corta el coche por arriba (el portón abierto llega al borde),
     difumina el borde para que no se vea un corte recto. La cámara se acerca al
     final: el coche se reduce lo justo para que el parachoques no toque el borde
     de abajo y quepa su sombra (cambio suave, fotograma a fotograma).
  4. Oscurece las lunas, enfoca un poco y añade sombra de contacto y reflejo
     (lo mismo que frames.py) para que se apoye en el suelo del garaje.
  5. Guarda maletero/000.webp… (1920 px, con transparencia) y portada-maletero.webp
     (garaje + primer fotograma: la imagen fija sin JavaScript).

El garaje es el mismo de siempre (public/demo/autovalue/garaje.webp) y los
fotogramas van en la franja y = FRAME_TOP·alto del garaje (theme.scrollFrames.frameTop).
"""
import os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import new_session, remove
from scipy import ndimage

# Modo interno: «--mascara entrada.png salida.png modelo» calcula un solo recorte y
# termina (el modelo completo acumula memoria: cada fotograma va en su propio proceso).
if len(sys.argv) == 5 and sys.argv[1] == '--mascara':
    remove(Image.open(sys.argv[2]).convert('RGB'), session=new_session(sys.argv[4]), only_mask=True).save(sys.argv[3])
    sys.exit(0)

SRC, OUT = sys.argv[1], sys.argv[2]
STEP = int(sys.argv[3]) if len(sys.argv) > 3 else 2
ROOT = os.path.dirname(os.path.abspath(__file__))
GARAGE = os.path.join(ROOT, '../../apps/web/public/demo/autovalue/garaje.webp')
FRAME_TOP = 920 / 2560
W = 1920
FADE = 0.06  # alto del difuminado del borde superior (fracción del fotograma)
MARGIN = 70  # espacio libre bajo el coche (px a 1920), para la sombra y el reflejo
# Los recortes (lo lento) se guardan aquí y se reutilizan si se repite el proceso.
CACHE = os.path.join(OUT, '_mascaras')
# Desde este fotograma (salida) aparece la plataforma junto al parachoques: allí se usa
# el modelo completo (más preciso en el contorno, ~40 s por fotograma); antes, el ligero.
FULL_FROM = 26

sessions = {}


def mask(img, key, model):
    path = f'{CACHE}/{model.split("-")[-1]}-{key}.png'
    if os.path.exists(path):
        return np.asarray(Image.open(path)).astype(np.float32) / 255
    os.makedirs(CACHE, exist_ok=True)
    if model == 'birefnet-general':
        sessions.clear()  # libera el modelo ligero antes de cargar el completo
        src = f'{CACHE}/_entrada.png'
        img.save(src)
        subprocess.run([sys.executable, '-I', os.path.abspath(__file__), '--mascara', src, path, model], check=True)
        os.remove(src)
        return np.asarray(Image.open(path)).astype(np.float32) / 255
    if model not in sessions:
        sessions[model] = new_session(model)
    m = remove(img, session=sessions[model], only_mask=True)
    m.save(path)
    return np.asarray(m).astype(np.float32) / 255


def clean(a):
    """Solo la pieza más grande del recorte (el coche), con su borde suave."""
    labels, n = ndimage.label(a > 0.5)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(a), labels, range(1, n + 1))
        keep = labels == (1 + int(np.argmax(sizes)))
        keep = ndimage.binary_dilation(keep, iterations=3)
        a = a * keep
    return a


def tint_windows(rgb, alpha):
    """Lunas más tintadas: oscurece los grises poco saturados del coche (cristales,
    gomas, interior), no la carrocería blanca ni los pilotos (saturados)."""
    lum = rgb.max(axis=2)
    sat = lum - rgb.min(axis=2)
    gray = np.clip((40 - sat) / 20, 0, 1)
    f = np.clip(lum / 140, 0, 1)
    factor = 0.4 + 0.6 * f ** 2
    k = 1 - (1 - factor) * gray * (alpha > 0.9)
    return rgb * k[..., None]


def frame(img, key, model):
    img = img.convert('RGB')
    if img.width != W:
        img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    w, h = img.size
    a = clean(mask(img, key, model))
    # Corte del vídeo por arriba: difuminado progresivo en la franja superior.
    band = int(h * FADE)
    if a[:2].max() > 0.5:
        a[:band] *= np.linspace(0, 1, band)[:, None] ** 1.5
    rgb = np.asarray(img.filter(ImageFilter.UnsharpMask(radius=2.4, percent=45, threshold=2))).astype(np.float32)
    rgb = tint_windows(rgb, a)
    # Si el coche llega abajo, se reduce (desde el centro de arriba) para dejar MARGIN libre.
    rows = np.where(a.max(axis=1) > 0.5)[0]
    s = min(1.0, (h - MARGIN) / (rows.max() + 1))
    if s < 1:
        nw, nh = round(w * s), round(h * s)
        x0 = (w - nw) // 2
        small_rgb = np.asarray(Image.fromarray(np.clip(rgb, 0, 255).astype('uint8')).resize((nw, nh), Image.LANCZOS)).astype(np.float32)
        small_a = np.asarray(Image.fromarray((a * 255).astype('uint8')).resize((nw, nh), Image.LANCZOS)).astype(np.float32) / 255
        rgb = np.zeros((h, w, 3), np.float32); rgb[:nh, x0:x0 + nw] = small_rgb
        a = np.zeros((h, w), np.float32); a[:nh, x0:x0 + nw] = small_a
        rows = np.where(a.max(axis=1) > 0.5)[0]
    cols = np.where(a.max(axis=0) > 0.5)[0]
    bottom, left, right = int(rows.max()), int(cols.min()), int(cols.max())
    out = np.zeros((h, w, 4), np.float32)
    # Sombra de contacto
    sh = Image.new('L', (w, h), 0)
    ImageDraw.Draw(sh).ellipse([left + 15, bottom - 27, right - 15, bottom + 21], fill=200)
    sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(24))).astype(np.float32) / 255
    out[..., 3] = sh * 0.85
    # Reflejo (el coche volteado bajo el suelo, desvaneciéndose)
    span = min(h - bottom - 1, 210)
    if span > 4:
        refl_rgb = rgb[bottom - span:bottom][::-1]
        refl_a = a[bottom - span:bottom][::-1] * np.linspace(0.2, 0, span)[:, None]
        dst = out[bottom + 1:bottom + 1 + span]
        blend = refl_a + dst[..., 3] * (1 - refl_a)
        dst[..., :3] = refl_rgb * refl_a[..., None] / np.maximum(blend[..., None], 1e-6)
        dst[..., 3] = blend
    ca = a[..., None]
    out_a = ca[..., 0] + out[..., 3] * (1 - ca[..., 0])
    out[..., :3] = (rgb * ca + out[..., :3] * out[..., 3:4] * (1 - ca)) / np.maximum(out_a[..., None], 1e-6)
    out[..., 3] = out_a
    return Image.fromarray(np.clip(np.round(out * [1, 1, 1, 255]), 0, 255).astype('uint8'), 'RGBA')


os.makedirs(f'{OUT}/maletero', exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['ffmpeg', '-v', 'error', '-i', SRC, '-vsync', '0', f'{tmp}/f%03d.png'], check=True)
    names = sorted(n for n in os.listdir(tmp) if n.endswith('.png'))
    picked = names[::STEP]
    if picked[-1] != names[-1]:
        picked.append(names[-1])  # el último fotograma (maletero abierto) siempre
    first = None
    for i, name in enumerate(picked):
        model = 'birefnet-general' if i >= FULL_FROM else 'birefnet-general-lite'
        img = frame(Image.open(f'{tmp}/{name}'), name[:-4], model)
        img.save(f'{OUT}/maletero/{i:03d}.webp', quality=80, method=5)
        first = first or img
        print(f'{i + 1}/{len(picked)}', flush=True)

garage = Image.open(GARAGE).convert('RGB')
poster = garage.copy()
poster.paste(first, (0, round(FRAME_TOP * poster.height)), first)
poster.save(f'{OUT}/portada-maletero.webp', quality=80, method=5)
print(f'{len(picked)} fotogramas y portada listos')
