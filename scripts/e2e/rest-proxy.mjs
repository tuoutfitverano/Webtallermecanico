#!/usr/bin/env node
/**
 * "Supabase mínimo" para pruebas: reenvía /rest/v1/* a PostgREST, como hace
 * la pasarela de Supabase. Permite simular una caída del backend:
 *   POST /__mode {"fail": true}  → todas las peticiones responden 503.
 * Uso: node rest-proxy.mjs <puerto> <url-postgrest>
 */
import http from 'node:http';
const [port, target] = process.argv.slice(2);
let fail = false;
http.createServer(async (req, res) => {
  if (req.url === '/__mode' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    fail = Boolean(JSON.parse(raw || '{}').fail);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ fail }));
    return;
  }
  if (fail) { res.writeHead(503, { 'content-type': 'application/json' }).end('{"message":"caída simulada"}'); return; }
  if (!req.url?.startsWith('/rest/v1/')) { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  try {
    const up = await fetch(target + req.url.slice('/rest/v1'.length), {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const out = Buffer.from(await up.arrayBuffer());
    const h = Object.fromEntries([...up.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k)));
    res.writeHead(up.status, h).end(out);
  } catch {
    res.writeHead(502).end('{"message":"PostgREST no responde"}');
  }
}).listen(Number(port), '127.0.0.1');
