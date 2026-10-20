"""Reescala fotogramas ×2 con Real-ESRGAN (CPU). Uso: upscale.py <modelo.pth> <entrada_dir> <salida_dir> [n_max]"""
import os, sys, time
import numpy as np, torch
from PIL import Image
from spandrel import ModelLoader
model = ModelLoader().load_from_file(sys.argv[1]).eval()
src, dst = sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 10**9
os.makedirs(dst, exist_ok=True)
torch.set_num_threads(os.cpu_count())
TILE, PAD = 256, 16
for name in sorted(os.listdir(src))[:limit]:
    out_path = f'{dst}/{name}'
    if os.path.exists(out_path): continue
    t = time.time()
    img = np.asarray(Image.open(f'{src}/{name}').convert('RGB')).astype(np.float32) / 255
    h, w, _ = img.shape
    x = torch.from_numpy(img).permute(2, 0, 1)[None]
    out = torch.zeros(1, 3, h * 2, w * 2)
    with torch.inference_mode():
        for y0 in range(0, h, TILE):
            for x0 in range(0, w, TILE):
                ys, xs = max(0, y0 - PAD), max(0, x0 - PAD)
                ye, xe = min(h, y0 + TILE + PAD), min(w, x0 + TILE + PAD)
                tile = x[..., ys:ye, xs:xe]
                if float(tile.max()) < 3 / 255:  # fondo negro: no hace falta el modelo
                    continue
                r = model(tile)
                oy, ox = (y0 - ys) * 2, (x0 - xs) * 2
                th, tw = min(TILE, h - y0) * 2, min(TILE, w - x0) * 2
                out[..., y0 * 2:y0 * 2 + th, x0 * 2:x0 * 2 + tw] = r[..., oy:oy + th, ox:ox + tw]
    arr = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)
    Image.fromarray(arr).save(out_path)
    print(name, f'{time.time() - t:.1f}s', flush=True)
