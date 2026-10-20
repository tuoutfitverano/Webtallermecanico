#!/usr/bin/env python3
"""
Convierte las pantallas guardadas por e2e/vista-previa.spec.ts en páginas
estáticas navegables (vista previa sin servidor ni base de datos).

  python3 scripts/vista-previa/build.py <carpeta capturas> <carpeta salida> <preview.js>

  · Estilos y fuentes: archivos compartidos en assets/ (fuentes como data URI).
  · Enlaces internos: a la página capturada correspondiente; si no se capturó,
    el enlace avisa de que no está incluido (data-vp-off).
  · Scripts de desarrollo fuera; se añade assets/preview.js (comportamiento
    del panel + avisos de «vista previa»: nada se guarda ni se finge guardar).
"""
import base64, hashlib, json, os, re, shutil, sys

SRC, OUT, PREVIEW_JS = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = '/home/user/Webtallermecanico'
os.makedirs(f'{OUT}/assets', exist_ok=True)
shutil.copy(PREVIEW_JS, f'{OUT}/assets/preview.js')

ROLES = {'taller': ('t', '/panel'), 'trabajador': ('w', '/panel'), 'cliente': ('c', '/portal')}
PUBLIC = {'': 'index.html', 'acceso': 'acceso.html', 'registro': 'registro.html', 'recuperar': 'recuperar.html',
          'privacidad': 'privacidad.html', 'aviso-legal': 'aviso-legal.html', 'cookies': 'cookies.html',
          'condiciones': 'condiciones.html', 'privacidad-cuenta': 'privacidad-cuenta.html'}
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
fonts, styles = {}, {}


def font(m):
    path = m.group(1).replace('/@fs', '', 1)
    if path not in fonts:
        fonts[path] = base64.b64encode(open(path, 'rb').read()).decode()
    return f'url(data:font/woff2;base64,{fonts[path]}) format("woff2")'


def style_file(css):
    css = re.sub(r',\s*url\(/@fs[^)]*\.woff\)\s*format\(["\']woff["\']\)', '', css)
    css = re.sub(r'url\((/@fs[^)]*\.woff2)\)\s*format\(["\']woff2["\']\)', font, css)
    assert '/@fs' not in css
    name = f'assets/s-{hashlib.sha1(css.encode()).hexdigest()[:10]}.css'
    if name not in styles:
        styles[name] = css
        open(f'{OUT}/{name}', 'w', encoding='utf-8').write(css)
    return f'<link rel="stylesheet" href="{name}">'


# Los identificadores (UUID) cambian cada vez que se generan los datos de demostración:
# se sustituyen por números según el orden en que aparecen en el recorrido, para que los
# nombres de archivo sean estables y una nueva publicación sustituya a la anterior.
ids = {}


def short(m):
    return ids.setdefault(m.group(0), f'n{len(ids) + 1}')


def filename(prefix, path):
    path, _, query = path.partition('?')
    slug = re.sub(r'[^a-z0-9]+', '-', UUID.sub(short, path.lower())).strip('-')
    if query:
        slug += '__' + re.sub(r'[^a-z0-9]+', '-', UUID.sub(short, query.lower())).strip('-')
    return f'{prefix}-{slug}.html'


pages = {}
for role, (prefix, home) in ROLES.items():
    index = json.load(open(f'{SRC}/{role}/index.json'))
    files = {path: filename(prefix, path) for path in index}

    def link(m, files=files, prefix=prefix, home=home):
        raw = m.group(1).replace('&amp;', '&')
        path, hashpart = (raw.split('#', 1) + [''])[:2]
        frag = f'#{hashpart}' if hashpart else ''
        if path == '/mi-area':
            path = home
        if path in files:
            return f'href="{files[path]}{frag}"'
        if path.lstrip('/') in PUBLIC:
            return f'href="{PUBLIC[path.lstrip("/")]}{frag}"'
        if path == '/favicon.svg':
            return 'href="#"'
        return 'href="#" data-vp-off'

    for path, file in index.items():
        html = open(f'{SRC}/{role}/{file}', encoding='utf-8').read()
        html = re.sub(r'<script type="module" src="[^"]*"></script>', '', html)
        html = re.sub(r'<script type="module"[^>]*>.*?</script>', '', html, flags=re.S)
        html = re.sub(r'<link rel="icon"[^>]*>|<meta name="astro-view-transitions[^>]*>', '', html)
        html = re.sub(r'<style[^>]*>(.*?)</style>', lambda m: style_file(m.group(1)), html, flags=re.S)
        html = re.sub(r'href="(/[^"]*)"', link, html)
        html = re.sub(r'(<form[^>]*action="/salir"[^>]*)>', r'\1 data-vp-logout>', html)
        html = html.replace('<main id="contenido" class="pnl-content" tabindex="-1">',
                            '<main id="contenido" class="pnl-content" tabindex="-1"><p class="vp-bar" role="note" style="margin:0 0 18px;padding:10px 14px;border:1px solid rgb(252 211 77 / .45);border-radius:12px;background:rgb(252 211 77 / .08);color:var(--alert-warn,#fde68a);font-size:.875rem;line-height:1.45"><strong>Vista previa</strong> con datos de demostración: los cambios no se guardan; el email y la consulta de matrículas son simulados. <a href="index.html" style="color:inherit">Ver la web pública</a></p>', 1)
        html = html.replace('</body>', '<script type="module" src="assets/preview.js"></script></body>', 1)
        assert 'href="/' not in html and '/@vite' not in html, (role, path)
        open(f'{OUT}/{files[path]}', 'w', encoding='utf-8').write(html)
        pages[files[path]] = path

print(f'{len(pages)} páginas, {len(styles)} hojas de estilo')
