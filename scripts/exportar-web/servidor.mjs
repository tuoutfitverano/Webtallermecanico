/**
 * Servidor de archivos MÍNIMO (como el de cualquier alojamiento): sirve una
 * carpeta, `/ruta` → `ruta/index.html` y, si no existe, `404.html` con estado
 * 404. Lo usan el script de exportación (para saber qué archivos pide la web)
 * y la comprobación (para demostrar que la copia funciona sin la plataforma).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

async function fileFor(root, pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (clean.split(sep).includes('..')) return null;
  for (const candidate of [join(root, clean), join(root, clean, 'index.html')]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // siguiente
    }
  }
  return null;
}

/** Arranca el servidor en un puerto libre. Devuelve { url, close, requested }. */
export async function serveFolder(root) {
  const requested = new Set();
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const file = await fileFor(root, pathname);
    if (file) {
      requested.add(file.slice(root.length + 1).split(sep).join('/'));
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(await readFile(file));
      return;
    }
    const notFound = join(root, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(await readFile(notFound).catch(() => 'No encontrado'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requested, close: () => new Promise(resolve => server.close(resolve)) };
}
