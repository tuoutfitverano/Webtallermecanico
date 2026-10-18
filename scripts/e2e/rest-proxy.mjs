#!/usr/bin/env node
/**
 * "Supabase mínimo" para pruebas: reenvía /rest/v1/* a PostgREST y /auth/v1/*
 * al servidor de Supabase Auth, como hace la pasarela de Supabase. Permite
 * simular una caída de la base de datos:
 *   POST /__mode {"fail": true}  → /rest/v1 responde 503.
 * Uso: node rest-proxy.mjs <puerto> <url-postgrest> [url-auth]
 */
import http from 'node:http';
const [port, restTarget, authTarget] = process.argv.slice(2);
let fail = false;
http.createServer(async (req, res) => {
  if (req.url === '/__mode' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    fail = Boolean(JSON.parse(raw || '{}').fail);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ fail }));
    return;
  }
  const route = req.url?.startsWith('/rest/v1/') ? { prefix: '/rest/v1', target: restTarget }
    : authTarget && req.url?.startsWith('/auth/v1/') ? { prefix: '/auth/v1', target: authTarget } : null;
  if (!route) { res.writeHead(404).end(); return; }
  if (fail && route.prefix === '/rest/v1') { res.writeHead(503, { 'content-type': 'application/json' }).end('{"message":"caída simulada"}'); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  try {
    const up = await fetch(route.target + req.url.slice(route.prefix.length), {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: 'manual',
    });
    const out = Buffer.from(await up.arrayBuffer());
    const h = Object.fromEntries([...up.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k)));
    res.writeHead(up.status, h).end(out);
  } catch {
    res.writeHead(502).end('{"message":"el servicio no responde"}');
  }
}).listen(Number(port), '127.0.0.1');
